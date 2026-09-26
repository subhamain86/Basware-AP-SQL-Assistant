import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob } from './cryptoService';

// ============================================================================
// passwordService — reuses the SAME operational password everywhere
// (Settings unlock, Manual Schema Update delete confirmation, Danger Zone).
// Encrypted at rest per spec:
//   Password -> Key derivation (PBKDF2) -> AES-GCM encryption
//     -> Encrypted credential -> Local secure storage
//
// Verification works WITHOUT ever storing the password itself: we encrypt a
// fixed marker string with a key derived from the password, then to verify
// a candidate we attempt to decrypt that same blob using a key derived from
// the candidate. AES-GCM's authentication tag makes a wrong password fail
// to decrypt (not just produce garbage) — a legitimate password-
// verification-via-authenticated-encryption pattern.
// ============================================================================

const STORAGE_KEY = 'apsql.pwvault.v132';
const MARKER = 'apsql-verified-marker-v132';
const DEFAULT_PASSWORD = 'apsql-admin';

let defaultBlobCache: string | null = null;

async function getStoredBlobRaw(): Promise<string> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  if (!defaultBlobCache) {
    const blob = await encryptWithSecret(DEFAULT_PASSWORD, MARKER);
    defaultBlobCache = serializeBlob(blob);
  }
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
export const DEMO_DEFAULT_PASSWORD_HINT = DEFAULT_PASSWORD;
