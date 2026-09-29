import type { SyncConfig, SyncSource, SyncTimeOption, SyncStatus, SchemaModel, PendingConflict, SyncLogEntry } from '../types';
import { secretVaultService, DEFAULT_BOOTSTRAP_CONFIG } from './secretVaultService';
import { schemaService } from './schemaService';
import { validateIncomingRegistryFile } from '../engines/schemaIntegrityEngine';
import { detectConflict } from '../engines/schemaVersionEngine';
import { planSchemaMerge, shouldApplyRemoteActiveSchema, type ActiveSchemaPointer } from '../engines/schemaSyncMerge';
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

/**
 * V16.4 — sanitize-then-validate a raw registry payload (schemas array +
 * active-schema pointer), exactly matching the local-import ordering fixed
 * in V16.3. Kept as one shared helper so the pull path, the pre-push merge
 * step, and background discovery can never again drift out of sync with
 * each other on this point.
 */
function sanitizeThenValidateRegistry(parsedRaw: unknown): { sanitizedSchemas: SchemaModel[]; remotePointer: ActiveSchemaPointer; integrityValid: boolean; issues: { severity: 'error' | 'warning'; message: string }[] } {
  const obj = (parsedRaw && typeof parsedRaw === 'object') ? (parsedRaw as Record<string, unknown>) : {};
  const rawSchemas = Array.isArray(obj.schemas) ? obj.schemas : null;
  const remotePointer: ActiveSchemaPointer = { activeSchemaId: typeof obj.activeSchemaId === 'string' ? obj.activeSchemaId : '', activeSchemaUpdatedAt: typeof obj.activeSchemaUpdatedAt === 'string' ? obj.activeSchemaUpdatedAt : null };
  if (!rawSchemas) return { sanitizedSchemas: [], remotePointer, integrityValid: false, issues: [{ severity: 'error', message: 'Missing required "schemas" array.' }] };
  const sanitizedSchemas = rawSchemas.map((s) => sanitizeIncomingSchema(s)) as SchemaModel[];
  const integrity = validateIncomingRegistryFile({ ...obj, schemas: sanitizedSchemas });
  return { sanitizedSchemas, remotePointer, integrityValid: integrity.valid, issues: integrity.issues };
}
function summarizeIssues(issues: { severity: 'error' | 'warning'; message: string }[], max = 3): string {
  const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
  if (errors.length === 0) return '';
  const shown = errors.slice(0, max);
  const suffix = errors.length > max ? ` (+${errors.length - max} more)` : '';
  return shown.join('; ') + suffix;
}
export interface PullOutcome { ok: boolean; error?: string; newSchemasAdded: string[]; updatedSchemas: string[]; conflicts: PendingConflict[]; unchanged: number; activeSchemaSynced?: boolean; }
export interface PushOutcome { ok: boolean; error?: string; requiresPullFirst?: boolean; }
class SyncService {
  private config: SyncConfig = loadConfig();
  private status: SyncStatus = (localStorage.getItem(STATUS_KEY) as SyncStatus) || 'never';
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private listeners = new Set<() => void>();
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private pendingConflicts: PendingConflict[] = loadPendingConflicts();
  private syncLog: SyncLogEntry[] = loadSyncLog();
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }
  private persistConfig(): void { safeLocalStorageSet(CONFIG_KEY, JSON.stringify(this.config)); }
  private persistPendingConflicts(): void { safeLocalStorageSet(PENDING_CONFLICTS_KEY, JSON.stringify(this.pendingConflicts)); this.notify(); }
  private logEvent(kind: SyncLogEntry['kind'], message: string): void {
    this.syncLog = [{ id: makeId('synclog'), timestamp: new Date().toISOString(), kind, message }, ...this.syncLog].slice(0, MAX_LOG_ENTRIES);
    safeLocalStorageSet(SYNC_LOG_KEY, JSON.stringify(this.syncLog));
    this.notify();
  }
  getConfig(): SyncConfig { return this.config; }
  getStatus(): SyncStatus { return this.status; }
  getLastSyncedAt(): string | null { return this.lastSyncedAt; }
  getLastError(): string | null { return this.lastError; }
  clearLastError(): void { if (this.lastError !== null) { this.lastError = null; this.notify(); } }
  getPendingConflicts(): PendingConflict[] { return this.pendingConflicts; }
  getSyncLog(): SyncLogEntry[] { return this.syncLog; }
  isFileSystemAccessSupported(): boolean { return typeof (window as any).showDirectoryPicker === 'function'; }
  hasConnectedLocation(): boolean { return this.directoryHandle !== null; }
  setSource(source: SyncSource): void { this.config = { ...this.config, source }; this.persistConfig(); this.notify(); }
  setTime(time: SyncTimeOption, customTime: string | null = null): void { this.config = { ...this.config, time, customTime }; this.persistConfig(); this.rescheduleTimer(); this.notify(); }
  private rescheduleTimer(): void { if (this.scheduleTimer) { clearInterval(this.scheduleTimer); this.scheduleTimer = null; } const ms = this.intervalMsFor(this.config.time); if (ms) this.scheduleTimer = setInterval(() => { this.pullRegistryFromGitHub().catch(() => {}); }, ms); }
  private intervalMsFor(t: SyncTimeOption): number | null { switch (t) { case '15m': return 15 * 60000; case '30m': return 30 * 60000; case '1h': return 60 * 60000; case '4h': return 4 * 60 * 60000; case '6h': return 6 * 60 * 60000; case 'daily': return 24 * 60 * 60000; default: return null; } }
  async connectSharedLocation(): Promise<{ ok: boolean; error?: string; label?: string }> {
    if (!this.isFileSystemAccessSupported()) return { ok: false, error: 'This browser does not support the File System Access API. Use Import/Export instead, or switch to GitHub sync.' };
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      this.directoryHandle = handle;
      const label = handle.name as string;
      this.notify();
      return { ok: true, label };
    } catch (e) { return { ok: false, error: 'Folder selection was cancelled or denied.' }; }
  }
  private lastKnownSha(): string | null { return localStorage.getItem(LAST_KNOWN_SHA_KEY); }
  private setLastKnownSha(sha: string | null): void { if (sha) safeLocalStorageSet(LAST_KNOWN_SHA_KEY, sha); else localStorage.removeItem(LAST_KNOWN_SHA_KEY); }
  private missingConfigMessage(): string | null {
    if (!secretVaultService.isUnlocked()) return 'The Secret Vault is locked. Enter the Admin Password to unlock it and enable synchronization.';
    const cfg = secretVaultService.getConfig()!;
    const result = assertSyncConfigOrError([
      { key: 'githubRepo', label: 'Repository', value: cfg.githubRepo, required: true },
      { key: 'githubBranch', label: 'Branch', value: cfg.githubBranch, required: false },
      { key: 'githubSchemaPath', label: 'Repository Path', value: cfg.githubSchemaPath, required: true },
      { key: 'githubToken', label: 'Access Token', value: cfg.githubToken, required: true, sensitive: true }
    ]);
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
    try {
      if (decision === 'remote') { try { const remoteSchema = JSON.parse(conflict.remoteSchemaJson) as SchemaModel; schemaService.replaceSchemaContent(conflict.schemaId, remoteSchema); } catch { } }
    } finally { endInternalSync(); }
    this.pendingConflicts = this.pendingConflicts.filter((c) => c.id !== conflictId);
    this.persistPendingConflicts();
  }
  /**
   * V16.4 — shared merge-application step used by BOTH the authenticated
   * pull and the pre-push merge. Given already-sanitized remote schemas,
   * runs `planSchemaMerge()` against the CURRENT local schema list and:
   *   - adds any schema that only exists remotely (never loses data),
   *   - records a pending conflict (existing UI, unchanged) for any schema
   *     that exists on both sides with genuinely different content,
   *   - leaves everything else untouched.
   * Returns the outcome so callers can report it and decide whether it's
   * safe to proceed (e.g. push should not proceed while new conflicts
   * exist, to avoid overwriting a change the user hasn't reviewed yet).
   */
  private applyMerge(remoteSchemas: SchemaModel[]): { newSchemasAdded: string[]; updatedSchemas: string[]; conflicts: PendingConflict[]; unchanged: number } {
    const plan = planSchemaMerge(schemaService.getAllSchemas(), remoteSchemas);
    const newSchemasAdded: string[] = []; const updatedSchemas: string[] = []; const conflicts: PendingConflict[] = []; let unchanged = 0;
    for (const action of plan) {
      if (action.kind === 'add') {
        const outcome = schemaService.addSchemaFromRemote(action.schema);
        if (outcome === 'added') newSchemasAdded.push(action.schema.name);
        else if (outcome === 'updated') updatedSchemas.push(action.schema.name);
        else unchanged += 1;
      } else if (action.kind === 'unchanged') {
        unchanged += 1;
      } else if (action.kind === 'conflict' && action.conflict) {
        conflicts.push(this.addPendingConflict(action.schema.id, action.schema.name, action.conflict.localVersion, action.conflict.remoteVersion, action.conflict.changedPaths, action.schema));
      }
    }
    return { newSchemasAdded, updatedSchemas, conflicts, unchanged };
  }
  /**
   * V16.4 — applies the Active Schema pointer from a remote registry, IF
   * (and only if) it wins the last-write-wins comparison against the
   * current local pointer. This is what makes cross-device Active Schema
   * sync actually happen — see schemaSyncMerge.ts for the full rationale.
   */
  private syncActiveSchemaPointer(remotePointer: ActiveSchemaPointer): boolean {
    const localPointer = schemaService.getActiveSchemaPointer();
    if (!shouldApplyRemoteActiveSchema(localPointer, remotePointer)) return false;
    const applied = schemaService.applyRemoteActiveSchemaPointer(remotePointer);
    if (applied) this.logEvent('pull', `Active Schema synchronized from the repository: "${schemaService.getSchemaById(remotePointer.activeSchemaId)?.name ?? remotePointer.activeSchemaId}".`);
    return applied;
  }
  async discoverPublicRegistry(reason: string): Promise<PullOutcome> {
    try {
      const repo = DEFAULT_BOOTSTRAP_CONFIG.githubRepo;
      const branch = DEFAULT_BOOTSTRAP_CONFIG.githubBranch;
      const path = DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath;
      const file = await getFile(repo, branch, path, '');
      if (!file) return { ok: true, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
      const parsedRaw = JSON.parse(file.content);
      const { sanitizedSchemas, integrityValid, issues } = sanitizeThenValidateRegistry(parsedRaw);
      if (!integrityValid) {
        // Silent, automatic, PRE-AUTHENTICATION background check — never
        // sets this.lastError (reserved for explicit user actions: Sync
        // Now/Push/Pull) and, per the intended Authentication -> Discover
        // -> ... -> Set Active Schema ordering, never touches the Active
        // Schema pointer either (that only happens on the authenticated
        // pull below, once Settings/Secret Vault has been unlocked).
        const detail = summarizeIssues(issues);
        return { ok: false, error: `Remote schema file failed validation.${detail ? ' ' + detail : ''}`, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
      }
      beginInternalSync();
      let merge: ReturnType<typeof this.applyMerge>;
      try { merge = this.applyMerge(sanitizedSchemas); } finally { endInternalSync(); }
      if (merge.newSchemasAdded.length || merge.updatedSchemas.length) this.logEvent('discovery', `Public discovery (${reason}): ${merge.newSchemasAdded.length} new schema(s), ${merge.updatedSchemas.length} updated: ${[...merge.newSchemasAdded, ...merge.updatedSchemas].join(', ')}.`);
      return { ok: true, ...merge };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message || 'Unknown error during public discovery.', newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
    }
  }
  async pullRegistryFromGitHub(): Promise<PullOutcome> {
    const missing = this.missingConfigMessage();
    if (missing) { this.logEvent('error', missing); return { ok: false, error: missing, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
    const cfg = secretVaultService.getConfig()!;
    this.status = 'syncing'; this.notify();
    beginInternalSync();
    try {
      const path = safeTrim(cfg.githubSchemaPath);
      const branch = safeTrim(cfg.githubBranch) || 'main';
      const file = await getFile(cfg.githubRepo, branch, path, cfg.githubToken);
      if (!file) { this.status = 'never'; this.notify(); const msg = 'No schema file found yet at the configured path — create or import a schema to establish the repository as the source of truth.'; this.logEvent('pull', msg); return { ok: false, error: msg, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
      this.setLastKnownSha(file.sha);
      const parsedRaw = JSON.parse(file.content);
      const { sanitizedSchemas, remotePointer, integrityValid, issues } = sanitizeThenValidateRegistry(parsedRaw);
      if (!integrityValid) { this.status = 'failed'; const detail = summarizeIssues(issues); const msg = 'Remote schema file failed validation.' + (detail ? ' ' + detail : ''); this.lastError = msg; this.notify(); this.logEvent('error', msg); return { ok: false, error: msg, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 }; }
      // This is the fully AUTHENTICATED path (Secret Vault already unlocked
      // — see missingConfigMessage() above), matching the requested
      // "Authentication -> ... -> Synchronize Local Store -> Retrieve
      // Active Schema -> Set Active Schema" workflow exactly: merge schema
      // content first, THEN apply the Active Schema pointer (so the
      // referenced schema is guaranteed to already exist locally by the
      // time we try to activate it).
      const merge = this.applyMerge(sanitizedSchemas);
      const activeSchemaSynced = this.syncActiveSchemaPointer(remotePointer);
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString();
      this.lastError = null;
      safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent('pull', `Discovery complete: ${merge.newSchemasAdded.length} new, ${merge.updatedSchemas.length} updated, ${merge.unchanged} up to date, ${merge.conflicts.length} conflict(s)${activeSchemaSynced ? ', Active Schema synchronized' : ''}.`);
      this.notify();
      return { ok: true, ...merge, activeSchemaSynced };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
      const message = isGitHubApiError(e) ? e.message : (e as Error)?.message || 'Unknown error during synchronization.';
      this.lastError = message; this.notify();
      this.logEvent('error', message);
      return { ok: false, error: message, newSchemasAdded: [], updatedSchemas: [], conflicts: [], unchanged: 0 };
    } finally {
      endInternalSync();
    }
  }
  /**
   * V16.4 — THE fix for cross-device schema loss on push. Previously this
   * method serialized ONLY the local registry and overwrote the remote
   * file unconditionally — so if another device had pushed a schema this
   * device never pulled, that schema would vanish from the central store
   * the next time THIS device pushed. Now, before building the outgoing
   * payload, it fetches the current remote file (using the same repo/
   * branch/path/token already required for the push itself — no new
   * configuration, no new permissions) and merges it in first:
   *   - Schemas that exist remotely but not locally are pulled in locally
   *     (schemaService.addSchemaFromRemote), so the very next serialization
   *     of the local registry already contains them — nothing is lost.
   *   - If a schema differs on both sides (genuine conflict, not just
   *     "remote has something new"), the push is aborted for THIS schema's
   *     sake: the existing conflict-resolution UI (Schema Management's
   *     conflict banner) is populated instead of either side blindly
   *     overwriting the other's changes, and the whole push is deferred
   *     until the user resolves it (same "Use Local / Use Remote" flow
   *     already used on pull, now also reachable from an attempted push).
   *   - The Active Schema pointer is synchronized the same way pull does,
   *     before the payload is built, so an Active Schema choice made on
   *     another device is not overwritten by an older local choice either.
   * Only once all of that is safely reconciled does the (now-merged) local
   * registry get serialized and PUT to GitHub, using the sha just fetched
   * (minimizing the chance of a stale-sha 409 on the actual write).
   */
  async pushRegistryToGitHub(commitMessage?: string): Promise<PushOutcome> {
    const missing = this.missingConfigMessage();
    if (missing) {
      this.logEvent('error', missing);
      return { ok: false, error: missing };
    }
    const cfg = secretVaultService.getConfig()!;
    this.status = 'syncing'; this.notify();
    beginInternalSync();
    try {
      const path = safeTrim(cfg.githubSchemaPath);
      const branch = safeTrim(cfg.githubBranch) || 'main';
      let shaForPut: string | null = this.lastKnownSha();
      try {
        const remoteFile = await getFile(cfg.githubRepo, branch, path, cfg.githubToken);
        if (remoteFile) {
          shaForPut = remoteFile.sha;
          this.setLastKnownSha(remoteFile.sha);
          const parsedRaw = JSON.parse(remoteFile.content);
          const { sanitizedSchemas, remotePointer, integrityValid } = sanitizeThenValidateRegistry(parsedRaw);
          if (integrityValid) {
            const merge = this.applyMerge(sanitizedSchemas);
            if (merge.conflicts.length) {
              this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
              const msg = `Cannot push: ${merge.conflicts.length} schema(s) have unresolved conflicts with the repository. Resolve them in Schema Management (Use Local / Use Remote), then sync again.`;
              this.lastError = msg; this.notify(); this.logEvent('error', msg);
              return { ok: false, error: msg, requiresPullFirst: true };
            }
            this.syncActiveSchemaPointer(remotePointer);
            if (merge.newSchemasAdded.length) this.logEvent('push', `Merged ${merge.newSchemasAdded.length} schema(s) found only in the repository before pushing, so they are preserved: ${merge.newSchemasAdded.join(', ')}.`);
          }
          // If integrityValid is false here, we deliberately don't abort the
          // push over it — an already-broken remote file (e.g. a manual
          // hand-edit gone wrong) should still be repairable by pushing a
          // known-good local registry over it, same as before this fix.
        }
      } catch (mergeErr) {
        // A network/auth failure while trying to pre-merge is surfaced as
        // the push's own failure, rather than silently pushing blind and
        // risking exactly the data-loss bug this fix exists to prevent.
        this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
        const msg = isGitHubApiError(mergeErr) ? mergeErr.message : (mergeErr as Error)?.message || 'Could not verify the current repository state before pushing.';
        this.lastError = msg; this.notify(); this.logEvent('error', msg);
        return { ok: false, error: msg };
      }
      const registry = schemaService.getRegistry();
      const content = JSON.stringify(registry, null, 2);
      const result = await putFile(cfg.githubRepo, branch, path, cfg.githubToken, content, safeTrim(commitMessage) || `Update SQL Assistant schema registry (${new Date().toISOString()})`, shaForPut);
      this.setLastKnownSha(result.sha);
      schemaService.markAllSynced();
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString();
      this.lastError = null;
      safeLocalStorageSet(STATUS_KEY, this.status);
      this.logEvent('push', `Schema registry saved to the repository (${registry.schemas.length} schema(s), Active Schema: "${schemaService.getActiveSchema().name}").`);
      this.notify();
      return { ok: true };
    } catch (e) {
      this.status = 'failed'; safeLocalStorageSet(STATUS_KEY, this.status);
      const apiErr = isGitHubApiError(e) ? e : null;
      const requiresPull = !!apiErr && (apiErr.status === 409 || apiErr.status === 422);
      const msg = apiErr?.message || (e as Error)?.message || 'Unknown error during synchronization.';
      this.lastError = msg; this.notify();
      this.logEvent('error', msg);
      return { ok: false, error: msg, requiresPullFirst: requiresPull };
    } finally {
      endInternalSync();
    }
  }
  resolveConflict(schemaId: string, decision: 'local' | 'remote', remoteSchema: SchemaModel): void {
    if (decision === 'remote') schemaService.replaceSchemaContent(schemaId, remoteSchema);
  }
  async pullFromSharedLocation(activeSchema: SchemaModel): Promise<{ ok: boolean; error?: string; conflict?: ReturnType<typeof detectConflict>; incoming?: SchemaModel }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    try {
      const fileHandle = await this.directoryHandle.getFileHandle('schema.json', { create: false });
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = sanitizeIncomingSchema(JSON.parse(text));
      const incoming = parsed as SchemaModel;
      const conflict = detectConflict(activeSchema, incoming);
      return { ok: true, conflict, incoming };
    } catch (e) { return { ok: false, error: 'Could not read schema.json from the connected location: ' + (e as Error).message }; }
  }
  async pushToSharedLocation(schema: SchemaModel): Promise<{ ok: boolean; error?: string }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    try {
      const fileHandle = await this.directoryHandle.getFileHandle('schema.json', { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(JSON.stringify(schema, null, 2));
      await writable.close();
      return { ok: true };
    } catch (e) { return { ok: false, error: 'Could not write to the connected location: ' + (e as Error).message }; }
  }
  async syncWithGitHubSimple(): Promise<PullOutcome> { return this.pullRegistryFromGitHub(); }
  async syncNow(): Promise<{ ok: boolean; error?: string }> {
    if (this.config.source === 'github') { const result = await this.pullRegistryFromGitHub(); return { ok: result.ok, error: result.error }; }
    this.status = 'syncing'; this.notify();
    beginInternalSync();
    try {
      const activeSchema = schemaService.getActiveSchema();
      const result = await this.pullFromSharedLocation(activeSchema);
      this.status = result.ok ? 'synchronized' : 'failed';
      this.lastSyncedAt = new Date().toISOString();
      if (result.ok) this.lastError = null; else this.lastError = result.error || 'Unknown error.';
      safeLocalStorageSet(STATUS_KEY, this.status);
      this.notify();
      return { ok: result.ok, error: result.error };
    } catch (e) { this.status = 'failed'; this.lastError = (e as Error)?.message || 'Unknown error.'; safeLocalStorageSet(STATUS_KEY, this.status); this.notify(); return { ok: false, error: (e as Error)?.message || 'Unknown error.' }; }
    finally { endInternalSync(); }
  }
}
export const syncService = new SyncService();
