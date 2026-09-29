# AP-SQL Assistant — V16.4

**Baseline:** V16.3. **Scope of this release:** exactly two areas — see
`docs/CHANGELOG_V16.4.md` for full detail. No other behaviour, UI, layout, or workflow
was changed.

## Run it

Open **`dist/index.html`** directly (double-click — it works fully offline from disk), or host the
same file on any static web server / GitHub Pages / SharePoint. It is a single self-contained HTML
file with CSS and JavaScript bundled inline (via esbuild) — no build step, no server, no
dependencies at rest.

To rebuild from source:
```
npm run typecheck   # tsc --noEmit — 0 errors
npm run build       # esbuild bundle -> dist/index.html
npm test            # 16/16 engine + regression-fix tests
python3 scripts/smoke_test.py   # real headless-Chromium smoke test — all checks pass
```

## What changed in V16.4

### 1. Schema Sync + Active Schema Sync across devices — fixed

Two independent root causes were found and fixed, purely at the service layer (no UI
changes):

- **Push was a blind overwrite.** Pushing to the central GitHub repository previously
  serialized only the local schema list, so a schema that existed only on another device
  could be silently dropped from the repository the next time this device pushed. Pushes
  now always fetch and merge in anything remote-only first; if a schema has genuinely
  diverged on both sides, the push defers to the existing conflict-resolution UI instead
  of guessing a winner.
- **The Active Schema selection was never synchronized at all.** It had no version or
  timestamp of its own to compare across devices. It now does — using the exact same
  last-write-wins approach already used for individual schema content — so Active Schema
  choices propagate correctly across devices without ever unexpectedly reverting an
  intentional local selection (a remote choice is only ever applied when it is
  demonstrably more recent).

### 2. M365 Copilot Enterprise Integration for Describe What You Need

Already implemented and carried forward unchanged in this rebuild — it already satisfies
every requirement: Microsoft identity platform (PKCE, no stored credentials) sign-in,
unconditional offline-engine fallback if Copilot is unavailable, the Active Schema as the
sole authority for what tables/columns/joins exist (Copilot can never invent one), only a
minimal relevant subset of the schema sent externally, and all secrets kept encrypted in
the existing Secret Vault, never exposed anywhere.

See `docs/CHANGELOG_V16.4.md` for the full technical explanation, including exactly how
each fix was verified.

## What earlier releases already fixed (carried forward unchanged)

- **V16.3:** "Remote schema file failed validation" recurrence fixed (sanitize-before-
  validate ordering; referential-integrity drift downgraded to non-blocking warnings).
- **V16.2:** every transient error/status box is only ever inserted into the page when
  there is an actual active error, rather than being permanently present and CSS-toggled.
- **V16.1:** card sizing restored on the Query Builder pages; GitHub sync widened to
  accept real-world data types beyond the original 5-value UI enum.

**Everything else — Query Builder, Manual Selectors, CASE functionality, Advanced
Options, the CR Query Builder's mandatory-WHERE safeguard, Manual Schema Update (including
the per-row-only update guarantee), Schema Management, Offline NLP, the Secret Vault,
GitHub sync architecture (beyond the specific merge/pointer fix above), the navbar,
colours, themes, and every other button — is unchanged.**

## Verification performed

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit tests | 16/16 passed, including 9 new tests specifically targeting both V16.4 sync-fix root causes |
| Real headless-Chromium smoke test | Navbar/card sizing/layout unchanged; Active Schema switching still works correctly through the real UI; M365 Copilot Enterprise section present in Secret Vault; schema import still works end-to-end; CR builder's WHERE safeguard works; Error Rectifier works; password error box stays empty until a real error occurs |
