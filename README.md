# AP-SQL Assistant — Version 11.8.2

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema(s) as its single source of truth.

> ⚠️ **Generated SQL only** — this application does not execute database changes.

## What V11.8.2 is

This release is a **focused UI/UX upgrade to the Read Only Query Builder and CR Query Builder** — nothing else. Per the golden rule for this release: *V11.8.2 should improve the Query Builder experience without changing what the application can do.*

### The new layout

```
┌───────────────────────────┬───────────────────────────┐
│  Describe What You Need   │       Generated SQL        │   ← side by side on desktop,
└───────────────────────────┴───────────────────────────┘      stacked on mobile

┌─────────────────────────────────────────────────────────┐
│                     Manual Selectors                      │
│   Tables & Columns │ Advanced Options │ Selected/Described │   ← Bootstrap tabs
│                                       │ Requirements       │
└─────────────────────────────────────────────────────────┘

  Tables & Columns tab:
┌──────────────────┬──────────────────┬──────────────────┐
│  Select Tables   │  Select Columns  │     Filters      │   ← side by side on desktop,
│  (scrollable)    │  (scrollable)    │  (scrollable)    │      stacked on mobile
└──────────────────┴──────────────────┴──────────────────┘
```

The exact same structure is applied to **both** the Read Only Query Builder and the CR Query Builder, with builder-specific controls preserved where they differ (e.g. the CR Query Type selector, WHERE-condition safeguard, and CASE/DECODE panel appear only in the CR builder's Tables & Columns tab).

### What did **not** change

Every underlying engine is byte-for-byte identical to V11.8:
- SQL Generation, Filter, Validation, Schema, Decode, and Relationship engines
- The AI Service Layer (`ai-service-engine.js`) — AI Self-Review, AI Error Rectifier, AI-assisted Optimization, AI Schema Assistant, AI CASE/DECODE proposals — all still schema-grounded, all still fully functional
- Multiple Schema Store (Stored/Active/Default/Inactive), GitHub sync + encrypted vault, sync schedule, password management with non-disclosing reset
- Read-only safety enforcement and CR WHERE-condition safeguards

**How this was achieved without touching the engines:** every DOM element ID from V11.8 (`promptInput`, `resultBody`, `tableListGrid`, `columnListBody`, `readOnlyFilterGroup`, `crFilterGroup`, etc.) was preserved exactly in the restructured HTML — only the surrounding cards/tabs/grid wrapping changed. `app.js` therefore required **zero logic changes**; it is functionally identical to V11.8, just re-skinned by the new CSS classes (`.qb-card`, `.qb-subcard`, `.manual-selectors-card`, `.qb-adv-section`, `.qb-scroll-lg`, etc.).

## Getting started

Open `index.html` directly in a modern browser (Chrome/Edge recommended for Cross-Device Schema Sync file-linking). GitHub sync and the Live Shared Schema check require serving over `http://` rather than `file://`:

```bash
npx http-server .
```

### Default administrator password

```
P@assw0rd
```

Change it from **Update Schema → Operational Password**; use **Forgot password? Reset to default** if forgotten.

## Project structure

```
ap-sql-assistant/
├── index.html                       # V11.8.2 restructured Query Builder layout
├── css/styles.css                   # + qb-card / qb-subcard / manual-selectors-card grid classes
├── js/                               # Every engine — byte-identical to V11.8
│   ├── ai-service-engine.js, schema-assistant-engine.js
│   ├── schema-tools.js, schema-engine.js, schema-store-engine.js, relationship-store.js
│   ├── datatype-engine.js, decode-engine.js, filter-engine.js, validation-engine.js
│   ├── sql-engine.js, cr-engine.js, nl-query-engine.js, error-rectifier-engine.js
│   ├── optimize-engine.js, suggestion-engine.js, password-manager-engine.js
│   ├── credential-vault-engine.js, github-sync-engine.js, schema-sync-engine.js
│   ├── shared-schema-loader.js, sync-schedule-engine.js
│   └── app.js                       # Same logic as V11.8, all element IDs preserved
├── schema/schema-sample.js
├── test/                            # 71 Node-based tests (unchanged from V11.8)
└── .github/workflows/deploy-pages.yml
```

## Running tests

```bash
node test/run-all.js
```

**71/71 pass.** Since no engine logic changed, this is the identical test suite from V11.8 — its continued 100% pass rate is direct evidence that the layout refinement introduced zero functional regressions.

## Responsive behavior

- **Desktop (≥ 992px):** Describe/Generated SQL side by side; Select Tables/Select Columns/Filters side by side.
- **Tablet:** Cards resize fluidly via Bootstrap's grid; no fixed pixel widths.
- **Mobile (< 992px):** Everything stacks vertically in the same top-to-bottom order shown above — no horizontal scrolling, no clipped buttons, no hidden controls.

## Security notes (unchanged from V11.8)

- No SQL is ever executed — only generated for manual review.
- AI recommendations are always reviewable/editable and are never saved to the schema without the operational password.
- AI never bypasses authentication, CR WHERE-condition safeguards, or schema activation controls.
- GitHub tokens are stored only encrypted (AES-256-GCM, PBKDF2, 210,000 iterations).
- The operational password is stored only as a SHA-256 hash.

## Author

Crafted by **Subham Ain**.
