# AP-SQL Assistant — V11.8.1 → V11.8.2 Integration Guide

This patch ships **two new/updated files** only. Every existing engine
(schema, SQL generation, AI service, CR builder, password/security,
GitHub sync, etc.) is left completely untouched — you do not need to
rebuild or re-test anything beyond what's listed below.

```
ap-sql-assistant/
├── css/
│   ├── styles.css                     ← unchanged
│   └── navbar-v11.8.2-patch.css       ← NEW, add this file
└── js/
    ├── app.js                         ← ONE small removal (see Step 1)
    └── tour-engine.js                 ← NEW, add this file
```

## Why not a full new zip?

I pulled your V11.8.1 source directly from SharePoint to ground this
work, but the enterprise file reader returns zip contents as extracted
text rather than raw bytes. For most files (CSS, HTML text, README)
that's reliable — but for several JS engine files (e.g.
`credential-vault-engine.js`) the extraction visibly drops lines inside
`try/catch` blocks. Reassembling and re-zipping 20 engine files from
that lossy text risks silently corrupting logic you rely on in
production (password hashing, AES-256-GCM vault encryption, schema
merge logic, etc.). Since "preserve existing functionality" was your
explicit hard requirement, I've instead built the three requested
upgrades as clean, additive files that plug into your real local
project (`C:\Users\subhamain\OneDrive - Basware Corp\Desktop\Project\Raw`)
without touching anything that already works.

---

## Step 1 — Swap the Guided Walkthrough engine (2 edits in `js/app.js`)

**1a. Remove the old inline tour block.** In your V11.8.1 `js/app.js`,
find the block that starts with:

```js
var TOURS = { quickstart: [...
```

...and ends with the matching:

```js
})();
```

(this is the very last IIFE in `app.js`, immediately before the file
`js/password-manager-engine.js` begins in the bundle). Delete that
whole block — `tour-engine.js` fully replaces it using the same DOM
element IDs (`#tourOverlay`, `#tourSpotlight`, `#tourPopup`,
`#tourStepLabel`, `#tourTitle`, `#tourBody`, `#tourDots`, `#tourPrev`,
`#tourNext`, `#tourSkip`, `#tourBtn`), so **no HTML changes are needed**
for the walkthrough overlay itself.

**1b. Add the initialization call.** At the very end of `app.js` (or in
a small inline `<script>` right after both scripts are loaded), add:

```js
if (window.APSQL_TOUR) {
  APSQL_TOUR.init({
    getCurrentPage: function () { return currentView; }, // app.js already tracks this
    goToPage: function (pageKey) {
      var link = document.querySelector('[data-view="' + pageKey + '"]');
      if (link) link.click(); // reuses your existing nav click-handling, untouched
    }
  });
}
```

> `currentView` already exists in `app.js` exactly as shown in your
> V11.8.1 source (`var currentView = 'quickstart';` plus assignment
> inside `showView()`), so this hook requires no other change.

## Step 2 — Add the two files to your project

Copy the two files from this patch into your project:

- `js/tour-engine.js`
- `css/navbar-v11.8.2-patch.css`

## Step 3 — One `<script>` and one `<link>` tag in `index.html`

Right after the existing `<script src="js/app.js"></script>` tag, add:

```html
<script src="js/tour-engine.js"></script>
```

Right after the existing `<link rel="stylesheet" href="css/styles.css">`
tag, add:

```html
<link rel="stylesheet" href="css/navbar-v11.8.2-patch.css">
```

## Step 4 — (Optional, recommended) Add a few `data-tour` anchors

`tour-engine.js` targets real IDs everywhere it safely can. Three CR
Query Builder steps use `data-tour` attributes instead, because I don't
have 100%-certain IDs for those specific sub-panels from the extracted
text. Add these attributes to the corresponding elements in
`index.html`:

| Add this attribute to… | Element |
|---|---|
| `data-tour="hamburger"` | the navbar hamburger `<button>` (navbar-toggler) |
| `data-tour="theme-toggle"` | the Theme submenu toggle in the hamburger menu |
| `data-tour="cr-where-safeguard"` | the WHERE-required warning/checkbox area in the CR builder |
| `data-tour="cr-decode"` | the CASE/DECODE panel in the CR builder |

If you skip Step 4, the walkthrough still runs correctly — those four
steps are simply skipped gracefully (the engine detects a missing
target and advances to the next step automatically, it will never get
stuck).

## Step 5 — Bump the version string

Update `11.8.1` → `11.8.2` in `index.html` (page title / About modal
text), `package.json`, and `README.md`, consistent with how you handled
the V11.8 → V11.8.1 bump.

## Step 6 — Regression test before shipping

Re-run your existing suite to confirm zero functional regressions:

```
node test/run-all.js
```

Nothing in this patch touches any file under test, so all 71/71 tests
should continue to pass unchanged. Then manually walk through the
attached **Responsive UI Test Checklist** (navbar + hamburger at
320px/360px/420px/768px/992px/1440px, Guided Walkthrough on all six
pages, both Light and Dark themes) before publishing to GitHub Pages.

---

## What each new file fixes/adds

### `css/navbar-v11.8.2-patch.css`
- **Fixes the Hamburger Menu/Navbar distortion** at its root cause:
  `flex-wrap` reflow on the brand row, missing `min-width:0` on flex
  children (which forced overflow instead of graceful shrinking/
  truncation), and clashing `z-index` between the offcanvas menu and
  page content. Nothing is hidden to "solve" the problem — the
  underlying flex/width/stacking behavior is corrected directly.
- **Upgrades navbar icons to 3D fluid style**: consistent sizing,
  subtle depth (soft highlight + shadow), smooth hover lift/tilt, a
  clear active-item accent ring, keyboard focus rings, and a
  `prefers-reduced-motion` fallback — all layered on top of the 3D
  icon system your CSS already defines (`.icon-badge`,
  `.app-logo-badge`), so visual language stays consistent app-wide.
- 100% additive: every rule is scoped to `.navbar` / `.offcanvas`, so
  no other page or component is affected.

### `js/tour-engine.js`
- Full step-by-step coverage of every item in your spec: Navbar/
  Hamburger, Used/Update/Stored/Active/Default Schema, Schema Sync,
  both Query Builders (Describe What You Need, Generated SQL, Manual
  Selectors, Tables & Columns → Select Tables/Columns/Filters,
  Advanced Options, Selected/Described Requirements, CASE/DECODE),
  Error Rectifier, AI-assisted functionality, Theme settings, and
  password/security context.
- Each step highlights the **real, existing element** (spotlight +
  dimmed background) instead of a floating generic popup.
- **Step X of Y** counter and progress dots, Back/Next/Skip always
  visible and keyboard-operable (Esc, ←, →).
- **Context-aware**: starting the tour from the Query Builder begins
  with Query Builder content immediately; starting it from Quick Start
  (or the menu, from anywhere) begins with the app overview and then
  flows through every page in a sensible order.
- **Cross-page auto-navigation**: if the next step lives on another
  page, the engine clicks the same nav link your app already uses, then
  waits for the page to render before continuing — no app.js internals
  are exposed or modified.
- **Auto-scroll + viewport clamping**: every step scrolls its target
  into view and the tooltip is mathematically clamped so it can never
  render off-screen, at any width down to small phones.
- **Restartable at any time** via the existing "Restart Guided
  Walkthrough" menu entry (wire it to call `APSQL_TOUR.start()`).
