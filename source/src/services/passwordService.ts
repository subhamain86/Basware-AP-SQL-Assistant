import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob } from './cryptoService';
import { safeLocalStorageSet, safeTrim, isNonEmptyString } from '../utils/validation';
import type { VaultErrorCode } from '../types';
const STORAGE_KEY = 'sqla.pwvault.v155';
const MARKER = 'sqla-verified-marker-v155';
const DEFAULT_PASSWORD = 'admin';
let defaultBlobCache: string | null = null;
let defaultBlobCacheFailed = false;
async function getStoredBlobRaw(): Promise<{ ok: true; raw: string } | { ok: false; code: VaultErrorCode; error: string }> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return { ok: true, raw: stored };
  if (defaultBlobCacheFailed) return { ok: false, code: 'encryption-error', error: 'Could not initialize the default password vault (Web Crypto unavailable).' };
  if (!defaultBlobCache) {
    const result = await encryptWithSecret(DEFAULT_PASSWORD, MARKER);
    if (!result.ok) { defaultBlobCacheFailed = true; return { ok: false, code: 'encryption-error', error: result.error }; }
    defaultBlobCache = serializeBlob(result.blob);
  }
  return { ok: true, raw: defaultBlobCache };
}
export interface PasswordVerifyResult { ok: boolean; code: VaultErrorCode; error?: string; }
export async function verifyPasswordDetailed(candidateRaw: unknown): Promise<PasswordVerifyResult> {
  if (candidateRaw === undefined || candidateRaw === null) return { ok: false, code: 'empty-password', error: 'Please enter the administrator password.' };
  if (typeof candidateRaw !== 'string') return { ok: false, code: 'empty-password', error: 'Password must be text.' };
  if (!safeTrim(candidateRaw)) return { ok: false, code: 'empty-password', error: 'Please enter the administrator password.' };
  const candidate = candidateRaw;
  const blobResult = await getStoredBlobRaw();
  if (!blobResult.ok) return { ok: false, code: blobResult.code, error: blobResult.error };
  const blob = deserializeBlob(blobResult.raw);
  if (!blob) return { ok: false, code: 'vault-corrupted', error: 'Stored password data is corrupted or unreadable.' };
  const decrypted = await decryptWithSecret(candidate, blob);
  if (!decrypted.ok) {
    if (decrypted.reason === 'wrong-secret-or-corrupted') return { ok: false, code: 'incorrect-password', error: 'Incorrect administrator password. Please try again.' };
    if (decrypted.reason === 'crypto-unavailable') return { ok: false, code: 'encryption-error', error: decrypted.error };
    return { ok: false, code: 'vault-corrupted', error: decrypted.error };
  }
  if (decrypted.value !== MARKER) return { ok: false, code: 'incorrect-password', error: 'Incorrect administrator password. Please try again.' };
  return { ok: true, code: 'none' };
}
export async function verifyPassword(candidate: string): Promise<boolean> {
  const result = await verifyPasswordDetailed(candidate);
  return result.ok;
}
export async function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (!isNonEmptyString(newPassword) || newPassword.trim().length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };
  const verify = await verifyPasswordDetailed(oldPassword);
  if (!verify.ok) {
    if (verify.code === 'incorrect-password') return { ok: false, error: 'Current password is incorrect.' };
    return { ok: false, error: verify.error || 'Could not verify the current password.' };
  }
  const newBlobResult = await encryptWithSecret(newPassword, MARKER);
  if (!newBlobResult.ok) return { ok: false, error: newBlobResult.error };
  const result = safeLocalStorageSet(STORAGE_KEY, serializeBlob(newBlobResult.blob));
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
export function resetPasswordToDefault(): void { localStorage.removeItem(STORAGE_KEY); }
export function isUsingDefaultPassword(): boolean { return localStorage.getItem(STORAGE_KEY) === null; }
