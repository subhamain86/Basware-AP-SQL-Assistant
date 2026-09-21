# AP-SQL Assistant — Version 11.7

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema(s) as its single source of truth. No production database connection is ever required or made.

> ⚠️ **Generated SQL only** — this application does not execute database changes.

## What V11.7 is

**This release restores the application UI to the original Version 10.7.1 visual design**, byte-for-byte in `css/styles.css`, after Version 11.6 unintentionally replaced it with a redesigned stylesheet and page layout. Nothing about the look and feel was supposed to change as part of the V10.7.1 → V11.5 consolidation — that consolidation was meant to be purely additive to the *functionality*, never a UI rewrite. V11.7 corrects that:

- **`css/styles.css` is the real, original V10.7.1 stylesheet**, restored exactly as authored — the 3D-tilted logo badge, gradient hand-written signature ("Dancing Script"), card hover animations, the original 64px navbar height, and every original color/spacing rule.
- **`index.html`** reproduces the real V10.7.1 page copy, headings, section order, and "New in V10.7" badges word-for-word, using the same Bootstrap structure and CSS classes the original stylesheet expects (`hero-brand-row`, `logo-3d-wrap`, `builder-row` / `builder-col-half`, `qs-example-card`, `cr-command-option`, `schema-store-item`, etc.) — not a newly invented layout.
- **Every engine (`js/*.js`) is unchanged** from the real, tested V10.7.1 baseline plus the additive consolidation through V11.5: the Multiple Schema Store (V10.7), the Stored/Active/Default/Inactive schema state model (V11.1, layered on top without altering the original single-schema API), the Secure GitHub Connection Vault and its anonymous-read fix (V10.7.1), the selectable Schema Synchronization Schedule (V10.7), and operational password management (V10.7).
- The only *new* markup added to the real V10.7.1 page is the minimal set of controls the V11.1 multi-schema state model needs (a "Select Default Schema" card, a "Select Active Schemas" card, and a per-row Active toggle in Used Schema) — and these reuse the real `.schema-store-item`, `.schema-state-badge`, and `.card` styles already defined in the restored stylesheet, rather than introducing a new visual language.
- Version number bumped to 11.7 throughout the UI and About panel; otherwise, this is visually the Version 10.7.1 you originally built.

## Getting started

Open `index.html` directly in a modern browser (Chrome/Edge recommended for Cross-Device Schema Sync file-linking — every other feature works in any modern browser). No build step or server is required. GitHub sync and the Live Shared Schema check require the app to be served over `http://` rather than `file://`:

```bash
npx http-server .
```

or push this folder to GitHub Pages using the included workflow.

### Default administrator password

Update Schema and every other admin-gated action share one operational password, stored only as a SHA-256 hash:

```
P@assw0rd
```

Change it from **Update Schema → Operational Password**. If forgotten, use **Forgot password? Reset to default** to restore `P@assw0rd` without ever displaying it.

## Project structure

```
ap-sql-assistant/
├── index.html                     # V10.7.1 page copy/structure, restored + minimal V11.1 additions
├── css/styles.css                 # The REAL, original V10.7.1 stylesheet — restored verbatim
├── js/                             # Every engine, unchanged from the real V10.7.1→V11.5 baseline
│   ├── schema-tools.js, schema-engine.js, schema-store-engine.js, relationship-store.js
│   ├── datatype-engine.js, decode-engine.js, filter-engine.js, validation-engine.js
│   ├── sql-engine.js, cr-engine.js, nl-query-engine.js, error-rectifier-engine.js
│   ├── optimize-engine.js, suggestion-engine.js, password-manager-engine.js
│   ├── credential-vault-engine.js, github-sync-engine.js, schema-sync-engine.js
│   ├── shared-schema-loader.js, sync-schedule-engine.js
│   └── app.js                     # UI wiring
├── schema/schema-sample.js        # Embedded default schema
├── test/                          # 48 Node-based smoke tests
└── .github/workflows/deploy-pages.yml
```

## Running tests

```bash
node test/run-all.js
```

48 checks covering schema lookups/relationships, filter/WHERE building (including IN/NOT IN), SQL generation (joins, decode CASE, recursive hierarchy, aggregation/GROUP BY), CR INSERT/UPDATE/DELETE with WHERE protection, the V10.7/V11.1 Stored/Active/Default/Inactive schema-state model (including the safeguard against deactivating the Default schema and per-entry sync-failure isolation), and the operational password manager (including the Forgot Password recovery path). **All 48 pass on this build.**

## Security notes

- No SQL is ever executed against a database — only generated for manual review.
- GitHub Personal Access Tokens are only ever stored **encrypted** (AES-256-GCM, PBKDF2, 210,000 iterations); reading a public schema file never requires a token.
- The operational password is stored only as a SHA-256 hash, never in plaintext.
- CR UPDATE/DELETE without a WHERE condition is blocked unless explicitly overridden.

## Author

Crafted by **Subham Ain**.
