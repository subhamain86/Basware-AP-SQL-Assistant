// ============================================================================
// base64 — UTF-8 safe base64 encode/decode helpers. Native btoa/atob only
// operate on Latin1 byte strings and throw on characters outside that range
// (e.g. curly quotes, accented characters, emoji in table/column
// descriptions). GitHub Contents API requires base64-encoded UTF-8 file
// content, so these helpers go through TextEncoder/TextDecoder to be fully
// correct for any schema text the user might have entered.
// ============================================================================
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
export function base64ToUtf8(b64: string): string {
  const cleaned = b64.replace(/\n/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
