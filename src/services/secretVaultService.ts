import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob, type EncryptedBlob } from './cryptoService';
import { getFile, putFile, isGitHubApiError } from './githubApiService';
import { safeString, safeTrim } from '../utils/validation';

const SECRET_VAULT_STORAGE_KEY = 'sqla.secretvault.v146';
const VAULT_LAST_SHA_KEY = 'sqla.vaultlastsha.v146';
const DEVICE_TAG_KEY = 'sqla.deviceTag.v146';

export interface SecretVaultConfig { githubRepo: string; githubBranch: string; githubSchemaPath: string; githubToken: string; sharedLocationLabel: string; }
export interface VaultVersionMeta { updatedAt: string; updatedByDevice: string; checksum: string; }
interface StoredVaultFile { blob: EncryptedBlob; meta: VaultVersionMeta; }

export const DEFAULT_BOOTSTRAP_CONFIG: Omit<SecretVaultConfig, 'githubToken' | 'sharedLocationLabel'> = {
  githubRepo: 'subhamain86/Basware-AP-SQL-Assistant',
  githubBranch: 'main',
  githubSchemaPath: 'sql-assistant-data/schemas/registry.json'
};
const VAULT_BLOB_PATH = 'sql-assistant-data/vault/secret-vault.enc.json';

function bootstrapConfig(): SecretVaultConfig { return { ...DEFAULT_BOOTSTRAP_CONFIG, githubToken: '', sharedLocationLabel: '' }; }

function normalizeVaultConfig(raw: unknown): SecretVaultConfig {
  const r = (raw && typeof raw === 'object') ? (raw as Partial<SecretVaultConfig>) : {};
  return {
    githubRepo: safeString(r.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubRepo),
    githubBranch: safeString(r.githubBranch, DEFAULT_BOOTSTRAP_CONFIG.githubBranch),
    githubSchemaPath: safeString(r.githubSchemaPath, DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath),
    githubToken: safeString(r.githubToken, ''),
    sharedLocationLabel: safeString(r.sharedLocationLabel, '')
  };
}

export function maskToken(token: unknown): string {
  const t = safeString(token);
  if (!t) return 'Not configured';
  const visibleTail = t.length > 4 ? t.slice(-4) : '';
  return `${'•'.repeat(12)}${visibleTail}`;
}

function getDeviceTag(): string {
  let tag = localStorage.getItem(DEVICE_TAG_KEY);
  if (!tag) { tag = 'device-' + Math.random().toString(36).slice(2, 8); localStorage.setItem(DEVICE_TAG_KEY, tag); }
  return tag;
}
async function computeConfigChecksum(config: SecretVaultConfig): Promise<string> {
  const canonical = JSON.stringify({ githubRepo: config.githubRepo, githubBranch: config.githubBranch, githubSchemaPath: config.githubSchemaPath });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical) as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VaultBootstrapOutcome { ok: boolean; source: 'local' | 'repository' | 'created-fresh'; error?: string; }

