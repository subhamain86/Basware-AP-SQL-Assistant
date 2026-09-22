# AP-SQL Assistant — Version 11.8.2

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema(s) as its single source of truth.

⚠️ **Generated SQL only** — this application does not execute database changes.

## What's new in V11.8.2

This is a UI/UX-focused release on top of V11.8.1, adding:

1. **Interactive Guided Walkthrough** (`js/tour-engine.js`) — a step-by-step, context-aware product tour covering Quick Start, both Query Builders, Schema pages, and the Error Rectifier. Features a step counter, progress dots, automatic cross-page navigation, auto-scroll with viewport-safe tooltip positioning, keyboard controls (Esc/←/→), and graceful skip-on-missing-target. Restart anytime from the navbar's "Guided Walkthrough" button.
2. **Hamburger Menu / Navbar stability fix** (`css/navbar-v11.8.2-patch.css`) — corrects flex-wrap reflow, missing `min-width: 0` on flex children, and colliding z-index between the offcanvas menu and page content, so the navbar never distorts at any viewport width.
3. **3D fluid navbar icons** — consistent sizing, soft depth, smooth hover lift/tilt, a clear active-item accent ring, and full keyboard focus support.

## What did not change

Every underlying engine — SQL Generation, Filter, Validation, Schema, Decode, Relationship, the AI Service Layer (AI Self-Review, AI Error Rectifier, AI-assisted Optimization, AI Schema Assistant), Multiple Schema Store, GitHub sync, the encrypted credential vault, sync scheduling, and password management with non-disclosing reset — is functionally identical to V11.8.1.

## Getting started

Open `index.html` directly in a modern browser (Chrome/Edge recommended). GitHub sync requires serving over `http://` rather than `file://`:

```
npx http-server .
```

### Default administrator password
`P@assw0rd`
Change it from **Update Schema → Change Operational Password**; use **Forgot password? Reset to default** if forgotten.

## Project structure

```
ap-sql-assistant/
├── index.html                          # Main application shell (all views)
├── css/
│   ├── styles.css                      # Core styling
│   └── navbar-v11.8.2-patch.css        # V11.8.2 navbar fix + 3D icons (additive)
├── js/
│   ├── app.js                          # UI wiring for all views
│   ├── tour-engine.js                  # V11.8.2 Guided Walkthrough engine
│   ├── schema-engine.js, schema-store-engine.js, relationship-store.js
│   ├── filter-engine.js, validation-engine.js, datatype-engine.js, decode-engine.js
│   ├── sql-engine.js, cr-engine.js, nl-query-engine.js, optimize-engine.js
│   ├── error-rectifier-engine.js, schema-assistant-engine.js, ai-service-engine.js
│   ├── schema-tools.js, password-manager-engine.js
│   ├── schema-sync-engine.js, shared-schema-loader.js, sync-schedule-engine.js
│   └── github-sync-engine.js, credential-vault-engine.js
├── schema/schema-sample.js             # Embedded default schema
├── test/                               # 71 Node-based tests
└── .github/workflows/deploy-pages.yml
```

## Running tests

```
npm test
```

**71/71 tests pass.**

## Security notes

- No SQL is ever executed — only generated for manual review.
- AI recommendations are always reviewable/editable.
- GitHub tokens are stored only encrypted (AES-256-GCM, PBKDF2, 210,000 iterations) when published as a vault.
- The operational password is stored only as a SHA-256 hash.

## Author

Crafted by **Subham Ain**.
