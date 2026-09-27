import { icon } from './icons';
import { logoMarkSvg } from './logoMark';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { syncService } from '../services/syncService';
import { isBrowserOnline } from '../services/onlineNlpService';
import type { Route, Theme, SyncSource, SyncTimeOption } from '../types';
interface NavLeaf { id: Route; label: string; icon: Parameters<typeof icon>[0]; }
const NAV_STRUCTURE: NavLeaf[] = [
  { id: 'quickstart', label: 'Quick Start', icon: 'compass' },
  { id: 'readonly', label: 'Read Only Query Builder', icon: 'table' },
  { id: 'cr', label: 'Query Builder for CR', icon: 'edit' },
  { id: 'schema-used', label: 'Schema', icon: 'database' },
  { id: 'error-rectifier', label: 'Error Rectifier', icon: 'bug' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'about', label: 'About', icon: 'info' }
];
export function renderNavbar(container: HTMLElement, onNavigate: (r: Route) => void, onStartTour: () => void, signatureName: string): void {
  let menuOpen = false;
  function activeRoute(): Route { return store.route; }
  function draw(): void {
    const activeSchema = schemaService.getActiveSchema();
    const settingsLockIcon = store.settingsUnlocked ? 'unlock' : 'lock';
    const online = isBrowserOnline();
    container.innerHTML = `
      <nav class="navbar">
        <div class="container-fluid navbar-inner">
          <div class="navbar-left-cluster">
            <button class="navbar-toggler" id="navToggle" type="button" aria-label="Toggle navigation menu" aria-expanded="${menuOpen}">${icon('menu', 22)}</button>
            <button class="hero-brand-row" id="logoHomeBtn" type="button" aria-label="Go to Quick Start" data-tour="brand">
              <span class="app-logo-badge">${logoMarkSvg(26)}</span>
              <span class="brand-text"><span class="builder-heading">AP-SQL Assistant</span><span class="small">V15</span></span>
            </button>
          </div>
          <div class="navbar-right-cluster">
            <span class="schema-badge" title="Active schema">${icon('database', 14)} ${activeSchema.name}</span>
            <span class="net-status-badge ${online ? 'is-online' : 'is-offline'}">${icon(online ? 'wifi' : 'wifi-off', 14)}</span>
            <span class="settings-lock-badge ${store.settingsUnlocked ? 'is-unlocked' : ''}">${icon(settingsLockIcon, 14)}</span>
            <span class="navbar-signature" title="Crafted by ${signatureName}">${icon('user', 14)} <span>${signatureName}</span></span>
          </div>
        </div>
      </nav>
      <div class="hamburger-overlay ${menuOpen ? 'open' : ''}" id="hamburgerOverlay" ${menuOpen ? '' : 'hidden'}>
        <div class="hamburger-panel" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div class="hamburger-panel-header">
            <span class="hamburger-panel-title">${icon('menu', 18)} Navigation</span>
            <button type="button" class="icon-btn" id="hamburgerCloseBtn" aria-label="Close menu">${icon('x', 18)}</button>
          </div>
          <div class="hamburger-panel-body">
            ${NAV_STRUCTURE.map((entry) => `<a href="#${entry.id}" data-route="${entry.id}" class="hb-link ${activeRoute() === entry.id ? 'active' : ''}">${icon(entry.icon, 18)}<span>${entry.label}</span></a>`).join('')}
          </div>
        </div>
      </div>`;
    wireEvents();
  }
  function closeMenu(): void { menuOpen = false; draw(); }
  function openMenu(): void { menuOpen = true; draw(); }
  function wireEvents(): void {
    container.querySelector<HTMLButtonElement>('#navToggle')?.addEventListener('click', () => { menuOpen ? closeMenu() : openMenu(); });
    container.querySelector('#hamburgerCloseBtn')?.addEventListener('click', closeMenu);
    container.querySelector('#hamburgerOverlay')?.addEventListener('click', (e) => { if (e.target === container.querySelector('#hamburgerOverlay')) closeMenu(); });
    container.querySelector<HTMLButtonElement>('#logoHomeBtn')?.addEventListener('click', () => { onNavigate('quickstart'); });
    container.querySelectorAll<HTMLAnchorElement>('[data-route]').forEach((a) => { a.addEventListener('click', (e) => { e.preventDefault(); onNavigate(a.dataset.route as Route); closeMenu(); }); });
  }
  store.subscribe(draw);
  schemaService.subscribe(draw);
  syncService.subscribe(draw);
  window.addEventListener('online', draw);
  window.addEventListener('offline', draw);
  draw();
}
