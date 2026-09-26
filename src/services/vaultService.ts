import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob } from './cryptoService';

// ============================================================================
// vaultService — a SEPARATE encryption layer from the Settings password,
// protected by its own user-chosen Vault Passphrase. Protects sensitive
// synchronization configuration: GitHub repo/branch/token, shared-location
// label, etc.
//
// Design: Vault Passphrase -> salt -> PBKDF2 -> AES-GCM key -> encrypt the
// entire config JSON blob -> store only the encrypted blob in localStorage.
// The passphrase itself is NEVER stored — only used transiently to derive
// the key at unlock time. Decrypted config lives in memory ONLY while
// unlocked; lockVault() clears it immediately.
//
// No default vault passphrase is ever hard-coded — the vault does not exist
// until the user explicitly creates one.
// ============================================================================

const VAULT_STORAGE_KEY = 'apsql.vault.v132';

export interface VaultConfig {
  githubRepo: string; githubBranch: string; githubSchemaPath: string; githubToken: string; sharedLocationLabel: string;
}

function emptyConfig(): VaultConfig { return { githubRepo: '', githubBranch: 'main', githubSchemaPath: 'schema.json', githubToken: '', sharedLocationLabel: '' }; }

class VaultService {
  private unlockedConfig: VaultConfig | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }

  exists(): boolean { return localStorage.getItem(VAULT_STORAGE_KEY) !== null; }
  isUnlocked(): boolean { return this.unlockedConfig !== null; }
  getConfig(): VaultConfig | null { return this.unlockedConfig; }

  async createVault(passphrase: string, confirmPassphrase: string): Promise<{ ok: boolean; error?: string }> {
    if (!passphrase || passphrase.length < 6) return { ok: false, error: 'Vault passphrase must be at least 6 characters.' };
    if (passphrase !== confirmPassphrase) return { ok: false, error: 'Passphrases do not match.' };
    if (this.exists()) return { ok: false, error: 'A vault already exists. Reset it first if you want to start over.' };
    const config = emptyConfig();
    const blob = await encryptWithSecret(passphrase, JSON.stringify(config));
    localStorage.setItem(VAULT_STORAGE_KEY, serializeBlob(blob));
    this.unlockedConfig = config;
    this.notify();
    return { ok: true };
  }

  async unlock(passphrase: string): Promise<{ ok: boolean; error?: string }> {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return { ok: false, error: 'No vault has been created yet.' };
    const blob = deserializeBlob(raw);
    if (!blob) return { ok: false, error: 'Vault data is corrupted.' };
    const decrypted = await decryptWithSecret(passphrase, blob);
    if (decrypted === null) return { ok: false, error: 'Incorrect passphrase.' };
    try { this.unlockedConfig = JSON.parse(decrypted) as VaultConfig; this.notify(); return { ok: true }; }
    catch { return { ok: false, error: 'Vault data is corrupted.' }; }
  }

  lock(): void { this.unlockedConfig = null; this.notify(); }

  async saveConfig(newConfig: Partial<VaultConfig>, passphrase: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.unlockedConfig) return { ok: false, error: 'Vault is locked.' };
    const merged: VaultConfig = { ...this.unlockedConfig, ...newConfig };
    const blob = await encryptWithSecret(passphrase, JSON.stringify(merged));
    localStorage.setItem(VAULT_STORAGE_KEY, serializeBlob(blob));
    this.unlockedConfig = merged;
    this.notify();
    return { ok: true };
  }

  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.unlockedConfig) return { ok: false, error: 'Unlock the vault first.' };
    const verify = await this.unlock(oldPassphrase);
    if (!verify.ok) return { ok: false, error: 'Current passphrase is incorrect.' };
    if (!newPassphrase || newPassphrase.length < 6) return { ok: false, error: 'New passphrase must be at least 6 characters.' };
    const blob = await encryptWithSecret(newPassphrase, JSON.stringify(this.unlockedConfig));
    localStorage.setItem(VAULT_STORAGE_KEY, serializeBlob(blob));
    this.notify();
    return { ok: true };
  }

  resetVault(): void { localStorage.removeItem(VAULT_STORAGE_KEY); this.unlockedConfig = null; this.notify(); }
}

export const vaultService = new VaultService();
