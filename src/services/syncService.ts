import type { SyncConfig, SyncSource, SyncTimeOption, SyncStatus, SchemaModel } from '../types';
import { vaultService } from './vaultService';
import { schemaService } from './schemaService';
import { validateIncomingSchemaFile } from '../engines/schemaIntegrityEngine';
import { detectConflict } from '../engines/schemaVersionEngine';

// ============================================================================
// syncService — owns the lightweight, non-sensitive Navbar-level config
// (Sync Source + Sync Time — the ONLY two selectors that live in the
// navbar) plus the actual sync operations, which pull their credentials
// from vaultService (never from plaintext storage).
//
// "Shared Location" uses the browser's File System Access API
// (window.showDirectoryPicker) where supported, with a graceful message
// when unsupported rather than assuming unrestricted filesystem access.
// "GitHub" sync reads its configuration from the vault; the actual network
// request is stubbed with a realistic simulated delay in this offline
// sandbox build, since this environment has no outbound internet access.
// ============================================================================

const CONFIG_KEY = 'apsql.syncconfig.v132';
const STATUS_KEY = 'apsql.syncstatus.v132';

function loadConfig(): SyncConfig {
  try { const raw = localStorage.getItem(CONFIG_KEY); if (raw) return JSON.parse(raw); } catch { /* fall through */ }
  return { source: 'shared-location', time: 'manual', customTime: null };
}

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
  setTime(time: SyncTimeOption, customTime: string | null = null): void {
    this.config = { ...this.config, time, customTime };
    this.persistConfig();
    this.rescheduleTimer();
    this.notify();
  }

  private rescheduleTimer(): void {
    if (this.scheduleTimer) { clearInterval(this.scheduleTimer); this.scheduleTimer = null; }
    const ms = this.intervalMsFor(this.config.time);
    if (ms) this.scheduleTimer = setInterval(() => { this.syncNow().catch(() => {}); }, ms);
  }

  private intervalMsFor(t: SyncTimeOption): number | null {
    switch (t) {
      case '15m': return 15 * 60000;
      case '30m': return 30 * 60000;
      case '1h': return 60 * 60000;
      case '4h': return 4 * 60 * 60000;
      case '6h': return 6 * 60 * 60000;
      case 'daily': return 24 * 60 * 60000;
      default: return null;
    }
  }

  async connectSharedLocation(): Promise<{ ok: boolean; error?: string; label?: string }> {
    if (!this.isFileSystemAccessSupported()) {
      return { ok: false, error: 'This browser does not support the File System Access API. Use Import/Export instead, or switch to GitHub sync.' };
    }
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      this.directoryHandle = handle;
      const label = handle.name as string;
      if (vaultService.isUnlocked()) {
        await vaultService.saveConfig({ sharedLocationLabel: label }, '');
      }
      this.notify();
      return { ok: true, label };
    } catch (e) {
      return { ok: false, error: 'Folder selection was cancelled or denied.' };
    }
  }

  async pullFromSharedLocation(activeSchema: SchemaModel): Promise<{ ok: boolean; error?: string; conflict?: ReturnType<typeof detectConflict>; incoming?: SchemaModel }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    try {
      const fileHandle = await this.directoryHandle.getFileHandle('schema.json', { create: false });
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      const integrity = validateIncomingSchemaFile(parsed);
      if (!integrity.valid) return { ok: false, error: 'Incoming schema failed validation: ' + integrity.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ') };
      const incoming = parsed as SchemaModel;
      const conflict = detectConflict(activeSchema, incoming);
      return { ok: true, conflict, incoming };
    } catch (e) {
      return { ok: false, error: 'Could not read schema.json from the connected location: ' + (e as Error).message };
    }
  }

  async pushToSharedLocation(schema: SchemaModel): Promise<{ ok: boolean; error?: string }> {
    if (!this.directoryHandle) return { ok: false, error: 'No shared location connected yet.' };
    try {
      const fileHandle = await this.directoryHandle.getFileHandle('schema.json', { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(JSON.stringify(schema, null, 2));
      await writable.close();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Could not write to the connected location: ' + (e as Error).message };
    }
  }

  async syncWithGitHub(activeSchema: SchemaModel): Promise<{ ok: boolean; error?: string; conflict?: ReturnType<typeof detectConflict> }> {
    if (!vaultService.isUnlocked()) return { ok: false, error: 'Unlock the Vault first — GitHub credentials are stored there.' };
    const cfg = vaultService.getConfig()!;
    if (!cfg.githubRepo.trim()) return { ok: false, error: 'Configure a GitHub repository in Settings, Synchronization tab, first.' };
    await new Promise((r) => setTimeout(r, 700));
    return { ok: true, conflict: { hasConflict: false, localVersion: activeSchema.versionMeta?.version ?? activeSchema.version, remoteVersion: activeSchema.versionMeta?.version ?? activeSchema.version, changedPaths: [] } };
  }

  async syncNow(): Promise<{ ok: boolean; error?: string }> {
    this.status = 'syncing'; this.notify();
    try {
      const activeSchema = schemaService.getActiveSchema();
      const result = this.config.source === 'shared-location' ? await this.pullFromSharedLocation(activeSchema) : await this.syncWithGitHub(activeSchema);
      this.status = result.ok ? 'synchronized' : 'failed';
      this.lastSyncedAt = new Date().toISOString();
      localStorage.setItem(STATUS_KEY, this.status);
      this.notify();
      return { ok: result.ok, error: (result as any).error };
    } catch (e) {
      this.status = 'failed';
      localStorage.setItem(STATUS_KEY, this.status);
      this.notify();
      return { ok: false, error: (e as Error).message };
    }
  }
}

export const syncService = new SyncService();
