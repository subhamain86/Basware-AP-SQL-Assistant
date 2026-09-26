// ============================================================================
// onlineNlpService — V14. Implements the "Online AI/NLP -> Local/Offline NLP
// -> Manual Selector fallback" priority chain (spec section 3.1). This
// module ONLY attempts the online leg: a short-timeout fetch to a
// user-configurable endpoint. If the endpoint is unset, unreachable, or the
// browser is offline (navigator.onLine === false), it resolves `null`
// immediately/quickly so the caller (nlpOrchestrator) can transparently
// fall back to the local rule-based engine — the Query Builder must never
// break or hang waiting on network connectivity.
//
// No endpoint is configured by default in this build (no API key or hosted
// inference endpoint was provided), so this will always fall back to the
// offline engine out of the box — which is the CORRECT and EXPECTED
// behavior per spec: "If online connectivity is unavailable... automatically
// fall back... clearly indicate that offline processing is being used."
// An endpoint can be configured later (see settings) once real online
// AI/NLP infrastructure is available to point at.
// ============================================================================

const ENDPOINT_STORAGE_KEY = 'sqla.onlineNlpEndpoint.v14';
const TIMEOUT_MS = 3500;

export function getConfiguredEndpoint(): string | null {
  return localStorage.getItem(ENDPOINT_STORAGE_KEY) || null;
}
export function setConfiguredEndpoint(url: string | null): void {
  if (url && url.trim()) localStorage.setItem(ENDPOINT_STORAGE_KEY, url.trim());
  else localStorage.removeItem(ENDPOINT_STORAGE_KEY);
}

export interface OnlineNlpResponse { sql?: string; tables?: string[]; columns?: string[]; filters?: unknown[]; raw?: unknown; }

/** Attempts a single online NLP call. Returns null (never throws) on any
 * failure: no endpoint configured, browser offline, timeout, network
 * error, or non-2xx response — every one of these is a normal, expected
 * "fall back to offline" condition, not an application error. */
export async function tryOnlineNlp(prompt: string, schemaContextSummary: string): Promise<OnlineNlpResponse | null> {
  const endpoint = getConfiguredEndpoint();
  if (!endpoint) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, schemaContext: schemaContextSummary }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data as OnlineNlpResponse;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}
