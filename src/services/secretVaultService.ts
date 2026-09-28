import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob, type EncryptedBlob } from './cryptoService';
import { getFile, putFile, isGitHubApiError } from './githubApiService';
import { safeString, safeTrim, safeLocalStorageSet } from '../utils/validation';
const SECRET_VAULT_STORAGE_KEY = 'sqla.secretvault.v15';
const VAULT_LAST_SHA_KEY = 'sqla.vaultlastsha.v15';
const DEVICE_TAG_KEY = 'sqla.deviceTag.v15';
/** V16.0: optional, read-only-w.r.t-schema M365 Copilot Enterprise integration config.
 *  Stored as one more field inside the SAME encrypted Secret Vault blob — no new vault,
 *  no new password, no plaintext storage. See CONFIGURATION.md. */
export interface M365CopilotConfig {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  /** Organization's own Copilot Studio / declarative-agent endpoint that accepts { prompt, schemaContext } and returns { tables?, columns?, filters?, raw? } — same response shape as the existing generic Online AI/NLP Endpoint. */
  agentEndpoint: string;
  /** OAuth2 scope requested from Microsoft identity platform for the agent endpoint (e.g. api://<agent-app-id>/.default). Never a client secret. */
  scope: string;
}
export function defaultM365CopilotConfig(): M365CopilotConfig { return { enabled: false, tenantId: '', clientId: '', agentEndpoint: '', scope: '' }; }
export interface SecretVaultConfig { githubRepo: string; githubBranch: string; githubSchemaPath: string; githubToken: string; sharedLocationLabel: string; m365Copilot: M365CopilotConfig; }
export interface VaultVersionMeta { updatedAt: string; updatedByDevice: string; checksum: string; }
interface StoredVaultFile { blob: EncryptedBlob; meta: VaultVersionMeta; }
export const DEFAULT_BOOTSTRAP_CONFIG: Omit<SecretVaultConfig, 'githubToken' | 'sharedLocationLabel' | 'm365Copilot'> = {
  githubRepo: 'subhamain86/Basware-AP-SQL-Assistant',
  githubBranch: 'main',
  githubSchemaPath: 'sql-assistant-data/schemas/registry.json'
};
const VAULT_BLOB_PATH = 'sql-assistant-data/vault/secret-vault.enc.json';
function bootstrapConfig(): SecretVaultConfig { return { ...DEFAULT_BOOTSTRAP_CONFIG, githubToken: '', sharedLocationLabel: '', m365Copilot: defaultM365CopilotConfig() }; }
function normalizeM365Config(raw: unknown): M365CopilotConfig {
  const r = (raw && typeof raw === 'object') ? (raw as Partial<M365CopilotConfig>) : {};
  return { enabled: !!r.enabled, tenantId: safeString(r.tenantId, ''), clientId: safeString(r.clientId, ''), agentEndpoint: safeString(r.agentEndpoint, ''), scope: safeString(r.scope, '') };
}
function normalizeVaultConfig(raw: unknown): SecretVaultConfig {
  const r = (raw && typeof raw === 'object') ? (raw as Partial<SecretVaultConfig>) : {};
  return {
    githubRepo: safeString(r.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubRepo),
    githubBranch: safeString(r.githubBranch, DEFAULT_BOOTSTRAP_CONFIG.githubBranch),
    githubSchemaPath: safeString(r.githubSchemaPath, DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath),
    githubToken: safeString(r.githubToken, ''),
    sharedLocationLabel: safeString(r.sharedLocationLabel, ''),
    m365Copilot: normalizeM365Config(r.m365Copilot)
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
    safeLocalStorageSet(SECRET_VAULT_STORAGE_KEY, JSON.stringify({ blob, meta } as StoredVaultFile));
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
  /** V16.0: update only the m365Copilot sub-object, reusing saveConfig — no new storage mechanism. */
  async saveM365CopilotConfig(patch: Partial<import('./secretVaultService').M365CopilotConfig>): Promise<{ ok: boolean; error?: string }> {
    if (!this.unlockedConfig) return { ok: false, error: 'Secret Vault is locked.' };
    return this.saveConfig({ m365Copilot: { ...this.unlockedConfig.m365Copilot, ...patch } });
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
      safeLocalStorageSet(VAULT_LAST_SHA_KEY, result.sha);
      this.lastMeta = meta;
      return { ok: true };
    } catch (e) { return { ok: false, error: isGitHubApiError(e) ? e.message : (e as Error).message || 'Unknown error while synchronizing the Secret Vault.' }; }
  }
  resetVault(): void { localStorage.removeItem(SECRET_VAULT_STORAGE_KEY); localStorage.removeItem(VAULT_LAST_SHA_KEY); this.unlockedConfig = null; this.unlockedPassword = null; this.lastMeta = null; this.notify(); }
}
export const secretVaultService = new SecretVaultService();
