import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob } from './cryptoService';

// ============================================================================
// passwordService — V14. Default admin password is now "admin" (spec
// section 9), encrypted at rest (never stored/logged in plain text), and
// — critically — NEVER surfaced anywhere in the UI (no hints, no tooltips,
// no walkthrough text, no error messages reveal it). Verification works by
// attempting to decrypt a fixed marker; a wrong password fails
// cryptographically via AES-GCM's auth tag, not a string comparison.
// ============================================================================

const STORAGE_KEY = 'sqla.pwvault.v14';
const MARKER = 'sqla-verified-marker-v14';
const DEFAULT_PASSWORD = 'admin'; // never displayed in any UI surface — internal use only

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
  localStorage.setItem(STORAGE_KEY, serializeBlob(newBlob));
  return { ok: true };
}

export function resetPasswordToDefault(): void { localStorage.removeItem(STORAGE_KEY); }
export function isUsingDefaultPassword(): boolean { return localStorage.getItem(STORAGE_KEY) === null; }
// NOTE: intentionally NOT exporting the default password value anywhere that
// a page/component could render it. Do not add such an export back.
