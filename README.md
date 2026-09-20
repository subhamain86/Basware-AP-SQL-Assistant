# AP-SQL Assistant

**Version 11.2 — Query Builder UI/UX Modernization**

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema as its single source of truth. No production database connection is ever required or made; the app only *generates* SQL for you to review and run through your own approved channels.

> ⚠️ **Generated SQL only** — this application does not execute database changes.

---

## What's New in 11.2

**This is a UI/UX-only release.** No query-generation logic, SQL syntax generation, schema handling, validation, filter behavior, advanced options, INSERT/UPDATE/DELETE behavior, navigation, permissions, or output/copy functionality was changed. `js/app.js` (all functional logic) is byte-for-byte untouched from V11.1 — every improvement below is presentation, layout, responsiveness, and accessibility only.

### Read Only Query Builder & Query Builder for CR — full redesign
- Both builders are now organized into clear, numbered logical sections (a "Step 1 → Step 6" flow), visually guided by a step-chip overview strip at the top of each page:
  - **Read Only Query Builder:** Step 1 Describe → Step 2 Tables → Step 3 Columns → Step 4 Filters → Step 5 Advanced Options → Step 6 Generated SQL.
  - **Query Builder for CR:** Step 1 Query Type & Describe → Step 2 Table → Step 3 Columns/Values → Step 4 Conditions → Step 5 Decode → Step 6 Generated SQL.
- **Advanced Options** (Read Only builder) is now a genuine Bootstrap **accordion** — each option (joins, sorting, limit, friendly name, EXISTS, related count, HAVING, hierarchy) collapses independently with an icon and clear header, instead of a long stack of always-open cards.
- The **Tables & Columns / Advanced Options / Requirements** switcher (and the CR equivalent) is restyled as modern Bootstrap **nav-pills** instead of plain tabs, with icons and equal-width segments that stay usable on narrow screens.
- The **CR command selector** (INSERT / UPDATE / DELETE) is now a clearer Bootstrap segmented control with icons, and stacks vertically on very small screens instead of squeezing.
- **Generated SQL** panels on both builders share the same card header, badge, toolbar layout, and an empty-state hint — visually identical between the two builders.
- Consistent spacing, typography, section headers, badges, and button placement across both builders so they are immediately recognizable as part of the same application.
- Verified responsive behavior on desktop, laptop, tablet, and narrow browser windows, and at multiple zoom levels — no cut-off controls, no overlapping elements, no forced horizontal scrolling on the page itself.

---

## Previously in 11.1

### 1. UI Rectification (full responsive pass)
- Reworked the base layout rules (`box-sizing`, `min-width: 0`, `overflow-wrap`, `clamp()`-based padding) so cards, grids, tabs, buttons, dropdowns, and forms no longer overlap, get cut off, or force horizontal scrolling on the page itself.
- Tabs (`Tables & Columns`, `Advanced Options`, etc.) now scroll horizontally within their own strip instead of wrapping/overlapping on narrow screens.
- Long SQL, table/column names, and JSON now wrap safely (`overflow-wrap: anywhere`) inside cards and code blocks instead of pushing layouts wider than the viewport.
- Verified and adjusted behavior across common desktop/laptop widths, narrow browser windows, and zoom levels from 80%–150%.
- The **Guided Walkthrough** overlay/spotlight positioning logic was re-verified against the updated layout, and gained new steps describing the relocated/renamed controls below.

### 2. Navbar — Schema Synchronization Schedule now clearly labeled
- The sync-frequency dropdown in the top navbar now has a permanent, visible text label — **"Schema Synchronization Schedule"** — next to it (with an icon and `aria-label`/`title` fallback on very narrow screens).
- The navbar wraps gracefully: on tablets/phones the schedule control drops to its own full-width row instead of squeezing or overlapping the logo, Guided Walkthrough button, or signature.

### 3. Used Schema — "Select Stored Active Schemas"
- The schema-activation control has moved to **Used Schema**, and is now a **multi-select** (checkbox list, not a single "Set Active" button).
- Every stored schema is listed with its state clearly badged (**Default** / **Active** / **Inactive**).
- Ticking/unticking a schema takes effect **immediately** — no password required — and instantly updates what SQL generation, both Query Builders, and the Error Rectifier can see.

### 4 & 5. Update Schema — Default Schema & Active Schemas configuration
Two new admin-only cards (behind the existing operational password):
- **Select Default Schema** — a single-choice list of every stored schema; exactly one can be the Default at a time. The Default schema is what Live Shared Schema, linked-file sync, and GitHub sync update automatically. Changing the default does **not** remove any schema from the active set.
- **Select Active Schemas** — a multi-select checklist (with an explicit **Save Active Schema Selection** button) to activate/deactivate any number of stored schemas at once. The Default schema is always force-included and can't be deselected here. Deactivating never deletes anything.

