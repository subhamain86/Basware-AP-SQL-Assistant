import { secretVaultService, DEFAULT_BOOTSTRAP_CONFIG } from './secretVaultService.js';
import { schemaService } from './schemaService.js';
import { validateIncomingRegistryFile } from '../engines/schemaIntegrityEngine.js';
import { detectConflict } from '../engines/schemaVersionEngine.js';
import { getFile, putFile, isGitHubApiError } from './githubApiService.js';
import { assertSyncConfigOrError, safeTrim, sanitizeIncomingSchema, safeLocalStorageSet } from '../utils/validation.js';
import { makeId } from '../utils/id.js';
import { beginInternalSync, endInternalSync } from './syncCoordination.js';
const CONFIG_KEY = 'sqla.syncconfig.v147';
const STATUS_KEY = 'sqla.syncstatus.v147';
const LAST_KNOWN_SHA_KEY = 'sqla.lastsha.v147';
const PENDING_CONFLICTS_KEY = 'sqla.pendingconflicts.v147';
const SYNC_LOG_KEY = 'sqla.synclog.v147';
const MAX_LOG_ENTRIES = 30;
function loadConfig() { try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw)
        return JSON.parse(raw);
}
catch { } return { source: 'shared-location', time: 'manual', customTime: null }; }
function loadPendingConflicts() { try {
    const raw = localStorage.getItem(PENDING_CONFLICTS_KEY);
    if (raw)
        return JSON.parse(raw);
}
catch { } return []; }
function loadSyncLog() { try {
    const raw = localStorage.getItem(SYNC_LOG_KEY);
    if (raw)
        return JSON.parse(raw);
}
catch { } return []; }
class SyncService {
    constructor() {
        this.config = loadConfig();
        this.status = localStorage.getItem(STATUS_KEY) || 'never';
        this.lastSyncedAt = null;
        this.directoryHandle = null;
        this.listeners = new Set();
        this.scheduleTimer = null;
        this.pendingConflicts = loadPendingConflicts();
        this.syncLog = loadSyncLog();
    }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    notify() { this.listeners.forEach((l) => l()); }
    persistConfig() { safeLocalStorageSet(CONFIG_KEY, JSON.stringify(this.config)); }
    persistPendingConflicts() { safeLocalStorageSet(PENDING_CONFLICTS_KEY, JSON.stringify(this.pendingConflicts)); this.notify(); }
    logEvent(kind, message) {
        this.syncLog = [{ id: makeId('synclog'), timestamp: new Date().toISOString(), kind, message }, ...this.syncLog].slice(0, MAX_LOG_ENTRIES);
        safeLocalStorageSet(SYNC_LOG_KEY, JSON.stringify(this.syncLog));
        this.notify();
    }
    getConfig() { return this.config; }
    getStatus() { return this.status; }
    getLastSyncedAt() { return this.lastSyncedAt; }
    getPendingConflicts() { return this.pendingConflicts; }
    getSyncLog() { return this.syncLog; }
    isFileSystemAccessSupported() { return typeof window.showDirectoryPicker === 'function'; }
    hasConnectedLocation() { return this.directoryHandle !== null; }
    setSource(source) { this.config = { ...this.config, source }; this.persistConfig(); this.notify(); }
    setTime(time, customTime = null) { this.config = { ...this.config, time, customTime }; this.persistConfig(); this.rescheduleTimer(); this.notify(); }
    rescheduleTimer() { if (this.scheduleTimer) {
        clearInterval(this.scheduleTimer);
        this.scheduleTimer = null;
    } const ms = this.intervalMsFor(this.config.time); if (ms)
        this.scheduleTimer = setInterval(() => { this.pullRegistryFromGitHub().catch(() => { }); }, ms); }
    intervalMsFor(t) { switch (t) {
        case '15m': return 15 * 60000;
        case '30m': return 30 * 60000;
        case '1h': return 60 * 60000;
        case '4h': return 4 * 60 * 60000;
        case '6h': return 6 * 60 * 60000;
        case 'daily': return 24 * 60 * 60000;
        default: return null;
    } }
    async connectSharedLocation() {
        if (!this.isFileSystemAccessSupported())
            return { ok: false, error: 'This browser does not support the File System Access API. Use Import/Export instead, or switch to GitHub sync.' };
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            this.directoryHandle = handle;
            const label = handle.name;
            this.notify();
            return { ok: true, label };
        }
        catch (e) {
            return { ok: false, error: 'Folder selection was cancelled or denied.' };
        }
    }
    lastKnownSha() { return localStorage.getItem(LAST_KNOWN_SHA_KEY); }
    setLastKnownSha(sha) { if (sha)
        safeLocalStorageSet(LAST_KNOWN_SHA_KEY, sha);
    else
        localStorage.removeItem(LAST_KNOWN_SHA_KEY); }
    missingConfigMessage() {
        if (!secretVaultService.isUnlocked())
            return 'The Secret Vault is locked. Enter the Admin Password to unlock it and enable synchronization.';
        const cfg = secretVaultService.getConfig();
        const result = assertSyncConfigOrError([
            { key: 'githubRepo', label: 'Repository', value: cfg.githubRepo, required: true },
            { key: 'githubBranch', label: 'Branch', value: cfg.githubBranch, required: false },
            { key: 'githubSchemaPath', label: 'Repository Path', value: cfg.githubSchemaPath, required: true },
            { key: 'githubToken', label: 'Access Token', value: cfg.githubToken, required: true, sensitive: true }
        ]);
        return result.ok ? null : result.message;
    }
    addPendingConflict(schemaId, schemaName, localVersion, remoteVersion, changedPaths, remoteSchema) {
        const existing = this.pendingConflicts.find((c) => c.schemaId === schemaId);
        const conflict = { id: existing?.id || makeId('conflict'), schemaId, schemaName, localVersion, remoteVersion, changedPaths, remoteSchemaJson: JSON.stringify(remoteSchema), detectedAt: new Date().toISOString() };
        this.pendingConflicts = [...this.pendingConflicts.filter((c) => c.schemaId !== schemaId), conflict];
        this.persistPendingConflicts();
        return conflict;
    }
    resolvePendingConflict(conflictId, decision) {
        const conflict = this.pendingConflicts.find((c) => c.id === conflictId);
        if (!conflict)
            return;
        beginInternalSync();
        try {
            if (decision === 'remote') {
                try {
                    const remoteSchema = JSON.parse(conflict.remoteSchemaJson);
                    schemaService.replaceSchemaContent(conflict.schemaId, remoteSchema);
                }
                catch { }
            }
        }
        finally {
            endInternalSync();
        }
        this.pendingConflicts = this.pendingConflicts.filter((c) => c.id !== conflictId);
        this.persistPendingConflicts();
    }
    /** V14.7 — THE fix for "other device is not getting the uploaded schema
     * synced". In V14.6, EVERY discovery/pull required the password-protected
     * Secret Vault to already be unlocked (missingConfigMessage() returned
     * early if locked), which meant a second device would never learn about
     * a newly uploaded schema unless a person physically opened Settings and
     * typed the Admin Password on THAT device first. Reading file contents
     * from a PUBLIC GitHub repository does not require authentication (GitHub
     * allows unauthenticated GET on public repo contents, just at a lower
     * rate limit) — only PUSHING (writing) requires the access token. This
     * method performs a read-only "is there anything new?" discovery pull
     * against the well-known default public repository/path, with NO
     * password or unlocked vault required, and is invoked automatically on
     * every app load (see layouts/appShell.ts) and whenever a schema-related
     * page is opened. Editing/pushing still correctly requires the vault to
     * be unlocked — this only affects *discovering and receiving* schemas
     * other devices already published. */
    async discoverPublicRegistry(reason) {
        try {
            const repo = DEFAULT_BOOTSTRAP_CONFIG.githubRepo;
            const branch = DEFAULT_BOOTSTRAP_CONFIG.githubBranch;
            const path = DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath;
            const file = await getFile(repo, branch, path, '');
            if (!file)
                return { ok: true, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
            const parsedRaw = JSON.parse(file.content);
            const integrity = validateIncomingRegistryFile(parsedRaw);
            if (!integrity.valid)
                return { ok: false, error: 'Remote schema file failed validation.', newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
            const parsed = parsedRaw;
            const sanitizedSchemas = Array.isArray(parsed.schemas) ? parsed.schemas.map((s) => sanitizeIncomingSchema(s)) : [];
            beginInternalSync();
            const newSchemasAdded = [];
            const updatedSchemas = [];
            let unchanged = 0;
            try {
                for (const remoteSchema of sanitizedSchemas) {
                    const local = schemaService.getSchemaById(remoteSchema.id);
                    if (!local) {
                        const outcome = schemaService.addSchemaFromRemote(remoteSchema);
                        if (outcome === 'added')
                            newSchemasAdded.push(remoteSchema.name);
                        else if (outcome === 'updated')
                            updatedSchemas.push(remoteSchema.name);
                        else
                            unchanged += 1;
                        continue;
                    }
                    const conflict = detectConflict(local, remoteSchema);
                    if (!conflict.hasConflict) {
                        unchanged += 1;
                        continue;
                    }
                    // Silent/unauthenticated discovery never auto-resolves conflicts —
                    // it only surfaces genuinely NEW schemas. Conflicting updates to
                    // an already-known schema still require an authenticated
                    // pull (Sync Now / vault unlock) so provenance/versioning stays
                    // correct and no one's in-progress edits are silently overwritten.
                }
            }
            finally {
                endInternalSync();
            }
            if (newSchemasAdded.length || updatedSchemas.length)
                this.logEvent('discovery', `Public discovery (${reason}): ${newSchemasAdded.length} new schema(s), ${updatedSchemas.length} updated: ${[...newSchemasAdded, ...updatedSchemas].join(', ')}.`);
            return { ok: true, newSchemasAdded, updatedSchemas, conflicts: [], unchanged };
        }
        catch (e) {
            return { ok: false, error: e?.message || 'Unknown error during public discovery.', newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
        }
    }
    async pullRegistryFromGitHub() {
        const missing = this.missingConfigMessage();
        if (missing) {
            this.logEvent('error', missing);
            return { ok: false, error: missing, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
        }
        const cfg = secretVaultService.getConfig();
        this.status = 'syncing';
        this.notify();
        beginInternalSync();
        try {
            const path = safeTrim(cfg.githubSchemaPath);
            const branch = safeTrim(cfg.githubBranch) || 'main';
            const file = await getFile(cfg.githubRepo, branch, path, cfg.githubToken);
            if (!file) {
                this.status = 'never';
                this.notify();
                const msg = 'No schema file found yet at the configured path — create or import a schema to establish the repository as the source of truth.';
                this.logEvent('pull', msg);
                return { ok: false, error: msg, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
            }
            this.setLastKnownSha(file.sha);
            const parsedRaw = JSON.parse(file.content);
            const integrity = validateIncomingRegistryFile(parsedRaw);
            if (!integrity.valid) {
                this.status = 'failed';
                this.notify();
                const msg = 'Remote schema file failed validation: ' + integrity.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ');
                this.logEvent('error', msg);
                return { ok: false, error: msg, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
            }
            const parsed = parsedRaw;
            const sanitizedSchemas = Array.isArray(parsed.schemas) ? parsed.schemas.map((s) => sanitizeIncomingSchema(s)) : [];
            const remoteRegistry = { ...parsed, schemas: sanitizedSchemas };
            const newSchemasAdded = [];
            const updatedSchemas = [];
            const conflicts = [];
            let unchanged = 0;
            for (const remoteSchema of remoteRegistry.schemas) {
                const local = schemaService.getSchemaById(remoteSchema.id);
                if (!local) {
                    const outcome = schemaService.addSchemaFromRemote(remoteSchema);
                    if (outcome === 'added')
                        newSchemasAdded.push(remoteSchema.name);
                    else if (outcome === 'updated')
                        updatedSchemas.push(remoteSchema.name);
                    else
                        unchanged += 1;
                    continue;
                }
                const conflict = detectConflict(local, remoteSchema);
                if (!conflict.hasConflict) {
                    unchanged += 1;
                    continue;
                }
                conflicts.push(this.addPendingConflict(remoteSchema.id, remoteSchema.name, conflict.localVersion, conflict.remoteVersion, conflict.changedPaths, remoteSchema));
            }
            this.status = 'synchronized';
            this.lastSyncedAt = new Date().toISOString();
            safeLocalStorageSet(STATUS_KEY, this.status);
            this.logEvent('pull', `Discovery complete: ${newSchemasAdded.length} new, ${updatedSchemas.length} updated, ${unchanged} up to date, ${conflicts.length} conflict(s).`);
            this.notify();
            return { ok: true, newSchemasAdded, updatedSchemas, conflicts, unchanged };
        }
        catch (e) {
            this.status = 'failed';
            safeLocalStorageSet(STATUS_KEY, this.status);
            this.notify();
            const message = isGitHubApiError(e) ? e.message : e?.message || 'Unknown error during synchronization.';
            this.logEvent('error', message);
            return { ok: false, error: message, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
        }
        finally {
            endInternalSync();
        }
    }
    async pushRegistryToGitHub(commitMessage) {
        const missing = this.missingConfigMessage();
        if (missing) {
            this.logEvent('error', missing);
            return { ok: false, error: missing };
        }
        const cfg = secretVaultService.getConfig();
        this.status = 'syncing';
        this.notify();
        beginInternalSync();
        try {
            const registry = schemaService.getRegistry();
            const content = JSON.stringify(registry, null, 2);
            const path = safeTrim(cfg.githubSchemaPath);
            const branch = safeTrim(cfg.githubBranch) || 'main';
            const result = await putFile(cfg.githubRepo, branch, path, cfg.githubToken, content, safeTrim(commitMessage) || `Update SQL Assistant schema registry (${new Date().toISOString()})`, this.lastKnownSha());
            this.setLastKnownSha(result.sha);
            schemaService.markAllSynced();
            this.status = 'synchronized';
            this.lastSyncedAt = new Date().toISOString();
            safeLocalStorageSet(STATUS_KEY, this.status);
            this.logEvent('push', `Schema registry saved to the repository (${registry.schemas.length} schema(s)).`);
            this.notify();
            return { ok: true };
        }
        catch (e) {
            this.status = 'failed';
            safeLocalStorageSet(STATUS_KEY, this.status);
            this.notify();
            const apiErr = isGitHubApiError(e) ? e : null;
            const requiresPull = !!apiErr && (apiErr.status === 409 || apiErr.status === 422);
            const msg = apiErr?.message || e?.message || 'Unknown error during synchronization.';
            this.logEvent('error', msg);
            return { ok: false, error: msg, requiresPullFirst: requiresPull };
        }
        finally {
            endInternalSync();
        }
    }
    resolveConflict(schemaId, decision, remoteSchema) {
        if (decision === 'remote')
            schemaService.replaceSchemaContent(schemaId, remoteSchema);
    }
    async pullFromSharedLocation(activeSchema) {
        if (!this.directoryHandle)
            return { ok: false, error: 'No shared location connected yet.' };
        try {
            const fileHandle = await this.directoryHandle.getFileHandle('schema.json', { create: false });
            const file = await fileHandle.getFile();
            const text = await file.text();
            const parsed = sanitizeIncomingSchema(JSON.parse(text));
            const incoming = parsed;
            const conflict = detectConflict(activeSchema, incoming);
            return { ok: true, conflict, incoming };
        }
        catch (e) {
            return { ok: false, error: 'Could not read schema.json from the connected location: ' + e.message };
        }
    }
    async pushToSharedLocation(schema) {
        if (!this.directoryHandle)
            return { ok: false, error: 'No shared location connected yet.' };
        try {
            const fileHandle = await this.directoryHandle.getFileHandle('schema.json', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(schema, null, 2));
            await writable.close();
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: 'Could not write to the connected location: ' + e.message };
        }
    }
    async syncWithGitHubSimple() { return this.pullRegistryFromGitHub(); }
    async syncNow() {
        if (this.config.source === 'github') {
            const result = await this.pullRegistryFromGitHub();
            return { ok: result.ok, error: result.error };
        }
        this.status = 'syncing';
        this.notify();
        beginInternalSync();
        try {
            const activeSchema = schemaService.getActiveSchema();
            const result = await this.pullFromSharedLocation(activeSchema);
            this.status = result.ok ? 'synchronized' : 'failed';
            this.lastSyncedAt = new Date().toISOString();
            safeLocalStorageSet(STATUS_KEY, this.status);
            this.notify();
            return { ok: result.ok, error: result.error };
        }
        catch (e) {
            this.status = 'failed';
            safeLocalStorageSet(STATUS_KEY, this.status);
            this.notify();
            return { ok: false, error: e?.message || 'Unknown error.' };
        }
        finally {
            endInternalSync();
        }
    }
}
export const syncService = new SyncService();
