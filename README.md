# SQL Assistant — V14

An incremental upgrade of the V13.x line. **Renamed application, rebuilt navbar, hybrid online/offline NLP,
module-scoped selectors everywhere, manual CASE/DECODE builders, CR Builder UI parity, and three real bugs found
and fixed via actual browser testing.** No existing functionality was removed.

## Just want to open it? `dist/index.html`

Fully self-contained (~200 KB, zero external `<script>`/`<link>` references). Double-click it — no server, no
build step. Verified via `file://` in a real headless browser with **zero console errors, zero page errors**
across an extensive, targeted test suite (see below).

## What's new in V14

- **Renamed to "SQL Assistant"** everywhere — page title, navbar, headings, About page, footer. No trace of the
  previous application name remains anywhere in the UI.
- **Navbar rebuilt**: Hamburger Menu is now on the **left**. On the right: Sync Source/Time dropdowns (center),
  then **Guided Walkthrough**, then the **signature** ("Subham Ain") on the far right, in that exact order.
- **Hybrid Online/Offline NLP**: a new `onlineNlpService` + `nlpOrchestrator` implement the required priority
  chain — **Online AI/NLP → Offline/local engine → Manual Selector fallback**. No online endpoint is configured
  out of the box (none was provided), so it correctly and transparently falls back to the local engine every
  time, with a visible badge (`🌐 Online AI/NLP` vs. `📵 Offline/local engine`) so the user always knows which
  engine actually ran. An endpoint can be configured later under Settings → AI / NLP Engine.
- **Module → Search → Select** flow added to: the Read Only/CR table picker, the main Schema page's "Tables in
  Active Schema" list, and the Manual Schema Update workflow.
- **Manual CASE / Manual DECODE** builders — new modal-based expression builders in Select Columns, for when no
  schema-defined CASE/DECODE already fits. Coexists with existing schema-level decode functionality.
- **CR Query Builder UI aligned with Read Only** — same top-row layout (Describe/Generated SQL), same
  "Manual Selectors" card with tabs below. All existing CR functionality (query type, WHERE safety, values editor)
  preserved unchanged.
- **Hamburger submenu collapse/expand bug fixed** (see below — this was a real, subtle CSS bug, not just a JS
  wiring issue).
- **Schema page simplified**: Add Schema / Import Schema removed from the main Schema page; both remain available
  (plus a new "Push to GitHub" action) inside Settings → Schema Management, gated by the Admin Password.
- **Settings password section bug fixed**: no more persistent/false message on the lock screen (see below).
- **Default Admin Password is `admin`**, used only internally — **never displayed anywhere in the UI** (no
  hints, tooltips, walkthrough text, notifications, or error messages reveal it). The lock screen now reads
  "Enter Admin Password".
- **Manual Schema Update workflow**: Select Schema → Select Module → Select Table → Populate Table. The data
  grid is now scoped to just the chosen table's columns, and the Add Row form pre-fills the Module/Table fields.

## Three real bugs found and fixed via actual browser testing (not just compilation)

| Bug | Root cause | Fix |
|---|---|---|
| Hamburger "Query Builder" submenu arrow toggled `aria-expanded` and the `hidden` attribute correctly in the DOM, but the submenu **never visually collapsed** | `.hb-group-children { display: flex; ... }` is an unconditional CSS rule — an author-specified `display` always overrides the browser's default `[hidden] { display: none }` behavior, per the CSS cascade | Added `.hb-group-children[hidden] { display: none; }`. Found the exact same pattern affecting `.issue-box`/`.note-box`/`.tips-box` (used by the Settings password error box and the Manual Schema Update delete-confirmation password error) and `.row-actions` (used by the schema editor's row-action bar) — fixed all three with the same technique. |
| The Query Plan and "Online/Offline engine" badge never appeared after building a query, even though the code that generates them ran successfully | `runNlBuild()`/`runCrNlBuild()` set `#nlNotes.innerHTML` with the results, then immediately called `draw()` — which re-renders the **entire** section's `innerHTML`, including a fresh, empty `#nlNotes` placeholder, silently discarding the content that was just written | Reordered both functions so `draw()` runs first (reflecting the "done building" state), and the notes/badge are written to the DOM **afterward** |
| (Regression check) Same `[hidden]`-override pattern also affected the 3-level delete confirmation's password-error box | Same root cause as bug #1 | Covered by the same `.issue-box[hidden]` fix |

## What's in this zip

```
sqla/
├── dist/index.html         ← Open this. Fully self-contained.
├── inline-build.mjs         ← Build-time inliner with byte-identical verification
├── src/
│   ├── engines/              + crNlpEngine, schemaVersionEngine, manual CASE/DECODE builders in decodeEngine
│   ├── services/              + onlineNlpService (NEW), nlpOrchestrator (NEW), cryptoService, passwordService,
│   │                            vaultService, syncService (+ pushSchemaToGitHub)
│   ├── components/            hamburgerNav (redesigned + bug fix), manualExprBuilder (NEW), tablePicker (Module flow)
│   └── pages/                 crBuilderPage (aligned with Read Only), schemaPage (simplified + Module/Search),
│                               schemaEditorSection (Module→Table workflow), settingsPage (fixed + AI/NLP tab)
├── package.json / tsconfig.json / vite.config.ts
└── README.md
```

## Verified before packaging (real browser tests, not just compilation)

- `tsc --noEmit`: 0 errors · `vite build`: clean
- Branding: "SQL Assistant" everywhere, zero trace of previous name
- Navbar: hamburger left, sync dropdowns, Guided Walkthrough immediately left of signature, signature far right
- Hamburger submenu: expand **and** collapse both verified visually (not just via `aria-expanded`)
- Read Only + CR builders: online/offline engine badge and Query Plan/notes correctly persist after building
- Relative-date SQL (e.g. "this month") generates valid, unquoted `DATE_TRUNC(...)` — not wrapped in a string
- Manual CASE and Manual DECODE both add correctly-rendered expressions to the generated SQL
- Settings: error box hidden on fresh load, shows only on actual wrong password, "Enter Admin Password" label,
  default password `admin` works and is never found in `localStorage` as plaintext
- Manual Schema Update: Module → Table selection correctly scopes the data grid; Add Row pre-fills Module/Table;
  3-level delete confirmation's password step also has its error box correctly hidden until an actual wrong entry
- Schema page: Add Schema / Import Schema fields confirmed absent; Module selector + Search confirmed present
- Schema Management (Settings): Add/Import/Push-to-GitHub confirmed present and gated behind the Admin Password
- Mobile (390px): hamburger opens, Sync Source/Time available as dropdowns inside the panel, zero horizontal overflow
- **Zero console errors, zero page errors** across the entire test run, including a full-route regression pass

## Demo credentials

Admin Password: `admin` (used internally only — never shown in the UI). Change or reset it from Settings → Security.