### 6. Schema State Model
| State | Meaning |
|---|---|
| **Stored** | Exists in the schema repository (`Manage Stored Schemas`) |
| **Active** | Included in SQL generation, both Query Builders, and the Error Rectifier — a merged view of every Active schema's tables is used, with the Default schema's tables taking precedence on name collisions |
| **Default** | The one schema always Active and used as the target for Live Shared Schema / linked-file / GitHub sync |
| **Inactive** | Stored but currently excluded from use — nothing is deleted |

A schema can be **Stored + Active + Default**, **Stored + Active**, or **Stored + Inactive**. These states are tracked independently from the "Working with" selector used for uploading/downloading/deleting a specific schema's content.

---

## Core Features (carried forward)

- **Describe What You Need** — natural-language query interpretation across the merged Active schema(s).
- **Structured Query Builder** — full manual control: joins, filters (`IN`/`NOT IN`), sorting, limits, named CTEs, `EXISTS`/`NOT EXISTS`, related counts, `HAVING`, recursive hierarchy walks.
- **Query Builder for CR** — `INSERT` / `UPDATE` / `DELETE` with mandatory `WHERE` protection (or explicit override).
- **Error Rectifier** — schema-aware, rule-based SQL correction with plain-language explanations.
- **Query Optimization & Explanation** — redundant `DISTINCT` removal, index-candidate flags, plain-language query summaries.
- **Multiple Schema Store**, **Encrypted GitHub Connection Vault** (AES-256-GCM), **Selectable Sync Schedule**, and **Operational Password Change** (SHA-256 hashed, no fixed default once changed).

---

## Getting Started

1. Open `ap-sql-assistant/index.html` in a modern Chromium-based browser (Chrome or Edge recommended for the shared-schema file linking feature).
2. Follow the **Guided Walkthrough**, or go straight to **Quick Start**.
3. Go to **Used Schema** to tick which stored schemas should be **Active** right now.
4. Go to **Update Schema** (password-protected — default password is **`admin123`**, see below) to set the **Default Schema** and fine-tune the full **Active Schemas** list.
5. Use **Describe What You Need**, the **Read-Only Query Builder**, or the **Query Builder for CR** to generate SQL — only your Active schema(s) are used.
6. Adjust how often schemas sync using the clearly labeled dropdown in the **top navbar**.

### Default Update Schema Password

The **Update Schema** page is protected by an operational password stored client-side as a SHA-256 hash (never in plain text). Out of the box, this password is:

```
admin123
```

**Change this immediately after first unlocking the app**, via **Update Schema → Operational Password**. Once changed, the new password is what unlocks the section going forward (the default `admin123` stops working as soon as a custom password is set) — there is no way to recover a forgotten custom password other than clearing this browser's local storage for the app (which resets it back to `admin123` and does **not** delete any stored schemas).

---

## Project Structure

```
ap-sql-assistant/
├── index.html                     # Main application shell and UI (V11.1 responsive pass + new schema-state UI)
├── css/
│   └── styles.css                 # All application styling, incl. the V11.1 UI rectification rules
├── js/
│   ├── schema-engine.js           # Core schema lookups (tables, columns, relationships)
│   ├── schema-store-engine.js     # V11.1: Stored/Active/Default/Inactive schema state model + merged-schema builder
│   ├── schema-sync-engine.js      # Local shared-schema file linking & sync (writes to the Default schema)
│   ├── github-sync-engine.js      # Encrypted GitHub connection vault & sync (writes to the Default schema)
│   ├── password-manager-engine.js # Operational password change
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
│   ├── credential-vault-engine.js # AES-256-GCM encrypted GitHub vault
│   ├── sync-schedule-engine.js    # Schedule options/state (labeled control in the navbar)
│   ├── suggestion-engine.js       # Suggested fixes for rejected queries
│   ├── shared-schema-loader.js    # Fetches a shared schema JSON file
│   └── app.js                     # UI wiring for every page, incl. the new schema-state controls
├── schema/
│   └── schema-sample.js           # Sample schema for local development/testing
└── test/
    └── smoke-test.js              # Node-based smoke tests (engines + V11.1 schema-state model)
```

## Running Tests

```bash
node ap-sql-assistant/test/smoke-test.js
```

20 checks covering the schema, filter, decode, SQL, CR, error-rectifier, natural-language query, schema-tools, GitHub-sync engines, and the new V11.1 Stored/Active/Default/Inactive schema-state model (including the safeguard that prevents directly deactivating the Default schema). All 20 pass on this build.

## Security Notes

- The application performs **no execution** of SQL against any database — only generation for manual review.
- GitHub tokens are stored **encrypted** in the vault, never in plain text.
- The operational password is stored locally as a SHA-256 hash.
- Update Schema (including the new Default/Active Schema configuration cards) remains a password-protected administrator action and never connects to a production database.

## Author

Crafted by **Subham Ain**.
