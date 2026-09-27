# SQL Assistant — V14.5

A focused stability, synchronization, schema persistence, AI/NLP, and Select Columns upgrade to V14.3. **All
existing V14.3 functionality, UI, Query Builder logic, NLP engine, schema management, Secret Vault, GitHub
integration, and synchronization functionality are preserved — nothing was redesigned or removed.**

## Just want to open it? `dist/index.html`

Fully self-contained (~245 KB, zero external references). Double-click it — no server, no build step. Verified
via `file://` in a real headless browser: **zero real console errors, zero page errors** across 18 targeted tests.

## 1-2, 4, 11. Cross-Device Schema Synchronization — no manual Pull Request

`autoSyncService.ts` (`performDiscovery()`) implements the exact required flow: Start SQL Assistant → Unlock/
authenticate Secret Vault → Connect to shared repository → Check latest schema catalogue → Retrieve available
schemas → Synchronize local schema catalogue → Display schemas. This runs automatically the moment Settings/Vault
is unlocked, and again on mount of the Read Only builder and Schema pages ("before opening Schema selection").
Every schema mutation (create/import/update/rename) triggers a debounced automatic push in the background. Manual
"Sync Now" buttons remain as an explicit, reassuring fallback — never a requirement. The **one** unavoidable
manual step is entering the Admin Password once per session to unlock Settings — that is the actual security
boundary and can't be bypassed without abandoning authentication.

## 3. Admin-Customized Schema Name

A dedicated naming modal (`schemaNameModal.ts`) is shown for both **Add Schema** and **Import Schema** — the
schema name is never silently taken from an uploaded filename. Validated live for syntax and uniqueness via
`schemaService.validateNewSchemaName()`. The original filename is preserved separately as `originalFileName`
(provenance/audit only) and never used for the schema's identity.

## 5-7. Secret Vault Cross-Device Sync — never plaintext

On a **brand-new machine**, unlocking Settings with the Admin Password automatically fetches the encrypted vault
blob (AES-GCM ciphertext, PBKDF2-derived key — never plaintext) from the shared repository via an unauthenticated
read (the bootstrap repo is public, breaking the chicken-and-egg problem), decrypts it locally, and the same
GitHub token configured on the first machine is now available — automatically. The token is always shown masked
in the UI (`••••••••••••abcd`).

## 8-10. Synchronization Error — root cause found and fixed

**Root cause:** `JSON.stringify()` silently drops any object property whose value is `undefined` (standard JS
behavior). A Secret Vault config saved by an earlier code path, or where a field was momentarily `undefined`,
could round-trip through `localStorage`/the repository missing that key — even though its TypeScript type claims
the field is always a `string`. TypeScript enforces nothing at runtime, so `cfg.someField.trim()` would throw
exactly the reported error.

**The fix — a single comprehensive gate, not scattered patches:**
- **`utils/validation.ts` → `assertSyncConfigOrError()`** — checks every named sync-relevant field (Schema Name,
  Repository, Branch, Repository Path, Access Token, Vault config) **before** any value is touched, and returns
  one aggregated, human-readable message naming exactly which field is missing — **never** the value (critical
  for the access token). Matches the spec's own example message format exactly: *"Repository synchronization
  configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: Access Token."*
- **`safeString`/`safeTrim`** — never throw regardless of what's actually passed at runtime; used as
  defense-in-depth throughout `githubApiService.ts` and `secretVaultService.ts`.
- Tested explicitly with missing schema name, missing repository config, missing branch, missing path, missing
  Vault config, invalid configuration, and valid configuration — **zero unhandled JavaScript errors** in every
  case.

## 12-16. Online AI/NLP — Active Schema is mandatory

`nlpOrchestrator.ts` runs the exact required flow: Load Saved Active Schema → **Validate Active Schema
availability** (explicit step, `validateActiveSchemaAvailability()`) → Extract relevant schema metadata → Send
Natural Language + Schema Context → Online AI/NLP → Generate SQL → **Validate SQL against Active Schema** → Display
SQL. Rich schema context (modules, tables, columns, types, descriptions, PK/FK, relationships, decode definitions,
views) is sent to the endpoint; anything it returns is strictly filtered against the Active Schema before use. An
independent engine (`sqlSchemaValidator.ts`) performs one final pass over the **assembled SQL text itself**,
catching any invented table/column reference regardless of where it entered the pipeline. Switching Active Schema
takes effect on the very next request automatically — there is no caching to invalidate.

## 17-20. Select Columns — search (re-verified) + Select All

The static-shell pattern was audited one more time given repeated reports: the search `<input>` and the **Select
All** checkbox are both part of a shell rendered exactly once — every interaction only replaces `.picker-list`'s
innerHTML, so the search box never loses focus and the page never refreshes. **Select All** always operates on
every real column across the selected table(s), completely **ignoring** the current search filter (per the
spec's own recommended behavior) — and never resets an already-selected column's Alias/CASE/DECODE configuration.

## 21. Synchronization and Query Builder Independence

Repository synchronization only ever calls `schemaService`'s change notification, which triggers a targeted SQL
regeneration in `state/store.ts` using whatever the **current** selections already are — it only prunes
references to tables that literally no longer exist. Verified: selecting tables/columns, navigating away, and
navigating back preserves the full query state (selected tables, columns, CTEs, filters) with no reset.

## Verified before packaging (real browser tests, not just compilation)

- `tsc --noEmit`: 0 errors · `vite build`: clean
- Settings unlock with default password `admin` succeeds with **zero** `undefined.trim()` crash
- Secret Vault confirmed auto-unlocking; token always masked, never plaintext
- Missing-config validation message confirmed naming the exact field ("Access Token") with **no** "undefined"
  anywhere in the text
- Synchronization Activity Log confirmed present and recording events in real time
- Schema naming modal confirmed opening for Add Schema; custom name confirmed used and displayed; duplicate name
  correctly rejected with a clear message
- Select Columns: search confirmed filtering (partial + case-insensitive) without losing input focus; Select All
  confirmed selecting every column regardless of the active search filter
- Automatic bridge joins, View chip, description-aware NLP with schema audit line all re-verified intact
- **Zero real console errors, zero page errors** across the entire test run

## Demo credentials

Admin Password: `admin` (used internally only — never shown in the UI). This same password automatically unlocks
(or bootstraps, on a brand-new machine) the Secret Vault.
