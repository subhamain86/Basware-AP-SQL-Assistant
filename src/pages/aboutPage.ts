import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `<div class="page" data-tour="about-panel">
    <h2>${icon('info')} About AP-SQL Assistant</h2>
    <p>AP-SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing deep, memorized knowledge of the underlying database schema.</p>
    <p><strong>Version 15</strong> is a from-scratch rebuild focused on reliability: it is packaged as a single self-contained HTML file (CSS and JavaScript inlined, bundled with esbuild — a real AST-based bundler, not a text-substitution hack) so it works identically whether opened directly by double-click (file://) or served over http/https.</p>
    <h4>Fix 1 — Storage quota exceeded, fixed</h4>
    <p>Every localStorage write now goes through a hardened <code>safeLocalStorageSet()</code> helper that automatically prunes duplicate/stale schemas and retries (with escalating aggressiveness) on quota errors.</p>
    <h4>Fix 2 — Cross-device schema sync gap, fixed</h4>
    <p>The app now performs an automatic, read-only, unauthenticated discovery pull on every app load — closing the gap without requiring the vault to be unlocked just to receive updates.</p>
    <h4>Fix 3 — Blank page on double-click, fixed</h4>
    <p>Previous builds used native ES modules (<code>&lt;script type="module"&gt;</code>), which browsers block from loading over the <code>file://</code> protocol for security reasons — causing a blank page when the file was opened directly rather than served. V15 is bundled into a single plain (non-module) script embedded directly in the HTML, which has no such restriction.</p>
    <p>Current AI provider: ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
    <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p>
  </div>`;
}
