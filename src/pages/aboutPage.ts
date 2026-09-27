import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `<div class="page" data-tour="about-panel">
    <h2>${icon('info')} About AP-SQL Assistant</h2>
    <p>AP-SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing deep, memorized knowledge of the underlying database schema.</p>
    <p><strong>Version 15</strong> is a from-scratch rebuild with full UI parity to the original design, packaged as a single self-contained HTML file (CSS and JavaScript bundled with esbuild, a real AST-based bundler) — so it works identically whether opened directly by double-click (file://) or served over http/https.</p>
    <h4>Fix 1 — Storage quota exceeded, fixed</h4>
    <p>Every localStorage write now goes through a hardened <code>safeLocalStorageSet()</code> helper that automatically prunes duplicate/stale schemas and retries (with escalating aggressiveness across up to 4 attempts) on quota errors. Duplicate schemas re-imported under the same name are updated in place instead of piling up forever.</p>
    <h4>Fix 2 — Cross-device schema sync gap, fixed</h4>
    <p>The app now performs an automatic, read-only, unauthenticated discovery pull on every app load — closing the gap without requiring the Secret Vault to be unlocked just to receive updates. Publishing changes still correctly requires the vault to be unlocked.</p>
    <h4>Fix 3 — Blank page on double-click, fixed</h4>
    <p>Previous builds used native ES modules (<code>&lt;script type="module"&gt;</code>), which browsers block from loading over the <code>file://</code> protocol for security reasons. V15 is bundled into a single plain (non-module) script embedded directly in the HTML, which has no such restriction — verified with a real headless Chromium browser across every page.</p>
    <p>Current AI provider: ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
    <p>Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations, the last requiring the Admin Password; the GitHub access token lives only as encrypted ciphertext, always shown masked in the UI.</p>
    <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p>
  </div>`;
}
