# AP-SQL Assistant — Version 11.5
**Full Functionality Consolidation, Advanced SQL Engine & Production-Ready UI**

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema(s) as its single source of truth.

> ⚠️ **Generated SQL only.** This application never connects to, or executes SQL against, a production database.

## What V11.5 is

V11.5 consolidates every working capability shipped from V5.x through V11.4 into one stable, complete build, restores anything that had regressed along the way, and adds:

1. **A rebuilt, schema-first Natural Language → SQL engine** (`js/nl-query-engine.js` + `js/conversation-engine.js` + `js/sql-engine.js` + `js/validation-engine.js`) that follows the pipeline: Intent Detection → Entity Identification → Active Schema Analysis → Table/Column Resolution → Relationship Resolution → Filter Resolution → Aggregation/Grouping Resolution → Query Plan → SQL Generation → Validation → Self-Correction → Final SQL.
2. **Conversational query refinement** — follow-up instructions ("only show the last 3 months", "add supplier name", "sort by highest amount") progressively refine the same query instead of starting over.
3. **Expanded SQL coverage**: SELECT/DISTINCT, WHERE (AND/OR/NOT, nested), ORDER BY, GROUP BY/HAVING, all five aggregate functions, INNER/LEFT/RIGHT/FULL/CROSS joins auto-resolved from schema relationships, subqueries, EXISTS/NOT EXISTS, IN/NOT IN, BETWEEN, LIKE/NOT LIKE, NULL handling, CASE/DECODE, named CTEs, recursive CTEs (hierarchy walks), window/ranking functions, UNION/UNION ALL/INTERSECT/EXCEPT (MINUS on Oracle), Top-N, duplicate detection, and dialect-aware limiting (TOP / LIMIT / FETCH FIRST).
4. **Multiple Schema Architecture**, fully consolidated: Stored / Active / Default / Inactive states, a merged view of every Active schema (Default wins on name collisions) used everywhere SQL is generated, and safeguards so the Default schema can never be silently deactivated.
5. **A compact, responsive Bootstrap 5 UI** across every page, with a navbar and Guided Walkthrough that always stay within the screen at any width.

## Getting started

Open `index.html` directly in a modern browser (Chrome/Edge/Firefox) — everything runs client-side; no server or build step is required. Some features (GitHub sync, the Live Shared Schema check, and the shared/linked-file options) require the app to be served over `http://` rather than opened via `file://`, because browsers block same-origin `fetch()` of local files under `file://`. A simple way to do that locally:

```bash
npx http-server .
```

or push the folder to GitHub Pages using the included workflow (see below).

### Default administrator password

Update Schema, manual CASE/DECODE approval, and every other admin-gated action share **one** operational password, stored only as a SHA-256 hash (never in plaintext, never logged):

```
P@assw0rd
```

Change it any time from **Update Schema → Operational Password**. If it's forgotten, use **Forgot password? Reset to default** on the locked Update Schema screen — this restores `P@assw0rd` without ever displaying it, and never deletes any stored schema.

## Project structure

```
ap-sql-assistant/
├── index.html                     # Application shell — every page as an .app-view
├── css/styles.css                 # Compact, responsive, overflow-safe Bootstrap-based styling
├── js/
│   ├── schema-tools.js            # Hashing, schema validation, sample-format generation, CSV helpers
│   ├── schema-engine.js           # Table/column/relationship lookups over a single schema object
│   ├── schema-store-engine.js     # Stored/Active/Default/Inactive schema state + merged-schema builder
│   ├── relationship-store.js      # Manual relationship overrides (used when the schema lacks one)
│   ├── datatype-engine.js         # Dialect-aware casting / literal formatting
│   ├── decode-engine.js           # Schema-first CASE/DECODE resolution + manual-definition safeguards
│   ├── filter-engine.js           # WHERE clause / filter-condition building
│   ├── sql-engine.js              # Read-only SELECT/WITH SQL generation (joins, CTEs, windows, sets…)
│   ├── cr-engine.js                # INSERT/UPDATE/DELETE text with mandatory WHERE protection
│   ├── nl-query-engine.js         # Natural-language → query plan (schema-grounded, no hallucination)
│   ├── conversation-engine.js     # Conversational follow-up refinement of the last query plan
│   ├── validation-engine.js       # Pre-display SQL validation + bounded self-correction
│   ├── error-rectifier-engine.js  # Schema-aware error-driven SQL correction
│   ├── optimize-engine.js         # Plain-language query explanation + optimization hints
│   ├── password-manager-engine.js # Centralized, SHA-256-hashed operational password
│   ├── credential-vault-engine.js # AES-256-GCM + PBKDF2 (210,000 iterations) GitHub token vault
│   ├── github-sync-engine.js      # GitHub schema sync (anonymous read, authenticated publish)
│   ├── schema-sync-engine.js      # Cross-device linked-file sync (File System Access API)
│   ├── shared-schema-loader.js    # "Live Shared Schema" zero-setup check on load
│   ├── sync-schedule-engine.js    # Predefined synchronization schedule options
│   ├── suggestion-engine.js       # Suggested fixes for unresolved/ambiguous requests
│   └── app.js                     # UI wiring for every page
├── schema/schema-sample.js        # Embedded default schema (replace via Update Schema at any time)
├── test/smoke-test.js             # Node-based smoke tests for every engine (59 checks)
└── .github/workflows/deploy-pages.yml   # GitHub Pages deployment workflow
```

## Running tests

```bash
node test/smoke-test.js
```

59 checks covering schema validation, CSV round-tripping, single- and multi-table SQL generation, joins, aggregation/GROUP BY/HAVING, CTEs, window functions, EXISTS filters, recursive hierarchy walks, set operations, SQL validation/self-correction, CR INSERT/UPDATE/DELETE with WHERE protection, the error rectifier, natural-language interpretation, conversational refinement, decode conflict protection, the GitHub anonymous-read fix, the Stored/Active/Default/Inactive schema-state model, the sync schedule, the encrypted credential vault, and the password manager (including the Forgot Password recovery path). All 59 pass on this build.

## Security notes

- The application performs **no execution** of SQL against any database — only generation, for manual review through your own approved change process.
- GitHub Personal Access Tokens are only ever stored **encrypted** (AES-256-GCM, PBKDF2-derived key, 210,000 iterations) in the Secure GitHub Connection Vault — never in plaintext, and reading a public schema file never requires a token.
- The operational/admin password is stored locally only as a SHA-256 hash; it is never displayed, logged, or recoverable in plaintext — only resettable to the documented default.
- The Read Only Query Builder rejects INSERT/UPDATE/DELETE/MERGE/DROP/ALTER/TRUNCATE/CREATE/GRANT/REVOKE if they ever appear in generated SQL.
- CR UPDATE/DELETE without a WHERE condition is blocked unless explicitly overridden and acknowledged in the UI.

## Author

Crafted by **Subham Ain**.
