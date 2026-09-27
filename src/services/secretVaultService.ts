import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob } from './cryptoService';

// ============================================================================
// secretVaultService — V14.2 (spec sections 24-30). Replaces V14.1's
// separate-passphrase vaultService with a Secret Vault that is unlocked
// using the SAME Admin Password already used to unlock Settings (spec
// section 27: "Use the existing Admin Password/Vault authentication
// mechanism... the user should see 'Enter Admin Password'"). This removes
// an entire second secret the user had to remember, while still keeping
// the GitHub configuration in its own dedicated encrypted store
// (different localStorage key/ciphertext, different purpose) rather than
// mixing it into the Settings-lock flag itself.
//
// "Without needing to know technical repository configuration" (spec 24):
// a non-secret DEFAULT_BOOTSTRAP_CONFIG (repo/branch/path — none of which
// are sensitive; knowing "which repo" is not a security boundary, only the
// access TOKEN is) is baked into the app and used to pre-fill the Secret
// Vault the first time it's created, so a typical user only ever has to
// supply their personal GitHub token. The token itself is inherently
// personal per GitHub's own security model (each authorized person needs
// their own credential) and — being a genuine secret — is intentionally
// NEVER synchronized or auto-recovered from anywhere: it must be entered
// once per machine, after which it's remembered locally, encrypted under
// the Admin Password. This is stated plainly rather than implying a false
// "fully automatic secret sync" capability that a static, backend-less
// client application cannot honestly provide.
// ============================================================================

const SECRET_VAULT_STORAGE_KEY = 'sqla.secretvault.v142';

export interface SecretVaultConfig {
  githubRepo: string;
  githubBranch: string;
  githubSchemaPath: string;
  githubToken: string;
  sharedLocationLabel: string;
}

// Non-secret bootstrap defaults — safe to bake into the shipped app.
export const DEFAULT_BOOTSTRAP_CONFIG: Omit<SecretVaultConfig, 'githubToken' | 'sharedLocationLabel'> = {
  githubRepo: 'subhamain86/Basware-AP-SQL-Assistant',
  githubBranch: 'main',
  githubSchemaPath: 'sql-assistant-data/schema-registry.json'
};

function bootstrapConfig(): SecretVaultConfig { return { ...DEFAULT_BOOTSTRAP_CONFIG, githubToken: '', sharedLocationLabel: '' }; }

export function maskToken(token: string): string {
  if (!token) return 'Not configured';
  const visibleTail = token.length > 4 ? token.slice(-4) : '';
  return `${'•'.repeat(12)}${visibleTail}`;
}

class SecretVaultService {
  private unlockedConfig: SecretVaultConfig | null = null;
  private listeners = new Set<() => void>();
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }

  exists(): boolean { return localStorage.getItem(SECRET_VAULT_STORAGE_KEY) !== null; }
  isUnlocked(): boolean { return this.unlockedConfig !== null; }
  getConfig(): SecretVaultConfig | null { return this.unlockedConfig; }
  hasToken(): boolean { return !!this.unlockedConfig?.githubToken; }

  /** Creates the Secret Vault (first time only), pre-filled with the
   * non-secret bootstrap defaults, encrypted under the SAME password the
   * caller already used to unlock Settings. */
  private async create(password: string): Promise<void> {
    const config = bootstrapConfig();
    const blob = await encryptWithSecret(password, JSON.stringify(config));
    localStorage.setItem(SECRET_VAULT_STORAGE_KEY, serializeBlob(blob));
    this.unlockedConfig = config;
  }

  /** Attempts to unlock the vault with the given (already-verified, since
   * it just successfully unlocked Settings) Admin Password. If no vault
   * exists yet, one is created automatically and pre-filled with the
   * bootstrap defaults — no separate "Create Vault" step is needed. */
  async tryAutoUnlock(adminPassword: string): Promise<{ ok: boolean; error?: string; justCreated?: boolean }> {
    const raw = localStorage.getItem(SECRET_VAULT_STORAGE_KEY);
    if (!raw) { await this.create(adminPassword); this.notify(); return { ok: true, justCreated: true }; }
    const blob = deserializeBlob(raw);
    if (!blob) return { ok: false, error: 'Secret Vault data is corrupted.' };
    const decrypted = await decryptWithSecret(adminPassword, blob);
    if (decrypted === null) return { ok: false, error: 'Could not unlock the Secret Vault with the current Admin Password.' };
    try { this.unlockedConfig = JSON.parse(decrypted) as SecretVaultConfig; this.notify(); return { ok: true }; }
    catch { return { ok: false, error: 'Secret Vault data is corrupted.' }; }
  }

  lock(): void { this.unlockedConfig = null; this.notify(); }

  /** Saves updated configuration, re-encrypting under the given (already
   * verified) Admin Password. */
  async saveConfig(newConfig: Partial<SecretVaultConfig>, adminPassword: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.unlockedConfig) return { ok: false, error: 'Secret Vault is locked.' };
    const merged: SecretVaultConfig = { ...this.unlockedConfig, ...newConfig };
    const blob = await encryptWithSecret(adminPassword, JSON.stringify(merged));
    localStorage.setItem(SECRET_VAULT_STORAGE_KEY, serializeBlob(blob));
    this.unlockedConfig = merged;
    this.notify();
    return { ok: true };
  }

  /** Since the vault's encryption key IS the Admin Password, changing the
   * Admin Password (in Settings → Security) must re-encrypt the vault too,
   * or it becomes unreadable. Called automatically from the password
   * change flow. */
  async reencryptForNewPassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    const raw = localStorage.getItem(SECRET_VAULT_STORAGE_KEY);
    if (!raw) return { ok: true }; // no vault yet — nothing to re-encrypt
    const blob = deserializeBlob(raw);
    if (!blob) return { ok: false, error: 'Secret Vault data is corrupted.' };
    const decrypted = await decryptWithSecret(oldPassword, blob);
    if (decrypted === null) return { ok: false, error: 'Could not re-encrypt the Secret Vault — old password did not match.' };
    const newBlob = await encryptWithSecret(newPassword, decrypted);
    localStorage.setItem(SECRET_VAULT_STORAGE_KEY, serializeBlob(newBlob));
    if (this.unlockedConfig) this.notify();
    return { ok: true };
  }

  resetVault(): void { localStorage.removeItem(SECRET_VAULT_STORAGE_KEY); this.unlockedConfig = null; this.notify(); }
}

export const secretVaultService = new SecretVaultService();
