import type { SyncConfig, SyncSource, SyncTimeOption, SyncStatus, SchemaModel, SchemaRegistry } from '../types';
import { vaultService } from './vaultService';
import { schemaService } from './schemaService';
import { validateIncomingRegistryFile } from '../engines/schemaIntegrityEngine';
import { detectConflict } from '../engines/schemaVersionEngine';
import { getFile, putFile, isGitHubApiError } from './githubApiService';

// ============================================================================
// syncService — V14.1. Owns the lightweight navbar-level config (Sync
// Source + Sync Time) AND the real cross-machine synchronization mechanism
// (spec sections 9-16): the ENTIRE local schema registry (all schemas +
// which one is active) is pushed to / pulled from a single JSON file in a
// configured GitHub repository via the Contents API, using the Vault's
// securely-stored access token. Per-schema conflicts are detected by
// REUSING the existing schemaVersionEngine.detectConflict() — no second,
// competing conflict system was introduced, per the explicit spec
// instruction in section 16.
//
// "Shared Location" (File System Access API) is preserved unchanged from
// V14 as an alternative, browser-local sync source for users without
// GitHub access.
// ============================================================================

const CONFIG_KEY = 'sqla.syncconfig.v141';
const STATUS_KEY = 'sqla.syncstatus.v141';
const LAST_KNOWN_SHA_KEY = 'sqla.lastsha.v141';

function loadConfig(): SyncConfig {
  try { const raw = localStorage.getItem(CONFIG_KEY); if (raw) return JSON.parse(raw); } catch { }
  return { source: 'shared-location', time: 'manual', customTime: null };
}

export interface PullOutcome {
  ok: boolean;
  error?: string;
  newSchemasAdded: string[];
  conflicts: { schemaId: string; schemaName: string; localVersion: string; remoteVersion: string; changedPaths: string[]; remoteSchema: SchemaModel }[];
  unchanged: number;
}
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
      if (vaultService.isUnlocked()) await vaultService.saveConfig({ sharedLocationLabel: label }, '');
      this.notify();
      return { ok: true, label };
    } catch (e) { return { ok: false, error: 'Folder selection was cancelled or denied.' }; }
  }

  private lastKnownSha(): string | null { return localStorage.getItem(LAST_KNOWN_SHA_KEY); }
  private setLastKnownSha(sha: string | null): void { if (sha) localStorage.setItem(LAST_KNOWN_SHA_KEY, sha); else localStorage.removeItem(LAST_KNOWN_SHA_KEY); }

  /** Pulls the full registry (all schemas + activeSchemaId) from the
   * configured GitHub repository. For each remote schema whose id already
   * exists locally, compares checksums via the EXISTING
   * schemaVersionEngine.detectConflict() — if they differ, the schema is
   * reported as a conflict (caller must show the resolution UI) rather
   * than being silently applied. Brand-new remote schema ids are added
   * locally as inactive schemas without any conflict prompt. */
  async pullRegistryFromGitHub(): Promise<PullOutcome> {
    if (!vaultService.isUnlocked()) return { ok: false, error: 'Unlock the Vault first — GitHub credentials are stored there.', newSchemasAdded: [], conflicts: [], unchanged: 0 };
    const cfg = vaultService.getConfig()!;
    if (!cfg.githubRepo.trim()) return { ok: false, error: 'Configure a GitHub repository in Settings → Synchronization first.', newSchemasAdded: [], conflicts: [], unchanged: 0 };
    this.status = 'syncing'; this.notify();
    try {
      const file = await getFile(cfg.githubRepo, cfg.githubBranch || 'main', cfg.githubSchemaPath || 'schema.json', cfg.githubToken);
      if (!file) {
        this.status = 'never'; this.notify();
        return { ok: false, error: 'No schema file found yet at the configured path — push your local schemas first to create it.', newSchemasAdded: [], conflicts: [], unchanged: 0 };
      }
      this.setLastKnownSha(file.sha);
      const parsed = JSON.parse(file.content);
      const integrity = validateIncomingRegistryFile(parsed);
      if (!integrity.valid) {
        this.status = 'failed'; this.notify();
        return { ok: false, error: 'Remote schema file failed validation: ' + integrity.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; '), newSchemasAdded: [], conflicts: [], unchanged: 0 };
      }
      const remoteRegistry = parsed as SchemaRegistry;
      const newSchemasAdded: string[] = [];
      const conflicts: PullOutcome['conflicts'] = [];
      let unchanged = 0;
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

  /** Pushes the ENTIRE local registry to GitHub. Uses the last-known SHA
   * (from the most recent pull/push) as an optimistic-concurrency guard —
   * GitHub will reject the write with a 409/422 if the remote file moved
   * on since then, surfacing `requiresPullFirst: true` rather than
   * silently overwriting someone else's changes. */
  async pushRegistryToGitHub(commitMessage?: string): Promise<PushOutcome> {
    if (!vaultService.isUnlocked()) return { ok: false, error: 'Unlock the Vault first — GitHub credentials are stored there.' };
    const cfg = vaultService.getConfig()!;
    if (!cfg.githubRepo.trim()) return { ok: false, error: 'Configure a GitHub repository in Settings → Synchronization first.' };
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

  /** Applies the user's conflict resolution decision: 'remote' overwrites
   * the local schema with the remote version; 'local' keeps the local
   * schema untouched (the working version is explicitly preserved, per
   * spec section 16's "preserve the existing working version until the
   * conflict is resolved"). */
  resolveConflict(schemaId: string, decision: 'local' | 'remote', remoteSchema: SchemaModel): void {
    if (decision === 'remote') schemaService.replaceSchemaContent(schemaId, remoteSchema);
    // decision === 'local': intentionally a no-op — local stays exactly as-is.
  }

  // -------- Shared Location (unchanged mechanism from V14) --------
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

  /** Generic entry point used by the navbar's "Sync Now"-equivalent
   * actions and the scheduler — dispatches to whichever source is
   * currently configured. */
  async syncNow(): Promise<{ ok: boolean; error?: string }> {
    if (this.config.source === 'github') {
      const result = await this.pullRegistryFromGitHub();
      return { ok: result.ok, error: result.error };
    }
    this.status = 'syncing'; this.notify();
    try {
      const activeSchema = schemaService.getActiveSchema();
      const result = await this.pullFromSharedLocation(activeSchema);
      this.status = result.ok ? 'synchronized' : 'failed';
      this.lastSyncedAt = new Date().toISOString();
      localStorage.setItem(STATUS_KEY, this.status);
      this.notify();
      return { ok: result.ok, error: result.error };
    } catch (e) {
      this.status = 'failed'; localStorage.setItem(STATUS_KEY, this.status); this.notify();
      return { ok: false, error: (e as Error).message };
    }
  }
}
export const syncService = new SyncService();
