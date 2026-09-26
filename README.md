# AP-SQL Assistant — V13.2

An incremental, security- and intelligence-focused upgrade of V13.1. **No existing functionality was removed.**

## Just want to open it? `dist/index.html`

Fully self-contained (~175 KB, zero external `<script>`/`<link>` references). Double-click it — no server, no
build step. Verified via `file://` in a real headless browser with **zero console errors, zero page errors**
across an extensive test suite (see below).

## What's new in V13.2

- **Manual Schema Update moved exclusively into Settings** — no longer a top-level nav item. Reachable only after
  Settings authentication, exactly as specified.
- **Settings is password-protected** — selecting it always shows a lock screen first; only a correct password
  unlocks the full Settings UI for that session (with a 5-minute inactivity auto-lock, and an explicit "Lock
  Settings" button).
- **Genuine encryption at rest** — both the Settings password and the separate Vault Passphrase use
  **PBKDF2 (150,000 iterations) + AES-GCM authenticated encryption** via the browser's built-in Web Crypto API.
  No plaintext password is ever written to `localStorage`; verification works by attempting to decrypt a fixed
  marker, so a wrong password/passphrase fails cryptographically, not just via a string comparison.
- **A separate encrypted Vault** for sync credentials (GitHub repo/branch/token) — protected by its own
  user-chosen passphrase (no default ever hard-coded), with Create / Unlock / Lock / Change Passphrase / Reset,
  and an honest "lost passphrase = unrecoverable, only resettable" policy (no fake recovery flow).
- **Navbar redesigned to carry ONLY two Schema Sync dropdowns** — Sync Source (Shared Location / GitHub) and Sync
  Time (Manual through Custom). No Sync Now button, no repository/credentials in the navbar — all detailed
  configuration lives inside Settings → Synchronization, exactly as specified.
- **Schema versioning + conflict detection** — every save stamps a version/checksum/device-tag; a
  `detectConflict()` engine compares local vs. incoming schemas and reports exactly which table.column paths
  changed, rather than silently overwriting.
- **Enhanced NLP** — relative dates (today, yesterday, this/last week/month/year, "last N days"), AND/OR
  detection, a step-by-step **Query Plan** shown before SQL generation, and **clarification questions** when a
  phrase is ambiguous (e.g. multiple DATE columns could match "this month").
- **Natural-language CR parsing** — e.g. "Update the payment status to PAID for invoice 12345" is parsed into
  table/column/value/WHERE automatically in the CR Builder.
- **AI self-review** — every AI-generated SELECT is re-validated through the same read-only safety engine as
  manual/CR SQL before being shown to the user.

## Bugs found and fixed during this build (verified via real browser testing, not just compilation)

| Bug | Root cause | Fix |
|---|---|---|
| Relative-date SQL was wrapped in quotes, e.g. `>= 'DATE_TRUNC(''MONTH'', CURRENT_DATE)'` | `filterEngine`'s value-quoting didn't recognize raw SQL expressions | Added `SQL_EXPRESSION_PATTERN` detection for `CURRENT_DATE`, `DATE_TRUNC(`, `INTERVAL`, etc. — these now pass through unquoted |
| Settings silently reset to the "Security" tab immediately after any successful action (e.g. right after saving a schema row) | `appShell` re-rendered the *entire* Settings page on **every** store notification (including toasts) | Now only re-renders Settings when the lock state itself actually flips (locked ↔ unlocked) |
| A literal `<script>...</script>` tag was getting corrupted into the middle of the bundled JS | Minified code contained a variable literally named `$` followed by `&&`; JS's `String.replace()` interprets `$&` as "insert the matched substring" when the replacement argument is a *string* | Switched to function-based replacements (which never interpret `$`-patterns) plus a byte-identical verification check that now runs on every build |

## What's in this zip

```
apsql/
├── dist/index.html          ← Open this. Fully self-contained.
├── inline-build.mjs          ← The build-time inliner, with the $-pattern and </script fixes + verification
├── src/                      ← Full TypeScript source
│   ├── engines/               + schemaVersionEngine (NEW), crNlpEngine (NEW)
│   ├── services/               + cryptoService (NEW), passwordService (rewritten), vaultService (NEW), syncService (NEW)
│   ├── components/             hamburgerNav (redesigned: sync dropdowns, no Manual Schema Editor link)
│   └── pages/                  settingsPage (rewritten: lock gate + 6 tabs), schemaEditorSection (moved here)
├── package.json / tsconfig.json / vite.config.ts
└── README.md
```

## Verified before packaging (real browser tests, not just compilation)

- `tsc --noEmit`: 0 errors · `vite build`: clean
- Navbar: only Sync Source + Sync Time dropdowns present, no other sync controls
- Settings: wrong password rejected, correct password unlocks, stays unlocked across in-session navigation, locks
  via button, password never in plaintext in `localStorage`
- Manual Schema Update (inside Settings): Add/Edit/Delete all work, 3-level delete confirmation with password gate
  confirmed, **does not reset to a different tab after a successful save**
- Vault: create, lock, unlock (wrong passphrase rejected, correct one works), passphrase never in plaintext
- Sync tab: GitHub fields only appear when Vault is unlocked; Shared Location connect button present
- NLP: relative dates generate **valid, unquoted** SQL; Query Plan displayed; CR natural-language parsing works
- Mobile (390px): hamburger menu includes Sync Source/Time as dropdowns, zero horizontal overflow
- **Zero console errors, zero page errors** across the entire test run

## Demo credentials

Operational password: `apsql-admin`. Vault has no default — you must create your own passphrase.
