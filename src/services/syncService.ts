import type { SyncConfig, SyncSource, SyncTimeOption, SyncStatus, SchemaModel, SchemaRegistry } from '../types';
import { secretVaultService } from './secretVaultService';
import { schemaService } from './schemaService';
import { validateIncomingRegistryFile } from '../engines/schemaIntegrityEngine';
import { detectConflict } from '../engines/schemaVersionEngine';
import { getFile, putFile, isGitHubApiError } from './githubApiService';

// syncService — V14.2. Same registry push/pull + conflict-detection
// mechanism as V14.1, now sourcing GitHub configuration from
// secretVaultService instead of the old separate-passphrase vaultService
// (spec sections 24-31: preserve existing sync functionality, but the
// user no longer needs to separately know/enter repo details — they come
// pre-filled from the Secret Vault's bootstrap defaults).
const CONFIG_KEY = 'sqla.syncconfig.v142';
const STATUS_KEY = 'sqla.syncstatus.v142';
const LAST_KNOWN_SHA_KEY = 'sqla.lastsha.v142';
function loadConfig(): SyncConfig { try { const raw = localStorage.getItem(CONFIG_KEY); if (raw) return JSON.parse(raw); } catch { } return { source: 'shared-location', time: 'manual', customTime: null }; }

export interface PullOutcome { ok: boolean; error?: string; newSchemasAdded: string[]; conflicts: { schemaId: string; schemaName: string; localVersion: string; remoteVersion: string; changedPaths: string[]; remoteSchema: SchemaModel }[]; unchanged: number; }
export interface PushOutcome { ok: boolean; error?: string; requiresPullFirst?: boolean; }

