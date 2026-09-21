# AP-SQL Assistant — Version 11.6

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema(s) as its single source of truth. No production database connection is ever required or made; the app only *generates* SQL for you to review and run through your own approved channels.

> ⚠️ **Generated SQL only** — this application does not execute database changes.

## What V11.6 is

This build is a **consolidation, stabilization, and enhancement release**, not a rewrite. Per the master upgrade directive, every version from **V10.7.1 through V11.5 is treated as one cumulative set of incremental requirements for a single application** — nothing that worked before was removed or replaced merely to simplify the implementation. Concretely:

- **V10.7.1 baseline (unchanged behavior, retested):** the intelligent Describe What You Need engine (both the base V10.1–V10.5 matcher and the V10.6 "intelligent" engine with boolean-flag disambiguation, exclusion/membership/date-range filters, aggregation + GROUP BY/HAVING inference, join-closure resolution, and ambiguity detection), the structured Read Only Query Builder, the CR Builder with mandatory WHERE protection, schema-aware CASE/DECODE with dialect-correct ELSE conversion, the rule-based Error Rectifier, Live Shared Schema, Cross-Device Schema Sync (File System Access API), and GitHub-Hosted Schema Sync — **including the V10.7.1 fix** that made the Secure GitHub Connection Vault's unlock step use a real/omitted token instead of a hardcoded placeholder (previously always 401'd).
- **V10.7 — Multiple Schema Store:** many named schemas can be stored, added, renamed, and deleted independently; each tracks its own sync status in isolation.
- **V11.1 — additive multi-schema state model:** every stored schema now also has a **Stored / Active / Default / Inactive** state. Multiple schemas can be **Active** at once (a merged view of their tables is used for SQL generation, both Query Builders, and the Error Rectifier — the **Default** schema's tables win on name collisions). Exactly one schema is always the **Default** (the sync target); it is always Active and can't be deactivated directly — change the Default first. The original V10.7.1 single-schema API (`getActiveId`/`getActiveSchema`/`setActiveId`) is preserved byte-for-byte in behavior and now simply resolves to the Default/merged-Active view, so no existing call site changed.
- **V10.8 — Guided Walkthrough**, **V11.1 UI rectification**, **V11.3 compact UI**, **V11.3.1 navbar-fit hardening:** the shared responsive/compact CSS pass (scrollable table/column panels, a navbar that never overflows at any width, `overflow-wrap: anywhere` on SQL/JSON output) is carried forward.
- **Operational password:** unchanged mechanism — SHA-256 hashed, default `P@assw0rd`, changeable (requires the current password), and a **Forgot Password** reset that restores the default without ever displaying it.
- **V11.6 (this build):** every one of the above is verified together in a single, consolidated codebase and test suite, with the version number and About panel updated accordingly.

## Getting started

Open `index.html` directly in a modern browser (Chrome/Edge recommended for the Cross-Device Schema Sync file-linking feature — every other feature works in any modern browser). No build step or server is required. Some features (GitHub sync, the Live Shared Schema check) require the app to be served over `http://` rather than opened via `file://`:

```bash
npx http-server .
```

or push this folder to GitHub Pages using the included workflow.

### Default administrator password

Update Schema and every other admin-gated action share one operational password, stored only as a SHA-256 hash (never in plain text, never logged, never exposed in the UI):

```
P@assw0rd
```

Change it any time from **Update Schema → Operational Password**. If it's forgotten, use **Forgot password? Reset to default** — this restores `P@assw0rd` without ever displaying it, and never deletes any stored schema.

## Project structure

```
ap-sql-assistant/
├── index.html                     # Application shell — every view as a .app-view section
├── css/styles.css                 # Compact, responsive styling (V11.1–V11.3.1 rectification pass)
├── js/
│   ├── schema-tools.js            # SHA-256 hashing, schema validation/diff/merge, sample & export blobs (JSON/CSV/DOCX/XLSX/DOC)
│   ├── schema-engine.js           # Core schema lookups (tables, columns, relationships, self-references)
│   ├── schema-store-engine.js     # V10.7 multi-schema store + V11.1 Stored/Active/Default/Inactive state model
│   ├── relationship-store.js      # Manual table relationship overrides (session-scoped, or saved permanently)
│   ├── datatype-engine.js         # Dialect-aware datatype classification / CASE-ELSE conversion rules
│   ├── decode-engine.js           # Schema-first CASE/DECODE resolution (schema-defined wins over manual)
│   ├── filter-engine.js           # WHERE condition building incl. IN/NOT IN, BETWEEN, LIKE family
│   ├── validation-engine.js       # Pre-generation validation of SELECT/CR requests against the active schema
│   ├── sql-engine.js              # Read-only SELECT/WITH SQL generation (joins, EXISTS, scalar subqueries, recursive hierarchy)
│   ├── cr-engine.js                # INSERT/UPDATE/DELETE text generation with mandatory WHERE protection
│   ├── nl-query-engine.js         # Natural-language interpretation (base + "intelligent" V10.6 engine)
│   ├── error-rectifier-engine.js  # Rule-based, schema- and dialect-aware SQL error correction
│   ├── optimize-engine.js         # Redundant-DISTINCT removal + plain-language optimization recommendations
│   ├── suggestion-engine.js       # Suggested fixes for rejected/ambiguous requests
│   ├── password-manager-engine.js # SHA-256-hashed operational password, change + reset-to-default
│   ├── credential-vault-engine.js # AES-256-GCM + PBKDF2 (210,000 iterations) GitHub token vault
│   ├── github-sync-engine.js      # GitHub schema sync — anonymous read (V10.7.1 fix) + authenticated write
│   ├── schema-sync-engine.js      # Cross-device linked-file sync (File System Access API + IndexedDB)
│   ├── shared-schema-loader.js    # "Live Shared Schema" zero-setup check on every page load
│   ├── sync-schedule-engine.js    # Predefined synchronization schedule options
│   └── app.js                     # UI wiring for every page
├── schema/schema-sample.js        # Embedded default schema (replace via Update Schema at any time)
├── test/                          # 279 Node-based smoke tests across every engine
└── .github/workflows/deploy-pages.yml
```

## Running tests

```bash
node test/run-all.js
```

279 checks covering schema lookups/relationships, filter/WHERE building (including IN/NOT IN), CASE/DECODE resolution and dialect-aware ELSE conversion, SQL generation (joins, EXISTS, scalar subqueries, recursive hierarchies, GROUP BY/HAVING, aggregates), CR INSERT/UPDATE/DELETE with WHERE protection, the rule-based Error Rectifier (10 correction rules), the natural-language engine (both the base matcher and the intelligent V10.6 engine — boolean-flag disambiguation, exclusion/membership/date-range filters, join-closure resolution, ambiguity detection, a synthetic 300-table performance check), schema import/export/diff/merge, the V10.7/V11.1 Stored/Active/Default/Inactive schema-state model, the encrypted credential vault (including tamper detection), the V10.7.1 GitHub anonymous-read fix (end-to-end regression test), the synchronization schedule, and the operational password manager (including the Forgot Password recovery path). **All 279 pass on this build.**

## Security notes

- The application performs **no execution** of SQL against any database — only generation, for manual review through your own approved change process.
- GitHub Personal Access Tokens are only ever stored **encrypted** (AES-256-GCM, PBKDF2-derived key, 210,000 iterations) in the Secure GitHub Connection Vault — never in plaintext; reading a public schema file never requires a token.
- The operational/admin password is stored locally only as a SHA-256 hash; it is never displayed, logged, or recoverable in plaintext — only resettable to the documented default.
- CR UPDATE/DELETE without a WHERE condition is blocked unless explicitly overridden and acknowledged in the UI.

## Author

Crafted by **Subham Ain**.
