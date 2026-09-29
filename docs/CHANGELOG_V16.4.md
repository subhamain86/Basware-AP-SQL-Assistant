# V16.4 — Cross-Device Schema Sync Fix + M365 Copilot Enterprise Integration

Baseline: V16.3. Scope: exactly the two areas requested — (1) Schema and Active Schema
synchronization across devices, and (2) M365 Copilot Enterprise / enterprise AI access
for Describe What You Need, with the offline NLP engine preserved as a fully functional
fallback. Nothing else was changed.

## 1. Schema Sync and Active Schema Sync across devices — root cause and fix

Two independent, previously-undiagnosed bugs were found in the synchronization
architecture. Both are now fixed at the service layer only — no UI, layout, or workflow
changes were needed or made.

### Bug A — pushing to GitHub was a blind overwrite, so a schema could vanish

`pushRegistryToGitHub()` previously serialized **only** the local schema registry and
unconditionally overwrote the remote file with it. If Device B had already pushed a new
or updated schema that Device A had never pulled, Device A's very next push would
silently erase Device B's schema from the central store — with no error, no warning, no
indication anything had gone wrong. This is very likely the root cause of "a schema may
exist and be saved on one device, but the same schema is not reliably available on
another device."

**Fix:** before building the outgoing payload, `pushRegistryToGitHub()` now fetches the
current remote file first (using the same credentials already required for the push) and
merges it in:
- Any schema that exists remotely but not locally is pulled into the local registry
  first (via the existing `schemaService.addSchemaFromRemote()`), so it can never again
  be silently dropped by an overwrite.
- If a schema exists on both sides with genuinely different content, the push is
  deferred and the existing conflict-resolution UI (Schema Management's "Use Local / Use
  Remote" banner) is populated instead of either side blindly winning. No new
  conflict-resolution mechanism was introduced — the existing one is now also reachable
  from a push attempt, not just from a pull.
- Only once this reconciliation is safely complete does the (now-merged) local registry
  get written to GitHub.

### Bug B — the Active Schema selection was never synchronized at all

Every individual schema already carries its own version metadata (a checksum) so its
*content* can be compared across devices — but which schema was **Active** was stored as
a bare ID with no timestamp of any kind attached to it anywhere. Without a way to compare
"is this incoming Active Schema selection newer or older than mine," the pull logic
never touched it — Active Schema sync did not exist as a feature at all, by design
omission, not by malfunction.

**Fix:** the schema registry now pairs `activeSchemaId` with a new
`activeSchemaUpdatedAt` timestamp, stamped fresh every time a user explicitly switches
the Active Schema (`schemaService.switchActiveSchema()`). A new pure function,
`shouldApplyRemoteActiveSchema()`, applies the same last-write-wins comparison already
used for individual schema versions to this pointer:
- A device that has never explicitly set an Active Schema (a brand-new install, or
  local data saved before this release) always adopts the remote selection.
- A remote selection is applied **only if it is strictly newer** than the local one —
  this is what guarantees "the Active Schema must not unexpectedly revert to another
  schema simply because the application is opened on another device": a revert can only
  ever happen when the incoming selection is demonstrably more recent.
- This is applied on the fully authenticated pull path (matching the requested
  Authentication → Discover → Synchronize → Retrieve Active Schema → Set Active Schema
  workflow) and, safely, during the pre-push merge step above — but deliberately **not**
  during the silent, unauthenticated, pre-login background discovery check, to avoid any
  pre-authentication state silently changing the Active Schema.

### Also fixed along the way

- Push failures now surface the **specific** reason (e.g. which schemas have unresolved
  conflicts) rather than only a generic message.
- The V15.6/V15.7 requirement — Manual Schema Update writes back only the single edited
  row, leaving every other row and table untouched in memory before the (safe, merged)
  registry is persisted — was re-confirmed intact; nothing about this fix changes that
  behavior.
- The V16.3 fix (sanitize-then-validate ordering, referential-integrity issues as
  warnings not errors) is preserved and reused by the new pre-push merge step, so "Remote
  schema file failed validation" cannot reappear as a side effect of this change.
- "Do not display an error box when synchronization succeeds" (V16.2) is preserved: the
  sync error indicator is still only ever inserted into the page when there is an actual
  active error.

## 2. M365 Copilot Enterprise Integration for Describe What You Need

This was already fully implemented in the codebase (since an earlier release) and is
carried forward in this rebuild unchanged, since it already satisfies every requirement
in this prompt:
- **Enterprise authentication (#9):** Microsoft identity platform v2.0 Authorization
  Code + PKCE flow — no client secret, no hard-coded or stored username/password, no
  undocumented/private Copilot endpoint. Configured entirely via an organization's own
  Entra ID app registration and Copilot Studio/declarative-agent endpoint (Settings →
  Secret Vault).
- **Offline NLP fully preserved (#10):** priority order is M365 Copilot Enterprise (if
  enabled and reachable) → generic Online AI/NLP Endpoint (if configured) → offline
  engine. If Copilot is unavailable for any reason (not configured, sign-in fails,
  network error, disabled), the app falls back to the offline engine automatically and
  unconditionally — no configuration required for the fallback to work.
- **Active Schema as source of truth (#11):** anything Copilot (or any online engine)
  suggests that is not an actual table/column in the Active Schema is discarded before
  SQL generation ever sees it (`filterToKnownTables` / `filterToKnownColumns`).
- **SQL generation capability (#12):** unchanged — the existing offline SQL engine
  (joins, WHERE/AND/OR/IN/BETWEEN/LIKE/NULL checks, DISTINCT, aggregations, GROUP
  BY/HAVING, ORDER BY, LIMIT/TOP/FETCH, CASE, WITH/CTEs, aliases, calculated fields)
  remains the mechanism that actually produces and validates SQL, regardless of which
  NLP tier supplied the interpretation.
- **Minimal schema context to the external service (#13):** `buildMinimalSchemaContext()`
  sends only a relevance-scored subset of tables/columns to Copilot — never the whole
  schema. The Active Schema remains locally authoritative for all resolution/validation.
- **Security (#14):** the GitHub token and any M365 Copilot credentials are stored only
  as AES-256-GCM ciphertext in the existing Secret Vault, masked in the UI, and never
  written to the repository, source code, generated SQL, or console/logs. The Copilot
  access token itself lives only in `sessionStorage` for the current tab.

## Regression testing performed

| Area | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Unit tests (`npm test`) | 16/16 passed, including 9 new tests specifically targeting both V16.4 sync-fix root causes (schema merge planning: add/unchanged/conflict; Active Schema pointer arbitration: 6 last-write-wins scenarios) |
| Real headless-Chromium smoke test | Navbar/card sizing/layout unchanged; Active Schema switching still works correctly through the real Schema Management UI; M365 Copilot Enterprise Integration section present and its fields render in Secret Vault; schema import still works end-to-end; CR builder's mandatory-WHERE safeguard still blocks a WHERE-less DELETE; Error Rectifier still works; the password error box remains genuinely empty until a real error occurs; no unexpected console errors |
| Manual re-read against V16.3 | Query Builder, Manual Selectors, Manual Schema Update UI (including the per-row update guarantee), CASE functionality, Error Rectifier, Secret Vault architecture, navbar, theme, card layout — all unchanged outside the specific service-layer files described above |

No other files, features, or UI/UX behavior were touched.
