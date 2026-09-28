const PBKDF2_ITERATIONS = 150000;
function toBase64(bytes: Uint8Array): string { let binary = ''; bytes.forEach((b) => { binary += String.fromCharCode(b); }); return btoa(binary); }
function fromBase64(b64: string): Uint8Array { const binary = atob(b64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }
async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export interface EncryptedBlob { salt: string; iv: string; ciphertext: string; }
export async function encryptWithSecret(secret: string, plaintext: string): Promise<{ ok: true; blob: EncryptedBlob } | { ok: false; error: string }> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return { ok: false, error: 'Web Crypto API is not available in this browser context.' };
    const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret, salt);
    const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext) as BufferSource);
    return { ok: true, blob: { salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertextBuf)) } };
  } catch (e) { return { ok: false, error: (e as Error)?.message || 'Encryption failed.' }; }
}
export type DecryptFailureReason = 'wrong-secret-or-corrupted' | 'crypto-unavailable' | 'malformed-blob';
export async function decryptWithSecret(secret: string, blob: unknown): Promise<{ ok: true; value: string } | { ok: false; reason: DecryptFailureReason; error: string }> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return { ok: false, reason: 'crypto-unavailable', error: 'Web Crypto API is not available in this browser context.' };
  if (!blob || typeof blob !== 'object') return { ok: false, reason: 'malformed-blob', error: 'Encrypted data is missing or malformed.' };
  const b = blob as Partial<EncryptedBlob>;
  if (typeof b.salt !== 'string' || typeof b.iv !== 'string' || typeof b.ciphertext !== 'string') return { ok: false, reason: 'malformed-blob', error: 'Encrypted data is missing required fields (salt/iv/ciphertext).' };
  try {
    const salt = fromBase64(b.salt); const iv = fromBase64(b.iv); const ciphertext = fromBase64(b.ciphertext);
    const key = await deriveKey(secret, salt);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource);
    return { ok: true, value: new TextDecoder().decode(plainBuf) };
  } catch {
    return { ok: false, reason: 'wrong-secret-or-corrupted', error: 'Decryption failed — the secret does not match, or the stored data is corrupted.' };
  }
}
export function serializeBlob(blob: EncryptedBlob): string { return JSON.stringify(blob); }
export function deserializeBlob(s: unknown): EncryptedBlob | null {
  if (typeof s !== 'string') return null;
  try { const parsed = JSON.parse(s); if (parsed && typeof parsed.salt === 'string' && typeof parsed.iv === 'string' && typeof parsed.ciphertext === 'string') return parsed; return null; } catch { return null; }
}
