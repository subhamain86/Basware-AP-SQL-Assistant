# AP-SQL Assistant — Version 11.4

This assistant writes database queries for you — both read-only reports and Change Request SQL — using your organization's approved database schema(s). V11.4 focuses on **Query Builder layout** and **schema-aware CASE/DECODE** while preserving every existing capability from prior releases.

## How to run
Open `index.html` directly in a modern browser (Chrome/Edge/Firefox). Everything runs client-side — no server or build step is required. For GitHub sync and the shared-schema/vault features, serve the folder over `http://` (e.g. `npx http-server .`) since `fetch()` of local files is blocked under `file://` in some browsers.

```
ap-sql-assistant/
├── index.html
├── css/styles.css
├── js/                 (all engines + app.js UI wiring)
├── schema/schema-sample.js   (embedded default schema; also drop a shared-schema.json or
│                              shared-schema.vault.json here to publish a live/shared schema)
└── test/smoke-test.js  (run with: node test/smoke-test.js)
```

## What's new in V11.4

### 1. Query Builder layout (redesigned)
The Read Only Query Builder now always renders in this order:
1. **Describe What You Need** — natural-language box.
2. **Generated SQL** — validated, schema-aware SQL + plain-English explanation.
3. **Manual Query Configuration** — a compact, card-based layout with **Select Table | Select Column | Filters** arranged horizontally on larger screens and stacked vertically on small screens. Each card scrolls independently so the page itself never stretches.

### 2. CASE/DECODE — fixed and made schema-aware
- CASE/DECODE resolution now **always checks the active/current schema first** (via `decode-engine.js`), and only offers a manual/session fallback when nothing is documented.
- If a definition exists in the schema, it is reused automatically — the app never asks you to recreate something that's already defined.
- If nothing exists, click the ⚙️ gear next to a column in **Select Column** to draft a **Manual CASE/DECODE Definition** (conditions/values, results/outputs, ELSE default, description).
- Manual definitions are **never saved immediately**. They require **Admin Approval** using the existing operational password before being written into the **currently selected (default) schema only** — never every stored schema.
- Duplicate detection prevents re-adding an identical mapping; conflicting mappings are rejected (not silently overwritten) so governed schema data is protected.

### 3. Advanced SQL Generation Engine
`nl-query-engine.js` + `sql-engine.js` understand natural language, resolve it against the active schema (tables, columns, types, PK/FK relationships, aliases, decode/CASE definitions), plan the query, generate dialect-aware SQL (Oracle / SQL Server / PostgreSQL / MySQL / Generic), and validate it (`validation-engine.js`) before it's shown. Supports joins (INNER/LEFT), aggregation, GROUP BY/HAVING, DISTINCT, ORDER BY, result limits, EXISTS-based filters, and recursive hierarchy walks (self-referencing tables) via CTEs.

### Preserved from earlier versions
Multiple Schema Store, Active/Default/Inactive schema states, CR Query Builder (INSERT/UPDATE/DELETE with mandatory WHERE unless explicitly overridden), Filters, Error Rectifier (schema-aware auto-correction with closest-match suggestions), Guided Walkthrough (now clamped so its tooltip always stays fully on-screen), GitHub schema sync, the Secure GitHub Connection Vault (AES-GCM + PBKDF2, 210,000 iterations), Schema Synchronization Schedule, and operational/admin password authentication.

## Operational / Admin password
- Default: `admin123` (hashed with SHA-256, never stored or transmitted in plaintext).
- Change it any time from **Update Schema → Operational / Admin Password**. All admin-gated actions (manual CASE/DECODE approval, etc.) immediately require the new password.

## Tests
`test/smoke-test.js` is a Node-based smoke test covering the schema engine, multi-schema store, schema-aware CASE/DECODE resolution, manual-definition approval + duplicate/conflict prevention, SQL generation (joins, recursive CTEs), filters, NL interpretation, the CR engine's WHERE-clause safety net, the optimizer, the error rectifier, and the password manager. Run it with:

```
node test/smoke-test.js
```

All 35 checks pass against this build.
