import type { WalkthroughStep, Route } from '../types';
import { store } from '../state/store';
export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  { id: 'w1', route: 'quickstart', targetSelector: '[data-tour="brand"]', title: 'Welcome', body: 'This tool writes SQL for you using your active schema.' }
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
    requestAnimationFrame(() => this.render(step));
  }
  private render(step: WalkthroughStep): void {
    this.cleanup();
    const overlay = document.createElement('div'); overlay.className = 'tour-overlay';
    overlay.innerHTML = `<div class="tour-popup" style="top:100px;left:100px;width:320px;"><h4>${step.title}</h4><p>${step.body}</p><div class="tour-actions"><button id="tourExit" class="btn btn-ghost" type="button">Exit</button><button id="tourNext" class="btn btn-primary" type="button">Finish</button></div></div>`;
    document.body.appendChild(overlay); this.overlay = overlay;
    overlay.querySelector('#tourExit')?.addEventListener('click', () => this.exit());
    overlay.querySelector('#tourNext')?.addEventListener('click', () => this.exit());
  }
}
