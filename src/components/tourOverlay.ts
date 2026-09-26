import type { WalkthroughStep, Route } from '../types';
import { store } from '../state/store';

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  { id: 'w1', route: 'quickstart', targetSelector: '[data-tour="brand"]', title: 'Welcome to AP-SQL Assistant V13.2', body: 'This tool writes read-only and Change Request SQL for you, using your organization\'s active schema as the single source of truth.' },
  { id: 'w2', route: 'quickstart', targetSelector: '[data-tour="hamburger-btn"]', title: 'Hamburger Menu', body: 'All page navigation lives behind this single button. Select it to open Quick Start, Query Builder, Schema, Error Rectifier, Settings, and About.' },
  { id: 'w3', route: 'quickstart', targetSelector: '[data-tour="navbar-sync"]', title: 'Sync Source & Sync Time', body: 'These two dropdowns are the ONLY schema-sync controls in the navbar — choose Shared Location or GitHub as your source, and how often to sync. Detailed configuration (repository, credentials, Vault) lives inside Settings.' },
  { id: 'w4', route: 'readonly', targetSelector: '[data-tour="describe-card"]', title: 'Describe What You Need', body: 'Type a plain-language requirement — including relative dates like "this month" or "last week" — and select Build Query.' },
  { id: 'w5', route: 'readonly', targetSelector: '[data-tour="generated-sql-card"]', title: 'Generated SQL', body: 'Your SQL appears here in real time, already passed through AI self-review before being shown to you.' },
  { id: 'w6', route: 'readonly', targetSelector: '[data-tour="tab-tables-columns"]', title: 'Tables & Columns', body: 'Manually pick tables, columns, and build filters — always kept in sync with whatever the AI interpreted.' },
  { id: 'w7', route: 'readonly', targetSelector: '[data-tour="tab-advanced"]', title: 'Advanced Options', body: 'Sorting, grouping, aggregation, joins, limits, DISTINCT and CASE/DECODE all live here.' },
  { id: 'w8', route: 'readonly', targetSelector: '[data-tour="tab-summary"]', title: 'Selected / Described Requirements', body: 'A live summary of everything selected or described so far.' },
  { id: 'w9', route: 'cr', targetSelector: '[data-tour="cr-query-type"]', title: 'Query Builder for CR', body: 'Build INSERT / UPDATE / DELETE statements, including from a natural-language description like "Update the payment status to PAID for invoice 12345."' },
  { id: 'w10', route: 'schema-used', targetSelector: '[data-tour="schema-list"]', title: 'Schema', body: 'Switch between stored schemas, view active/default status, import/export. Manual editing now lives only inside Settings.' },
  { id: 'w11', route: 'error-rectifier', targetSelector: '[data-tour="error-rectifier-form"]', title: 'Error Rectifier', body: 'Paste a database error and the SQL that caused it — always grounded in the current active schema.' },
  { id: 'w12', route: 'settings', targetSelector: '[data-tour="settings-lock-screen"]', title: 'Settings is password protected', body: 'Selecting Settings shows this authentication screen first. The same operational password used elsewhere unlocks it — the password itself is encrypted at rest, never stored in plain text.' },
  { id: 'w13', route: 'about', targetSelector: '[data-tour="about-panel"]', title: 'About', body: 'Version history, architecture, and safety notes for AP-SQL Assistant.' }
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
    const needsMenuOpen = step.targetSelector.includes('hamburger') || step.id === 'w2';
    if (needsMenuOpen) { const toggler = document.querySelector<HTMLButtonElement>('#navToggle'); if (toggler && toggler.getAttribute('aria-expanded') !== 'true') toggler.click(); }
    requestAnimationFrame(() => requestAnimationFrame(() => this.render(step)));
  }

  private render(step: WalkthroughStep): void {
    this.cleanup();
    const target = document.querySelector<HTMLElement>(step.targetSelector);
    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    const rect = target?.getBoundingClientRect();
    const spotlightStyle = rect ? `top:${Math.max(4, rect.top - 6)}px;left:${Math.max(4, rect.left - 6)}px;width:${rect.width + 12}px;height:${rect.height + 12}px;` : 'display:none;';
    let popupTop = rect ? rect.bottom + 16 : window.innerHeight / 2 - 100;
    const popupWidth = Math.min(420, window.innerWidth - 32);
    let popupLeft = rect ? Math.min(Math.max(16, rect.left), window.innerWidth - popupWidth - 16) : (window.innerWidth - popupWidth) / 2;
    if (popupTop + 220 > window.innerHeight) popupTop = Math.max(16, (rect?.top || window.innerHeight / 2) - 236);
    const dots = this.steps.map((_, i) => `<span class="tour-dot ${i === this.index ? 'active' : ''}"></span>`).join('');
    overlay.innerHTML = `
      <div class="tour-spotlight" style="${spotlightStyle}"></div>
      <div class="tour-popup" style="top:${popupTop}px; left:${popupLeft}px; width:${popupWidth}px;">
        <div class="tour-step-label">Step ${this.index + 1} of ${this.steps.length}</div>
        <h4>${step.title}</h4><p>${step.body}</p>
        <div class="tour-dots">${dots}</div>
        <div class="tour-actions">
          <button id="tourExit" class="btn btn-ghost" type="button">Exit</button>
          <button id="tourSkip" class="btn btn-ghost" type="button">Skip</button>
          <div class="tour-actions-right">
            <button id="tourPrev" class="btn btn-ghost" type="button" ${this.index === 0 ? 'disabled' : ''}>Back</button>
            <button id="tourNext" class="btn btn-primary" type="button">${this.index === this.steps.length - 1 ? 'Finish' : 'Next'}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay); this.overlay = overlay;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    overlay.querySelector('#tourExit')?.addEventListener('click', () => this.exit());
    overlay.querySelector('#tourSkip')?.addEventListener('click', () => this.exit());
    overlay.querySelector('#tourPrev')?.addEventListener('click', () => { this.index = Math.max(0, this.index - 1); this.showStep(); });
    overlay.querySelector('#tourNext')?.addEventListener('click', () => { if (this.index === this.steps.length - 1) { this.exit(); return; } this.index += 1; this.showStep(); });
  }
}
