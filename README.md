# SQL Assistant — V14.1

A stability, usability, offline-NLP, and synchronization upgrade to V14. **All existing V14 functionality,
UI, schema logic, Query Builder behavior, AI/NLP behavior, synchronization, Vault, and navigation are preserved**
except where explicitly changed below.

## Just want to open it? `dist/index.html`

Fully self-contained (~217 KB, zero external `<script>`/`<link>` references). Double-click it — no server, no
build step. Verified via `file://` in a real headless browser with **zero console errors, zero page errors**
across an extensive, targeted test suite (see below).

## The root cause of the "automatic page refresh" bug (spec section 1)

The Read Only and CR Query Builder pages both subscribed to the global store with `store.subscribe(draw)` —
meaning **every single interaction anywhere in the app** (checking a checkbox, typing a filter value, or even an
unrelated toast auto-dismissing 4 seconds later) triggered a full top-to-bottom rebuild of the entire page
section. Every control on the page *already* called its own targeted update function immediately after mutating
state, so this blanket subscription was pure redundancy — and it was actively harmful: it tore down and
recreated the table/column pickers with brand-new closures, silently resetting their search term and selected
module back to blank, and stealing focus from whatever input the user was typing in. **This is also what made
Search look "broken"** — a keystroke in the search box didn't touch the store, but the NEXT unrelated interaction
(or even just time passing) would trigger a full rebuild that wiped the search term back out.

**The fix:** removed the blanket subscription entirely. `schemaService.subscribe(draw)` was kept, since a genuine
active-schema change is a legitimate, rare, deliberate reason to refresh the available tables/columns — unlike
routine micro-interactions.

Additionally, `tablePicker.ts`, `columnPicker.ts`, and `dataTable.ts` (used everywhere search boxes appear,
including Manual Schema Update) were rewritten with a **static-shell + list-only re-render pattern**: the search
`<input>` and dropdowns are rendered exactly once and never destroyed; only the results list underneath is
replaced on each keystroke. This is a proper engineering fix, not a refocus hack.

## What's new in V14.1

- **Search Tables / Search Columns fixed** at the root cause (see above) — partial, case-insensitive, works
  together with the Module filter, never triggers a refresh, never loses focus.
- **Schema-aware offline NLP**: the engine now reads table/column **descriptions**, not just names, so business
  terminology like *"who approved this invoice"* resolves to `APPROVAL_HISTORY` (via its description) **while
  still keeping** `INVOICE_HEADER` (matched by name) — merged, not replaced. Never invents tables/columns that
  don't exist in the Active Schema.
- **True AND/OR merge** between Natural Language and Manual Selectors (spec section 3): a new
  `store.mergeReadOnlyFromNlp()` unions tables/columns/filters/sorts instead of one input overwriting the other.
  Manually select a table, then describe a filter in plain English — both apply together.
- **Per-column CASE/DECODE controls** (spec section 7): every column row in Select Columns now shows `CASE` /
  `DECODE` buttons directly beside it. Existing schema-defined DECODEs show as an optional toggle chip —
  **fixed to never auto-apply** (was silently violating spec 7.2 in an earlier build of this version; caught and
  fixed via testing) — the user must explicitly opt in.
- **Real GitHub-based schema synchronization** (spec sections 9-16): a new `githubApiService.ts` makes genuine
  `fetch()` calls to the GitHub Contents API (get file + SHA, PUT with optimistic-concurrency). The entire local
  schema **registry** (all schemas + which one is active) is pushed/pulled as one JSON document, so both imported
  and active schemas travel together. Conflict detection **reuses the existing `schemaVersionEngine`** (per the
  explicit spec instruction not to introduce a second competing system) and surfaces an interactive **Use Local /
  Use Remote** resolution UI per conflicting schema — nothing is silently overwritten.
- **Vault security preserved**: GitHub tokens are only ever decrypted in memory while the Vault is unlocked and
  are never rendered as plain text anywhere in the UI (the token field always shows a password mask or a bullet
  placeholder, never the actual value).

## Bugs found and fixed via actual browser testing (not just compilation)

| Bug | Root cause | Fix |
|---|---|---|
| Decode was **automatically applied** the instant a column with a schema decode was checked | `useDecode: !!colDef.decode?.length` defaulted to `true` | Changed default to `false` — decode is now a genuinely optional, explicit opt-in per spec section 7.2 |
| "who approved this invoice" only found `INVOICE_HEADER`, never `APPROVAL_HISTORY` | Description-based table/column matching only ran as a **total fallback** when zero name-matches existed — since "invoice" matched by synonym, the description pass never ran at all | Description matching now always runs and **merges** an additional high-scoring match in, instead of only firing when nothing else was found |
| Manual CASE/DECODE columns could **duplicate** in the generated SQL after toggling an unrelated checkbox | `onColumnsChange` unconditionally re-appended `s.selectedColumns.filter(c => c.manualExpr)`, even when the picker's own state already included them | De-duplicate by `id` before merging — only re-append a manual column if it's genuinely missing from the picker's latest state |

## What's in this zip

```
sqla141/
├── dist/index.html          ← Open this. Fully self-contained.
├── inline-build.mjs          ← Build-time inliner with byte-identical verification
├── src/
│   ├── engines/               nlpEngine (schema-aware, description-merge), decodeEngine, schemaVersionEngine (reused for conflicts)
│   ├── services/              githubApiService (NEW — real Contents API client), syncService (rewritten — registry push/pull + conflicts),
│   │                            passwordService, vaultService, onlineNlpService, nlpOrchestrator
│   ├── components/            tablePicker / columnPicker / dataTable (rewritten — static-shell root-cause fix),
│   │                            manualExprBuilder (pre-fill support for per-column triggers)
│   └── pages/                 readOnlyBuilderPage / crBuilderPage (no blanket store subscribe; AND/OR merge),
│                                schemaPage / settingsPage (GitHub push/pull + conflict resolution UI)
├── package.json / tsconfig.json / vite.config.ts
└── README.md
```

## Verified before packaging (real browser tests, not just compilation)

- `tsc --noEmit`: 0 errors · `vite build`: clean
- Search Tables/Columns: filters correctly, case-insensitive, partial match, works with Module filter, **search
  input never loses focus**, clearing restores the full list
- Selecting tables/columns across a sequence of interactions never resets prior selections or navbar state
- Decode confirmed **NOT** auto-applied on selection; confirmed it applies correctly after explicit opt-in
- "who approved this invoice" confirmed to resolve **both** `APPROVAL_HISTORY` and `INVOICE_HEADER` together
- AND/OR merge confirmed: a manually-selected column survives an NLP build that adds a different table
- Manual CASE/DECODE columns confirmed to appear exactly once in the SQL after further unrelated interactions
- CR Builder: table/query-type selection persists correctly across interactions
- Settings: password error box hidden on load, shown only on genuine wrong password, unlocks with `admin`
- Manual Schema Update: Module→Table scoped search confirmed working and focus-preserving
- GitHub sync: Vault creation, config save, and push all wired correctly; push attempt against a fake repo
  **fails gracefully** with a clear "network error" message and zero app crash (expected — this sandbox has no
  outbound internet access; the same code performs a genuine GitHub round-trip once hosted with real connectivity
  and a valid PAT)
- Mobile (390px): hamburger opens correctly, zero horizontal overflow
- **Zero console errors, zero page errors** across the entire test run, including a full-route regression pass

## Demo credentials

Admin Password: `admin` (used internally only — never shown in the UI). Vault has no default — create your own
passphrase under Settings → Vault before configuring GitHub sync.
