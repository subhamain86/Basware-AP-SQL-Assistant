const ENDPOINT_STORAGE_KEY = 'sqla.onlineNlpEndpoint.v147';
const TIMEOUT_MS = 3500;
export function getConfiguredEndpoint() { return localStorage.getItem(ENDPOINT_STORAGE_KEY) || null; }
export function setConfiguredEndpoint(url) { if (url && url.trim())
    localStorage.setItem(ENDPOINT_STORAGE_KEY, url.trim());
else
    localStorage.removeItem(ENDPOINT_STORAGE_KEY); }
export async function tryOnlineNlp(prompt, schemaContextSummary) {
    const endpoint = getConfiguredEndpoint();
    if (!endpoint)
        return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
        return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, schemaContext: schemaContextSummary }), signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok)
            return null;
        const data = await res.json();
        return data;
    }
    catch {
        clearTimeout(timer);
        return null;
    }
}
export function isBrowserOnline() { return typeof navigator === 'undefined' ? true : navigator.onLine !== false; }
