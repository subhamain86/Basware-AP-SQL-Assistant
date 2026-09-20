# AP-SQL Assistant

**Version 11.3.1 — Responsive Navbar & Centralized Password Authentication**

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema as its single source of truth. No production database connection is ever required or made; the app only *generates* SQL for you to review and run through your own approved channels.

> ⚠️ **Generated SQL only** — this application does not execute database changes.

## What's New in 11.3.1

This release is a **focused Navbar + Authentication release**. No SQL generation logic, schema handling, table/column selection, filter behavior, advanced options, validation logic, CR behavior, GitHub synchronization, or schema synchronization scheduling was changed.

### 1. Navbar — Fit to Screen
- The navbar now uses a genuine two-toggler responsive pattern: the hamburger (app menu) and brand always stay visible and never shrink below usable size; a **second, dedicated navbar toggler** collapses the Schema Synchronization Schedule control, the Guided Walkthrough button, and the signature into a full-width row on narrow screens.
- The navbar can never force horizontal scrolling of the page — every element wraps or collapses instead of overflowing, at any width or zoom level.
- Only the navbar's own layout was touched; the rest of the application (`.app-shell`) is completely unaffected.

### 2 & 3. Update Schema Password Authentication — Rebuilt & Centralized
- Root-caused and fixed the Update Schema password gate so the unlock flow reliably opens, validates, and admits the administrator on a valid password, and clearly rejects an invalid one.
- **Every** password-protected action in the app — Update Schema unlock, the Operational Password change form, Delete Stored Schema, Delete Schema Contents, Save Relationship to Schema, and the Apply Schema Update re-authentication step — now calls the **exact same** `password-manager-engine.js` instance, which itself delegates to a single `password-auth-engine.js` module. There is exactly one authentication code path in the entire application.

### 4 & 5. Default Password & Secure Storage
- The application ships with a default operational password (documented separately, out-of-band, for administrators — it is **never** written in plain text anywhere in this codebase, the UI, logs, error messages, browser storage, or API responses).
- Every stored credential — the built-in default and any password an administrator sets — is represented **only** as an opaque `{ algorithm, iterations, salt, hash }` record, produced with **PBKDF2-HMAC-SHA256** (150,000 iterations, random salt, one-way). This is a modern, salted, non-reversible hash, not encryption — the password itself can never be recovered from what is stored.

### 6. Password Change Behavior
- Flow: **Current Password → New Password → Confirm New Password → Validate → Securely Save → Use New Password.**
- The current password is verified before any change is accepted; new/confirm must match and meet a minimum length; the previous password (default or custom) stops working immediately once a new one is saved; every password-protected feature immediately uses the new password.

### 7. Forgot Password — Never Reveals a Password
- The locked Update Schema screen has a **"Forgot password?"** link that opens a **Set a New Password** panel — it does **not** require the previous password, and it never displays, logs, or writes any current or default password value anywhere.
- Flow: **Forgot Password → Set New Password → Confirm → Securely Save New Password** — the newly chosen password is what authenticates from then on.

### 8. Security Hardening
- No plaintext passwords are stored, logged, or returned by any function.
- Authentication failures return a generic "incorrect password" state and never reveal which part was wrong or what the correct value is.
- Password `<input>` fields use `type="password"` throughout.

## Core Features (carried forward, unchanged)
- **Describe What You Need** — natural-language query interpretation across the merged Active schema(s).
- **Read Only Query Builder** — joins, filters (IN/NOT IN), sorting, limits, named CTEs, EXISTS/NOT EXISTS, related counts, HAVING, recursive hierarchy walks.
- **Query Builder for CR** — INSERT / UPDATE / DELETE with mandatory WHERE protection.
- **Error Rectifier** — schema-aware, rule-based SQL correction with plain-language explanations.
- **Multiple Schema Store** with a full **Stored / Active / Default / Inactive** lifecycle, **Encrypted GitHub Connection Vault** (AES-256-GCM, for the GitHub token only — a separate concern from the operational password), **Selectable Sync Schedule**, and the rebuilt **Operational Password** management described above.
- Fully responsive, compact, scrollable-panel UI across every page (carried forward from V11.3).

