# AP-SQL Assistant — V16.5

**Baseline:** V16.4. **Scope of this release:** one root-cause fix (Active Schema still
not syncing across devices) plus one robustness fix uncovered while verifying it (GitHub
network calls could hang indefinitely with no timeout). See
`docs/CHANGELOG_V16.5.md` for full detail. No other behaviour, UI, layout, or workflow
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
npm test            # 12/12 engine + regression-fix tests
python3 scripts/smoke_test.py   # real headless-Chromium smoke test — all checks pass
```

## What changed in V16.5

### 1. Active Schema Sync — actual root cause found and fixed

V16.4 built the right last-write-wins comparison logic for the Active Schema pointer,
but only wired it into the **authenticated** GitHub pull path — which only runs once a
user manually unlocks Settings with the Admin Password **in that session** (that unlock
state resets on every page reload). Since most real usage never touches Settings at all,
Active Schema sync effectively never fired, even though schema *content* had already
been synchronizing silently on every app load since V16.3 via a separate, unauthenticated
background check. The fix extends that same silent, no-login background check to also
carry the Active Schema pointer — no new credential or trust requirement, just closing an
oversight where one field was left out of a sync path that already handled everything
else.

### 2. GitHub network calls could hang indefinitely — found during verification

While writing the regression test for the fix above, live testing surfaced a real bug:
GitHub API calls had no request timeout, so on a restricted or unreachable network, the
entire Settings-unlock flow (and therefore the authenticated sync path) could hang far
longer than any user would wait. Every GitHub call now aborts after 8 seconds and fails
fast with a clear error instead, matching the timeout pattern already used elsewhere in
the app.

See `docs/CHANGELOG_V16.5.md` for the full technical explanation and how each fix was
verified.

## What earlier releases already fixed (carried forward unchanged)

- **V16.4:** Schema Sync push no longer silently drops a schema that only exists on
  another device (merge-before-push).
- **V16.3:** "Remote schema file failed validation" recurrence fixed.
- **V16.2:** Transient error boxes only ever appear when there's an actual active error.
- **V16.1:** Card sizing restored; GitHub sync accepts real-world data types.

**Everything else — Query Builder, Manual Selectors, CASE functionality, Advanced
Options, the CR Query Builder's mandatory-WHERE safeguard, Manual Schema Update (including
the per-row-only update guarantee), Schema Management, Offline NLP, M365 Copilot
Enterprise integration, the Secret Vault, the navbar, colours, themes, and every other
button — is unchanged.**

## Verification performed

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit tests | 12/12 passed, including tests that assert directly against the fixed source (that `discoverPublicRegistry()` now calls the pointer-sync logic, and in the correct order) |
| Real headless-Chromium smoke test | Settings now unlocks reliably; Schema Management UI correctly describes the no-login Active Schema sync; Active Schema switching still works through the real UI; M365 Copilot Enterprise section present; schema import works end-to-end; card sizing/layout unchanged; CR builder's WHERE safeguard and Error Rectifier both work; no unexpected console errors |

## An honest limitation

The deep cross-device network round-trip (two real GitHub-backed devices actually
exchanging an Active Schema selection) is verified here at the unit level against the
exact fixed logic and function-ordering, plus a live browser test of the surrounding UI —
but a live, two-device, real-network end-to-end confirmation isn't possible from this
sandbox, since outbound GitHub calls are blocked here by design. If you can, a quick
real-world check across two actual devices/browsers once deployed would be the final
confirmation.
