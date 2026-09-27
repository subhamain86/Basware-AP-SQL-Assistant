# SQL Assistant — V14.2

An incremental upgrade of V14.1: navbar/logo polish, automatic JOIN generation, per-column Alias/DECODE controls,
an expanded Advanced Options area, and a Secret Vault that unifies with the Admin Password so GitHub sync no
longer requires technical repository knowledge. **All existing V14.1 functionality, UI, Query Builder logic, NLP
engine, schema management, synchronization, and Vault behavior are preserved.**

## Just want to open it? `dist/index.html`

Fully self-contained (~230 KB, zero external references). Double-click it — no server, no build step. Verified
via `file://` in a real headless browser with **zero console errors, zero page errors** across 33 targeted tests.

## What's new in V14.2

### 1. Navbar / Logo (spec section 1)
A more polished, layered logo mark (database stack + magnifying-glass accent) replaces the flat V14.1 badge —
built entirely from the app's own existing brand blue (`#2f6fed` / `#1c3f8f`); no new colours were introduced.
*(Note: the spec referenced "the requested #D colour/theme" — formatting appears to have been stripped from the
source document in transit. We've interpreted this as "reuse the existing brand colour," since no other colour
reference was available — happy to adjust to a specific hex if a different one was intended.)* The logo has
**zero** hover/focus/active styling of its own (verified: identical markup before/after hover) and is wrapped in a
real `<button>` that navigates to Quick Start via the same in-SPA callback every other nav link uses — no full
page reload.

### 2-5. Automatic Joins (the centerpiece of this release)
A new `joinAutoEngine.ts` inspects the Active Schema's declared PK/FK relationships to connect selected tables
automatically:
- **Direct relationships** are used when they exist.
- **One-hop bridges** are detected when two tables aren't directly related but share a connecting table — the
  spec's own example (**Invoice → Supplier → Organization**) is now literally demonstrable: we added an
  `ORGANIZATION` table + `VENDOR.ORG_ID` FK to the default schema specifically to prove this out, and it's
  verified working end-to-end.
- **Ambiguous pairs** (more than one valid path) are surfaced with a dropdown in Advanced Options → Automatic
  Joins, rather than silently guessing.
- **No relationship found** now produces a clear warning comment — V14.1's old `ON 1=1` arbitrary-guess fallback
  has been removed entirely, since an always-true join condition is worse than no join at all.

### 6-11. Select Columns — search, Alias, DECODE
- Column search re-verified (static-shell pattern, never loses focus, works across multiple selected tables).
- **Alias** now appears only once a column is checked — a clean `Column Name` before, `☑ Column Name | Alias` after.
- **DECODE** likewise appears only once selected, as a "Display as" choice: **Raw Column** / **Schema DECODE**
  (only shown if one exists) / **Manual DECODE…** (opens a builder pre-filled for that exact column; on save, it
  replaces that column's entry in place — never creating a duplicate).

### 12. Manual Selectors — single "Build Query" button
A single `Build Query` action now sits directly below the Manual Selectors tabs — no other buttons in that row.

### 13-23. Advanced Options — expanded into the central SELECT-configuration area
WITH/CTEs (new), GROUP BY, HAVING, ORDER BY, LIMIT, DISTINCT, aggregates, CASE, DECODE, and Views are all here.
The "Manual CASE (custom)" / "Manual DECODE (custom)" buttons were relocated here from Select Columns, per the
spec's explicit instruction that Advanced Options — not the main Query Builder — should be the central home for
advanced functionality.

### 22. Views vs. Tables
`TableDef` gained an optional `objectType: 'TABLE' | 'VIEW'` field (defaults to `'TABLE'` everywhere it's read, so
existing schemas are unaffected). A `VIEW` chip now appears next to any view in every table listing; a `VW_OPEN_INVOICES`
example view was added to the default schema to demonstrate this.

### 24-30. Secret Vault (the other centerpiece)
The Vault now unlocks with the **same Admin Password** already used for Settings — spec section 27 explicitly
asked for this, and it removes an entire second secret users had to remember. Non-secret bootstrap defaults
(repository/branch/path) are baked into the app and pre-fill automatically, collapsed behind an "Advanced
repository settings" disclosure — a typical user only ever supplies their personal GitHub token. The token is
**always masked** (`••••••••••••abcd`), with a "Change Token" flow that never displays the previous value. A
simple **"Sync with GitHub"** button is the primary action on both the Schema page and Settings → Synchronization;
manual push/pull remain available for power users behind a collapsed "Advanced" section.

**Honest scope note:** the GitHub access token is inherently a personal credential per GitHub's own security
model — it is intentionally never synchronized or auto-recovered, since a static client-only app has no secure
way to do that without a backend. This is stated plainly in the UI and About page rather than implying a false
"fully automatic secret sync."

## What's in this zip

```
sqla142/
├── dist/index.html          ← Open this. Fully self-contained.
├── inline-build.mjs          ← Build-time inliner with byte-identical verification
├── src/
│   ├── engines/               + joinAutoEngine (NEW — direct + bridge join detection)
│   ├── services/               secretVaultService (NEW — replaces vaultService, Admin-Password-unified)
│   ├── components/             logoMark (NEW), columnPicker (rewritten — inline Alias/Display-as),
│   │                            manualExprBuilder (+ replace-in-place support)
│   ├── utils/                  sqlIdentifier (NEW — alias validation)
│   └── pages/                  readOnlyBuilderPage (Automatic Joins UI, CTE builder, single Build Query button),
│                                settingsPage (Secret Vault tab), schemaPage (View chip, simplified sync)
├── package.json / tsconfig.json / vite.config.ts
└── README.md
```

## Verified before packaging (real browser tests, not just compilation)

- `tsc --noEmit`: 0 errors · `vite build`: clean
- Logo: renders correctly, markup byte-identical before/after hover, click navigates to Quick Start
- Automatic Joins: direct joins confirmed; the Invoice→Vendor→Organization bridge chain confirmed working
  end-to-end in generated SQL; confirmed the old `1=1` arbitrary-join fallback no longer appears anywhere
- Select Columns: search filters correctly and never loses focus; Alias hidden before selection, shown and
  functional immediately after; DECODE confirmed NOT auto-applied, confirmed applying correctly once explicitly
  chosen via "Display as"
- Exactly one button (`Build Query`) confirmed present below Manual Selectors
- CTE/WITH builder confirmed generating correct SQL
- View chip confirmed present and visually distinguished from Tables
- Secret Vault: confirmed auto-unlocking with the Admin Password, confirmed no separate passphrase prompt exists
  anywhere, confirmed masked token display, confirmed bootstrap repository defaults pre-filled
- **Full V14.1 regression pass**: no-refresh behavior, AND/OR merge, description-aware NLP, Settings password fix,
  Manual Schema Update module/table scoping, and hamburger submenu collapse/expand all re-verified intact
- Mobile (390px): hamburger opens correctly, zero horizontal overflow
- **Zero console errors, zero page errors** across 33 targeted tests spanning both new features and regressions

## Demo credentials

Admin Password: `admin` (used internally only — never shown in the UI). This same password unlocks the Secret
Vault automatically — no separate passphrase to create or remember.
