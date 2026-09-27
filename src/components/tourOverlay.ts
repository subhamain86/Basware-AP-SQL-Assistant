import type { WalkthroughStep, Route } from '../types';
import { store } from '../state/store';
export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  { id: 'w1', route: 'quickstart', targetSelector: '[data-tour="brand"]', title: 'Welcome to SQL Assistant', body: 'This tool writes read-only and Change Request SQL for you, using your organization\'s active schema as the single source of truth. Select the logo any time to return here.' },
  { id: 'w2', route: 'quickstart', targetSelector: '[data-tour="hamburger-btn"]', title: 'Hamburger Menu', body: 'All page navigation lives behind this button on the left of the navbar.' },
  { id: 'w3', route: 'quickstart', targetSelector: '[data-tour="navbar-sync"]', title: 'Sync Source & Sync Time', body: 'Schema synchronization is fully automatic once the Secret Vault is unlocked — these dropdowns control WHERE and HOW OFTEN background pulls happen. A brand-new schema uploaded on another device is now also discovered automatically on app load, even before you unlock the vault here.' },
  { id: 'w4', route: 'readonly', targetSelector: '[data-tour="describe-card"]', title: 'Describe What You Need', body: 'Describe a requirement in plain language. Both the online and offline engines always use your currently saved Active Schema.' },
  { id: 'w5', route: 'readonly', targetSelector: '[data-tour="module-selector"]', title: 'Module → Search → Select', body: 'Narrow the table list by Module, then search.' },
  { id: 'w6', route: 'readonly', targetSelector: '[data-tour="tab-tables-columns"]', title: 'Select Columns — Search + Select All', body: 'Search filters what\'s shown; "Select All" always selects every column for the selected table(s) regardless of the search filter.' },
  { id: 'w7', route: 'readonly', targetSelector: '[data-tour="tab-advanced"]', title: 'Advanced Options', body: 'Automatic Joins, WITH/CTEs, GROUP BY, HAVING, ORDER BY, LIMIT, DISTINCT, aggregates, and manual CASE/DECODE all live here.' },
  { id: 'w8', route: 'cr', targetSelector: '[data-tour="cr-query-type"]', title: 'Query Builder for CR', body: 'Same layout and stability as Read Only.' },
  { id: 'w9', route: 'schema-used', targetSelector: '[data-tour="schema-module-selector"]', title: 'Schema — Module & Search', body: 'Filter Tables (and Views) in the Active Schema. Any schema you create or import here is automatically synchronized once the Secret Vault is unlocked — no manual Pull Request needed.' },
  { id: 'w10', route: 'error-rectifier', targetSelector: '[data-tour="error-rectifier-form"]', title: 'Error Rectifier', body: 'Paste a database error and the SQL that caused it — always grounded in the active schema.' },
  { id: 'w11', route: 'settings', targetSelector: '[data-tour="settings-lock-screen"]', title: 'Settings is password protected', body: 'Enter the Admin Password to unlock Settings — this automatically unlocks (or bootstraps, on a brand-new machine) the Secret Vault and starts synchronizing schemas in the background.' },
  { id: 'w12', route: 'about', targetSelector: '[data-tour="about-panel"]', title: 'About', body: 'Version history and architecture notes for SQL Assistant.' }
];
export class GuidedTour {
  private index = 0;
  private overlay?: HTMLDivElement;
  private navigate: (r: Route) => void;
  private steps: WalkthroughStep[];
  constructor(navigate: (r: Route) => void, steps: WalkthroughStep[] = WALKTHROUGH_STEPS) { this.navigate = navigate; this.steps = steps; }
  start(): void { this.index = 0; this.showStep(); }
  private cleanup(): void { this.overlay?.remove(); this.overlay = undefined; }
  exit(): void { this.cleanup(); store.markWalkthroughSeen(); }
  private showStep(): void {
    const step = this.steps[this.index];
    if (!step) { this.exit(); return; }
    if (store.route !== step.route) this.navigate(step.route);
    const needsMenuOpen = step.targetSelector.includes('hamburger-panel') || step.id === 'w2';
    if (needsMenuOpen) { const toggler = document.querySelector<HTMLButtonElement>('#navToggle'); if (toggler && toggler.getAttribute('aria-expanded') !== 'true') toggler.click(); }
    requestAnimationFrame(() => requestAnimationFrame(() => this.render(step)));
  }
  private render(step: WalkthroughStep): void {
    this.cleanup();
    const target = document.querySelector<HTMLElement>(step.targetSelector);
    const overlay = document.createElement('div'); overlay.className = 'tour-overlay';
    const rect = target?.getBoundingClientRect();
    const spotlightStyle = rect ? `top:${Math.max(4, rect.top - 6)}px;left:${Math.max(4, rect.left - 6)}px;width:${rect.width + 12}px;height:${rect.height + 12}px;` : 'display:none;';
    let popupTop = rect ? rect.bottom + 16 : window.innerHeight / 2 - 100;
    const popupWidth = Math.min(420, window.innerWidth - 32);
    let popupLeft = rect ? Math.min(Math.max(16, rect.left), window.innerWidth - popupWidth - 16) : (window.innerWidth - popupWidth) / 2;
    if (popupTop + 220 > window.innerHeight) popupTop = Math.max(16, (rect?.top || window.innerHeight / 2) - 236);
    const dots = this.steps.map((_, i) => `<span class="tour-dot ${i === this.index ? 'active' : ''}"></span>`).join('');
    overlay.innerHTML = `<div class="tour-spotlight" style="${spotlightStyle}"></div><div class="tour-popup" style="top:${popupTop}px; left:${popupLeft}px; width:${popupWidth}px;"><div class="tour-step-label">Step ${this.index + 1} of ${this.steps.length}</div><h4>${step.title}</h4><p>${step.body}</p><div class="tour-dots">${dots}</div><div class="tour-actions"><button id="tourExit" class="btn btn-ghost" type="button">Exit</button><button id="tourSkip" class="btn btn-ghost" type="button">Skip</button><div class="tour-actions-right"><button id="tourPrev" class="btn btn-ghost" type="button" ${this.index === 0 ? 'disabled' : ''}>Back</button><button id="tourNext" class="btn btn-primary" type="button">${this.index === this.steps.length - 1 ? 'Finish' : 'Next'}</button></div></div></div>`;
    document.body.appendChild(overlay); this.overlay = overlay;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    overlay.querySelector('#tourExit')?.addEventListener('click', () => this.exit());
    overlay.querySelector('#tourSkip')?.addEventListener('click', () => this.exit());
    overlay.querySelector('#tourPrev')?.addEventListener('click', () => { this.index = Math.max(0, this.index - 1); this.showStep(); });
    overlay.querySelector('#tourNext')?.addEventListener('click', () => { if (this.index === this.steps.length - 1) { this.exit(); return; } this.index += 1; this.showStep(); });
  }
}
