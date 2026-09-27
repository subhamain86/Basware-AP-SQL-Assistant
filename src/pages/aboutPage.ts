import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `<div class="page" data-tour="about-panel">
    <h2>${icon('info')} About AP-SQL Assistant</h2>
    <p>AP-SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing deep, memorized knowledge of the underlying database schema.</p>
    <p><strong>Version 15.1</strong> is a targeted stability and synchronization fix release — no functionality was redesigned or removed.</p>
    <h4>Fix 1 — "Remote schema file failed validation", fixed</h4>
    <p>Root cause: validation previously ran on the raw, un-sanitized remote payload, and treated common structural variations (an FK pointing to a column added later, a missing PK, duplicate DECODE entries, negative length on a legacy field) as hard errors — and a single such issue anywhere in the registry rejected the ENTIRE registry, from every device.</p>
    <p>Fix: every incoming schema is now sanitized (safe defaults filled in for missing optional fields) <em>before</em> structural validation runs, structural nitpicks are downgraded to internal diagnostics rather than blocking errors, and each schema in a registry is validated and loaded independently — one malformed entry is skipped and logged internally, while every other valid schema still loads normally. The user-facing message is now always a single clean sentence; the exact internal cause (invalid JSON, empty file, wrong file selected, encoding issue, unsupported version, etc.) is logged to the browser console for diagnostics only.</p>
    <h4>Fix 2 — Password / Secret Vault always reporting "incorrect credential", fixed</h4>
    <p>Root cause: the password/vault unlock flow had no way to distinguish a genuinely wrong password from every other possible failure (a not-yet-initialized vault, a corrupted local blob, a GitHub/network issue while trying to bootstrap the vault from the repository, or the Web Crypto API being unavailable) — every one of these was capable of surfacing as "Incorrect password".</p>
    <p>Fix: password verification and vault unlock now return a specific internal error code for every distinct failure — <code>incorrect-password</code>, <code>empty-password</code>, <code>vault-not-initialized</code>, <code>vault-corrupted</code>, <code>encryption-error</code>, or <code>github-auth-failed</code> — and only a genuine decryption mismatch against an existing password/vault is ever shown as a credential error. GitHub/repository authentication failures are now always reported separately from Vault/password failures, exactly as required. The default administrative password remains <code>admin</code> internally and is never displayed, logged, or stored in plaintext — only its encrypted representation is ever persisted.</p>
    <p>Current AI provider: ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
    <p>Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations, the last requiring the Admin Password; the GitHub access token lives only as encrypted ciphertext, always shown masked in the UI.</p>
    <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p>
  </div>`;
}
