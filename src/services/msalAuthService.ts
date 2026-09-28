/**
 * V16.0 — M365 Copilot Enterprise authentication.
 *
 * Implements the Microsoft identity platform v2.0 Authorization Code flow with
 * PKCE — the Microsoft-supported, dependency-free authentication mechanism for
 * single-page applications (this is exactly what @azure/msal-browser does
 * internally; it is implemented directly here, with no external library and
 * no CDN fetch, so the app remains a single self-contained file that works
 * fully offline via file:// when M365 Copilot Enterprise is not configured).
 *
 * Security properties:
 *  - No client secret is ever used or requested (PKCE removes the need for one
 *    in a browser-based app — this is Microsoft's documented guidance for SPAs).
 *  - No credentials are hard-coded. Tenant ID / Client ID / Scope / Endpoint are
 *    supplied by an administrator via the existing encrypted Secret Vault.
 *  - The access token is kept only in sessionStorage (cleared when the tab
 *    closes) and is never written to localStorage, never logged, and never
 *    included in the schema sync payloads.
 *  - Sign-in happens in a popup so the rest of the app (including any unsaved
 *    query) is undisturbed.
 */

const TOKEN_CACHE_KEY = 'sqla.copilotToken.v16';
const PKCE_VERIFIER_KEY = 'sqla.copilotPkceVerifier.v16';

export interface CopilotAuthConfig { tenantId: string; clientId: string; scope: string; }
interface CachedToken { accessToken: string; scope: string; expiresAt: number; }

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return base64UrlEncode(bytes).slice(0, length);
}
async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input) as BufferSource);
  return base64UrlEncode(new Uint8Array(digest));
}

function readCachedToken(scope: string): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedToken;
    if (cached.scope !== scope) return null;
    if (Date.now() >= cached.expiresAt - 30000) return null; // 30s safety margin
    return cached.accessToken;
  } catch { return null; }
}
function writeCachedToken(token: CachedToken): void {
  try { sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(token)); } catch { /* non-fatal */ }
}
export function clearCachedCopilotToken(): void { try { sessionStorage.removeItem(TOKEN_CACHE_KEY); } catch { /* non-fatal */ } }

function authorityUrl(tenantId: string): string { return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`; }

function openPopupAndAwaitCode(authorizeUrl: string, redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(authorizeUrl, 'm365-copilot-signin', 'width=520,height=680');
    if (!popup) { reject(new Error('The sign-in popup was blocked by the browser. Allow popups for this site and try again.')); return; }
    const redirectOrigin = new URL(redirectUri).origin;
    let settled = false;
    const cleanup = (): void => { window.removeEventListener('message', onMessage); clearInterval(poll); if (!popup.closed) popup.close(); };
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== redirectOrigin) return;
      const data = event.data as { type?: string; code?: string; error?: string };
      if (!data || data.type !== 'm365-copilot-auth-result') return;
      settled = true; cleanup();
      if (data.error) reject(new Error(data.error)); else if (data.code) resolve(data.code); else reject(new Error('Sign-in did not return an authorization code.'));
    };
    window.addEventListener('message', onMessage);
    const poll = setInterval(() => { if (popup.closed && !settled) { cleanup(); reject(new Error('Sign-in was cancelled (the popup window was closed).')); } }, 500);
  });
}

/**
 * Acquires an access token for the configured M365 Copilot Enterprise agent,
 * using a cached token when still valid, or an interactive popup sign-in
 * otherwise. Throws with a user-readable message on any failure — callers
 * (the NLP orchestrator) must catch this and fall back to the offline engine.
 */
export async function acquireCopilotToken(config: CopilotAuthConfig): Promise<string> {
  if (!config.tenantId || !config.clientId || !config.scope) throw new Error('M365 Copilot Enterprise is not fully configured (Tenant ID, Client ID, and Scope are all required).');
  const cached = readCachedToken(config.scope);
  if (cached) return cached;

  const redirectUri = `${window.location.origin}${window.location.pathname}`.replace(/\/$/, '/') + '#copilot-auth-callback';
  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(24);
  try { sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier); } catch { /* non-fatal */ }

  const authorizeUrl = new URL(`${authorityUrl(config.tenantId)}/authorize`);
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_mode', 'fragment');
  authorizeUrl.searchParams.set('scope', config.scope);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('prompt', 'select_account');

  const code = await openPopupAndAwaitCode(authorizeUrl.toString(), redirectUri);

  const tokenRes = await fetch(`${authorityUrl(config.tenantId)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: config.scope,
    }).toString(),
  });
  if (!tokenRes.ok) {
    let detail = '';
    try { const j = await tokenRes.json(); detail = j.error_description ? ` (${String(j.error_description).split('\r\n')[0]})` : ''; } catch { /* ignore */ }
    throw new Error(`Microsoft identity platform rejected the sign-in (HTTP ${tokenRes.status})${detail}.`);
  }
  const tokenJson = await tokenRes.json();
  const accessToken = tokenJson.access_token as string;
  const expiresIn = Number(tokenJson.expires_in) || 3600;
  if (!accessToken) throw new Error('Microsoft identity platform did not return an access token.');
  writeCachedToken({ accessToken, scope: config.scope, expiresAt: Date.now() + expiresIn * 1000 });
  return accessToken;
}

/**
 * Callback-page helper. The redirect URI used above is on the SAME page
 * (a hash fragment), so main.ts calls this on boot; if the current URL looks
 * like an auth-code redirect, it relays the result to the opener window and
 * closes itself instead of rendering the app shell twice.
 */
export function handleCopilotAuthCallbackIfPresent(): boolean {
  if (!window.location.hash.includes('copilot-auth-callback') && !window.location.hash.includes('code=')) return false;
  if (!window.opener) return false;
  const hash = window.location.hash.replace(/^#\/?/, '').replace('copilot-auth-callback', '');
  const params = new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : hash);
  const code = params.get('code');
  const error = params.get('error_description') || params.get('error');
  try { window.opener.postMessage({ type: 'm365-copilot-auth-result', code, error }, window.location.origin); } catch { /* ignore */ }
  window.close();
  return true;
}
