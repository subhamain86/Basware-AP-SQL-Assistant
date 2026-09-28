# V16.0 — M365 Copilot Enterprise Configuration

This is **optional**. Nothing changes for any user until an administrator completes every field
below and ticks "Enable". Until then, Describe What You Need works exactly as it did in V15.7,
using only the offline engine (and the generic Online AI/NLP Endpoint, if that was already
configured).

## What you need from your Microsoft 365 / Entra ID administrator

1. **An Entra ID App Registration** for this app (single-page application / SPA platform), with:
   - **Tenant ID** — your organization's directory (tenant) ID.
   - **Client ID** — the application (client) ID of the registration.
   - **Redirect URI** registered as a **SPA** redirect URI: the exact URL this app is hosted at
     (e.g. `https://your-org.github.io/Basware-AP-SQL-Assistant/#copilot-auth-callback`, or the
     `file://` path if run locally — see note below).
   - No client secret is required or used (the app uses the Authorization Code + PKCE flow,
     Microsoft's documented, secret-free mechanism for browser-based apps).

2. **An M365 Copilot Enterprise agent endpoint** your organization has already published — this
   is typically a **Copilot Studio agent** or a **declarative agent** exposed as an HTTPS endpoint
   that accepts `{ prompt, schemaContext }` and returns `{ tables, columns, filters, raw }` (the
   same shape the app already uses for the existing generic Online AI/NLP Endpoint). Your Copilot
   platform team can tell you this URL and the **Scope** to request for it
   (e.g. `api://<agent-app-id>/.default`).

## Where to configure it

**Settings → Secret Vault** (the same password-protected, encrypted vault already used for GitHub
sync — no new screen, no new password):

1. Unlock Settings with the Admin Password.
2. Open the **Secret Vault** tab.
3. Scroll to **"M365 Copilot Enterprise Integration"**.
4. Fill in Tenant ID, Client ID, Agent/Endpoint URL, and Scope.
5. Tick **"Enable M365 Copilot Enterprise for Describe What You Need"**.
6. Click **Save M365 Copilot Settings**.

This is stored as one more field inside the existing encrypted Secret Vault blob (AES-256-GCM,
same as the GitHub token) — it is never written in plain text, and it synchronizes to your
repository the same way the rest of the vault already does.

## What happens after it's enabled

- The first time a user clicks "Build from Description" or "Interpret Description", a small
  **Microsoft sign-in popup** appears (standard Microsoft identity platform login). The resulting
  token is kept only in `sessionStorage` for that browser tab — cleared when the tab closes.
- Copilot is asked to interpret the natural-language text, using only a **small, relevant
  subset** of your schema (never the full schema, never Secret Vault contents).
- The **offline engine and your Active Schema always have the final word**: anything Copilot
  suggests that isn't an actual table/column in your Active Schema is silently discarded before
  SQL is generated. Copilot cannot modify the schema — it has no write path to it at all.
- If sign-in fails, is cancelled, the endpoint is unreachable, or the browser is offline, the app
  automatically falls back to the offline engine — exactly as it already does today when the
  generic Online AI/NLP Endpoint is unavailable. No error is shown to the end user; the SQL
  Builder pages simply show the "Offline/local engine" badge instead of the Copilot badge.

## Priority order when multiple engines are configured

1. **M365 Copilot Enterprise** (if enabled and reachable)
2. **Generic Online AI/NLP Endpoint** (Settings → AI / NLP Engine tab, unchanged from V15.7)
3. **Offline engine only**

## Turning it off

Untick "Enable" and save, or clear the fields entirely. Describe What You Need immediately
reverts to the pre-V16.0 behaviour.

## A note on the redirect URI for `file://` deployments

If this app is used by double-clicking a local HTML file rather than being hosted, Microsoft's
identity platform cannot redirect back to a `file://` URL. In that deployment mode, either host
the app at a real HTTPS URL for the Copilot-assisted path (the offline-only experience continues
to work perfectly from disk, unchanged), or ask your Entra ID administrator whether a
device-code or app-only alternative is preferred for your environment.
