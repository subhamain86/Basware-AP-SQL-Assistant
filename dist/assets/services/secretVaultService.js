import { encryptWithSecret, decryptWithSecret } from './cryptoService.js';
import { getFile, putFile, isGitHubApiError } from './githubApiService.js';
import { safeString, safeLocalStorageSet } from '../utils/validation.js';
const SECRET_VAULT_STORAGE_KEY = 'sqla.secretvault.v147';
const VAULT_LAST_SHA_KEY = 'sqla.vaultlastsha.v147';
const DEVICE_TAG_KEY = 'sqla.deviceTag.v147';
export const DEFAULT_BOOTSTRAP_CONFIG = {
    githubRepo: 'subhamain86/Basware-AP-SQL-Assistant',
    githubBranch: 'main',
    githubSchemaPath: 'sql-assistant-data/schemas/registry.json'
};
const VAULT_BLOB_PATH = 'sql-assistant-data/vault/secret-vault.enc.json';
function bootstrapConfig() { return { ...DEFAULT_BOOTSTRAP_CONFIG, githubToken: '', sharedLocationLabel: '' }; }
function normalizeVaultConfig(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    return {
        githubRepo: safeString(r.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubRepo),
        githubBranch: safeString(r.githubBranch, DEFAULT_BOOTSTRAP_CONFIG.githubBranch),
        githubSchemaPath: safeString(r.githubSchemaPath, DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath),
        githubToken: safeString(r.githubToken, ''),
        sharedLocationLabel: safeString(r.sharedLocationLabel, '')
    };
}
export function maskToken(token) {
    const t = safeString(token);
    if (!t)
        return 'Not configured';
    const visibleTail = t.length > 4 ? t.slice(-4) : '';
    return `${'•'.repeat(12)}${visibleTail}`;
}
function getDeviceTag() {
    let tag = localStorage.getItem(DEVICE_TAG_KEY);
    if (!tag) {
        tag = 'device-' + Math.random().toString(36).slice(2, 8);
        safeLocalStorageSet(DEVICE_TAG_KEY, tag);
    }
    return tag;
}
async function computeConfigChecksum(config) {
    const canonical = JSON.stringify({ githubRepo: config.githubRepo, githubBranch: config.githubBranch, githubSchemaPath: config.githubSchemaPath });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
class SecretVaultService {
    constructor() {
        this.unlockedConfig = null;
        this.unlockedPassword = null;
        this.lastMeta = null;
        this.listeners = new Set();
    }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    notify() { this.listeners.forEach((l) => l()); }
    exists() { return localStorage.getItem(SECRET_VAULT_STORAGE_KEY) !== null; }
    isUnlocked() { return this.unlockedConfig !== null; }
    getConfig() { return this.unlockedConfig; }
    hasToken() { return !!this.unlockedConfig?.githubToken; }
    async persistLocal(config, password, meta) {
        const blob = await encryptWithSecret(password, JSON.stringify(config));
        safeLocalStorageSet(SECRET_VAULT_STORAGE_KEY, JSON.stringify({ blob, meta }));
        this.lastMeta = meta;
    }
    async tryAutoUnlock(adminPassword) {
        const rawLocal = localStorage.getItem(SECRET_VAULT_STORAGE_KEY);
        if (rawLocal) {
            try {
                const parsed = JSON.parse(rawLocal);
                const decrypted = await decryptWithSecret(adminPassword, parsed.blob);
                if (decrypted === null)
                    return { ok: false, source: 'local', error: 'Could not unlock the Secret Vault with the current Admin Password.' };
                this.unlockedConfig = normalizeVaultConfig(JSON.parse(decrypted));
                this.unlockedPassword = adminPassword;
                this.lastMeta = parsed.meta ?? null;
                this.notify();
                return { ok: true, source: 'local' };
            }
            catch {
                return { ok: false, source: 'local', error: 'Secret Vault data is corrupted.' };
            }
        }
        try {
            const remoteFile = await getFile(DEFAULT_BOOTSTRAP_CONFIG.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubBranch, VAULT_BLOB_PATH, '');
            if (remoteFile) {
                const parsedRemote = JSON.parse(remoteFile.content);
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
        }
        catch { }
        const config = bootstrapConfig();
        const meta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(config) };
        await this.persistLocal(config, adminPassword, meta);
        this.unlockedConfig = config;
        this.unlockedPassword = adminPassword;
        this.notify();
        return { ok: true, source: 'created-fresh' };
    }
    lock() { this.unlockedConfig = null; this.unlockedPassword = null; this.notify(); }
    async saveConfig(newConfig, adminPasswordOverride) {
        if (!this.unlockedConfig)
            return { ok: false, error: 'Secret Vault is locked.' };
        const password = adminPasswordOverride || this.unlockedPassword;
        if (!password)
            return { ok: false, error: 'Session password unavailable — please lock and re-unlock Settings.' };
        const merged = normalizeVaultConfig({ ...this.unlockedConfig, ...newConfig });
        const meta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(merged) };
        await this.persistLocal(merged, password, meta);
        this.unlockedConfig = merged;
        this.notify();
        this.pushToRepository().catch(() => { });
        return { ok: true };
    }
    async reencryptForNewPassword(oldPassword, newPassword) {
        const raw = localStorage.getItem(SECRET_VAULT_STORAGE_KEY);
        if (!raw)
            return { ok: true };
        try {
            const parsed = JSON.parse(raw);
            const decrypted = await decryptWithSecret(oldPassword, parsed.blob);
            if (decrypted === null)
                return { ok: false, error: 'Could not re-encrypt the Secret Vault — old password did not match.' };
            const config = normalizeVaultConfig(JSON.parse(decrypted));
            const meta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(config) };
            await this.persistLocal(config, newPassword, meta);
            if (this.unlockedConfig) {
                this.unlockedPassword = newPassword;
                this.notify();
            }
            this.pushToRepository().catch(() => { });
            return { ok: true };
        }
        catch {
            return { ok: false, error: 'Secret Vault data is corrupted.' };
        }
    }
    async pushToRepository() {
        if (!this.unlockedConfig || !this.unlockedPassword)
            return { ok: false, error: 'Secret Vault is locked.' };
        try {
            const blob = await encryptWithSecret(this.unlockedPassword, JSON.stringify(this.unlockedConfig));
            const meta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), checksum: await computeConfigChecksum(this.unlockedConfig) };
            const content = JSON.stringify({ blob, meta }, null, 2);
            const lastSha = localStorage.getItem(VAULT_LAST_SHA_KEY);
            const result = await putFile(DEFAULT_BOOTSTRAP_CONFIG.githubRepo, DEFAULT_BOOTSTRAP_CONFIG.githubBranch, VAULT_BLOB_PATH, this.unlockedConfig.githubToken, content, `Update Secret Vault configuration (${new Date().toISOString()})`, lastSha);
            safeLocalStorageSet(VAULT_LAST_SHA_KEY, result.sha);
            this.lastMeta = meta;
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: isGitHubApiError(e) ? e.message : e.message || 'Unknown error while synchronizing the Secret Vault.' };
        }
    }
    resetVault() { localStorage.removeItem(SECRET_VAULT_STORAGE_KEY); localStorage.removeItem(VAULT_LAST_SHA_KEY); this.unlockedConfig = null; this.unlockedPassword = null; this.lastMeta = null; this.notify(); }
}
export const secretVaultService = new SecretVaultService();
