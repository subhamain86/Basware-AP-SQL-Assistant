import type { SyncConfig, SyncSource, SyncTimeOption, SyncStatus, SchemaModel, SchemaRegistry, PendingConflict, SyncLogEntry } from '../types';
import { secretVaultService, DEFAULT_BOOTSTRAP_CONFIG } from './secretVaultService';
import { schemaService } from './schemaService';
import { validateIncomingRegistryFile } from '../engines/schemaIntegrityEngine';
import { detectConflict } from '../engines/schemaVersionEngine';
import { getFile, putFile, isGitHubApiError } from './githubApiService';
import { assertSyncConfigOrError, safeTrim, sanitizeIncomingSchema, safeLocalStorageSet } from '../utils/validation';
import { makeId } from '../utils/id';
import { beginInternalSync, endInternalSync } from './syncCoordination';
const CONFIG_KEY = 'sqla.syncconfig.v15';
const STATUS_KEY = 'sqla.syncstatus.v15';
const LAST_KNOWN_SHA_KEY = 'sqla.lastsha.v15';
const PENDING_CONFLICTS_KEY = 'sqla.pendingconflicts.v15';
const SYNC_LOG_KEY = 'sqla.synclog.v15';
const MAX_LOG_ENTRIES = 30;
function loadConfig(): SyncConfig { try { const raw = localStorage.getItem(CONFIG_KEY); if (raw) return JSON.parse(raw); } catch { } return { source: 'shared-location', time: 'manual', customTime: null }; }
function loadPendingConflicts(): PendingConflict[] { try { const raw = localStorage.getItem(PENDING_CONFLICTS_KEY); if (raw) return JSON.parse(raw); } catch { } return []; }
function loadSyncLog(): SyncLogEntry[] { try { const raw = localStorage.getItem(SYNC_LOG_KEY); if (raw) return JSON.parse(raw); } catch { } return []; }
export interface PullOutcome { ok: boolean; error?: string; newSchemasAdded: string[]; updatedSchemas: string[]; conflicts: PendingConflict[]; unchanged: number; }
export interface PushOutcome { ok: boolean; error?: string; requiresPullFirst?: boolean; }
class SyncService {
  private config: SyncConfig = loadConfig();
  private status: SyncStatus = (localStorage.getItem(STATUS_KEY) as SyncStatus) || 'never';
  private lastSyncedAt: string | null = null;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private listeners = new Set<() => void>();
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private pendingConflicts: PendingConflict[] = loadPendingConflicts();
  private syncLog: SyncLogEntry[] = loadSyncLog();
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }
  private persistConfig(): void { safeLocalStorageSet(CONFIG_KEY, JSON.stringify(this.config)); }
  private persistPendingConflicts(): void { safeLocalStorageSet(PENDING_CONFLICTS_KEY, JSON.stringify(this.pendingConflicts)); this.notify(); }
  private logEvent(kind: SyncLogEntry['kind'], message: string): void { this.syncLog = [{ id: makeId('synclog'), timestamp: new Date().toISOString(), kind, message }, ...this.syncLog].slice(0, MAX_LOG_ENTRIES); safeLocalStorageSet(SYNC_LOG_KEY, JSON.stringify(this.syncLog)); this.notify(); }
  getConfig(): SyncConfig { return this.config; }
  getStatus(): SyncStatus { return this.status; }
  getLastSyncedAt(): string | null { return this.lastSyncedAt; }
  getPendingConflicts(): PendingConflict[] { return this.pendingConflicts; }
  getSyncLog(): SyncLogEntry[] { return this.syncLog; }
  isFileSystemAccessSupported(): boolean { return typeof (window as any).showDirectoryPicker === 'function'; }
  hasConnectedLocation(): boolean { return this.directoryHandle !== null; }
  setSource(source: SyncSource): void { this.config = { ...this.config, source }; this.persistConfig(); this.notify(); }
  setTime(time: SyncTimeOption, customTime: string | null = null): void { this.config = { ...this.config, time, customTime }; this.persistConfig(); this.rescheduleTimer(); this.notify(); }
  private rescheduleTimer(): void { if (this.scheduleTimer) { clearInterval(this.scheduleTimer); this.scheduleTimer = null; } const ms = this.intervalMsFor(this.config.time); if (ms) this.scheduleTimer = setInterval(() => { this.pullRegistryFromGitHub().catch(() => {}); }, ms); }
  private intervalMsFor(t: SyncTimeOption): number | null { switch (t) { case '15m': return 15 * 60000; case '30m': return 30 * 60000; case '1h': return 60 * 60000; case '4h': return 4 * 60 * 60000; case '6h': return 6 * 60 * 60000; case 'daily': return 24 * 60 * 60000; default: return null; } }
  async connectSharedLocation(): Promise<{ ok: boolean; error?: string; label?: string }> {
    if (!this.isFileSystemAccessSupported()) return { ok: false, error: 'This browser does not support the File System Access API.' };
    try { const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' }); this.directoryHandle = handle; const label = handle.name as string; this.notify(); return { ok: true, label }; }
    catch (e) { return { ok: false, error: 'Folder selection was cancelled or denied.' }; }
  }
  private lastKnownSha(): string | null { return localStorage.getItem(LAST_KNOWN_SHA_KEY); }
  private setLastKnownSha(sha: string | null): void { if (sha) safeLocalStorageSet(LAST_KNOWN_SHA_KEY, sha); else localStorage.removeItem(LAST_KNOWN_SHA_KEY); }
  private missingConfigMessage(): string | null {
    if (!secretVaultService.isUnlocked()) return 'The Secret Vault is locked. Enter the Admin Password to unlock it.';
    const cfg = secretVaultService.getConfig()!;
    const result = assertSyncConfigOrError([ { key: 'githubRepo', label: 'Repository', value: cfg.githubRepo, required: true }, { key: 'githubSchemaPath', label: 'Repository Path', value: cfg.githubSchemaPath, required: true }, { key: 'githubToken', label: 'Access Token', value: cfg.githubToken, required: true, sensitive: true } ]);
    return result.ok ? null : result.message;
  }
  private addPendingConflict(schemaId: string, schemaName: string, localVersion: string, remoteVersion: string, changedPaths: string[], remoteSchema: SchemaModel): PendingConflict {
    const existing = this.pendingConflicts.find((c) => c.schemaId === schemaId);
    const conflict: PendingConflict = { id: existing?.id || makeId('conflict'), schemaId, schemaName, localVersion, remoteVersion, changedPaths, remoteSchemaJson: JSON.stringify(remoteSchema), detectedAt: new Date().toISOString() };
    this.pendingConflicts = [...this.pendingConflicts.filter((c) => c.schemaId !== schemaId), conflict];
    this.persistPendingConflicts();
    return conflict;
  }
  resolvePendingConflict(conflictId: string, decision: 'local' | 'remote'): void {
    const conflict = this.pendingConflicts.find((c) => c.id === conflictId);
    if (!conflict) return;
    beginInternalSync();
    try { if (decision === 'remote') { try { const remoteSchema = JSON.parse(conflict.remoteSchemaJson) as SchemaModel; schemaService.replaceSchemaContent(conflict.schemaId, remoteSchema); } catch { } } } finally { endInternalSync(); }
    this.pendingConflicts = this.pendingConflicts.filter((c) => c.id !== conflictId);
    this.persistPendingConflicts();
  }
  async discoverPublicRegistry(reason: string): Promise<PullOutcome> {
    try {
      const repo = DEFAULT_BOOTSTRAP_CONFIG.githubRepo; const branch = DEFAULT_BOOTSTRAP_CONFIG.githubBranch; const path = DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath;
      const file = await getFile(repo, branch, path, '');
      if (!file) return { ok: true, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
      const parsedRaw = JSON.parse(file.content);
      const integrity = validateIncomingRegistryFile(parsedRaw);
      if (!integrity.valid) return { ok: false, error: 'Remote schema file failed validation.', newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
      const parsed = parsedRaw as Record<string, unknown>;
      const sanitizedSchemas = Array.isArray(parsed.schemas) ? (parsed.schemas as unknown[]).map((s) => sanitizeIncomingSchema(s)) : [];
      beginInternalSync();
      const newSchemasAdded: string[] = []; const updatedSchemas: string[] = []; let unchanged = 0;
      try {
        for (const remoteSchema of sanitizedSchemas as SchemaModel[]) {
          const local = schemaService.getSchemaById(remoteSchema.id);
          if (!local) { const outcome = schemaService.addSchemaFromRemote(remoteSchema); if (outcome === 'added') newSchemasAdded.push(remoteSchema.name); else if (outcome === 'updated') updatedSchemas.push(remoteSchema.name); else unchanged += 1; continue; }
          const conflict = detectConflict(local, remoteSchema);
          if (!conflict.hasConflict) { unchanged += 1; continue; }
        }
      } finally { endInternalSync(); }
      if (newSchemasAdded.length || updatedSchemas.length) this.logEvent('discovery', `Public discovery (${reason}): ${newSchemasAdded.length} new, ${updatedSchemas.length} updated.`);
      return { ok: true, newSchemasAdded, updatedSchemas, conflicts: [], unchanged };
    } catch (e) { return { ok: false, error: (e as Error)?.message || 'Unknown error during public discovery.', newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
  }
  async pullRegistryFromGitHub(): Promise<PullOutcome> {
    const missing = this.missingConfigMessage();
    if (missing) { this.logEvent('error', missing); return { ok: false, error: missing, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
    const cfg = secretVaultService.getConfig()!;
    this.status = 'syncing'; this.notify();
    beginInternalSync();
    try {
      const path = safeTrim(cfg.githubSchemaPath); const branch = safeTrim(cfg.githubBranch) || 'main';
      const file = await getFile(cfg.githubRepo, branch, path, cfg.githubToken);
      if (!file) { this.status = 'never'; this.notify(); const msg = 'No schema file found yet at the configured path.'; this.logEvent('pull', msg); return { ok: false, error: msg, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
      this.setLastKnownSha(file.sha);
      const parsedRaw = JSON.parse(file.content);
      const integrity = validateIncomingRegistryFile(parsedRaw);
      if (!integrity.valid) { this.status = 'failed'; this.notify(); const msg = 'Remote schema file failed validation.'; this.logEvent('error', msg); return { ok: false, error: msg, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
      const parsed = parsedRaw as Record<string, unknown>;
      const sanitizedSchemas = Array.isArray(parsed.schemas) ? (parsed.schemas as unknown[]).map((s) => sanitizeIncomingSchema(s)) : [];
      const remoteRegistry = { ...parsed, schemas: sanitizedSchemas } as SchemaRegistry;
      const newSchemasAdded: string[] = []; const updatedSchemas: string[] = []; const conflicts: PendingConflict[] = []; let unchanged = 0;
      for (const remoteSchema of remoteRegistry.schemas) {
        const local = schemaService.getSchemaById(remoteSchema.id);
        if (!local) { const outcome = schemaService.addSchemaFromRemote(remoteSchema); if (outcome === 'added') newSchemasAdded.push(remoteSchema.name); else if (outcome === 'updated') updatedSchemas.push(remoteSchema.name); else unchanged += 1; continue; }
        const conflict = detectConflict(local, remoteSchema);
        if (!conflict.hasConflict) { unchanged += 1; continue; }
        conflicts.push(this.addPendingConflict(remoteSchema.id, remoteSchema.name, conflict.localVersion, conflict.remoteVersion, conflict.changedPaths, remoteSchema));
      }
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString(); safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent('pull', `Discovery complete: ${newSchemasAdded.length} new, ${updatedSchemas.length} updated, ${unchanged} up to date, ${conflicts.length} conflict(s).`);
      this.notify();
      return { ok: true, newSchemasAdded, updatedSchemas, conflicts, unchanged };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status); this.notify();
      const message = isGitHubApiError(e) ? e.message : (e as Error)?.message || 'Unknown error during synchronization.';
      this.logEvent('error', message);
      return { ok: false, error: message, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
    } finally { endInternalSync(); }
  }
  async pushRegistryToGitHub(commitMessage?: string): Promise<PushOutcome> {
    const missing = this.missingConfigMessage();
    if (missing) { this.logEvent('error', missing); return { ok: false, error: missing }; }
    const cfg = secretVaultService.getConfig()!;
    this.status = 'syncing'; this.notify();
    beginInternalSync();
    try {
      const registry = schemaService.getRegistry();
      const content = JSON.stringify(registry, null, 2);
      const path = safeTrim(cfg.githubSchemaPath); const branch = safeTrim(cfg.githubBranch) || 'main';
      const result = await putFile(cfg.githubRepo, branch, path, cfg.githubToken, content, safeTrim(commitMessage) || `Update SQL Assistant schema registry (${new Date().toISOString()})`, this.lastKnownSha());
      this.setLastKnownSha(result.sha);
      schemaService.markAllSynced();
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString(); safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent('push', `Schema registry saved (${registry.schemas.length} schema(s)).`);
      this.notify();
      return { ok: true };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status); this.notify();
      const apiErr = isGitHubApiError(e) ? e : null;
      const requiresPull = !!apiErr && (apiErr.status === 409 || apiErr.status === 422);
      const msg = apiErr?.message || (e as Error)?.message || 'Unknown error during synchronization.';
      this.logEvent('error', msg);
      return { ok: false, error: msg, requiresPullFirst: requiresPull };
    } finally { endInternalSync(); }
  }
  resolveConflict(schemaId: string, decision: 'local' | 'remote', remoteSchema: SchemaModel): void { if (decision === 'remote') schemaService.replaceSchemaContent(schemaId, remoteSchema); }
  async pullFromSharedLocation(activeSchema: SchemaModel): Promise<{ ok: boolean; error?: string; conflict?: ReturnType<typeof detectConflict>; incoming?: SchemaModel }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    try { const fileHandle = await this.directoryHandle.getFileHandle('schema.json', { create: false }); const file = await fileHandle.getFile(); const text = await file.text(); const parsed = sanitizeIncomingSchema(JSON.parse(text)); const incoming = parsed as SchemaModel; const conflict = detectConflict(activeSchema, incoming); return { ok: true, conflict, incoming }; }
    catch (e) { return { ok: false, error: 'Could not read schema.json: ' + (e as Error).message }; }
  }
  async pushToSharedLocation(schema: SchemaModel): Promise<{ ok: boolean; error?: string }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    try { const fileHandle = await this.directoryHandle.getFileHandle('schema.json', { create: true }); const writable = await (fileHandle as any).createWritable(); await writable.write(JSON.stringify(schema, null, 2)); await writable.close(); return { ok: true }; }
    catch (e) { return { ok: false, error: 'Could not write: ' + (e as Error).message }; }
  }
  async syncWithGitHubSimple(): Promise<PullOutcome> { return this.pullRegistryFromGitHub(); }
  async syncNow(): Promise<{ ok: boolean; error?: string }> {
    if (this.config.source === 'github') { const result = await this.pullRegistryFromGitHub(); return { ok: result.ok, error: result.error }; }
    this.status = 'syncing'; this.notify();
    beginInternalSync();
    try { const activeSchema = schemaService.getActiveSchema(); const result = await this.pullFromSharedLocation(activeSchema); this.status = result.ok ? 'synchronized' : 'failed'; this.lastSyncedAt = new Date().toISOString(); safeLocalStorageSet(STATUS_KEY, this.status); this.notify(); return { ok: result.ok, error: result.error }; }
    catch (e) { this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status); this.notify(); return { ok: false, error: (e as Error)?.message || 'Unknown error.' }; }
    finally { endInternalSync(); }
  }
}
export const syncService = new SyncService();
