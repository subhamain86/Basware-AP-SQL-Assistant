# AP-SQL Assistant — V16.1.1

**This is a rebuild/re-delivery of V16.1** — no functional changes beyond V16.1's three
regression fixes. See `docs/CHANGELOG_V16.1.1.md` for why this rebuild was necessary, and
`docs/CHANGELOG_V16.1.md` for the full technical detail of the three fixes themselves.

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

## What's included (V16.1 fixes, carried forward unchanged)

1. **Card sizing restored.** The "Describe What You Need" / "Describe the Change" card
   on the Read Only Query Builder and CR Builder pages had picked up an extra CSS
   modifier that capped it at 480px wide inside an otherwise-equal two-column grid,
   making it visibly smaller than the "Generated SQL" card next to it. That modifier is
   removed; both cards now render at equal, symmetric widths again.

2. **GitHub sync no longer rejects validly imported schemas.** A schema import
   containing real-world data types (e.g. `VARCHAR2`, `INTEGER`, `BOOLEAN`, `CLOB`,
   `TIMESTAMP(6)`) could previously sync successfully to GitHub and then fail on the very
   next pull with "Remote schema file failed validation" — because the validator only
   accepted five internal UI dropdown type names. The validator now requires only that a
   data type be present, not that it match that narrow list, and schema import now
   validates *before* saving/syncing using the exact same check used for remote files.

3. **The sync error indicator is hidden when there is no error, and clears itself after
   a successful sync.** It now reflects one explicit, nullable error state that is set
   only by explicit user actions (Sync Now / Push / Pull) and cleared the instant a later
   one of those succeeds — never shown for silent, automatic background checks.

**Everything else — Query Builder, Manual Selectors, CASE functionality, Advanced
Options, the CR Query Builder's mandatory-WHERE safeguard, Manual Schema Update (beyond
the import-validation ordering above), Schema Management, M365 Copilot integration,
Offline NLP, the Secret Vault, GitHub sync architecture, the navbar, colours, themes, and
every other button — is unchanged.**

See `docs/CONFIGURATION.md` for M365 Copilot Enterprise setup and `docs/PROVENANCE.md` for
the full history of this package across rebuilds.

## Verification performed on this build

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit tests | 9/9 passed |
| Real headless-Chromium smoke test | All checks passed: equal card widths on both builder pages, a schema with non-enum data types imports successfully through the real upload UI with a visible success message, the error indicator is absent with no active error, the CR builder's WHERE safeguard still works, Error Rectifier still works, Settings still unlocks with the default password |
