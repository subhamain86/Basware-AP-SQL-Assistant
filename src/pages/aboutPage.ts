import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `<div class="page" data-tour="about-panel"><h1 class="page-title">${icon('info')} About AP-SQL Assistant</h1><p>AP-SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing deep, memorized knowledge of the underlying database schema.</p><p>Packaged as a single self-contained HTML file (CSS and JavaScript bundled with esbuild) — so it works identically whether opened directly by double-click (file://) or served over http/https.</p>
  <h3 class="section-title">V16.5 — Active Schema Sync: fixed for the common (no-login) flow</h3>
  <p>V16.4 made Active Schema selections synchronizable across devices, but only via the authenticated GitHub pull path — which only runs once the user manually unlocks Settings with the Admin Password (that unlock state is session-only and is not remembered across page reloads). Since most users never open Settings just to browse or run a query, Active Schema sync effectively never fired for the common flow, even though schema content itself already synchronized silently on every app load. This release closes that gap: the same silent, unauthenticated, public GitHub read that already keeps the schema catalogue in sync on every app load now also applies the Active Schema pointer using the identical last-write-wins comparison — no new credential or trust requirement is introduced, and an intentional local selection still cannot be overwritten by an older remote one.</p>
  <h3 class="section-title">V16.4 — Cross-device Schema Sync fix</h3>
  <p>Pushing to the central GitHub repository previously serialized only the local schema list, so a schema that existed only on another device could be silently dropped from the repository on the next push from this one — pushes now merge in anything remote-only first, and defer to the existing conflict-resolution UI instead of guessing if genuine content differs.</p>
  <h3 class="section-title">M365 Copilot Enterprise Integration</h3>
  <p>Describe What You Need can optionally use your organization's M365 Copilot Enterprise agent to help interpret natural-language requests, using Microsoft's standard identity-platform sign-in (no stored passwords or hard-coded credentials). It is off by default: nothing changes until an administrator configures it in Settings → Secret Vault. Whenever it is used, the offline engine still resolves the final SQL against your Active Schema — Copilot can never introduce a table or column that isn't already in your schema, and it cannot modify the schema itself. If Copilot is unavailable, unreachable, or not configured, the app falls back to the existing offline engine automatically.</p>
  <h3 class="section-title">V16.3 — GitHub sync validation fix</h3>
  <p>Fixed a recurring "Remote schema file failed validation" error by sanitizing incoming schema data before validating it, and downgrading referential-integrity drift (dangling foreign keys, duplicate columns) from blocking errors to non-blocking warnings.</p>
  <h3 class="section-title">V16.2 — Error box visibility hardening</h3>
  <p>Every transient status/error indicator in the app is only ever inserted into the page when there is an actual active error, making "no error visible when there is no error" independent of CSS cascade behaviour entirely.</p>
  <h3 class="section-title">V16.1 — Regression fixes</h3>
  <p>Card sizing/spacing restored; GitHub synchronization no longer rejects validly imported schemas with real-world data types.</p>
  <h3 class="section-title">Fix — Storage quota exceeded</h3>
  <p>Every localStorage write goes through a hardened <code>safeLocalStorageSet()</code> helper that automatically prunes duplicate/stale schemas and retries on quota errors.</p>
  <h3 class="section-title">Fix — Blank page on double-click</h3>
  <p>The app is bundled into a single plain (non-module) script embedded directly in the HTML, which works fully over the <code>file://</code> protocol.</p>
  <p class="hint">Current AI provider: ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
  <p class="hint">Strictly a SQL-text generator — never opens a database connection, never executes a query. Manual Schema Update's delete requires three confirmations, the last requiring the Admin Password; the GitHub access token and any M365 Copilot Enterprise credentials live only as encrypted ciphertext, always shown masked in the UI.</p>
  <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p></div>`;
}
