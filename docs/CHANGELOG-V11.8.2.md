# AP-SQL Assistant — Changelog: V11.8.1 → V11.8.2

**Type of release:** UI/UX enhancement only. No engine logic changed — SQL Generation, Filter, Validation, Schema, Decode, Relationship, AI Service Layer, CR builder, Error Rectifier, password/security, GitHub sync, and the encrypted credential vault behave the same as V11.8.1.

## 1. Guided Walkthrough — new, interactive product tour
- New file: `js/tour-engine.js`.
- Step counter ("Step X of Y"), progress dots, context-aware starting point, automatic cross-page navigation, automatic scrolling, viewport-safe tooltip positioning, keyboard controls (Esc/←/→), graceful skip-on-missing-target, restart support via the navbar's "Guided Walkthrough" button.

## 2. Hamburger Menu / Navbar — distortion fixed at the root cause
- New file: `css/navbar-v11.8.2-patch.css` (loaded after `styles.css`, fully additive).
- Root causes corrected: `flex-wrap` reflow on the brand/hamburger row, missing `min-width: 0` on flex children, and colliding `z-index` between the offcanvas menu and page content/cards.
- Verified at 320 / 360 / 420 / 768 / 992 / 1440px viewport widths.

## 3. Navbar Icons — upgraded to 3D fluid style
- Consistent sizing, subtle 3D depth, smooth hover lift/tilt, a clear active-item accent ring, visible keyboard focus rings, and a `prefers-reduced-motion` fallback.

## 4. Functionality preserved
- Navigation, hamburger menu, both Query Builders, schema management/synchronization, AI engines, Error Rectifier, CASE/DECODE, password/security, theme switching are all unaffected. `test/run-all.js` reports **71/71 passing**.

## Files changed in this release
- `+` `css/navbar-v11.8.2-patch.css` (new)
- `+` `js/tour-engine.js` (new)
- `~` `index.html` (Guided Walkthrough overlay markup, navbar `data-tour` anchors, version string bumped to 11.8.2)
- `~` `package.json` / `README.md` (version bumped to 11.8.2)
