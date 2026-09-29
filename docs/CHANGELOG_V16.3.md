# V16.3 — Root-Cause Fix: "Remote schema file failed validation" (recurring)

Baseline: V16.2. Scope: one issue, reported as recurring after the V16.1 fix that was
supposed to have resolved it permanently.

## Why the V16.1 fix did not fully resolve this

V16.1 widened the schema validator so it no longer rejected columns whose `type` string
wasn't one of five internal UI dropdown values (it started accepting `VARCHAR2`,
`INTEGER`, `BOOLEAN`, etc.). That fixed one real cause of the error. It did **not** fix a
second, independent cause that kept producing the exact same symptom.

## Root cause #1 — validating before sanitizing on the remote/pull path

The **local import path** (`schemaService.importSchema()`) has always done this
correctly: it **sanitizes** the incoming schema first — filling in safe defaults for any
genuinely missing optional field (a column with no `type` key at all defaults to
`'VARCHAR'`) — and only **then** runs structural validation against the *sanitized*
result.

The **remote/GitHub-pull path** (`syncService.pullRegistryFromGitHub()` and
`discoverPublicRegistry()`) did **not** follow that same order. It validated the raw,
freshly-`JSON.parse`d payload **before** any sanitization happened, and only sanitized
the data afterward — once validation had already (sometimes wrongly) rejected it.

This matters because `JSON.stringify` silently **drops any object key whose value is
`undefined`**. A column that ever had a missing/undefined `type` in memory — however
that happened (a partial write, a hand-edit of the registry file directly on GitHub, an
older export, etc.) — would therefore arrive over the wire with the `type` key **absent
entirely**, not merely empty. Validating that raw, pre-default data correctly (from the
validator's point of view) flags "missing Data Type" as an error, and the *entire*
registry — every schema in it — is rejected with "Remote schema file failed
validation," even though the exact same data would have been silently accepted on the
local import path once defaulted.

**Fix:** `syncService.ts` now sanitizes every schema in the pulled registry file **first**
(via the same `sanitizeIncomingSchema()` used for local import), then re-validates the
*sanitized* result — bringing the remote path in line with the local one. This is applied
to both `pullRegistryFromGitHub()` (explicit, user-initiated Sync Now / Push / Pull) and
`discoverPublicRegistry()` (the silent background discovery check on every page load).

## Root cause #2 — referential-integrity drift treated as fatal

Independently, the validator treated a **dangling foreign-key reference** (pointing at a
table/column that has since been renamed or removed) and a **duplicate column entry**
as hard, blocking errors. Real schemas drift over time — someone renames a table,
someone hand-edits the file, a sync merge quirk introduces a duplicate row — and a
*single* such inconsistency anywhere in a large schema was enough to fail validation for
the **entire registry**, blocking sync for every device, over one small, cosmetic piece
of metadata.

**Fix:** `schemaIntegrityEngine.ts` now treats these as **warnings** (non-blocking) —
still surfaced to the user so the drift is visible and fixable, but no longer capable of
halting an otherwise-usable schema's synchronization. Only genuinely fatal, unidentifiable
structural problems (a table with no name, a column with no name) remain blocking
errors.

## Also improved: actionable error messages

When an explicit sync action (Sync Now / Push / Pull) does still fail validation for a
genuinely fatal reason, the surfaced message now includes the first few specific issue(s)
(e.g. `Remote schema file failed validation. Schema #1: A table is missing its Table
Name.`) instead of just the bare generic phrase — so if this class of problem ever
resurfaces for a different reason, there is enough detail to diagnose it immediately
rather than repeating a blind trial-and-error loop.

## Verified

- Two new unit tests reproduce the exact original bug mechanism: a schema whose column
  is missing its `type` key **entirely** (not just an empty string) is confirmed to fail
  raw/pre-sanitize validation (sanity check) and confirmed to **pass** once sanitized
  first — exactly matching the new code path.
- A unit test calls `validateIncomingRegistryFile()` — the literal function the sync pull
  path invokes — with a registry sanitized the new way, and confirms it is now valid.
- A unit test confirms a dangling FK reference no longer blocks validation, while still
  producing a visible warning.
- A unit test confirms a duplicate column no longer blocks validation, while still
  producing a visible warning.
- A unit test confirms genuinely fatal issues (missing table/column name) still
  correctly block validation — the fix did not overcorrect into never blocking anything.
- A real headless-Chromium browser test imports a schema through the actual file-upload
  UI with a column that has **no `type` key at all** and a **dangling FK reference**
  simultaneously (the two conditions combined), and confirms it is accepted with a clear
  success message — not rejected.
- All prior fixes (V16.1 card sizing, V16.1 data-type widening, V16.2 password/error-box
  hardening) re-verified as still working.
- 11/11 unit tests pass, type-check clean.

No other files, features, or behaviors were touched.
