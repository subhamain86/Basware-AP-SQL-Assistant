# Baseline Provenance

Your upgrade brief pointed to a SharePoint folder for **V15.7**. That exact URL could not be
opened directly by the tools available here, but a matching source archive
(`AP-SQL-Assistant-V15-FullUI-20260927-190013.zip`, containing the `AP-SQL-Assistant-V15/` project
— TypeScript source organized as `src/services/`, `src/engines/`, `src/components/`, `src/pages/`,
`src/state/`, `src/types/`, `src/utils/`, `src/layouts/`, `src/styles/`, plus `tsconfig.json` and
`public/favicon.svg`) was found in your enterprise file store and used as the baseline. It was
read and transcribed file-by-file, in full, before any V16.0 change was written.

This baseline already contained a hybrid online/offline NLP architecture
(`nlpOrchestrator.ts`, `onlineNlpService.ts`) with the exact schema-authoritative validation
pattern (`filterToKnownTables` / `filterToKnownColumns`) your V16.0 brief requires — V16.0 adds
M365 Copilot Enterprise as a new, higher-priority, optional tier ahead of that existing generic
online endpoint, reusing the identical validation pattern rather than inventing a new one.

**What to double-check on your side:** because the original file could not be opened directly
from the SharePoint link, please diff this package against your own local/authoritative copy of
V15.7 if one exists outside the enterprise search index, particularly for:
- Exact wording of a few UI strings that were transcribed from an extracted-text view (e.g.
  hyphens, quotes, and en/em dashes may have been normalized in a handful of places).
- Any V15.7 changes made after 2026-09-27 19:00 (the timestamp embedded in the archive filename)
  that would not be reflected here.

If you can attach the exact `AP-SQL-Assistant-V15.7.zip` directly to this chat, it can be re-based
onto precisely instead, with a mechanical diff proving byte-for-byte equivalence outside the files
listed in the README's "What changed" section.

## Bug found and fixed during V16.0 verification

While writing the browser test suite for this delivery, a pre-existing timing defect was found in
`settingsPage.ts`'s unlock flow: `store.unlockSettings()` triggers a **synchronous** re-mount of
the Settings page (via the app shell's store subscription), but the Secret Vault's
`tryAutoUnlock()` bootstrap is asynchronous. In the reconstructed baseline these were called in
the wrong order, so the freshly re-mounted Secret Vault tab could briefly (or, on a slow/blocked
network request such as file://'s CORS-blocked GitHub check, indefinitely until the user
navigated away and back) render as "locked" even though the password was correct. The fix
reorders the two calls so the vault is confirmed unlocked before the page remounts. This is
unrelated to the V16.0 feature itself and does not change any documented behaviour — it only
ensures the Secret Vault tab (including the new M365 Copilot Enterprise section) renders correctly
on the very first paint after unlocking. Verified with a real headless-Chromium test.
