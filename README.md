# AP-SQL Assistant — Version 11.8

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema(s) as its single source of truth.

> ⚠️ **Generated SQL only** — this application does not execute database changes.

## What V11.8 is

This is a **careful restoration and enhancement release**, built on one non-negotiable rule: **do not break or remove any existing functionality.**

**UI baseline = V10.7.1.** `css/styles.css` restores the real, original V10.7.1 stylesheet verbatim (3D-tilted logo badge, gradient hand-written signature, card hover animation, original navbar height/spacing), then adds only carefully-scoped V11.8 refinements: a consistent **fluid 3D icon system** (subtle depth, highlight sweep, hover elevation/scale/rotation, focus-visible outlines for accessibility) applied uniformly across the navbar, menu, Query Builder, Schema pages, and new AI indicators — never a full redesign.

**Functionality baseline = the latest working version.** Every engine from V10.7.1 through V11.7 is preserved and retested: the Multiple Schema Store, the V11.1 additive Stored/Active/Default/Inactive schema state model, GitHub-hosted sync with the encrypted credential vault, the selectable synchronization schedule, operational password management with a non-disclosing Forgot Password reset, the intelligent Describe-What-You-Need engine, the structured Query Builder and CR Builder (with mandatory WHERE protection), schema-aware CASE/DECODE, and the rule-based Error Rectifier — **nothing was rolled back to reach the V10.7.1 look.**

**New in V11.8 — the AI layer.** Per the architecture `Application → AI Service Layer → AI Provider → Model`, every AI-powered feature routes through one seam (`js/ai-service-engine.js`):

- **AI Self-Review** of generated SQL (schema correctness, relationship correctness, logic-matches-request, and performance findings) — available from the Read Only Query Builder's Generated SQL card.
- **AI Error Rectifier** — the same rule-based, schema-grounded correction engine as before, now explicitly surfaced as an **AI Analysis** step ahead of the Rectified SQL and Explanation.
- **AI-assisted Query Optimization** in both the Read Only and CR Query Builders.
- **AI Schema Assistant** (Used Schema page) — answers plain-language questions ("What is IA_INVOICE used for?", "How are IA_INVOICE and IA_SUPPLIER related?") strictly from schema metadata, with every fact explicitly tagged **From schema** or **AI interpretation**.
- **AI-assisted CASE/DECODE proposals** — reuses an existing definition if one exists; otherwise parses a plain-language hint into code/label pairs for review (administrative approval still required to save).

**Honest architecture disclosure:** this remains a static, serverless, client-side-only application, so there is nowhere safe to hold a real model API key in the frontend. The bundled, default AI provider is therefore a fully **local, deterministic, schema-grounded heuristic engine** — it never calls a network endpoint, never times out, never requires a key, and (by construction, since it only ever composes the schema/validation/optimize/error-rectifier engines) never hallucinates a table or column that isn't in your active schema. A `RemoteAIProvider` seam exists and can be wired to a real hosted model later via `configureRemoteProvider(...)` without touching any UI code — but it stays inactive unless explicitly configured, and even then every response is still schema-validated before being trusted, with automatic fallback to the local provider on any failure or timeout.

## Getting started

Open `index.html` directly in a modern browser (Chrome/Edge recommended for Cross-Device Schema Sync file-linking). GitHub sync and the Live Shared Schema check require serving over `http://` rather than `file://`:

```bash
npx http-server .
```

### Default administrator password

```
P@assw0rd
```

Change it from **Update Schema → Operational Password**; use **Forgot password? Reset to default** if forgotten (never displays the password).

## Project structure

```
ap-sql-assistant/
├── index.html                       # V10.7.1-restored layout + V11.8 AI UI hooks
├── css/styles.css                   # Restored V10.7.1 stylesheet + fluid 3D icon system + AI badges
├── js/
│   ├── ai-service-engine.js         # NEW — AI Service Layer: provider abstraction, local + remote providers, caching, fallback
│   ├── schema-assistant-engine.js   # NEW — AI Schema Assistant, grounded strictly in schema metadata
│   ├── schema-tools.js, schema-engine.js, schema-store-engine.js, relationship-store.js
│   ├── datatype-engine.js, decode-engine.js, filter-engine.js, validation-engine.js
│   ├── sql-engine.js, cr-engine.js, nl-query-engine.js, error-rectifier-engine.js
│   ├── optimize-engine.js, suggestion-engine.js, password-manager-engine.js
│   ├── credential-vault-engine.js, github-sync-engine.js, schema-sync-engine.js
│   ├── shared-schema-loader.js, sync-schedule-engine.js
│   └── app.js                       # UI wiring, including all AI feature wiring
├── schema/schema-sample.js
├── test/                            # 71 Node-based tests
└── .github/workflows/deploy-pages.yml
```

## Running tests

```bash
node test/run-all.js
```

71 checks covering schema lookups/relationships, filter/WHERE building, SQL generation (joins, decode CASE, recursive hierarchy, aggregation), CR INSERT/UPDATE/DELETE with WHERE protection, the V10.7/V11.1 Stored/Active/Default/Inactive schema-state model, the operational password manager, the new **AI Schema Assistant** (grounded-vs-not-found honesty, relationship Q&A), and the new **AI Service Layer** (schema-grounded intent analysis, self-review flagging both missing tables and logic mismatches, error rectification, optimization, entity recommendation, filter parsing, CASE/DECODE reuse-vs-propose, response caching, and remote-provider fallback). **All 71 pass.**

## Security notes

- No SQL is ever executed — only generated for manual review.
- AI recommendations are always reviewable/editable and are never saved to the schema without the operational password.
- AI never bypasses authentication, CR WHERE-condition safeguards, or schema activation controls.
- GitHub tokens are stored only encrypted (AES-256-GCM, PBKDF2, 210,000 iterations).
- The operational password is stored only as a SHA-256 hash.

## Author

Crafted by **Subham Ain**.
