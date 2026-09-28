# V16.1 — Targeted Bug-Fix / Regression-Fix Release

Baseline: V16.0. Scope: exactly the three regressions below. Nothing else was changed —
no new features, no UI redesign, no changes to Query Builder, Manual Selectors, M365
Copilot integration, Offline NLP, Secret Vault, or GitHub sync architecture.

## Fix 1 — Card sizing/spacing regression

**Symptom:** The two top cards on the Read Only Query Builder and CR Builder pages
("Describe What You Need" / "Describe the Change" and "Generated SQL") rendered at
visibly uneven widths.

**Root cause:** The left card carried an extra `.narrow` CSS modifier
(`max-width: 480px`) while sitting inside an equal `1fr 1fr` grid. The right card had no
such cap and stretched to fill its column, so the two cards — meant to be symmetric —
ended up different sizes.

**Fix:** Removed the `.narrow` modifier's width restriction and the class from both
pages' markup. Both cards now share the plain `.builder-panel` class with no
width-capping rule, so they stretch equally to their grid column again. No other card
property (padding, border-radius, shadow, internal spacing, button/control positioning)
was touched.

**Verified:** Automated browser test measures both card widths on both pages and fails
if they differ by more than a few pixels of rounding tolerance.

## Fix 2 — GitHub sync rejecting imported schemas ("Remote schema file failed validation")

**Symptom:** Importing a schema, saving it, and letting it sync to GitHub could later
fail — on the next reload or on another device — with "Remote schema file failed
validation", even though the import itself had appeared to succeed.

**Root cause:** The schema-integrity validator rejected any column whose `type` string
was not one of five internal UI dropdown values (`VARCHAR`, `NUMBER`, `DATE`, `FLAG`,
`TIMESTAMP`). Real imported/exported schemas commonly use richer, real-world type names
(`VARCHAR2`, `INTEGER`, `CHAR`, `BOOLEAN`, `CLOB`, `DECIMAL`, `TIMESTAMP(6)`, etc.). Such
a schema would import successfully (V16.0's import path did not validate before saving),
auto-push to GitHub, and then fail this same overly strict check on the very next
pull — reproducing exactly the reported workflow: *Imported Schema → Saved → GitHub
Synchronization → "Remote schema file failed validation."*

**Fix (two parts, both required for a permanent fix):**
1. **Widened the actual rule** in `validateSchemaIntegrity()` (`schemaIntegrityEngine.ts`)
   to require only that a data type be *present* (non-empty), not that it match the
   5-value UI enum. This is the single shared validator used for local schema editing,
   schema import, and remote/pulled-registry validation — so a schema that passes at
   import time is now *guaranteed* to also pass at pull time, because it's the identical
   check. No imported data (table names, column names, descriptions, data types,
   relationships, aliases, CASE/DECODE metadata) is stripped, renamed, or altered by this
   change — the exact type string provided is preserved and used as-is.
2. **Added the missing "Validate" step** to `schemaService.importSchema()`, which
   previously only checked that `tables` was an array before saving and triggering
   auto-sync. It now runs the same `validateSchemaIntegrity()` check *before* saving,
   implementing the exact required workflow: *Import Schema → Validate Schema → Save
   Schema → Synchronize with GitHub.* A structurally invalid file is now rejected
   immediately, with a clear message, before it ever reaches the repository.

**Also fixed along the way:** a stale-DOM bug where a successful import's confirmation
message was written to a detached DOM node (because `importSchema()`'s own save
triggers a synchronous re-render of the section it's called from) and so never became
visible. The message is now written to the freshly rendered container.

**Verified:** Unit tests directly exercise `validateSchemaIntegrity()` and
`validateIncomingRegistryFile()` with columns typed `INTEGER`, `VARCHAR2`, `BOOLEAN`,
`CLOB`, `NUMBER(10)`, `TIMESTAMP(6)`, `NVARCHAR2`, and `BLOB` — all now pass. A browser
test performs the actual file-upload UI flow end-to-end and confirms the success message
(not a validation failure) is shown and visible.

## Fix 3 — Error box visible with no active error / stale errors not clearing

**Symptom:** A synchronization error indicator could appear even when nothing had
failed, or could remain visible after a later, successful synchronization.

**Root cause / fix:** `syncService` now tracks one explicit, nullable `lastError` state:
- It is set **only** by explicit, user-initiated actions — Sync Now, Push, Pull — never
  by the automatic, silent background/auto-discovery checks that run on every page load
  (those already returned `ok:false` on failure in V16.0, but nothing rendered them; this
  is now the deliberate, documented rule going forward: a check the user didn't ask for
  must never surface a box they didn't ask for).
- It is **cleared** the instant any subsequent explicit sync action of that kind
  succeeds.
- The Schema Management section renders one conditional indicator bound to this state:
  renders nothing at all when it is `null`, and the exact message when it is not —
  never an empty box, never a stale one, never a default/placeholder message.

**Verified:** Unit-level reasoning is covered by the sync-service code paths (each
success branch sets `lastError = null`; each explicit-action failure branch sets a
message; background-check failure branches never touch it). Browser test confirms the
error-indicator mount is empty (`innerHTML === ''`) on a normal page load with no prior
failures.

## Regression testing performed

| Area | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit tests (`npm test`) | 9/9 passed, including 3 new tests targeting Fix 2 |
| Browser smoke test (`python3 scripts/smoke_test.py`) | All checks passed, including: card-width equality on both builder pages, no `.narrow` class present, real file-upload import of a schema with non-enum data types succeeds with a visible success message, error indicator absent with no active error, CR builder's mandatory-WHERE safeguard still blocks a WHERE-less DELETE, Error Rectifier still works, Settings still unlocks with the default password |
| Manual re-read against V16.0 | Query Builder, Manual Selectors, M365 Copilot integration, Offline NLP, Secret Vault, GitHub sync architecture, navbar, theme — all byte-for-byte unchanged outside the specific lines described above |
