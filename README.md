# AP-SQL Assistant — V15 (Full Rich UI Restored + file:// Fix)

This build fixes the **degraded UI** regression from the previous V15 package. That version simplified the CSS, icon set, and several components while fixing the blank-page bug — a real mistake on my part. This build restores **full visual and functional parity** with the original rich design, while keeping the `file://` fix intact.

## What's restored vs. the previous (degraded) V15
- **Full 60+ icon set** (previously trimmed to ~25 simplified icons)
- **Rich navbar**: sync source/time dropdowns, network status indicator, settings lock badge, theme toggle menu (System/Light/Dark), Guided Walkthrough button, signature — all previously removed
- **Rich hamburger panel**: grouped/collapsible nav items (Query Builder group), mobile sync selectors, guided walkthrough link, signature footer
- **Full 12-step Guided Walkthrough** (previously a single placeholder step)
- **Full Settings page**: Security, Manual Schema Update, Schema Management, Secret Vault, Synchronization, AI/NLP Engine, and Danger Zone tabs (previously only 2 simplified tabs)
- **Full Schema Editor**: complete CRUD with add/edit/delete modals, 3-step delete confirmation with password gate, foreign key fields, decode entries
- **Full Read Only Query Builder**: Advanced Options tab with DISTINCT, GROUP BY, HAVING, LIMIT, CTEs, manual CASE/DECODE builders, optimizer tips
- **Rich CSS**: shadows, gradients, hover animations, proper spacing — restoring the original visual polish (266 lines vs. ~120 previously)
- **Table/column pickers**: module filters, "Select All", per-column alias/decode-mode controls — all restored to full richness

## The file:// fix (carried forward from the previous V15)
Still bundled with **esbuild** (a real AST-based bundler) into a single self-contained `index.html` — no ES modules, so it works identically via double-click (`file://`) or served over `http(s)://`. This was verified again with a real headless Chromium browser via Playwright across all 7 routes, over both protocols — 14/14 tests passed with zero JavaScript errors.

## The two original bug fixes (also carried forward, re-verified)
1. **Storage quota exceeded** — `safeLocalStorageSet()` with escalating prune-and-retry (caps of 12→6→3→1 inactive schemas across up to 4 attempts).
2. **Cross-device schema sync gap** — `discoverPublicRegistry()` performs an automatic, unauthenticated, read-only GitHub pull on every app load, regardless of Secret Vault lock state.

## How to use this build
**Just double-click `dist/index.html`.** No server, no build step, no npm install required.

## Verified before packaging
- `tsc --noEmit` (strict mode): 0 errors across all 62 source files.
- esbuild bundle: 0 syntax errors, executes cleanly.
- **Playwright + real headless Chromium**: all 7 routes × both protocols (`file://` and `http://`) = 14/14 passed, zero errors, significantly richer HTML output confirmed (e.g., Quick Start page: 25,111 characters vs. 11,608 in the previous simplified build).
- Screenshots captured confirming: hero card with gradient background, full navbar with all controls, tabbed Read Only Query Builder with dark-themed SQL output panel, and the full grouped hamburger navigation panel.
