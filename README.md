# SQL Assistant — V15.6

Baseline: V15.5 (working). This is a **targeted bug-fix release only** — no
UI, navbar, theme, layout, Query Builder, AI/NLP, CASE/DECODE, sync
architecture, or Secret Vault changes were made. The only change is the
Manual Schema Update Save fix described below.

## How to run
- **Static hosting** (GitHub Pages, SharePoint, OneDrive, any web server):
  upload `index.html` as-is — CSS and JS are fully inlined, no build step.
- **Local / offline:** double-click `index.html`.
- `source/` contains the full TypeScript source (`tsc --noEmit` clean).

## The bug, and the actual root cause

**Symptom:** editing an existing row in Manual Schema Update and clicking
Save did not reliably persist the change — or, when it did technically
succeed, the mechanism used was structurally wrong (see below), risking
exactly the "reset unrelated rows / rebuild the entire schema" failure
mode the bug report describes.

**Root cause #1 — full-schema validation instead of row-scoped validation.**
The previous implementation validated an edited row by running
`validateSchemaIntegrity()` over the **entire candidate table set** (every
table, every column in the whole schema) after applying the edit, and
rejected the Save if that full sweep produced *any* error — including
errors on rows the user never touched. In a schema of any real size it is
common for at least one pre-existing, unrelated column to have a
naturally-occurring structural issue (e.g. a composite key, or metadata
imported from elsewhere), and because the full-schema check has no way to
distinguish "pre-existing and unrelated" from "caused by this edit," a
perfectly valid single-row edit could be silently blocked by validation
noise from a completely different part of the schema.

**Root cause #2 — the update itself rebuilt the whole column collection.**
Even when validation passed, the previous update logic performed a
filter-then-push sequence across the *entire* `tables` array (deep-clone,
remove the old entry, push the new one at the end) and reassigned
`schema.tables` wholesale. This is a full-collection rebuild, not a
targeted patch — fragile (an edited column's position silently moved to
the end of the table) and structurally the opposite of "load the existing
schema, modify only the targeted record, and preserve every other record
byte-for-byte."

## The fix (both parts)

1. **`schemaIntegrityEngine.validateCandidateRowFields()`** (new) —
   validates *only* the single candidate row's own fields (data type,
   length/precision, decode-entry integrity) plus, where relevant, whether
   its own declared Foreign Key target actually exists elsewhere in the
   schema. It is structurally impossible for this check to fail because of
   an unrelated, pre-existing issue on a different row, since it never
   inspects any column other than the one being saved.
2. **`schemaService.upsertRow()`** now finds the exact target column **by
   identity** (`table::column`, the same key used by `SchemaEditorRow.rowId`)
   and mutates that one column object's fields **in place**, preserving its
   exact array position — or, only for a genuine rename, removes the old
   entry and inserts the new one, again without touching any other table or
   column. Every other row keeps the same values, same order, same object
   identity, apart from the one row actually being changed.

`schemaEditorSection.ts` was updated to match: it no longer performs its
own separate full-schema validation before calling `upsertRow` — the single
source of truth for "is this row valid" is now inside `upsertRow` itself,
scoped correctly, and the post-save UI refresh (`refreshTable()`) only
re-populates the existing data table in place, explicitly preserving the
selected schema/module/table and never calling a full page/section
rebuild.

## Regression testing performed (Playwright, against the built app)

- **Test 1 — Single row update:** edited `PO_HEADER.STATUS`'s description,
  clicked Save — modal closed (save succeeded), no validation errors, the
  same 7 column identities remained present, and the table immediately
  showed the updated description.
- **Test 2 — Multiple existing rows:** captured the full text of all 7
  `PO_HEADER` rows, edited only `VENDOR_ID`'s description, and confirmed
  all 6 other rows were **byte-for-byte identical** before and after.
- **Test 3 — Validation failure:** cleared the required Column Name field
  and clicked Save — the modal correctly stayed open with "Column Name is
  required," and the row set was confirmed unchanged (no data modified).
- **Test 4 — Persistence after navigating away and back:** edited a
  description, navigated to Quick Start and back to Settings → Manual
  Schema Update — the edited value was still present.
- **Test 5 — Persistence after a genuine page reload:** confirmed the
  edited value was present in `localStorage` before reload, then performed
  an actual same-tab `page.reload()` (not a fresh isolated browser
  context) — the edited value was still present after re-unlocking
  Settings.
- **Test 6 — Query Builder regression:** confirmed table selection → SQL
  generation still works, and that editing a column's *description* does
  not affect its DECODE mapping — selecting `PO_HEADER.STATUS` with
  "Schema CASE/DECODE" still correctly produces a `CASE WHEN...THEN...END`
  expression with the original Open/Closed/On Hold labels (never a
  database-specific `DECODE()` call).
- All 7 application routes load cleanly with zero console/page errors,
  both before and after the fix.
