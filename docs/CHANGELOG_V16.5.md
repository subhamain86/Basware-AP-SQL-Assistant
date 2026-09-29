# V16.5 — Active Schema Sync: root-cause fix for the "still different on two devices" report

Baseline: V16.4. Trigger: "Active schema is different in two devices" — reported as still
broken even after the V16.4 fix that was supposed to have resolved this permanently.

## Why the V16.4 fix did not fully resolve this

V16.4 correctly identified that the Active Schema selection needed its own version
pointer to be comparable across devices, and built the right last-write-wins comparison
logic for it (`shouldApplyRemoteActiveSchema()`). It applied that comparison in exactly
one place: `pullRegistryFromGitHub()` — the **authenticated** pull path.

That path only ever runs once a user has manually entered the Admin Password to unlock
Settings **in that browser session**. Settings' unlocked state is intentionally
session-only and is never persisted across a page reload — so on every fresh page load,
Settings starts locked again, and the authenticated pull path simply never executes
unless someone deliberately opens Settings and unlocks it.

In practice, almost nobody does that just to browse tables or run a query — most users
only ever interact with Read Only Query Builder, the CR Builder, or the Schema page
directly. Meanwhile, **schema content itself** has synchronized automatically and
silently on every single app load since V16.3, via a completely separate,
**unauthenticated**, public, read-only GitHub check (`discoverPublicRegistry()`) that
requires no password and no Settings interaction at all. V16.4 never extended that same
silent check to also carry the Active Schema pointer — so schemas themselves kept
synchronizing invisibly in the background, while which one was "Active" simply never
did, for the overwhelming majority of real usage.

## The fix

`syncService.discoverPublicRegistry()` — the same silent, unauthenticated, read-only
GitHub check that already runs unconditionally on every app load (see `appShell.ts`) and
already merges in schema content — now also calls the exact same
`syncActiveSchemaPointer()` last-write-wins comparison the authenticated pull path uses,
in the same order (schema-content merge first, so the referenced schema is guaranteed to
already exist locally before it's ever activated). No new credential, permission, or
trust boundary is introduced: this is the identical public GitHub read that was already
silently keeping the schema catalogue in sync, now also carrying the one additional field
(`activeSchemaId` + `activeSchemaUpdatedAt`) that was previously left out of that path by
oversight.

The existing safety guarantee from V16.4 is fully preserved: a remote Active Schema
selection is still only ever applied when it is strictly newer than the local one (or
when the local device has never explicitly set one), so an intentional local choice can
never be silently overwritten by a stale remote pointer — only made consistent with a
genuinely more recent choice made elsewhere.

## A second, related bug found and fixed during verification

While writing the browser-based regression test for this fix, a live smoke test
uncovered a genuine hang: **GitHub API calls (`getFile`/`putFile`) had no request
timeout.** In a sandboxed, no-egress test environment (and, just as importantly, on any
real network where a firewall or proxy silently drops outbound connections to GitHub
instead of actively refusing them), the browser's `fetch()` call can hang for a very long
time — well beyond what any user would wait — before failing. Concretely, this meant
`secretVaultService.tryAutoUnlock()` (which runs the instant a user enters the correct
Admin Password to unlock Settings) could hang the **entire Settings-unlock flow**
indefinitely under exactly these conditions, which in turn silently prevents the
authenticated Schema Sync / Active Schema Sync path from ever completing.

**Fix:** every GitHub network call (`getFile` and `putFile` in `githubApiService.ts`) now
uses an `AbortController` with an 8-second timeout, matching the pattern already used
elsewhere in the codebase (`onlineNlpService.ts`, `copilotNlpService.ts`). A network
failure — whether outright unreachable, CORS-blocked, or silently dropped by a firewall —
now fails fast with a clear, catchable error instead of hanging, so the existing
bootstrap/fallback logic (e.g. "no vault found remotely, create a fresh local one
instead") can proceed immediately rather than stalling the whole Settings screen.

## Verified

- Two of the new unit tests directly exercise `shouldApplyRemoteActiveSchema()` for the
  specific last-write-wins scenarios that make cross-device sync work (adopt when local
  has no timestamp yet; adopt when remote is strictly newer; never adopt when remote is
  older).
- A new unit test asserts, directly against the source of `discoverPublicRegistry()`,
  that it now calls `syncActiveSchemaPointer()` **and** that this happens **after**
  `applyMerge()` — i.e. it verifies the actual code-level fix is present and correctly
  ordered, not just that the underlying comparison function is correct in isolation.
- A live headless-Chromium smoke test confirmed: Settings now unlocks reliably (the
  GitHub-call timeout fix was required for this to complete inside a bounded wait rather
  than hanging); the Schema Management UI copy now correctly describes Active Schema
  sync working without needing to unlock Settings; Active Schema switching still works
  correctly through the real UI; the M365 Copilot Enterprise section is still present and
  correctly configured; schema import still works end-to-end; card sizing/layout are
  unchanged; the CR builder's mandatory-WHERE safeguard and Error Rectifier both still
  work; no unexpected console errors (the CORS-blocked GitHub calls visible in the
  console are expected in this sandboxed test environment and are the same calls that
  succeed on a real, permitted network).
- 12/12 unit tests pass, type-check clean.

No UI, layout, workflow, or other feature was changed. This release touches exactly two
files' logic: `syncService.ts` (the pointer-sync fix) and `githubApiService.ts` (the
timeout fix), plus their corresponding tests and documentation.
