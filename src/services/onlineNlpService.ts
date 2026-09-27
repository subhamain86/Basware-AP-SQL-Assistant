const ENDPOINT_STORAGE_KEY = 'sqla.onlineNlpEndpoint.v15';
export function getConfiguredEndpoint(): string | null { return localStorage.getItem(ENDPOINT_STORAGE_KEY) || null; }
export function setConfiguredEndpoint(url: string | null): void { if (url && url.trim()) localStorage.setItem(ENDPOINT_STORAGE_KEY, url.trim()); else localStorage.removeItem(ENDPOINT_STORAGE_KEY); }
export interface OnlineNlpResponse { sql?: string; tables?: string[]; columns?: { table: string; column: string }[]; filters?: unknown[]; raw?: unknown; }
export async function tryOnlineNlp(prompt: string, schemaContextSummary: string): Promise<OnlineNlpResponse | null> {
  const endpoint = getConfiguredEndpoint();
  if (!endpoint) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, schemaContext: schemaContextSummary }), signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch { clearTimeout(timer); return null; }
}
export function isBrowserOnline(): boolean { return typeof navigator === 'undefined' ? true : navigator.onLine !== false; }
