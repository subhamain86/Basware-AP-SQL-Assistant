# AP-SQL Assistant — V16.2

**Baseline:** V16.1.1. **Scope of this release:** one root-cause fix — see
`docs/CHANGELOG_V16.2.md` for full detail. No other behaviour was changed.

## Run it

Open **`dist/index.html`** directly (double-click — it works fully offline from disk), or host the
same file on any static web server / GitHub Pages / SharePoint. It is a single self-contained HTML
file with CSS and JavaScript bundled inline (via esbuild) — no build step, no server, no
dependencies at rest.

To rebuild from source:
```
npm run typecheck   # tsc --noEmit — 0 errors
npm run build       # esbuild bundle -> dist/index.html
npm test            # 10/10 engine + regression-fix tests
python3 scripts/smoke_test.py   # real headless-Chromium smoke test — all checks pass
```

## What changed in V16.2

**Root-cause fix:** the Settings password error box (and two related dialogs) could still show a
red "error" state with no actual error, even after V16.1.1's CSS fix. The previous fix depended on
one specific CSS rule always being in effect — a real risk if this file is viewed through a cached
copy, or through any wrapping viewer/portal that reinjects its own stylesheet.

V16.2 removes that dependency entirely: the password error box, the schema-name modal's error box,
and the delete-confirmation dialog's error box are now **never inserted into the page at all**
until an actual error occurs, and are removed again the moment the condition that caused them is
corrected. An empty element cannot be displayed by any stylesheet, in any browser, in any
embedding context — this is not a CSS fix, it is the removal of the thing CSS was fighting with.

See `docs/CHANGELOG_V16.2.md` for the full technical explanation, including why the V16.1.1 fix,
while correct as far as it went, wasn't sufficient on its own.

## What earlier releases already fixed (carried forward unchanged)

1. **Card sizing restored** (V16.1) — the two top cards on the Query Builder pages render at
   equal widths again.
2. **GitHub sync no longer rejects validly imported schemas** (V16.1) — schemas with real-world
   data types (`VARCHAR2`, `INTEGER`, `BOOLEAN`, etc.) are validated before saving/syncing, using
   the same check used for remote files.
3. **The GitHub-sync error indicator** (V16.1) is hidden when there is no error and clears itself
   after a successful sync — this pattern is what V16.2 has now also applied to the remaining
   password/error dialogs.

**Everything else — Query Builder, Manual Selectors, CASE functionality, Advanced Options, the CR
Query Builder's mandatory-WHERE safeguard, Manual Schema Update, Schema Management, M365 Copilot
integration, Offline NLP, the Secret Vault, GitHub sync architecture, the navbar, colours, themes,
and every other button — is unchanged.**

## Verification performed

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit tests | 10/10 passed, including 3 new tests asserting the fragile pattern is gone from source |
| Real headless-Chromium smoke test | `#settingsPwError` confirmed **genuinely empty** (not merely CSS-hidden) on load; confirmed it populates on a real wrong password; confirmed it clears on edit; confirmed a clean unlock with no stray error box anywhere; equal card widths; schema import with non-enum data types succeeds; CR builder's WHERE safeguard works; Error Rectifier works |
