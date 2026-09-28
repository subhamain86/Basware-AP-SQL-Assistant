export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
export function base64ToUtf8(b64: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof b64 !== 'string') return { ok: false, error: 'Content is not a base64 string.' };
  try {
    const cleaned = b64.replace(/\n/g, '');
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { ok: true, value: new TextDecoder().decode(bytes) };
  } catch (e) { return { ok: false, error: (e as Error)?.message || 'Base64/encoding error.' }; }
}