## Getting Started
1. Open `ap-sql-assistant/index.html` in a modern Chromium-based browser (Chrome or Edge recommended for the shared-schema file linking feature).
2. Follow the **Guided Walkthrough**, or go straight to **Quick Start**.
3. Go to **Used Schema** to tick which stored schemas should be **Active** right now.
4. Go to **Update Schema** (password-protected — obtain the default operational password from your administrator/documentation out-of-band) to configure the **Default Schema** and **Active Schemas**.
5. If you ever forget the password, use **"Forgot password?"** on the locked screen to set a brand-new one immediately — no need to know the old value.
6. Use **Describe What You Need**, the **Read-Only Query Builder**, or the **Query Builder for CR** to generate SQL.

## Project Structure
```
ap-sql-assistant/
├── index.html                     # Main application shell and UI (V11.3.1: fit-to-screen navbar, rebuilt password UI)
├── css/
│   └── styles.css                 # All application styling, incl. the V11.3.1 navbar-fit rules
├── js/
│   ├── schema-engine.js           # Core schema lookups (tables, columns, relationships)
│   ├── schema-store-engine.js     # Stored/Active/Default/Inactive schema state model + merged-schema builder
│   ├── schema-sync-engine.js      # Local shared-schema file linking & sync
│   ├── github-sync-engine.js      # Encrypted GitHub connection vault & sync
│   ├── password-auth-engine.js    # V11.3.1: single PBKDF2-HMAC-SHA256 password hashing/verification core
│   ├── password-manager-engine.js # V11.3.1: storage-aware wrapper — the one instance every feature shares
│   ├── relationship-store.js      # Manual table relationship overrides
│   ├── sql-engine.js              # Read-only SELECT SQL generation
│   ├── cr-engine.js               # INSERT / UPDATE / DELETE (CR) SQL generation
│   ├── nl-query-engine.js         # Natural-language requirement interpretation
│   ├── filter-engine.js           # WHERE condition / filter building
│   ├── decode-engine.js           # Value decode / lookup (CASE expressions)
│   ├── datatype-engine.js         # Dialect-aware datatype casting rules
│   ├── validation-engine.js       # Schema validation for requests
│   ├── error-rectifier-engine.js  # Error-driven SQL correction
│   ├── optimize-engine.js         # Query optimization suggestions
│   ├── credential-vault-engine.js # AES-256-GCM encrypted GitHub vault (token storage only)
│   ├── sync-schedule-engine.js    # Schedule options/state
│   ├── suggestion-engine.js       # Suggested fixes for rejected queries
│   ├── shared-schema-loader.js    # Fetches a shared schema JSON file
│   └── app.js                     # UI wiring for every page, incl. the rebuilt password UI and hardened navbar
├── schema/
│   └── schema-sample.js           # Sample schema for local development/testing
└── test/
    └── smoke-test.js              # Node-based smoke tests, incl. the full V11.3.1 password-authentication suite
```

## Running Tests
```bash
node ap-sql-assistant/test/smoke-test.js
```
30 checks covering the schema, filter, decode, SQL, CR, error-rectifier, natural-language query, schema-tools, GitHub-sync engines, the Stored/Active/Default/Inactive schema-state model, and — new in this release — a full simulation of the centralized password-authentication mechanism (default credential shape, out-of-the-box unlock, incorrect-password rejection, the full Current→New→Confirm change flow, immediate invalidation of the old password, the Forgot Password reset flow, and rejection of weak/mismatched/incorrect inputs). All 30 pass on this build.

## Security Notes
- The application performs **no execution** of SQL against any database — only generation for manual review.
- The operational password is never stored, logged, or transmitted in plain text; only an opaque PBKDF2-HMAC-SHA256 credential record (algorithm, iterations, salt, hash) is persisted.
- The default operational password is documented **separately, out-of-band** for administrators — it does not appear anywhere in this codebase, the UI, or any generated output.
- GitHub tokens are a separate concern and remain stored **encrypted** (AES-256-GCM) in the optional connection vault, never in plain text.
- Update Schema and every other administrator action remain password-protected and never connect to a production database.

## Author
Crafted by **Subham Ain**.