class SyncService {
  private config: SyncConfig = loadConfig();
  private status: SyncStatus = (localStorage.getItem(STATUS_KEY) as SyncStatus) || 'never';
  private lastSyncedAt: string | null = null;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private listeners = new Set<() => void>();
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }
  private persistConfig(): void { localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config)); }
  getConfig(): SyncConfig { return this.config; }
  getStatus(): SyncStatus { return this.status; }
  getLastSyncedAt(): string | null { return this.lastSyncedAt; }
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
  private setLastKnownSha(sha: string | null): void { if (sha) localStorage.setItem(LAST_KNOWN_SHA_KEY, sha); else localStorage.removeItem(LAST_KNOWN_SHA_KEY); }

  /** Returns a clear, non-secret-exposing message describing exactly what
   * is missing before a GitHub sync can proceed (spec section 30). */
  private missingConfigMessage(): string | null {
    if (!secretVaultService.isUnlocked()) return 'The Secret Vault is locked. Enter the Admin Password to unlock it and enable GitHub synchronization.';
    const cfg = secretVaultService.getConfig()!;
    if (!cfg.githubRepo.trim()) return 'No GitHub repository is configured yet. Open Settings → Secret Vault to configure one (a default is provided).';
    if (!cfg.githubToken.trim()) return 'No GitHub access token is configured yet. Open Settings → Secret Vault and enter your personal access token — this is the one piece of information each authorized user must supply individually, since it is a personal credential.';
    return null;
  }

  async pullRegistryFromGitHub(): Promise<PullOutcome> {
    const missing = this.missingConfigMessage();
    if (missing) return { ok: false, error: missing, newSchemasAdded: [], conflicts: [], unchanged: 0 };
    const cfg = secretVaultService.getConfig()!;
    this.status = 'syncing'; this.notify();
    try {
      const file = await getFile(cfg.githubRepo, cfg.githubBranch || 'main', cfg.githubSchemaPath || 'schema.json', cfg.githubToken);
      if (!file) { this.status = 'never'; this.notify(); return { ok: false, error: 'No schema file found yet at the configured path — push your local schemas first to create it.', newSchemasAdded: [], conflicts: [], unchanged: 0 }; }
      this.setLastKnownSha(file.sha);
      const parsed = JSON.parse(file.content);
      const integrity = validateIncomingRegistryFile(parsed);
      if (!integrity.valid) { this.status = 'failed'; this.notify(); return { ok: false, error: 'Remote schema file failed validation: ' + integrity.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; '), newSchemasAdded: [], conflicts: [], unchanged: 0 }; }
      const remoteRegistry = parsed as SchemaRegistry;
      const newSchemasAdded: string[] = []; const conflicts: PullOutcome['conflicts'] = []; let unchanged = 0;
      for (const remoteSchema of remoteRegistry.schemas) {
        const local = schemaService.getSchemaById(remoteSchema.id);
        if (!local) { schemaService.addSchemaFromRemote(remoteSchema); newSchemasAdded.push(remoteSchema.name); continue; }
        const conflict = detectConflict(local, remoteSchema);
        if (!conflict.hasConflict) { unchanged += 1; continue; }
        conflicts.push({ schemaId: remoteSchema.id, schemaName: remoteSchema.name, localVersion: conflict.localVersion, remoteVersion: conflict.remoteVersion, changedPaths: conflict.changedPaths, remoteSchema });
      }
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString();
      localStorage.setItem(STATUS_KEY, this.status);
      this.notify();
      return { ok: true, newSchemasAdded, conflicts, unchanged };
    } catch (e) {
      this.status = 'failed'; localStorage.setItem(STATUS_KEY, this.status); this.notify();
      const message = isGitHubApiError(e) ? e.message : (e as Error).message || 'Unknown error during pull.';
      return { ok: false, error: message, newSchemasAdded: [], conflicts: [], unchanged: 0 };
    }
  }

  async pushRegistryToGitHub(commitMessage?: string): Promise<PushOutcome> {
    const missing = this.missingConfigMessage();
    if (missing) return { ok: false, error: missing };
    const cfg = secretVaultService.getConfig()!;
    this.status = 'syncing'; this.notify();
    try {
      const registry = schemaService.getRegistry();
      const content = JSON.stringify(registry, null, 2);
      const path = cfg.githubSchemaPath || 'schema.json';
      const branch = cfg.githubBranch || 'main';
      const result = await putFile(cfg.githubRepo, branch, path, cfg.githubToken, content, commitMessage || `Update SQL Assistant schema registry (${new Date().toISOString()})`, this.lastKnownSha());
      this.setLastKnownSha(result.sha);
      schemaService.markAllSynced();
      this.status = 'synchronized'; this.lastSyncedAt = new Date().toISOString();
      localStorage.setItem(STATUS_KEY, this.status);
      this.notify();
      return { ok: true };
    } catch (e) {
      this.status = 'failed'; localStorage.setItem(STATUS_KEY, this.status); this.notify();
      const apiErr = isGitHubApiError(e) ? e : null;
      const requiresPull = !!apiErr && (apiErr.status === 409 || apiErr.status === 422);
      return { ok: false, error: apiErr?.message || (e as Error).message || 'Unknown error during push.', requiresPullFirst: requiresPull };
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
      const parsed = JSON.parse(text);
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

  /** V14.2 — the simple, user-facing "Sync with GitHub" entry point (spec
   * section 29): internally retrieves config from the Secret Vault,
   * connects, pulls the latest data, and reports success/failure clearly —
   * no technical repository details are surfaced to the caller. */
  async syncWithGitHubSimple(): Promise<PullOutcome> { return this.pullRegistryFromGitHub(); }

  async syncNow(): Promise<{ ok: boolean; error?: string }> {
    if (this.config.source === 'github') { const result = await this.pullRegistryFromGitHub(); return { ok: result.ok, error: result.error }; }
    this.status = 'syncing'; this.notify();
    try {
      const activeSchema = schemaService.getActiveSchema();
      const result = await this.pullFromSharedLocation(activeSchema);
      this.status = result.ok ? 'synchronized' : 'failed';
      this.lastSyncedAt = new Date().toISOString();
      localStorage.setItem(STATUS_KEY, this.status);
      this.notify();
      return { ok: result.ok, error: result.error };
    } catch (e) { this.status = 'failed'; localStorage.setItem(STATUS_KEY, this.status); this.notify(); return { ok: false, error: (e as Error).message }; }
  }
}
export const syncService = new SyncService();
