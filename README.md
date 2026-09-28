# AP-SQL Assistant — V16.1

**Baseline:** V16.0. **Scope of this release:** three targeted regression fixes only —
see `docs/CHANGELOG_V16.1.md` for full detail on each. No features were added or removed,
and no unrelated behaviour was changed.

## Run it

Open **`dist/index.html`** directly (double-click — it works fully offline from disk), or
host the same file on any static web server / GitHub Pages. It is a single
self-contained HTML file with CSS and JavaScript bundled inline (via esbuild) — no build
step, no server, no dependencies at rest.

To rebuild from source:
```
npm run typecheck   # tsc --noEmit — 0 errors
npm run build       # esbuild bundle -> dist/index.html
npm test            # 9/9 engine + regression-fix tests
python3 scripts/smoke_test.py   # real headless-Chromium smoke test — all checks pass
```

## What changed in V16.1 (and only this)

1. **Card sizing restored.** The "Describe What You Need" / "Describe the Change" card
   on the Read Only Query Builder and CR Builder pages had picked up an extra CSS
   modifier that capped it at 480px wide inside an otherwise-equal two-column grid,
   making it visibly smaller than the "Generated SQL" card next to it. That modifier is
   removed; both cards now render at equal, symmetric widths again. No other card
   dimension, spacing, padding, or control position changed.

2. **GitHub sync no longer rejects validly imported schemas.** A schema import
   containing real-world data types (e.g. `VARCHAR2`, `INTEGER`, `BOOLEAN`, `CLOB`,
   `TIMESTAMP(6)`) could previously sync successfully to GitHub and then fail on the very
   next pull with "Remote schema file failed validation" — because the validator only
   accepted five internal UI dropdown type names. The validator now requires only that a
   data type be present, not that it match that narrow list, and schema import now
   validates *before* saving/syncing (matching the required Import → Validate → Save →
   Sync workflow) using the exact same check used for remote files — so what passes on
   import is guaranteed to pass on the next pull, on this device or another. No imported
   data (names, descriptions, types, relationships, aliases, CASE/DECODE) is stripped or
   altered by this fix.

3. **The sync error indicator is hidden when there is no error, and clears itself after
   a successful sync.** It now reflects one explicit, nullable error state that is set
   only by explicit user actions (Sync Now / Push / Pull) and cleared the instant a later
   one of those succeeds — never shown for the silent, automatic background checks that
   already ran (and already failed silently) in V16.0.

**Everything else — Query Builder, Manual Selectors, CASE functionality, Advanced
Options, the CR Query Builder's mandatory-WHERE safeguard, Manual Schema Update (beyond
the import-validation ordering above), Schema Management, M365 Copilot integration,
Offline NLP, the Secret Vault, GitHub sync architecture, the navbar, colours, themes, and
every other button — is unchanged from V16.0.**

See `docs/CHANGELOG_V16.1.md` for the full technical detail and verification results,
`docs/CONFIGURATION.md` for M365 Copilot Enterprise setup (unchanged from V16.0), and
`docs/PROVENANCE.md` for baseline notes.

## Verification performed

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit tests | 9/9 passed |
| Real headless-Chromium smoke test | All checks passed: equal card widths on both builder pages, a schema with non-enum data types imports successfully through the real upload UI with a visible success message, the error indicator is absent with no active error, the CR builder's WHERE safeguard still works, Error Rectifier still works, Settings still unlocks with the default password |
