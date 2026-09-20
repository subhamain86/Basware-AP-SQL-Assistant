# AP-SQL Assistant

**Version 11.3 — Compact, Scrollable & User-Friendly UI + Password Section Fix**

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema as its single source of truth. No production database connection is ever required or made; the app only *generates* SQL for you to review and run through your own approved channels.

> ⚠️ **Generated SQL only** — this application does not execute database changes.

---

## What's New in 11.3

**This is a UI/UX + bug-fix release.** No SQL generation logic, schema handling, table/column selection behavior, filter behavior, advanced options, validation logic, INSERT/UPDATE/DELETE behavior, GitHub synchronization, schema synchronization scheduling, navigation, or saved configuration was changed.

### 1–6. Compact, Scrollable UI (application-wide)
- The main content area now sits in a **constrained, centered container** (`container-xl`, ~1180px max-width) instead of stretching edge-to-edge — the app feels like a compact desktop application rather than a full-width web page.
- **Component-level scrolling** replaces page-level stretching for every long list:
  - **Table selection** — the table grid now sits inside a fixed-height scrollable panel (`.qb-scroll-panel-tables`); search/filter and Select All/Clear stay pinned above it.
  - **Column selection** — the column list is likewise contained in its own scrollable panel (`.qb-scroll-panel-columns`), so wide tables never stretch the page.
  - **Filters** — redesigned as a **dedicated Bootstrap card** ("Filters") with its own header, separated visually from table/column selection, and an internal scroll area for when many conditions are configured.
  - **Schema lists** (Used Schema's active-schema selector, the full schema-store detail list, Update Schema's Default/Active selectors) and the **schema tree** all use the same scrollable-panel pattern.
  - **Generated SQL** panels now cap their height and scroll internally for very long queries, on both the Read Only and CR builders.
- **Update Schema** has been reorganized into a Bootstrap **accordion** (Select Default Schema, Select Active Schemas, Manage Stored Schemas, Live Shared Schema, Cross-Device Sync, GitHub Sync, Vault, Download, Import, Operational Password, Danger Zone) so the page is short and navigable instead of one long scroll of always-open cards.
- Reduced padding/margins consistently across cards, sections, and forms for a tighter, more professional layout, while keeping every control comfortably readable and tappable.

### 7. Password Section — Root Cause Found & Fixed
Investigation found the root cause of "the Password section is not opening": the Update Schema gate compares your entered password against a hash stored in this browser's local storage. If **any** custom or stale password hash was ever saved in this browser (from an earlier session, an earlier app version, or testing), the documented default password would correctly stop working — but there was **no way in the UI to recover** without already knowing the current password, so it looked like the section was permanently broken.

**Fix:** a **"Forgot password? Reset to default"** link has been added directly to the locked Update Schema screen (no login required to use it). Clicking it clears any custom/stale password hash and restores the documented default:

```
admin123
```

This is exercised by an automated regression test (`test/smoke-test.js`) that specifically simulates setting a custom password and then confirms the reset link restores access — the exact scenario that was causing the reported lockout.

---

## Core Features (carried forward, unchanged)

- **Describe What You Need** — natural-language query interpretation across the merged Active schema(s).
- **Structured Query Builder** (Read Only) — joins, filters (`IN`/`NOT IN`), sorting, limits, named CTEs, `EXISTS`/`NOT EXISTS`, related counts, `HAVING`, recursive hierarchy walks — now organized into a clear Step 1–6 flow (Describe → Tables → Columns → Filters → Advanced → Generated SQL).
- **Query Builder for CR** — `INSERT` / `UPDATE` / `DELETE` with mandatory `WHERE` protection, organized into the same Step 1–6 flow (Type & Describe → Table → Columns/Values → Conditions → Decode → Generated SQL).
- **Error Rectifier** — schema-aware, rule-based SQL correction with plain-language explanations.
- **Multiple Schema Store** with a full **Stored / Active / Default / Inactive** lifecycle, **Encrypted GitHub Connection Vault** (AES-256-GCM), **Selectable Sync Schedule**, and **Operational Password Change**.

---

## Getting Started

1. Open `ap-sql-assistant/index.html` in a modern Chromium-based browser (Chrome or Edge recommended for the shared-schema file linking feature).
2. Follow the **Guided Walkthrough**, or go straight to **Quick Start**.
3. Go to **Used Schema** to tick which stored schemas should be **Active** right now.
4. Go to **Update Schema** (password-protected — default password is **`admin123`**; use **"Forgot password? Reset to default"** on the locked screen if it's ever been changed and forgotten) to configure the **Default Schema** and **Active Schemas**.
5. Use **Describe What You Need**, the **Read-Only Query Builder**, or the **Query Builder for CR** to generate SQL.
6. Adjust how often schemas sync using the labeled dropdown in the **top navbar**.

### Update Schema Password & Recovery

The **Update Schema** section is protected by an operational password, stored client-side only as a SHA-256 hash (never in plain text). The default is `admin123`. If a custom password was set and later forgotten (or if this browser has a stale hash left over from testing or an earlier session), click **"Forgot password? Reset to default"** directly on the locked screen — this clears the stored hash and restores `admin123` immediately, without needing to know the current password. No stored schemas are affected by a password reset.

---

## Project Structure

```
ap-sql-assistant/
├── index.html                     # Main application shell and UI (V11.3: compact shell, scroll panels, accordions, password-fix UI)
├── css/
│   └── styles.css                 # All application styling, incl. the V11.3 compact/scrollable rules
├── js/
│   ├── schema-engine.js           # Core schema lookups (tables, columns, relationships)
│   ├── schema-store-engine.js     # Stored/Active/Default/Inactive schema state model + merged-schema builder
│   ├── schema-sync-engine.js      # Local shared-schema file linking & sync
│   ├── github-sync-engine.js      # Encrypted GitHub connection vault & sync
│   ├── password-manager-engine.js # Operational password change + resetToDefault (used by the V11.3 fix)
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
│   ├── sync-schedule-engine.js    # Schedule options/state
│   ├── suggestion-engine.js       # Suggested fixes for rejected queries
│   ├── shared-schema-loader.js    # Fetches a shared schema JSON file
│   └── app.js                     # UI wiring for every page, incl. the "Forgot password?" control
├── schema/
│   └── schema-sample.js           # Sample schema for local development/testing
└── test/
    └── smoke-test.js              # Node-based smoke tests, incl. the password-lockout regression test
```

## Running Tests

```bash
node ap-sql-assistant/test/smoke-test.js
```

23 checks covering the schema, filter, decode, SQL, CR, error-rectifier, natural-language query, schema-tools, GitHub-sync engines, the Stored/Active/Default/Inactive schema-state model, and — new in this release — a full simulation of the password-lockout scenario (set a custom password, confirm the old default stops working, then confirm "Reset to default" restores access). All 23 pass on this build.

## Security Notes

- The application performs **no execution** of SQL against any database — only generation for manual review.
- GitHub tokens are stored **encrypted** in the vault, never in plain text.
- The operational password is stored locally as a SHA-256 hash; it can always be reset back to the documented default via the locked-screen recovery link, without affecting any stored schema data.
- Update Schema remains a password-protected administrator action and never connects to a production database.

## Author

Crafted by **Subham Ain**.
