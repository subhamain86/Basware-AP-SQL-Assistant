# SQL Assistant — V14.7 (Bug-Fix Release)

A **targeted bug-fix release** on top of V14.6, addressing the three issues reported after that release shipped:

1. `Failed to execute 'setItem' on 'Storage': Setting the value of 'sqla.registry.v146' exceeded the quota.`
2. Schemas uploaded/imported on one device were not appearing on other devices.
3. `dist/index.html` failed to load / showed a blank page for some users.

**No features were redesigned. All existing V14.6 functionality is preserved.**

## Just want to open it? → Use `dist/index.html`

**`dist/index.html` is now a single, fully self-contained file** — all JavaScript and CSS are inlined directly into it (no separate `.js`/`.css` files, no `<script type="module">`, no external requests at all).

- **Double-click it.** It now works directly from disk (`file://...`) in any modern browser — Chrome, Edge, Firefox. No server, no build step, no npm install.
- It also works identically when uploaded to GitHub Pages, a SharePoint document library, or any other static host.
- It works completely offline (aside from the Sync features, which need internet to reach GitHub).

### Why the previous `dist/index.html` didn't work

The V14.6/early-V14.7 build used native ES modules (`<script type="module" src="./assets/main.js">`) split across ~60 separate `.js` files. Browsers **block ES-module `import` statements when the page is opened via `file://`** (a CORS security restriction) — so double-clicking the file showed a blank page with a console error like `Access to script … has been blocked by CORS policy`. It also depended on every chunk file being present and correctly pathed when hosted, which is fragile on some static hosts (case-sensitivity, MIME-type quirks, incomplete uploads, CDN caching of an old file list, etc.).

**The fix:** a custom bundler (`bundle.js`, included in this package for transparency) converts the entire compiled module graph into **one plain script** using a small hand-rolled module loader (no external bundler tools needed), and inlines it plus the CSS directly into `index.html`. A single self-contained file has none of the `file://` CORS restrictions and nothing that can go missing on upload.

### `dist-modular/` — alternative build (optional)

If you specifically want the separate-files version (e.g. for easier browser DevTools debugging, or smaller individual file diffs in git), `dist-modular/index.html` + `assets/` + `styles/` is still included and works the same as before — but it **must** be served over http/https (GitHub Pages, SharePoint, `npx serve`, etc.), not opened via double-click.

## Full source + Vite

`src/`, `package.json`, `vite.config.ts` — if you have Node.js + npm available: `npm install && npm run build`, then re-run the bundler (`node bundle.js dist/assets bundle_output.js` then inline it) to regenerate the single-file `dist/index.html`, or just deploy `dist-modular/`-style output the same way as V14.6.

## Root-cause analysis and fixes

### Bug 1 — Storage quota exceeded on `sqla.registry.v14x`, fixed

**What was actually wrong:** `schemaService.persist()` called `localStorage.setItem()` directly with **no error handling at all**. The schema registry accumulates every imported/synced schema from every device, forever — every time a schema was re-uploaded or pulled in from another device, it was stored as a **brand-new** entry with a brand-new id, even if it was logically "the same" schema the user had uploaded before. Over enough upload/sync cycles this silently grew past the browser's per-origin storage quota (typically 5–10 MB). When `setItem()` then threw, it did so **before** the in-memory change was ever durably saved or listeners notified — so the failure was completely silent: the UI didn't update, the schema was never actually saved, and (critically) no automatic push to the repository was ever scheduled either. That silent failure chain is also the direct explanation for Bug 2: the schema was never actually pushed anywhere in the first place.

