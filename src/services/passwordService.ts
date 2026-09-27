import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob } from './cryptoService';
import { safeLocalStorageSet } from '../utils/validation';
const STORAGE_KEY = 'sqla.pwvault.v147';
const MARKER = 'sqla-verified-marker-v147';
const DEFAULT_PASSWORD = 'admin';
let defaultBlobCache: string | null = null;
async function getStoredBlobRaw(): Promise<string> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  if (!defaultBlobCache) { const blob = await encryptWithSecret(DEFAULT_PASSWORD, MARKER); defaultBlobCache = serializeBlob(blob); }
  return defaultBlobCache;
}
export async function verifyPassword(candidate: string): Promise<boolean> {
  const raw = await getStoredBlobRaw();
  const blob = deserializeBlob(raw);
  if (!blob) return false;
  const decrypted = await decryptWithSecret(candidate, blob);
  return decrypted === MARKER;
}
export async function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (!newPassword || newPassword.trim().length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };
  const isValid = await verifyPassword(oldPassword);
  if (!isValid) return { ok: false, error: 'Current password is incorrect.' };
  const newBlob = await encryptWithSecret(newPassword, MARKER);
  const result = safeLocalStorageSet(STORAGE_KEY, serializeBlob(newBlob));
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
export function resetPasswordToDefault(): void { localStorage.removeItem(STORAGE_KEY); }
export function isUsingDefaultPassword(): boolean { return localStorage.getItem(STORAGE_KEY) === null; }
