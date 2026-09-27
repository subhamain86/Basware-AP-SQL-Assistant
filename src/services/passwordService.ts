import { encryptWithSecret, decryptWithSecret, serializeBlob, deserializeBlob } from './cryptoService';
import { safeLocalStorageSet, safeTrim, isNonEmptyString } from '../utils/validation';
import type { VaultErrorCode } from '../types';
const STORAGE_KEY = 'sqla.pwvault.v151';
const MARKER = 'sqla-verified-marker-v151';
/** Preserved exactly per V15.1 requirement #8 — the internal/default
 * administrative password remains "admin". It is NEVER stored, displayed,
 * or transmitted in plaintext anywhere except as the in-memory constant
 * used once to derive the default encrypted marker blob below; the actual
 * comparison always happens via AES-GCM decryption (see cryptoService),
 * never via a plaintext string comparison. */
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

/** V15.1 FIX #2 — "Password / Secret Vault page always displaying an
 * incorrect credential error, even when the correct password is entered."
 *
 * ROOT CAUSE ANALYSIS: password verification correctly used AES-GCM
 * authenticated decryption (decrypt succeeds only if the derived key
 * matches, i.e. only if the candidate password is correct) — but NEITHER
 * `verifyPassword()` NOR its caller in the Settings unlock screen had any
 * defense against the handful of ways this check could fail for reasons
 * that have NOTHING to do with the password itself:
 *   - `encryptWithSecret()`/`decryptWithSecret()` previously had no
 *     structured failure path at all for a missing/unavailable Web Crypto
 *     API — they simply threw, and that raw exception was never caught
 *     anywhere between here and the click handler, so the unlock button
 *     appeared to silently fail (or, depending on timing, left the UI in
 *     an inconsistent state that a subsequent click would report as
 *     "incorrect password" purely because the previous attempt's promise
 *     rejection was swallowed).
 *   - A corrupted/partial `STORAGE_KEY` blob (e.g. a prior interrupted
 *     write) would throw during JSON.parse or during decrypt, and that,
 *     too, surfaced as an undistinguished "incorrect password".
 *   - There was no way for the caller to tell "wrong password" apart from
 *     "vault isn't initialized yet" or "vault data is corrupted".
 *
 * THE FIX: `verifyPasswordDetailed()` below returns a structured result
 * with an explicit VaultErrorCode for every distinct failure mode, so a
 * correct password reliably resolves to `{ ok: true }` regardless of
 * transient state, and every non-credential failure is reported under
 * its own code — never bucketed into "incorrect-password". The original
 * boolean `verifyPassword()` is kept as a thin, backward-compatible
 * wrapper. */
export interface PasswordVerifyResult { ok: boolean; code: VaultErrorCode; error?: string; }
export async function verifyPasswordDetailed(candidateRaw: unknown): Promise<PasswordVerifyResult> {
  if (candidateRaw === undefined || candidateRaw === null) return { ok: false, code: 'empty-password', error: 'No password was provided.' };
  if (typeof candidateRaw !== 'string') return { ok: false, code: 'empty-password', error: 'Password must be text.' };
  // Intentionally do NOT trim the password itself before comparison — a
  // password with meaningful leading/trailing whitespace should compare
  // exactly as typed (this preserves exact-match semantics and avoids a
  // different class of false-negative if a user's real password happens
  // to contain a trailing space). We only use safeTrim() to decide
  // whether the field is effectively empty.
  if (!safeTrim(candidateRaw)) return { ok: false, code: 'empty-password', error: 'Password cannot be empty.' };
  const candidate = candidateRaw;
  const blobResult = await getStoredBlobRaw();
  if (!blobResult.ok) return { ok: false, code: blobResult.code, error: blobResult.error };
  const blob = deserializeBlob(blobResult.raw);
  if (!blob) return { ok: false, code: 'vault-corrupted', error: 'Stored password data is corrupted or unreadable.' };
  const decrypted = await decryptWithSecret(candidate, blob);
  if (!decrypted.ok) {
    // Only the AES-GCM auth-tag-mismatch path (wrong-secret-or-corrupted)
    // is EVER reported as an incorrect password. A crypto-unavailable or
    // malformed-blob failure gets its own distinct code so it is never
    // shown to the user as "you typed the wrong password".
    if (decrypted.reason === 'wrong-secret-or-corrupted') return { ok: false, code: 'incorrect-password', error: 'Incorrect password.' };
    if (decrypted.reason === 'crypto-unavailable') return { ok: false, code: 'encryption-error', error: decrypted.error };
    return { ok: false, code: 'vault-corrupted', error: decrypted.error };
  }
  if (decrypted.value !== MARKER) return { ok: false, code: 'incorrect-password', error: 'Incorrect password.' };
  return { ok: true, code: 'none' };
}
/** Backward-compatible boolean wrapper — unchanged call sites elsewhere in
 * the app that only need a yes/no answer continue to work exactly as
 * before. */
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
