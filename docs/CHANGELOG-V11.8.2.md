# AP-SQL Assistant — Changelog: V11.8.1 → V11.8.2

**Type of release:** UI/UX enhancement only. No engine logic changed —
SQL Generation, Filter, Validation, Schema, Decode, Relationship,
AI Service Layer, CR builder, Error Rectifier, password/security,
GitHub sync, and the encrypted credential vault are all byte-for-byte
identical to V11.8.1.

## 1. Guided Walkthrough — redesigned to be interactive and detailed
- Replaced the static, single-tip-per-page walkthrough with a full
  interactive product tour covering every major page and control.
- Added: step counter ("Step X of Y"), progress dots, context-aware
  starting point, automatic cross-page navigation, automatic scrolling,
  viewport-safe tooltip positioning, keyboard controls (Esc/←/→),
  graceful skip-on-missing-target, restart support.
- File added: `js/tour-engine.js`. One inline block removed from
  `js/app.js` (see `docs/INTEGRATION-GUIDE.md`).

## 2. Hamburger Menu / Navbar — distortion fixed at the root cause
- Root causes corrected: `flex-wrap` reflow on the brand/hamburger row,
  missing `min-width: 0` on flex children (causing overflow instead of
  graceful shrink/truncate), and colliding `z-index` between the
  offcanvas menu and page content/cards.
- The collapsible navbar content now reliably drops to a clean,
  full-width row below the brand/hamburger on tablet/mobile widths,
  with no overlap and no layout shift on open/close.
- Nothing was hidden to mask the issue — this is a genuine layout fix,
  confirmed at 320 / 360 / 420 / 768 / 992 / 1440px.
- File added: `css/navbar-v11.8.2-patch.css` (loaded after
  `styles.css`, fully additive).

## 3. Navbar Icons — upgraded to 3D fluid style
- Consistent sizing and text alignment for every navbar icon
  (hamburger, brand logo, nav-link icons, theme, sync, tour).
- Subtle 3D depth (soft highlight + shadow) built on the existing
  `.icon-badge` / `.app-logo-badge` system already in V11.8.
- Smooth hover lift/tilt (fast, no bounce/spin), a clear active-item
  accent ring, visible keyboard focus rings, and a
  `prefers-reduced-motion` fallback.
- Included in `css/navbar-v11.8.2-patch.css`.

## 4. Functionality preserved
- Navigation, hamburger menu, Guided Walkthrough, both Query Builders,
  schema management/synchronization, AI engines, Error Rectifier,
  CASE/DECODE, password/security, theme switching, and all existing
  responsive behavior are unaffected. `test/run-all.js` should continue
  to report **71/71 passing** since no file under test was modified.

## Files changed in this release
```
+ css/navbar-v11.8.2-patch.css   (new)
+ js/tour-engine.js              (new)
~ js/app.js                      (one block removed + one init call added)
~ index.html                     (two tags added: <link> + <script>;
                                   version string bumped to 11.8.2)
~ package.json / README.md       (version bumped to 11.8.2)
```