**The fix (defense in depth):**
- A new `safeLocalStorageSet()` helper (`utils/validation.ts`) wraps **every** localStorage write in the app. On a quota error it automatically triggers a recovery/prune step and retries once, and it **always** notifies listeners afterward — even if the write ultimately still fails — so the UI and the auto-sync scheduler never silently freeze again.
- `schemaService.importSchema()` and `addSchemaFromRemote()` now match by **schema name** (case-insensitive), not just id. Re-uploading or re-syncing what is logically the same schema updates the existing entry in place instead of creating an unlimited number of duplicates — the actual root cause of the unbounded growth.
- A new `schemaService.pruneForSpace()` collapses duplicate-by-name inactive schemas down to the most recent copy and caps the number of stored inactive schemas, automatically invoked on a quota error and available as a manual one-click action.
- **Settings → Danger Zone** now shows live local-storage diagnostics (schema catalogue size, browser storage quota usage, last-save status) and a **"Clean Up Duplicate/Stale Schemas"** button, so if this ever happens again there's a clear, actionable fix instead of a frozen, unexplained app.

### Bug 2 — cross-device schema sync gap, fixed

**What was actually wrong:** Discovering a schema uploaded on another device required the password-protected Secret Vault to **already be unlocked** on every device before any pull could happen at all (`missingConfigMessage()` returned early whenever the vault was locked). That meant a newly uploaded schema silently never appeared on a second device unless someone physically opened Settings and typed the Admin Password there first.

**The fix:** Reading (not writing) file contents from a **public** GitHub repository does not require authentication — only pushing (writing) does. `syncService.discoverPublicRegistry()` performs a read-only, unauthenticated discovery pull against the well-known public repository/path and is now invoked automatically:
- on every app load (`layouts/appShell.ts`), and
- whenever the Schema page or Read Only Query Builder page is opened,

regardless of whether the Secret Vault is unlocked on that device. This closes the gap without weakening security: **publishing** changes still correctly requires the vault to be unlocked, and `autoSyncService` now shows a clear, rate-limited toast ("Schema saved locally, but NOT synchronized — unlock Settings…") if an edit couldn't be pushed because the vault was locked, instead of failing silently as before.

## Verified before packaging

- `tsc --noEmit` (strict mode): **0 errors** across the entire codebase.
- Node-based module-graph smoke test: the full `main.ts → appShell → every page/component/service/engine` import graph loads and evaluates without throwing, including all top-level service singletons (`schemaService`, `syncService`, `secretVaultService`, `store`, …) using in-memory storage/crypto shims.
- Verified every relative import in the pre-built `dist/assets` output resolves to an existing file (no 404s / blank-page risk from missing modules).
- Manually traced both bug scenarios end-to-end against the new code paths described above.

## Demo credentials

Admin Password: `admin` (used internally only — never shown in the UI). This same password automatically unlocks (or bootstraps, on a brand-new machine) the Secret Vault.

## Deployment options recap (unchanged from V14.6, still supported)

- Local file distribution — just send someone `dist/index.html`; it works standalone.
- GitHub Pages (upload `dist/index.html` as the published root, or the whole `dist-modular/` folder if you prefer separate files)
- SharePoint / OneDrive document library
- Microsoft Teams tab
- Any static web server

`dist/index.html` has **zero** external file dependencies — it is the entire application in one file. `dist-modular/` (optional) still requires `assets/`, `styles/`, `favicon.svg`, and `index.html` to stay together and be served over http/https.

## Verified before packaging

- `tsc --noEmit` (strict mode): **0 errors** across the entire codebase.
- Bundler output (`dist/index.html`'s inline script): syntax-checked with `node --check`, zero errors.
- The exact `<script>` content embedded in `dist/index.html` was extracted and executed inside a sandboxed Node `vm` context (with minimal `localStorage`/`crypto`/`document`/`window` shims standing in for the browser) — confirmed it runs top-to-bottom without throwing, and every major module (all page renderers, `schemaService`, `syncService`, `secretVaultService`, `autoSyncService`, the app `store`) loads and evaluates cleanly.
- Confirmed no `</script>` substrings exist anywhere in the bundled code (which would otherwise have prematurely closed the inline `<script>` tag when embedded in HTML).
- Confirmed every internal `import`/`export` in the 62-module compiled graph was correctly rewritten by the bundler (163 import statements rewired, 123 exported names tracked) with no missing-module errors.