class SecretVaultService {
  private unlockedConfig: SecretVaultConfig | null = null;
  private unlockedPassword: string | null = null;
  private lastMeta: VaultVersionMeta | null = null;
  private listeners = new Set<() => void>();
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }

  exists(): boolean { return localStorage.getItem(SECRET_VAULT_STORAGE_KEY) !== null; }
  isUnlocked(): boolean { return this.unlockedConfig !== null; }
  getConfig(): SecretVaultConfig | null { return this.unlockedConfig; }
  hasToken(): boolean { return !!this.unlockedConfig?.githubToken; }

  private async persistLocal(config: SecretVaultConfig, password: string, meta: VaultVersionMeta): Promise<void> {
    const blob = await encryptWithSecret(password, JSON.stringify(config));
    localStorage.setItem(SECRET_VAULT_STORAGE_KEY, JSON.stringify({ blob, meta } as StoredVaultFile));
    this.lastMeta = meta;
  }

  async tryAutoUnlock(adminPassword: string): Promise<VaultBootstrapOutcome> {
    const rawLocal = localStorage.getItem(SECRET_VAULT_STORAGE_KEY);

    if (rawLocal) {
      try {
        const parsed = JSON.parse(rawLocal) as StoredVaultFile;
        const decrypted = await decryptWithSecret(adminPassword, parsed.blob);
        if (decrypted === null) return { ok: false, source: 'local', error: 'Could not unlock the Secret Vault with the current Admin Password.' };
        this.unlockedConfig = normalizeVaultConfig(JSON.parse(decrypted));
        this.unlockedPassword = adminPassword;
        this.lastMeta = parsed.meta ?? null;
        this.notify();
        return { ok: true, source: 'local' };
      } catch { return { ok: false, source: 'local', error: 'Secret Vault data is corrupted.' }; }
    }

    try {
      const remoteFile = await getFile(DEFAULT_BOOTSTRAP_CONFIG.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubBranch, VAULT_BLOB_PATH, '');
      if (remoteFile) {
        const parsedRemote = JSON.parse(remoteFile.content) as StoredVaultFile;
        const decrypted = await decryptWithSecret(adminPassword, parsedRemote.blob);
        if (decrypted !== null) {
          const config = normalizeVaultConfig(JSON.parse(decrypted));
          await this.persistLocal(config, adminPassword, parsedRemote.meta);
          this.unlockedConfig = config;
          this.unlockedPassword = adminPassword;
          this.notify();
          return { ok: true, source: 'repository' };
        }
      }
    } catch { }

    const config = bootstrapConfig();
    const meta: VaultVersionMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(config) };
    await this.persistLocal(config, adminPassword, meta);
    this.unlockedConfig = config;
    this.unlockedPassword = adminPassword;
    this.notify();
    return { ok: true, source: 'created-fresh' };
  }

  lock(): void { this.unlockedConfig = null; this.unlockedPassword = null; this.notify(); }

  async saveConfig(newConfig: Partial<SecretVaultConfig>, adminPasswordOverride?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.unlockedConfig) return { ok: false, error: 'Secret Vault is locked.' };
    const password = adminPasswordOverride || this.unlockedPassword;
    if (!password) return { ok: false, error: 'Session password unavailable — please lock and re-unlock Settings.' };
    const merged: SecretVaultConfig = normalizeVaultConfig({ ...this.unlockedConfig, ...newConfig });
    const meta: VaultVersionMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(merged) };
    await this.persistLocal(merged, password, meta);
    this.unlockedConfig = merged;
    this.notify();
    this.pushToRepository().catch(() => {});
    return { ok: true };
  }

  async reencryptForNewPassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    const raw = localStorage.getItem(SECRET_VAULT_STORAGE_KEY);
    if (!raw) return { ok: true };
    try {
      const parsed = JSON.parse(raw) as StoredVaultFile;
      const decrypted = await decryptWithSecret(oldPassword, parsed.blob);
      if (decrypted === null) return { ok: false, error: 'Could not re-encrypt the Secret Vault — old password did not match.' };
      const config = normalizeVaultConfig(JSON.parse(decrypted));
      const meta: VaultVersionMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(config) };
      await this.persistLocal(config, newPassword, meta);
      if (this.unlockedConfig) { this.unlockedPassword = newPassword; this.notify(); }
      this.pushToRepository().catch(() => {});
      return { ok: true };
    } catch { return { ok: false, error: 'Secret Vault data is corrupted.' }; }
  }

  async pushToRepository(): Promise<{ ok: boolean; error?: string }> {
    if (!this.unlockedConfig || !this.unlockedPassword) return { ok: false, error: 'Secret Vault is locked.' };
    try {
      const blob = await encryptWithSecret(this.unlockedPassword, JSON.stringify(this.unlockedConfig));
      const meta: VaultVersionMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(this.unlockedConfig) };
      const content = JSON.stringify({ blob, meta } as StoredVaultFile, null, 2);
      const lastSha = localStorage.getItem(VAULT_LAST_SHA_KEY);
      const result = await putFile(DEFAULT_BOOTSTRAP_CONFIG.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubBranch, VAULT_BLOB_PATH, this.unlockedConfig.githubToken, content, `Update Secret Vault configuration (${new Date().toISOString()})`, lastSha);
      localStorage.setItem(VAULT_LAST_SHA_KEY, result.sha);
      this.lastMeta = meta;
      return { ok: true };
    } catch (e) { return { ok: false, error: isGitHubApiError(e) ? e.message : (e as Error).message || 'Unknown error while synchronizing the Secret Vault.' }; }
  }

  resetVault(): void { localStorage.removeItem(SECRET_VAULT_STORAGE_KEY); localStorage.removeItem(VAULT_LAST_SHA_KEY); this.unlockedConfig = null; this.unlockedPassword = null; this.lastMeta = null; this.notify(); }
}

export const secretVaultService = new SecretVaultService();
