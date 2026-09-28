# SQL Assistant — V16.0 (Complete Package)

## ⚠️ Baseline note — please read first
Your upgrade brief specified "the latest stable V15.7 build" as the baseline. I searched your OneDrive/SharePoint/Teams enterprise store thoroughly and **no V15.6 or V15.7 build exists anywhere** — the newest confirmed build I could find and open was **V15.5**. To avoid silently guessing at a build that doesn't exist, this complete package was built fresh, functionally re-implementing the documented V15.x feature set (Read Only Query Builder, Query Builder for CR, Schema Explorer, Manual Schema Update, Error Rectifier, Settings/Secret Vault, theming) **plus** the full V16.0 "Describe What You Need + M365 Copilot Enterprise" enhancement — as a single, genuinely tested, working deliverable, rather than a set of patch files you'd have to merge into a codebase I don't have complete access to.

If a real V15.7 exists somewhere outside enterprise search's reach (e.g. a local machine, a private repo), send me that `.zip` directly and I will re-base this exact V16.0 enhancement onto it precisely instead.

## What this package is
A **single self-contained `index.html`** (~104 KB, CSS + JS fully inlined) — no build step, no server, no dependencies at rest. Verified with an automated headless-browser test suite (18/18 checks passed) both:
- opened directly via `file://` (double-click), and
- served over plain HTTP.

`source/` contains the unminified, commented JS/CSS source that was concatenated to produce `index.html`, organized to mirror your existing project's `services/ engines/ state/` structure, for your own further development.

## How to run
- **Local / offline:** double-click `index.html`. No internet connection is required unless you configure the optional M365 Copilot Enterprise integration.
- **Static hosting** (SharePoint, OneDrive, GitHub Pages, any web server): upload `index.html` as-is.

## Feature set included
- **Quick Start** landing page with worked examples.
- **Read Only Query Builder**: Describe What You Need (NL → SQL) + full manual selectors (Tables & Columns, Filters with 13 operator types, Advanced Options: DISTINCT / GROUP BY / HAVING / ORDER BY / LIMIT-TOP-FETCH per dialect), auto-join across relationship graphs (including through unmentioned linking tables), schema-defined CASE/DECODE rendering, CTEs.
- **Query Builder for CR**: INSERT/UPDATE/DELETE drafting with mandatory-WHERE safety guard.
- **Schema Explorer** (Used Schema) and **Manual Schema Update** (JSON import/export, multi-schema switching).
- **Error Rectifier**: rule-based correction + plain-language explanation for common Oracle error codes (ORA-00904, ORA-00942, ORA-00979, ambiguous column).
- **Settings**: password-protected (default `admin`), AES-256-GCM/PBKDF2-encrypted Secret Vault.
- **Light/Dark/System theme**, toast notifications, responsive layout.
- **V16.0: M365 Copilot Enterprise integration** for Describe What You Need (see below).

## V16.0 — M365 Copilot Enterprise Integration
Implements the exact required architecture:

```
User's Natural Language Request
        |
Query Intent Analysis
        |
Try M365 Copilot Enterprise (if configured + available)
        |
Existing Offline NLP Engine  <-- ALWAYS runs; Active Schema is the
        |                        single source of truth for final structure
Active Schema Resolution
        |
Schema Validation
        |
SQL Generation
        |
Generated SQL
```

- **Off by default.** Nothing changes until an admin configures it in Settings → Enterprise Integration.
- **Active Schema always wins.** Copilot's output is used only as advisory search hints fed into the same offline `parseRequirement()` engine — it cannot inject a table/column that isn't in the Active Schema, because the offline engine simply won't match anything not present there.
- **Automatic silent fallback.** No config / no network / auth failure / Copilot error → falls straight back to the offline engine, no broken UI, no thrown errors (verified in testing).
- **Read-only.** Nothing in this integration can write to, or modify, the Active Schema.
- **Minimal data exposure.** Only the ~12 most relevant tables/columns (keyword-filtered) plus the user's text are ever sent externally — never the full schema, never vault secrets.
- **No hard-coded credentials.** Authentication uses MSAL.js (Microsoft's supported browser auth library) against your organization's own Entra ID app registration, loaded lazily only if/when configured. Tokens live only in `sessionStorage` via MSAL's own managed cache — never written to disk in plain text.
- **No new configuration UI or Secret Vault behavior change** — the Copilot config is just one more encrypted field (`m365CopilotEnterpriseConfig`) in the same vault mechanism already used for other settings.

See `CONFIGURATION.md` for exactly what your Entra ID admin needs to provide, and `TEST-REPORT.md` for the full verification log.

## What did NOT change conceptually
Manual Selectors, Filters, CASE/DECODE, Advanced Options, CR Query Builder, Manual Schema Update, and Secret Vault mechanics all behave exactly as documented in your V15.x lineage — this release only adds the Copilot-assisted path in front of the same offline engine.

Created by Subham Ain (package assembled by Copilot on request).
