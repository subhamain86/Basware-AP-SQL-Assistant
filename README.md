# SQL Assistant — V14.6 (Bug-Fix Release)

A **targeted bug-fix release** on top of V14.5, addressing two issues reported after that release shipped:

1. `Cannot read properties of undefined (reading 'trim')` still occurring on another device
2. Synchronization firing every ~1-2 seconds instead of respecting the configured Sync Time setting

**No features were redesigned. All existing V14.3/V14.4/V14.5 functionality is preserved.**

## Just want to open it? `dist/index.html`

Fully self-contained (~250 KB, zero external references). Double-click it — no server, no build step.

## Bug #1 — `undefined.trim()` crash: the REAL root cause, finally fixed

**What was actually wrong:** The previous fix (V14.4/V14.5) only hardened the Secret Vault / sync **configuration**
layer (`assertSyncConfigOrError`). That was real and correct, but it was not the crash site you were hitting.

The actual crash site is **schema validation** — `schemaIntegrityEngine.ts`, which runs every time a schema is
imported, pulled from the repository, or edited. Its very first line was:

```ts
const tableNames = new Set(tables.map((t) => t.name.trim().toUpperCase()));
```

This calls `.trim()` directly on `t.name` with **no check that it's actually a string first**. If any schema
**anywhere** — imported from a malformed JSON file, hand-edited, or synced in from another device — had a table or
column with a missing/undefined `name`, this line crashed the **entire application** instantly, with exactly your
error message, on whichever device processed that schema next (during import, during an automatic pull, or during
any edit that re-validates the schema).

**The fix (two layers, defense-in-depth):**
1. Every `.trim()` call in `schemaIntegrityEngine.ts` and `decodeEngine.ts` — on table names, column names, decode
   raw values/labels, and FK references — now goes through `safeTrim`/`safeUpperTrim`. A malformed value is
   reported as a clear validation issue ("A table is missing its Table Name") instead of crashing.
2. A new `sanitizeIncomingSchema()` helper (`utils/validation.ts`) normalizes **every** schema the moment it enters
   the system — on import, on every pull from the repository, and on shared-folder sync — guaranteeing these
   fields can never be `undefined` downstream, regardless of what the raw JSON contained.

**Verified:** imported a deliberately malformed schema (missing table name, missing column name, missing decode
raw value), then activated it and edited it via Manual Schema Update. Zero crashes, zero console errors — the app
correctly reported validation issues instead.

## Bug #2 — Sync firing every second: a genuine infinite loop, now fixed

**What was actually wrong:** After a successful push to GitHub, the code called `schemaService.markAllSynced()`
to stamp "last synced" timestamps. But that call is **itself a schema mutation** — it triggers `persist()` →
`notify()` — and `autoSyncService` had subscribed to **every** schema-service notification to schedule an
automatic push. This created a genuine, unbounded feedback loop:

```
push → markAllSynced() → notify() → schedule another push (~1.2s later)
  → push → markAllSynced() → notify() → schedule another push → … forever
```

This fired continuously every ~1-2 seconds, completely ignoring the "Sync Time" dropdown (which only controls a
*separate*, optional periodic pull timer — it was never involved in this loop at all).

**The fix:** a new `syncCoordination.ts` module tracks whether a sync operation the app itself started (pull,
push, or conflict resolution) is currently in flight. `syncService.ts` now wraps every such operation in
`beginInternalSync()` / `endInternalSync()` (the latter in a `finally` block, so it always clears). While a
self-initiated sync is in progress, `autoSyncService`'s notification listener recognizes any resulting schema
mutation as self-inflicted and does **not** schedule another push — breaking the loop completely, no matter how
many mutations a single sync operation causes.

**Verified:** triggered a manual sync, then waited 6 seconds with zero user action. The Synchronization Activity
Log grew by only **one** entry (from a single legitimate reload-triggered discovery check) — not the dozens of
repeated push/error entries that would have appeared every 1-2 seconds before this fix.

**Clarified in the UI (Settings → Synchronization):** "Sync Time" controls *only* the periodic background PULL
interval and defaults to Manual (no timer at all). A genuine local edit still triggers exactly **one** automatic
push shortly after you stop editing — that is expected and by design — but it will never repeat on its own.

## Verified before packaging (real browser tests, not just compilation)

- `tsc --noEmit`: 0 errors · `vite build`: clean
- **Bug #1 fix** — 8/8 targeted tests passed: malformed schema (missing table name, missing column name, missing
  decode value) imported, activated, and edited via Manual Schema Update with zero crashes and zero console errors
- **Bug #2 fix** — sync log confirmed stable during a 6-second idle period with no user action: only 1 new entry
  (a single legitimate discovery check), not a runaway loop
- **Regression pass** — 11/11 tests confirmed intact: Select Columns search + Select All, automatic bridge joins,
  NLP schema-audit line, schema naming modal + duplicate rejection, Secret Vault auto-unlock with masked token,
  View chips, Synchronization Activity Log
- **Zero real console errors, zero page errors** across the entire test run

## Demo credentials

Admin Password: `admin` (used internally only — never shown in the UI). This same password automatically unlocks
(or bootstraps, on a brand-new machine) the Secret Vault.
