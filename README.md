# AP-SQL Assistant — V16.0

**Baseline:** V15.7 (reconstructed faithfully from your SharePoint source — see `docs/PROVENANCE.md`).
**Scope of this release:** M365 Copilot Enterprise integration for **Describe What You Need**, only.

## Run it

Open **`dist/index.html`** directly (double-click — it works fully offline from disk), or host the
same file on any static web server / GitHub Pages. It is a single self-contained HTML file with
CSS and JavaScript bundled inline (via esbuild, exactly like V15.7's own packaging approach) — no
build step, no server, no dependencies at rest.

To rebuild from source:
```
npm run typecheck   # tsc --noEmit — 0 errors
npm run build       # esbuild bundle -> dist/index.html
npm test            # 10/10 engine + V16.0 orchestration tests
python3 scripts/smoke_test.py   # real headless-Chromium smoke test, 9/9 checks
```

## What changed in V16.0 (and only this)

**"Describe What You Need"** on both the Read Only Query Builder and the Query Builder for CR can
now optionally use your organization's **M365 Copilot Enterprise** agent to help interpret
natural-language requests. It is **off by default**; nothing changes until an administrator
configures it in **Settings → Secret Vault → M365 Copilot Enterprise Integration** (see
`docs/CONFIGURATION.md`).

Architecture implemented exactly as specified:
```
Natural Language → Try M365 Copilot Enterprise (only if enabled+configured)
                  → Offline NLP Engine (always runs, always authoritative)
                  → Active Schema Resolution (discards anything not in your schema)
                  → SQL Generation
```

New files (V16.0 only):
- `src/services/msalAuthService.ts` — Microsoft identity platform sign-in (Authorization Code +
  PKCE, no client secret, no hardcoded credentials).
- `src/services/copilotNlpService.ts` — calls your configured Copilot agent endpoint with the
  user's text and a **minimal** schema context; never the full schema.

Modified files (additive only — every existing behaviour is preserved):
- `src/services/nlpOrchestrator.ts` — Copilot is now tried first (if configured), ahead of the
  existing generic Online AI/NLP Endpoint, ahead of the offline engine. With no Copilot
  configuration, this file's runtime behaviour is identical to V15.7.
- `src/services/secretVaultService.ts` — added one optional `m365Copilot` field to the existing
  `SecretVaultConfig` type and one new `saveM365CopilotConfig()` method. Encryption mechanism,
  storage key, unlock flow, and GitHub push/pull are all unchanged.
- `src/pages/settingsPage.ts` — added one new subsection inside the **existing** Secret Vault tab.
  No new tab, no new page, no new password. (Also fixes a pre-existing unlock-ordering timing
  bug found during verification — see `docs/PROVENANCE.md`.)
- `src/pages/readOnlyBuilderPage.ts`, `src/pages/crBuilderPage.ts` — the existing engine-badge
  logic (`Online AI/NLP` vs `Offline/local engine`) gained one more state,
  `M365 Copilot Enterprise + Offline Engine`. No layout change.
- `src/components/icons.ts` — added one new icon (`bot`) for the badge above. Purely additive.
- `src/components/tourOverlay.ts`, `src/pages/aboutPage.ts` — one sentence each, mentioning the
  new optional capability. No structural change.
- `src/main.ts` — added a one-line check for the OAuth popup callback before mounting the app
  shell (required for the sign-in popup to work; does not affect normal page loads).

**Everything else — Manual Selectors, Select Tables, Select Columns, Filters, CASE functionality,
Advanced Options, Build Query, the CR Query Builder's mandatory-WHERE safeguard, Manual Schema
Update, Schema Management, GitHub synchronization, the Secret Vault's existing encryption/unlock
mechanics, the navbar, colours, themes, icons, and every other button — is unchanged from V15.7.**

## Security properties of the new integration

- No client secret anywhere (PKCE — Microsoft's documented mechanism for SPAs).
- No credentials hard-coded; Tenant ID / Client ID / Scope / Endpoint are admin-supplied via the
  existing encrypted Secret Vault.
- The access token lives only in `sessionStorage` (cleared when the tab closes) — never
  `localStorage`, never logged, never included in schema-sync payloads.
- Only a small, keyword-relevant subset of the schema is ever sent externally — never the full
  schema, never vault secrets.
- Read-only with respect to the schema: the Copilot integration has no code path that can write
  to, or modify, the Active Schema. Any table/column it references that isn't already in your
  schema is discarded before SQL generation, every time, with no exception.
- Automatic, silent fallback to the offline engine on any failure — sign-in cancelled, endpoint
  unreachable, browser offline, or simply not configured.

See `docs/CONFIGURATION.md` for the exact setup steps and `docs/PROVENANCE.md` for how the V15.7
baseline was verified (including one pre-existing bug found and fixed along the way).

## Verification performed

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Engine + orchestration unit tests | 10/10 passed |
| Real headless-Chromium smoke test (opened via `file://`) | 9/9 checks passed, no console errors (only expected CORS messages from background GitHub sync attempts, harmless on file://) |
