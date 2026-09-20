# AP-SQL Assistant

**Version 10.9**

AP-SQL Assistant is a browser-based, schema-aware SQL authoring tool for AP/P2P teams. It writes both **read-only report queries** and **Change Request (CR) SQL** — INSERT, UPDATE, DELETE — using your organization's approved database schema as its single source of truth. No production database connection is ever required or made; the app only *generates* SQL for you to review and run through your own approved channels.

> ⚠️ **Generated SQL only** — this application does not execute database changes.

---

## What's New in 10.9

Version 10.9 is a **maintenance release** focused entirely on the in-app **Guided Walkthrough**:

- 🔁 **Rebuilt Guided Walkthrough** for the existing V10.7.1 setup, with step-by-step tooltips covering Quick Start, the Read-Only Query Builder, the CR Query Builder, and Schema management.
- 🚫 **No other UI or functional changes** — every capability, screen, and workflow from V10.7.1 remains exactly as it was.

If you're already on V10.7.1, upgrading to V10.9 only refreshes the walkthrough content; there is nothing else to relearn.

---

## Core Features (carried forward from V10.7)

### 🗂️ Multiple Schema Store & Management
- Store any number of named schemas side by side in the browser.
- Add, switch between, rename, or delete schemas independently — updating one never affects another.
- The **active schema** is used consistently across SQL generation, both Query Builders, and the Error Rectifier.

### 🔐 Secure Encrypted GitHub Connection Vault
- Save GitHub connection details (token and repository info) in the project repository in **encrypted** form.
- The vault can be shared and reused across machines and users **without ever exposing the token in plain text**.

### ⏱️ Selectable Schema Synchronization Schedule
- Choose how often the active schema syncs from a set of predefined intervals via a dropdown, instead of a fixed schedule.

### 🔑 Operational Password Change
- Genuine, self-service password change option for the password-protected **Update Schema** administrator action — replacing the previous hardcoded password.
- New passwords are hashed (SHA-256) and stored locally; the current password must be verified before a change is accepted.

### 💬 Describe What You Need (Natural-Language Query Builder)
- Describe a requirement in plain language (e.g. *"active suppliers with their email, sorted by name"*) — tables, joins, columns, filters, sorting, and aggregations are identified automatically against the active schema.
- Works from your description alone, your manual selections alone, or a combination of both.
- Supports Generic, Oracle, SQL Server, PostgreSQL, and MySQL dialects.

### 🧱 Structured Query Builder
- Full manual control: pick tables/columns, configure joins, filters (including `IN` / `NOT IN`), sorting, row limits, named CTEs (`WITH`), related-table existence checks (`EXISTS` / `NOT EXISTS`), related counts, `HAVING` filters, and recursive hierarchy/org-chart walks (`WITH RECURSIVE`).

### 📝 Query Builder for CR (Change Requests)
- Build `INSERT`, `UPDATE`, and `DELETE` statements from a description or manual column/value selection.
- Built-in safeguards: `UPDATE` and `DELETE` require a `WHERE` condition (or an explicit confirmation override) to protect against unintended changes.
- Optional value **decode/lookup** support per column.

### 🩹 Error Rectifier
- Paste a database error message and the SQL that caused it.
- The tool identifies the likely cause (datatype mismatches, invalid columns/tables, bad joins, `GROUP BY`/date-format issues, trailing commas, `NULL` comparisons, dialect-specific `NULL` functions, etc.) and returns a corrected query with a plain-language explanation.

### 🚀 Query Optimization & Explanation
- **Optimize**: suggests improvements such as removing redundant `DISTINCT` and flagging index candidates on filtered, non-primary-key columns.
- **Explain This Query**: generates a plain-language summary of what a built query does.

---

## Getting Started

1. Open `ap-sql-assistant/index.html` in a modern Chromium-based browser (Chrome or Edge recommended — required for the shared-schema file linking feature).
2. Follow the **Guided Walkthrough**, or go straight to **Quick Start** to try a ready-made example.
3. Add or select an active schema under **Used Schema**.
4. Use **Describe What You Need**, the **Read-Only Query Builder**, or the **Query Builder for CR** to generate SQL.
5. Copy the generated SQL, or run **Optimize** / **Explain This Query** for further insight.

### Setting up the GitHub Connection Vault
1. Go to **Update Schema** and unlock it with the operational password.
2. Under schema management, configure the encrypted GitHub connection (repository and token) and choose a sync schedule.
3. The connection can then be reused, securely, across any machine or user without re-entering the token in plain text.

---

## Project Structure

```
ap-sql-assistant/
├── index.html                     # Main application shell and UI
├── js/
│   ├── schema-engine.js           # Core schema lookups (tables, columns, relationships)
│   ├── schema-store-engine.js     # Multiple schema store & management (V10.7+)
│   ├── schema-sync-engine.js      # Local shared-schema file linking & sync
│   ├── github-sync-engine.js      # Encrypted GitHub connection vault & sync
│   ├── password-manager-engine.js # Operational password change (V10.7+)
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
│   └── shared-schema-loader.js    # Fetches a shared schema JSON file
├── schema/
│   └── schema-sample.js           # Sample schema for local development/testing
└── test/
    └── smoke-test.js              # Node-based smoke tests for all engines
```

## Running Tests

```bash
node ap-sql-assistant/test/smoke-test.js
```

The smoke test suite exercises the schema, filter, decode, SQL, CR, error-rectifier, natural-language query, schema-tools, and GitHub-sync engines.

## Security Notes

- The application performs **no execution** of SQL against any database — it only generates statements for manual review and execution through your organization's approved process.
- GitHub tokens are stored **encrypted** in the vault and are never exposed in plain text in the UI or logs.
- The operational password is stored locally as a SHA-256 hash; there is no fixed or hardcoded password once a custom password has been set.
- Update Schema is a password-protected administrator action and never connects to a production database.

## Author

Crafted by **Subham Ain**.
