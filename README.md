# AP-SQL Assistant — V15.1 (Stability & Synchronization Fix Release)

This is a **targeted stability and synchronization fix release** on the V15 baseline. **No existing functionality was redesigned or removed.** Two specific, previously-reported bugs are fixed at their root cause, both verified empirically in a real headless Chromium browser (not just code review).

---

## Fix #1 — "Remote schema file failed validation"

### Root cause
The validator ran on the **raw, un-sanitized** remote payload, **before** `sanitizeIncomingSchema()` had a chance to fill in safe defaults for missing/legacy optional fields. It also treated common, legitimate structural variations as hard `error`-severity issues:
- A foreign key pointing to a table/column added later on another device
- A table with no primary key marked
- Duplicate DECODE raw values
- Negative length/precision on a legacy field

**A single such issue anywhere in the registry rejected the ENTIRE registry — every schema, from every device — with the generic message "Remote schema file failed validation."**

### The fix
1. **Sanitize before validate.** Every incoming schema is now sanitized (safe string/array defaults filled in) *before* any structural check runs, so legacy/optional gaps can never trigger a false rejection.
2. **Per-schema independence.** Each schema in a registry is validated and loaded **independently**. One malformed entry is skipped (and logged internally) — every other valid schema in the same registry still loads normally. This directly satisfies the "Multiple schemas remain available across machines" requirement.
3. **Structural nitpicks demoted to diagnostics.** FK mismatches, missing PK, duplicate decode values, etc. are still detected and logged (via `console.debug`, visible only in DevTools) but never block loading — they are not "genuinely malformed," per the specification.
4. **Only genuinely fatal conditions reject a schema**: not an object, missing/non-array `tables` (even after sanitization), or no resolvable schema name.
5. **New internal error taxonomy** (`SyncErrorCode`): `invalid-json`, `empty-file`, `invalid-root-structure`, `incorrect-file-selection` (e.g. a GitHub API metadata response mistaken for schema content), `encoding-issue`, `github-sync-issue`, etc. — each mapped to its own diagnostic, while the user always sees one clean sentence: *"Remote schema synchronization failed. The schema file could not be validated. Please check the schema format or synchronization status."*
6. **Defensive file retrieval** (`getFile()` in `githubApiService.ts`): explicitly detects and labels a folder listing, a missing `content` field, a base64 decode failure, and an empty decoded file — so the app can never mistake GitHub metadata for actual schema content.

### Empirical verification
A direct test of the new `validateAndSanitizeRegistry()` function against a registry containing the exact "legitimate but imperfect" schema shapes described above:
```
TEST 1 (realistic imperfect schema loads): PASS
TEST 2 (one bad schema skipped, one good schema loads): PASS
TEST 3 (genuinely invalid root rejected cleanly): PASS
TEST 4 (GitHub metadata response detected): PASS
```

---

## Fix #2 — Password / Secret Vault always reporting "incorrect credential"

### Root cause
The password/vault unlock flow had **no way to distinguish** a genuinely wrong password from every other possible failure:
- A not-yet-initialized vault
- A corrupted local password/vault blob
- A GitHub/network issue while trying to bootstrap the vault from the repository
- The Web Crypto API being unavailable in the current context

**Any one of these could surface as "Incorrect password," even when the correct password was entered.**

### The fix
1. **`verifyPasswordDetailed()`** (replaces the old boolean-only check) returns a specific `VaultErrorCode` for every distinct failure: `incorrect-password`, `empty-password`, `vault-corrupted`, `encryption-error`. **Only a genuine AES-GCM decryption mismatch is ever reported as `incorrect-password`.**
2. **Vault vs. GitHub authentication are now fully separate.** `secretVaultService.tryAutoUnlock()` distinguishes:
   - A **local** vault blob failing to decrypt → genuinely `incorrect-password` (there IS a real credential to check).
   - A **repository bootstrap** failure (network/GitHub auth issue while fetching a not-yet-locally-cached vault) → **never** reported as incorrect password; falls through to creating a fresh local vault, exactly as V15 did.
3. **Hardened `cryptoService.ts`**: `encryptWithSecret`/`decryptWithSecret` never throw uncaught exceptions — every failure (missing Web Crypto, malformed blob, wrong key) returns a structured, distinct result.
4. **No secrets exposed.** The default administrative password remains `admin` internally (unchanged), never displayed, logged, or stored in plaintext — only its encrypted representation is ever persisted, exactly as before.

### Empirical verification (real headless Chromium browser, via Playwright)
```
TEST 1 (correct 'admin' password unlocks): PASS
TEST 2 (incorrect password rejected properly): PASS
TEST 3 (empty password distinct message): PASS
```
Specifically: typing `admin` into the Settings lock screen unlocks Settings with **zero** "Incorrect password" message; typing a wrong password correctly shows "Incorrect password" and stays locked; leaving the field empty shows "Please enter a password" — never conflated with a wrong-password error.

---

## Schema Format Consistency & Cross-Device Sync (verified, unchanged)
Create/Import/Update/Save/Upload/Sync/Download/Active-Schema-load all continue to use the same canonical `SchemaModel`/`SchemaRegistry` structure — no separate local/remote format. Cross-device discovery (`discoverPublicRegistry()`) remains fully automatic on every app load, requiring no manual repository file copying or Pull Request.

## No Regression (verified)
All 7 app routes (Quick Start, Read Only Query Builder, CR Query Builder, Schema, Error Rectifier, Settings, About) were tested over **both** `http://` and `file://` protocols — **14/14 passed**, zero JavaScript errors. A live functional check confirmed selecting a table in the Query Builder correctly regenerates SQL with **no page refresh** and no errors, preserving existing state exactly as required.

## How to use this build
**Just double-click `dist/index.html`.** No server, build step, or install required — verified working via direct `file://` double-click simulation.

## Verified before packaging
- `tsc --noEmit` (strict mode): 0 errors across all 62 source files.
- esbuild bundle: 0 syntax errors.
- Direct unit-level test of the new lenient schema validator: 4/4 passed.
- Playwright + real headless Chromium: password unlock flow 3/3 passed; full route regression 14/14 passed; functional Query Builder interaction check passed.
