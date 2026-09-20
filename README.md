# AP-SQL Assistant

**Version 11.0**

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema as its single source of truth. No production database connection is ever required or made; the app only *generates* SQL for you to review and run through your own approved channels.

> ⚠️ **Generated SQL only** — this application does not execute database changes.

---

## What's New in 11.0

Version 11.0 is a **navigation/UX release**:

- 🧭 **Schema Synchronization Schedule moved to the navbar.** The dropdown that controls how often the active schema checks the Live Shared Schema, a linked file, and GitHub for updates now lives in the top navigation bar (next to the Guided Walkthrough button), so it is one click away on **every page** — not just on Update Schema.
- 🚫 **No functional change** to what the schedule does — it still drives the same automatic checks against the Live Shared Schema, the linked shared file (File System Access API), and GitHub-hosted sync, using the exact same options (Manual only, 30 seconds, 1/5/15/30 minutes, 1/6/24 hours).
- 📘 The Guided Walkthrough gained a short new step (visible from any page) explaining the relocated control.
- Everything else — schema store, GitHub vault, password management, Describe What You Need, both Query Builders, and the Error Rectifier — is unchanged from V10.9.

---

## Core Features (carried forward)

### 🗂️ Multiple Schema Store & Management
- Store any number of named schemas side by side in the browser.
- Add, switch between, rename, or delete schemas independently — updating one never affects another.
- The **active schema** is used consistently across SQL generation, both Query Builders, and the Error Rectifier.

### 🔐 Secure Encrypted GitHub Connection Vault
- Save GitHub connection details (token and repository info) in the project repository in **encrypted** form.
- The vault can be shared and reused across machines and users **without ever exposing the token in plain text**.

### ⏱️ Selectable Schema Synchronization Schedule — now in the navbar
- Choose how often the active schema syncs from a set of predefined intervals via a dropdown in the top navigation bar, available from any page.

### 🔑 Operational Password Change
- Genuine, self-service password change option for the password-protected **Update Schema** administrator action.
- New passwords are hashed (SHA-256) and stored locally; the current password must be verified before a change is accepted.

### 💬 Describe What You Need (Natural-Language Query Builder)
- Describe a requirement in plain language — tables, joins, columns, filters, sorting, and aggregations are identified automatically against the active schema.
- Supports Generic, Oracle, SQL Server, PostgreSQL, and MySQL dialects.

### 🧱 Structured Query Builder
- Full manual control: tables/columns, joins, filters (`IN`/`NOT IN`), sorting, row limits, named CTEs, `EXISTS`/`NOT EXISTS`, related counts, `HAVING`, and recursive hierarchy walks (`WITH RECURSIVE`).

### 📝 Query Builder for CR (Change Requests)
- Build `INSERT`, `UPDATE`, and `DELETE` statements from a description or manual column/value selection.
- `UPDATE`/`DELETE` require a `WHERE` condition (or an explicit override) to protect against unintended changes.

### 🩹 Error Rectifier
- Paste a database error and the SQL that caused it; get a corrected query with a plain-language explanation.

### 🚀 Query Optimization & Explanation
- **Optimize**: removes redundant `DISTINCT`, flags index candidates.
- **Explain This Query**: plain-language summary of a built query.

---

## Getting Started

1. Open `ap-sql-assistant/index.html` in a modern Chromium-based browser (Chrome or Edge recommended — required for the shared-schema file linking feature).
2. Follow the **Guided Walkthrough**, or go straight to **Quick Start** to try a ready-made example.
3. Add or select an active schema under **Used Schema**.
4. Use **Describe What You Need**, the **Read-Only Query Builder**, or the **Query Builder for CR** to generate SQL.
5. Pick how often schemas sync using the dropdown in the **top navbar** (next to Guided Walkthrough).

---

## Project Structure

```
ap-sql-assistant/
├── index.html                     # Main application shell and UI
├── css/
│   └── styles.css                 # All application styling (incl. new navbar sync-schedule styles)
├── js/
│   ├── schema-engine.js           # Core schema lookups (tables, columns, relationships)
│   ├── schema-store-engine.js     # Multiple schema store & management
│   ├── schema-sync-engine.js      # Local shared-schema file linking & sync
│   ├── github-sync-engine.js      # Encrypted GitHub connection vault & sync
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
│   ├── sync-schedule-engine.js    # Schedule options/state (now surfaced in the navbar)
│   ├── suggestion-engine.js       # Suggested fixes for rejected queries
│   ├── shared-schema-loader.js    # Fetches a shared schema JSON file
│   └── app.js                     # UI wiring for every page, including the navbar
├── schema/
│   └── schema-sample.js           # Sample schema for local development/testing
└── test/
    └── smoke-test.js              # Node-based smoke tests for all engines
```

## Running Tests

```bash
node ap-sql-assistant/test/smoke-test.js
```

The smoke test suite exercises the schema, filter, decode, SQL, CR, error-rectifier, natural-language query, schema-tools, and GitHub-sync engines. All 12 checks pass on this build.

## Security Notes

- The application performs **no execution** of SQL against any database — it only generates statements for manual review and execution through your organization's approved process.
- GitHub tokens are stored **encrypted** in the vault and are never exposed in plain text in the UI or logs.
- The operational password is stored locally as a SHA-256 hash; there is no fixed or hardcoded password once a custom password has been set.
- Update Schema is a password-protected administrator action and never connects to a production database.

## Author

Crafted by **Subham Ain**.
