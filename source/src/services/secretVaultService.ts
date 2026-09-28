import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob, type EncryptedBlob } from './cryptoService';
import { getFile, putFile, isGitHubApiError } from './githubApiService';
import { safeString, safeLocalStorageSet } from '../utils/validation';
import type { VaultErrorCode } from '../types';
const SECRET_VAULT_STORAGE_KEY = 'sqla.secretvault.v157';
const VAULT_LAST_SHA_KEY = 'sqla.vaultlastsha.v157';
const DEVICE_TAG_KEY = 'sqla.deviceTag.v157';
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
  if (!tag) { tag = 'device-' + Math.random().toString(36).slice(2, 8); safeLocalStorageSet(DEVICE_TAG_KEY, tag); }
  return tag;
}
async function computeConfigChecksum(config: SecretVaultConfig): Promise<string> {
  const canonical = JSON.stringify({ githubRepo: config.githubRepo, githubBranch: config.githubBranch, githubSchemaPath: config.githubSchemaPath });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical) as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a response.')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
export interface VaultBootstrapOutcome { ok: boolean; source: 'local' | 'repository' | 'created-fresh'; code: VaultErrorCode; error?: string; }
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
  private async persistLocal(config: SecretVaultConfig, password: string, meta: VaultVersionMeta): Promise<{ ok: boolean; error?: string }> {
    const blobResult = await encryptWithSecret(password, JSON.stringify(config));
    if (!blobResult.ok) return { ok: false, error: blobResult.error };
    safeLocalStorageSet(SECRET_VAULT_STORAGE_KEY, JSON.stringify({ blob: blobResult.blob, meta } as StoredVaultFile));
    this.lastMeta = meta;
    return { ok: true };
  }
  async tryAutoUnlock(adminPassword: string): Promise<VaultBootstrapOutcome> {
    const rawLocal = localStorage.getItem(SECRET_VAULT_STORAGE_KEY);
    if (rawLocal) {
      let parsed: StoredVaultFile;
      try { parsed = JSON.parse(rawLocal); } catch { return { ok: false, source: 'local', code: 'vault-corrupted', error: 'Secret Vault data is corrupted.' }; }
      if (!parsed || typeof parsed !== 'object' || !parsed.blob) return { ok: false, source: 'local', code: 'vault-corrupted', error: 'Secret Vault data is corrupted.' };
      const decrypted = await decryptWithSecret(adminPassword, parsed.blob);
      if (!decrypted.ok) {
        if (decrypted.reason === 'wrong-secret-or-corrupted') return { ok: false, source: 'local', code: 'incorrect-password', error: 'Incorrect administrator password. Please try again.' };
        if (decrypted.reason === 'crypto-unavailable') return { ok: false, source: 'local', code: 'encryption-error', error: decrypted.error };
        return { ok: false, source: 'local', code: 'vault-corrupted', error: decrypted.error };
      }
      let configObj: unknown;
      try { configObj = JSON.parse(decrypted.value); } catch { return { ok: false, source: 'local', code: 'vault-corrupted', error: 'Secret Vault configuration is corrupted.' }; }
      this.unlockedConfig = normalizeVaultConfig(configObj);
      this.unlockedPassword = adminPassword;
      this.lastMeta = parsed.meta ?? null;
      this.notify();
      return { ok: true, source: 'local', code: 'none' };
    }
    try {
      const remoteFile = await withTimeout(getFile(DEFAULT_BOOTSTRAP_CONFIG.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubBranch, VAULT_BLOB_PATH, ''), 4000);
      if (remoteFile) {
        let parsedRemote: StoredVaultFile | null;
        try { parsedRemote = JSON.parse(remoteFile.content); } catch { parsedRemote = null; }
        if (parsedRemote && parsedRemote.blob) {
          const decrypted = await decryptWithSecret(adminPassword, parsedRemote.blob);
          if (decrypted.ok) {
            let configObj: unknown;
            try { configObj = JSON.parse(decrypted.value); } catch { configObj = null; }
            if (configObj) {
              const config = normalizeVaultConfig(configObj);
              const persistResult = await this.persistLocal(config, adminPassword, parsedRemote.meta);
              if (persistResult.ok) {
                this.unlockedConfig = config; this.unlockedPassword = adminPassword; this.notify();
                return { ok: true, source: 'repository', code: 'none' };
              }
            }
          }
          if (decrypted && !decrypted.ok && decrypted.reason === 'wrong-secret-or-corrupted') {
            return { ok: false, source: 'repository', code: 'incorrect-password', error: 'Incorrect administrator password. Please try again.' };
          }
        }
      }
    } catch { /* network/GitHub-layer failure while bootstrapping — fall through to fresh vault, never a credential error */ }
    const config = bootstrapConfig();
    const meta: VaultVersionMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(config) };
    const persistResult = await this.persistLocal(config, adminPassword, meta);
    if (!persistResult.ok) return { ok: false, source: 'created-fresh', code: 'encryption-error', error: persistResult.error };
    this.unlockedConfig = config; this.unlockedPassword = adminPassword; this.notify();
    return { ok: true, source: 'created-fresh', code: 'none' };
  }
  lock(): void { this.unlockedConfig = null; this.unlockedPassword = null; this.notify(); }
  async saveConfig(newConfig: Partial<SecretVaultConfig> = {}, adminPasswordOverride?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.unlockedConfig) return { ok: false, error: 'Secret Vault is locked.' };
    const password = adminPasswordOverride || this.unlockedPassword;
    if (!password) return { ok: false, error: 'Session password unavailable — please lock and re-unlock Settings.' };
    const merged: SecretVaultConfig = normalizeVaultConfig({ ...this.unlockedConfig, ...newConfig });
    const meta: VaultVersionMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(merged) };
    const persistResult = await this.persistLocal(merged, password, meta);
    if (!persistResult.ok) return { ok: false, error: persistResult.error };
    this.unlockedConfig = merged;
    this.notify();
    this.pushToRepository().catch(() => {});
    return { ok: true };
  }
  async reencryptForNewPassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    const raw = localStorage.getItem(SECRET_VAULT_STORAGE_KEY);
    if (!raw) return { ok: true };
    let parsed: StoredVaultFile;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, error: 'Secret Vault data is corrupted.' }; }
    const decrypted = await decryptWithSecret(oldPassword, parsed.blob);
    if (!decrypted.ok) return { ok: false, error: decrypted.reason === 'wrong-secret-or-corrupted' ? 'Could not re-encrypt the Secret Vault — old password did not match.' : decrypted.error };
    let configObj: unknown;
    try { configObj = JSON.parse(decrypted.value); } catch { return { ok: false, error: 'Secret Vault configuration is corrupted.' }; }
    const config = normalizeVaultConfig(configObj);
    const meta: VaultVersionMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(config) };
    const persistResult = await this.persistLocal(config, newPassword, meta);
    if (!persistResult.ok) return { ok: false, error: persistResult.error };
    if (this.unlockedConfig) { this.unlockedPassword = newPassword; this.notify(); }
    this.pushToRepository().catch(() => {});
    return { ok: true };
  }
  async pushToRepository(): Promise<{ ok: boolean; error?: string }> {
    if (!this.unlockedConfig || !this.unlockedPassword) return { ok: false, error: 'Secret Vault is locked.' };
    try {
      const blobResult = await encryptWithSecret(this.unlockedPassword, JSON.stringify(this.unlockedConfig));
      if (!blobResult.ok) return { ok: false, error: blobResult.error };
      const meta: VaultVersionMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(this.unlockedConfig) };
      const content = JSON.stringify({ blob: blobResult.blob, meta } as StoredVaultFile, null, 2);
      const lastSha = localStorage.getItem(VAULT_LAST_SHA_KEY);
      const result = await putFile(DEFAULT_BOOTSTRAP_CONFIG.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubBranch, VAULT_BLOB_PATH, this.unlockedConfig.githubToken, content, `Update Secret Vault configuration (${new Date().toISOString()})`, lastSha);
      safeLocalStorageSet(VAULT_LAST_SHA_KEY, result.sha);
      this.lastMeta = meta;
      return { ok: true };
    } catch (e) { return { ok: false, error: isGitHubApiError(e) ? e.message : (e as Error).message || 'Unknown error while synchronizing the Secret Vault.' }; }
  }
  resetVault(): void { localStorage.removeItem(SECRET_VAULT_STORAGE_KEY); localStorage.removeItem(VAULT_LAST_SHA_KEY); this.unlockedConfig = null; this.unlockedPassword = null; this.lastMeta = null; this.notify(); }
}
export const secretVaultService = new SecretVaultService();
