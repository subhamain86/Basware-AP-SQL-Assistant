// cryptoService — PBKDF2 + AES-GCM via the browser's built-in Web Crypto API.
// No external dependency. Honest scope: client-side protection only, raises
// the bar against casual localStorage inspection; not server-grade security.
const PBKDF2_ITERATIONS = 150000;
function toBase64(bytes: Uint8Array): string { let binary = ''; bytes.forEach((b) => { binary += String.fromCharCode(b); }); return btoa(binary); }
function fromBase64(b64: string): Uint8Array { const binary = atob(b64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }
async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export interface EncryptedBlob { salt: string; iv: string; ciphertext: string; }
export async function encryptWithSecret(secret: string, plaintext: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret, salt);
  const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext) as BufferSource);
  return { salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertextBuf)) };
}
export async function decryptWithSecret(secret: string, blob: EncryptedBlob): Promise<string | null> {
  try {
    const salt = fromBase64(blob.salt); const iv = fromBase64(blob.iv); const ciphertext = fromBase64(blob.ciphertext);
    const key = await deriveKey(secret, salt);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource);
    return new TextDecoder().decode(plainBuf);
  } catch { return null; }
}
export function serializeBlob(blob: EncryptedBlob): string { return JSON.stringify(blob); }
export function deserializeBlob(s: string): EncryptedBlob | null { try { const parsed = JSON.parse(s); if (parsed && parsed.salt && parsed.iv && parsed.ciphertext) return parsed; return null; } catch { return null; } }
