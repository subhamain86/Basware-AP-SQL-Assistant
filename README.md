# AP-SQL Assistant — V15 (Fresh Rebuild, Blank-Page Issue Fixed)

This is a **complete, from-scratch rebuild** as requested. It includes both prior bug fixes (storage quota, cross-device sync) **and** a fundamental architecture change that fixes the blank-page issue at its root cause.

## The blank-page issue — root cause and fix

**Root cause:** All previous builds used native ES modules (`<script type="module" src="...">`). Browsers **block ES-module script loading over the `file://` protocol** for security reasons (CORS policy: `Cross origin requests are only supported for protocol schemes: chrome, ... http, https`). This meant double-clicking `index.html` — rather than serving it through a web server — always produced a blank page, regardless of how correct the underlying app code was.

**The fix in V15:** The entire application (all TypeScript source, ~62 files) is compiled and bundled using **esbuild** — a real, industry-standard, AST-based JavaScript bundler (not a risky text/regex substitution) — into a single plain (non-module) IIFE script. This script, along with all CSS, is inlined directly into one self-contained `index.html` file. A plain `<script>` tag has **no** cross-origin restriction and works identically whether the file is opened by double-click (`file://`) or served over `http(s)://`.

### Verified with a real browser, not just code review
I used Playwright to drive an actual headless Chromium browser against this exact build:

| Protocol | Result |
|---|---|
| `file://` (double-click simulation) | ✅ All 7 routes render full UI content, **zero page errors**, confirmed via screenshot |
| `http://` (served) | ✅ All 7 routes render full UI content, **zero page errors** |

Both protocols now behave identically — see the screenshot evidence gathered during this build for visual confirmation.

## The other two bugs (carried forward and re-verified)

### Storage quota exceeded
`safeLocalStorageSet()` wraps every localStorage write with automatic, escalating recovery (prune caps of 12 → 6 → 3 → 1 most-recent inactive schemas across up to 4 retry attempts) whenever a `QuotaExceededError` occurs, and schemas are deduplicated by name on import/sync instead of accumulating unbounded duplicates.

### Cross-device schema sync gap
`discoverPublicRegistry()` performs a read-only, **unauthenticated** GitHub read (public repos allow this) automatically on every app load, regardless of whether the Secret Vault is unlocked — so a schema uploaded on one device now reaches other devices automatically.

## How to use this build

**Just double-click `dist/index.html`.** That's it — no server, no build step, no npm install required. It works completely standalone.

It also works identically if you prefer to host it: upload `dist/index.html` to GitHub Pages, SharePoint, or any static server.

## Verified before packaging

- `tsc --noEmit` (strict mode): 0 errors across all 62 source files.
- esbuild bundle: 0 syntax errors (`node --check`), executes cleanly in a sandboxed VM.
- **Playwright + real headless Chromium**: all 7 routes tested over both `file://` and `http://` — 100% pass rate, zero JS errors, full UI content confirmed.
- Screenshot evidence captured for both protocols showing correct, complete rendering.
- Storage-quota recovery re-verified against the new bundle using a byte-accurate simulated quota.

## What's included

- `dist/index.html` — the complete, self-contained application. **This is the only file you need.**
- `src/` — full TypeScript source, if you want to modify and rebuild (`esbuild` + manual HTML assembly, or set up your own bundler).
