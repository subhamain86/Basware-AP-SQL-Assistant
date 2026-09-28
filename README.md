# SQL Assistant — V15.7

Baseline: V15.6 (working). This is a **targeted synchronization bug-fix
release only** — no UI, layout, theme, colors, icons, navbar, Query
Builder, AI/NLP, SQL generation, CASE/DECODE, Manual Schema Update UI,
schema structure, Secret Vault, or GitHub architecture changes were made.
The only change is the Manual Schema Update → GitHub central-sync fix
described below.

## How to run
- **Static hosting** (GitHub Pages, SharePoint, OneDrive, any web server):
  upload `index.html` as-is — CSS and JS are fully inlined, no build step.
- **Local / offline:** double-click `index.html`.
- `source/` contains the full TypeScript source (`tsc --noEmit` clean).

## The bug, and the actual root cause

**Symptom:** Manual Schema Update successfully saved an edited row
locally, but the change never reached the central schema stored in the
GitHub repository — so the local copy and the GitHub copy could silently
drift apart, and other devices pulling from GitHub would keep seeing the
old value.

**Root cause:** the Save button's own submit handler only ever called
`schemaService.upsertRow()` — a purely **local** in-memory + `localStorage`
write — and then immediately reported success and closed the modal. The
**only** thing that ever pushed the updated schema registry to GitHub was
`autoSyncService`'s `scheduleBackgroundPush()`: a fully **decoupled**,
1.2-second-debounced background timer that fires independently of the Save
action, reporting its own outcome via a *separate* toast that appears well
after the Save modal has already closed — with no connection back to that
specific save. This is exactly "Manual Save → Local State Updated → GitHub
Sync Not Triggered [as part of the same operation]" from the bug report:
the save workflow itself never attempted, awaited, or confirmed a central
GitHub write; it just hoped a best-effort background timer would pick it
up. If that timer never fired for any reason (tab closed within 1.2s,
Secret Vault happened to be locked at that instant, etc.), the save would
still report as fully successful even though nothing had reached GitHub.

## The fix

The Save handler in `schemaEditorSection.ts` now **explicitly calls and
awaits** `syncService.pushRegistryToGitHub()` as an integral, sequential
step of the save workflow itself — immediately after the local, targeted,
single-row update succeeds (V15.6's row-level upsert logic is completely
unchanged: still only one row is ever touched) — and reports one of three
honest, save-specific outcomes:

1. **Local + central both succeeded** → "Saved locally and synchronized to
   the central GitHub schema."
2. **Local succeeded, Secret Vault locked** → "Saved locally, but NOT yet
   synchronized to the central GitHub schema... Unlock Settings to publish
   this change."
3. **Local succeeded, GitHub push itself failed** (network, auth, missing
   token, conflict, etc.) → "Saved locally, but central GitHub
   synchronization FAILED: `<real error>`... The background sync will
   retry automatically, or use 'Sync Now'."

In every case the modal briefly shows this real outcome (not just a
generic "Saved!") before closing, and the corresponding toast is tied
directly to that save action. The pre-existing debounced
`autoSyncService` background push is left completely intact as a
secondary safety net/retry path — it is simply no longer the *only* thing
responsible for actually reaching GitHub. The same explicit-then-await
pattern was also applied to the Delete flow's third confirmation step, for
consistency.

## Regression testing performed (Playwright, against the built app)

- **All 7 routes** load cleanly with zero console/page errors.
- **Save explicitly attempts + awaits central sync:** edited
  `PO_HEADER.STATUS`'s description and saved. This sandboxed test
  environment has no real GitHub token configured, which is actually a
  perfect real-world test of the failure path — the Save modal's live
  status box read *"Saved locally, but central GitHub synchronization
  FAILED: Repository synchronization configuration is incomplete...
  Missing: Access Token."* — proving the sync attempt runs synchronously,
  as part of Save itself, and is never silently reported as a successful
  central save when it wasn't.
- **Persistent sync log** confirms the same honest failure reason is
  recorded for later diagnosis/retry, exactly matching what the modal
  showed.
- **Local row-level update still succeeds** even when central sync fails
  — the edited description was correctly visible in the table immediately
  after save, and all 6 other rows in `PO_HEADER` remained completely
  untouched (only the intended row was modified — V15.6's targeted-update
  guarantee is fully preserved).
- **Persistence after a genuine same-context reload:** saved an edit,
  performed an actual `page.reload()` (same browser tab/context, not a
  fresh Playwright context), re-unlocked Settings, and confirmed the
  edited value was still present.
- **Query Builder / CASE-DECODE regression:** confirmed table selection →
  SQL generation still works, and selecting `PO_HEADER.STATUS` with
  "Schema CASE/DECODE" still correctly produces a `CASE WHEN...THEN...END`
  expression with the original Open/Closed/On Hold labels — never a
  database-specific `DECODE()` call, and completely unaffected by the sync
  fix.
