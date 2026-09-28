# V16.0 — Configuring the optional M365 Copilot Enterprise integration

This integration is **off by default**. Nothing changes for any user until an administrator explicitly configures it, and there is deliberately **no new configuration screen** — it reuses the Settings → Secret Vault mechanism already in the app.

## What you need from your Microsoft 365 / Entra ID admin
1. An **approved Azure AD (Entra ID) app registration** for this integration (Public client / SPA platform type — required for MSAL.js browser authentication).
2. The **Tenant ID** and **Client ID** of that app registration.
3. The **organization-approved M365 Copilot Enterprise endpoint URL** (e.g. a published Copilot Studio agent endpoint, or an internal Graph-based custom engine agent your org has approved). This is never hard-coded — you supply it at configuration time.
4. Any delegated **API scope(s)** your Entra admin exposed on that app registration.

## How to configure it
1. Open the app → hamburger menu → **Settings**.
2. Enter the password (default `admin` on first run — change it immediately via "Change Settings Password").
3. Under **Enterprise Integration — M365 Copilot Enterprise**, fill in:
   - Tenant ID
   - Client ID
   - Copilot Endpoint URL
   - Scopes (comma-separated)
4. Click **Save**. This is AES-256-GCM/PBKDF2-encrypted into the same Secret Vault storage as everything else in Settings — never written in plain text, never sent to GitHub or anywhere else.

## Verifying it without a real Entra tenant yet
Check **"Developer test mode"** before saving. This makes the app simulate a Copilot response **entirely client-side, with zero network calls to Microsoft or anyone else** — purely so you can see the "☁️ Enterprise-assisted" badge light up and confirm the UI plumbing works, before your real Azure AD app registration is ready. It is clearly labeled in the UI and in the generated interpretation notes whenever it's active. Turn it off once your real tenant/endpoint is ready.

## Removing / disabling the integration
Click **Delete Configuration** in Settings. The app reports Copilot as "not configured" and continues using the offline engine exclusively — no restart required.

## What is sent externally, and what is not
- **Sent (only when configured and a user clicks Build Query):** the user's typed request, plus a minimal, auto-filtered schema context (only the ~12 most relevant tables/columns/relationships/decodes).
- **Never sent:** Secret Vault contents, the full Active Schema, any data from a live database (this application never connects to a production database at all).
- **Never modified:** the Active Schema itself.
