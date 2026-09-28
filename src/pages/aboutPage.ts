import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `<div class="page" data-tour="about-panel"><h1 class="page-title">${icon('info')} About AP-SQL Assistant</h1><p>AP-SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing deep, memorized knowledge of the underlying database schema.</p><p>Packaged as a single self-contained HTML file (CSS and JavaScript bundled with esbuild) — so it works identically whether opened directly by double-click (file://) or served over http/https.</p>
  <h3 class="section-title">M365 Copilot Enterprise Integration</h3>
  <p>Describe What You Need can optionally use your organization's M365 Copilot Enterprise agent to help interpret natural-language requests, using Microsoft's standard identity-platform sign-in (no stored passwords or hard-coded credentials). It is off by default: nothing changes until an administrator configures it in Settings → Secret Vault. Whenever it is used, the offline engine still resolves the final SQL against your Active Schema — Copilot can never introduce a table or column that isn't already in your schema, and it cannot modify the schema itself. If Copilot is unavailable, unreachable, or not configured, the app falls back to the existing offline engine automatically.</p>
  <h3 class="section-title">V16.1 — Regression fixes</h3>
  <p>This release restores the previously approved card sizing/spacing, permanently fixes a GitHub synchronization issue that could reject a validly imported schema with "Remote schema file failed validation", and ensures the sync error indicator is hidden whenever there is no active error and clears itself the moment a later synchronization succeeds.</p>
  <h3 class="section-title">Fix — Storage quota exceeded</h3>
  <p>Every localStorage write goes through a hardened <code>safeLocalStorageSet()</code> helper that automatically prunes duplicate/stale schemas and retries on quota errors.</p>
  <h3 class="section-title">Fix — Cross-device schema sync gap</h3>
  <p>The app performs an automatic, read-only, unauthenticated discovery pull on every app load.</p>
  <h3 class="section-title">Fix — Blank page on double-click</h3>
  <p>The app is bundled into a single plain (non-module) script embedded directly in the HTML, which works fully over the <code>file://</code> protocol.</p>
  <p class="hint">Current AI provider: ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
  <p class="hint">Strictly a SQL-text generator — never opens a database connection, never executes a query. Manual Schema Update's delete requires three confirmations, the last requiring the Admin Password; the GitHub access token and any M365 Copilot Enterprise credentials live only as encrypted ciphertext, always shown masked in the UI.</p>
  <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p></div>`;
}
