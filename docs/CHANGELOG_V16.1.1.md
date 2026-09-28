# V16.1.1 — Rebuild / Re-delivery of V16.1

This package is a clean rebuild of the verified **V16.1** codebase, re-delivered because the
previous build was lost between sessions. **No functional changes were made beyond V16.1** — the
version label was bumped to 16.1.1 to reflect this specific rebuild/delivery, per your request.

All three V16.1 regression fixes are included and re-verified in this build:

1. **Card sizing restored** — the `.narrow` CSS modifier that capped the "Describe What You Need"
   / "Describe the Change" card at 480px inside an equal two-column grid (making it visibly
   smaller than the "Generated SQL" card next to it) has been removed. Both cards render at equal,
   symmetric widths again.
2. **GitHub sync no longer rejects validly imported schemas** — the schema validator now requires
   only that a column's data type be *present*, not that it match a narrow 5-value UI list (e.g.
   `VARCHAR2`, `INTEGER`, `BOOLEAN`, `CLOB`, `TIMESTAMP(6)` are all accepted). Schema import now
   validates *before* saving/syncing, using the exact same check used for remote files, so a
   schema accepted on import is guaranteed to also pass on the next pull.
3. **Sync error indicator hidden when there is no error** — a nullable `lastError` state is set
   only by explicit user actions (Sync Now / Push / Pull) and cleared the instant a later one
   succeeds; silent background/auto-discovery checks never set it.

See `docs/CHANGELOG_V16.1.md` for the full technical detail behind each fix.

## Verification performed on this rebuild

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit tests (`npm test`) | 9/9 passed, including 3 tests specifically targeting Fix #2 |
| Browser smoke test (`python3 scripts/smoke_test.py`) | All checks passed: equal card widths on both builder pages (Fix #1), a schema with non-enum data types (`INTEGER`, `VARCHAR2`, `BOOLEAN`, `CLOB`) imports successfully through the real file-upload UI with a visible success message (Fix #2), the error indicator is absent with no active error (Fix #3), the CR builder's mandatory-WHERE safeguard still blocks a WHERE-less DELETE, Error Rectifier still works, Settings still unlocks with the default password |

## Why this rebuild was necessary

The development sandbox used to build this project does not persist files between separated
turns of conversation — each time significant time passes, the working project files are lost and
must be reconstructed from the source recorded in this chat history. This rebuild reproduces the
V16.1 codebase file-for-file from that record, then re-runs the full verification suite (type
-check, unit tests, browser smoke test) to confirm the rebuild is faithful before packaging.
