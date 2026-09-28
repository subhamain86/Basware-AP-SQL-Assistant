# SQL Assistant — V15.4

Baseline: V15.3 (working). This is a **UI organization, theme consistency,
form usability, and documentation release** — every V15.3 feature and
workflow is preserved; nothing was removed, simplified, or restructured
beyond what's described below.

## How to run
- **Static hosting** (GitHub Pages, SharePoint, OneDrive, any web server):
  upload `index.html` as-is — CSS and JS are fully inlined, no build step.
- **Local / offline:** double-click `index.html`. Verified both served
  over HTTP and opened directly via `file://`.
- `source/` contains the full TypeScript source (`tsc --noEmit` clean) for
  further development — `index.html` is the only file you need to *deploy*.

## What changed in V15.4

### 1. Consistent "SQL Assistant" branding
Carried forward from V15.3 and re-verified across every route — no stale
"AP-SQL Assistant" text anywhere in the visible UI, browser tab title reads
"SQL Assistant · V15.4".

### 2 & 3. Describe What You Need + Generated SQL — now side by side
Both the **Read Only Query Builder** and **Query Builder for CR** place
"Describe What You Need (Optional)" (left) and "Generated SQL" (right)
inside a new responsive `.builder-top-grid` on screens ≥1100px wide:
- Equal column widths, `align-items: stretch` for equal card heights.
- **Pixel-exact aligned top edges** — caught and fixed a real CSS
  specificity tie (`.builder-section:first-of-type` vs
  `.builder-top-grid .builder-section`) that was silently adding an extra
  6.4px of top margin to only the left card; added a higher-specificity
  override so both cards' top edges are now guaranteed flush regardless
  of any other stylesheet ordering.
- A clear, deliberate 28px gap between the cards (no touching, no
  excessive whitespace).
- Below 1100px, the grid collapses to a single stacked column
  automatically — verified via Playwright at a 900px viewport.
- Manual Selectors (with Advanced Options in its tabs) and Build Query
  remain as their own full-width section directly below, preserving the
  intended workflow: **Describe → Manual Selectors/Advanced Options →
  Build Query → Generated SQL**.
- The CR Query Builder uses the exact same grid/card/heading styles, so
  the two builders "feel like two modes of the same application."

### 4. Global theme-compatibility pass
- Added dedicated theme variables for disabled text, error text, success
  text, and secondary-button colors, wired into the existing `--input-*`
  variables introduced in V15.3.
- **Added `color-scheme: light` / `color-scheme: dark`** per theme — this
  was a real, previously-uncovered gap: without it, native browser UI that
  CSS can't reach directly (select-dropdown panels/arrows, date/time
  pickers, autofill highlighting) could keep following the OS-level theme
  even while every custom-styled control correctly followed the app's
  theme. Confirmed via Playwright that `color-scheme` now flips with the
  theme toggle exactly like every other themed property.
- Disabled inputs/textareas/selects now use full opacity with a dedicated
  `--disabled-text` color instead of a washed-out `opacity: .55` (which
  could become unreadable in dark mode) — still clearly "disabled," but
  legible in both themes.
- Re-verified (Playwright): switching Light ⇄ Dark changes both the
  background **and** the text color of live form controls immediately,
  with zero page navigation/refresh.

### 5. Manual Schema Update — DECODE guidance (new)
The DECODE field in "Add/Edit Row" now includes, directly above the input:
- A plain-language explanation of what DECODE does (display label instead
  of raw stored value) and the exact `RAW=Label` per-line format the
  application actually parses (matches `schemaService.upsertRow()`
  byte-for-byte — no invented syntax).
- A worked example table showing **database value → display value**
  (`1 → Approved`, `2 → Rejected`, `3 → Pending`) next to the exact text
  to type, in a two-column, theme-aware layout.
- A collapsible "Show the SQL this example would generate" section that
  calls the app's real `buildSchemaDecodeExpression()` to render the
  actual Oracle `DECODE(...)` and actual ANSI `CASE...END` output for that
  example — so the guidance can never drift from what the app really
  generates.
- A **live preview**: as the user types their own mappings, a preview box
  updates immediately showing how many mappings were detected and the
  real SQL expression that would be produced from them — again using the
  same parser/validator/SQL-builder as the actual save path.
- **Save-time validation**: malformed DECODE input (e.g. a duplicate raw
  value) is now caught by `validateDecodeEntries()` both live and again at
  Save, and is never silently accepted — confirmed via Playwright by
  entering a duplicate raw value and seeing the exact validation message.
- The example is purely illustrative — it is never written into schema
  data automatically; only clicking Save (with valid input) persists
  anything, exactly as before.
- The whole block (help text, example table, code samples, live preview,
  validation messages) uses only shared theme variables, confirmed
  readable in both Light and Dark.

## Regression testing performed
- `tsc --noEmit` (strict): clean, 0 errors.
- Playwright: all 7 routes render with zero console/page errors over both
  HTTP and `file://`.
- Playwright: branding sweep — zero old-name occurrences.
- Playwright: Read Only Query Builder side-by-side grid at 1440px width —
  confirmed identical top edge (y), identical height, identical width,
  28px gap; confirmed the grid collapses to a single stacked column at
  900px width.
- Playwright: CR Query Builder side-by-side grid confirmed present and
  correctly positioned.
- Playwright: table selection → SQL generation still works with no page
  refresh (functional regression check).
- Playwright: theme switch confirmed to update textarea background,
  text color, and `color-scheme` simultaneously, with zero navigation.
- Playwright: Manual Schema Update DECODE — help block, example table,
  example code, live preview (after typing valid mappings), and live
  validation error (after typing a duplicate raw value) all confirmed
  present and correct after unlocking Settings with the admin password.
