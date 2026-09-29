# AP-SQL Assistant — V16.3

**Baseline:** V16.2. **Scope of this release:** one root-cause fix — see
`docs/CHANGELOG_V16.3.md` for full detail. No other behaviour was changed.

## Run it

Open **`dist/index.html`** directly (double-click — it works fully offline from disk), or host the
same file on any static web server / GitHub Pages / SharePoint. It is a single self-contained HTML
file with CSS and JavaScript bundled inline (via esbuild) — no build step, no server, no
dependencies at rest.

To rebuild from source:
```
npm run typecheck   # tsc --noEmit — 0 errors
npm run build       # esbuild bundle -> dist/index.html
npm test            # 11/11 engine + regression-fix tests
python3 scripts/smoke_test.py   # real headless-Chromium smoke test — all checks pass
```

## What changed in V16.3

**Root-cause fix:** GitHub sync recurrently failed with "Remote schema file failed
validation" even after V16.1's fix. Two independent causes were found and fixed:

1. **Validate-before-sanitize ordering bug.** The remote/pull path validated the raw,
   freshly-parsed JSON *before* filling in safe defaults for missing optional fields —
   unlike the local import path, which always sanitized first. Since `JSON.stringify`
   silently drops keys with `undefined` values, a column whose `type` was genuinely
   missing arrived over the wire with no `type` key at all, and was wrongly rejected on
   the remote path even though the identical data would have been accepted locally. The
   remote path now sanitizes first, exactly like local import always did.
2. **Referential-integrity drift treated as fatal.** A single dangling foreign-key
   reference or duplicate column anywhere in a schema used to fail the *entire* registry.
   These are now non-blocking warnings — visible and fixable, but no longer capable of
   halting sync for everyone over one small piece of metadata drift.

See `docs/CHANGELOG_V16.3.md` for the full technical explanation and how each fix was
verified, including a real end-to-end browser test that reproduces both original
conditions simultaneously and confirms the import now succeeds.

## What earlier releases already fixed (carried forward unchanged)

- **V16.2:** Every transient error/status box (Settings password, schema-name modal,
  delete confirmation) is only ever inserted into the page when there is an actual active
  error, rather than being permanently present and CSS-toggled.
- **V16.1:** Card sizing restored on the Query Builder pages; GitHub sync widened to
  accept real-world data types beyond the original 5-value UI enum.

**Everything else — Query Builder, Manual Selectors, CASE functionality, Advanced
Options, the CR Query Builder's mandatory-WHERE safeguard, Manual Schema Update, Schema
Management, M365 Copilot integration, Offline NLP, the Secret Vault, GitHub sync
architecture, the navbar, colours, themes, and every other button — is unchanged.**

## Verification performed

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit tests | 11/11 passed, including 5 new tests specifically targeting both V16.3 root causes |
| Real headless-Chromium smoke test | A schema with a genuinely-missing data-type key AND a dangling FK reference (the exact combination that caused the recurring bug) imports successfully through the real upload UI with a clear success message; equal card widths; the password error box stays empty until a real error occurs; the CR builder's WHERE safeguard works; Error Rectifier works |
