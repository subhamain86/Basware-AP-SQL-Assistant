import { renderNavbar } from '../components/hamburgerNav';
import { mountToastContainer } from '../components/toast';
import { renderQuickstartPage } from '../pages/quickstartPage';
import { renderReadOnlyBuilderPage } from '../pages/readOnlyBuilderPage';
import { renderCrBuilderPage } from '../pages/crBuilderPage';
import { renderSchemaPage } from '../pages/schemaPage';
import { renderErrorRectifierPage } from '../pages/errorRectifierPage';
import { renderSettingsPage } from '../pages/settingsPage';
import { renderAboutPage } from '../pages/aboutPage';
import { GuidedTour } from '../components/tourOverlay';
import { store } from '../state/store';
import type { Route } from '../types';

const VALID_ROUTES: Route[] = ['quickstart', 'readonly', 'cr', 'schema-used', 'error-rectifier', 'settings', 'about'];

export function mountAppShell(root: HTMLElement): void {
  root.innerHTML = '';
  const shell = document.createElement('div'); shell.className = 'app-shell';
  const navSlot = document.createElement('div'); const mainSlot = document.createElement('main'); mainSlot.className = 'app-main';
  shell.appendChild(navSlot); shell.appendChild(mainSlot); root.appendChild(shell);

  const footer = document.createElement('footer'); footer.className = 'app-footer';
  footer.innerHTML = `<span>AP-SQL Assistant · Version 13.2</span><span class="hint">Crafted by Subham Ain</span>`;
  root.appendChild(footer);

  mountToastContainer(root);

  function routeFromHash(): Route { const h = window.location.hash.replace('#', '') as Route; return VALID_ROUTES.includes(h) ? h : 'quickstart'; }
  function navigate(route: Route): void { window.location.hash = route; }
  const tour = new GuidedTour(navigate);

  function renderPage(route: Route): void {
    const prev = mainSlot.firstElementChild as any;
    if (prev && typeof prev._cleanup === 'function') prev._cleanup();
    const pageEl = document.createElement('div'); mainSlot.innerHTML = ''; mainSlot.appendChild(pageEl);
    switch (route) {
      case 'readonly': renderReadOnlyBuilderPage(pageEl); break;
      case 'cr': renderCrBuilderPage(pageEl); break;
      case 'schema-used': renderSchemaPage(pageEl); break;
      case 'error-rectifier': renderErrorRectifierPage(pageEl); break;
      case 'settings': renderSettingsPage(pageEl); break;
      case 'about': renderAboutPage(pageEl); break;
      case 'quickstart':
      default: renderQuickstartPage(pageEl, navigate); break;
    }
  }

  function renderAll(): void { const route = routeFromHash(); store.setRoute(route); renderPage(route); }
  window.addEventListener('hashchange', renderAll);

  // Only force a full Settings re-render when the LOCK STATE itself flips
  // (locked <-> unlocked) — e.g. from the "Lock Settings" inactivity timer
  // firing while the user is on another tab. Re-rendering on every store
  // notification (which fires on every toast, every Query Builder keystroke,
  // etc.) would otherwise reset the active Settings tab back to "Security"
  // any time the user does anything at all inside Settings.
  let lastKnownSettingsLockState = store.settingsUnlocked;
  store.subscribe(() => {
    if (store.route === 'settings' && store.settingsUnlocked !== lastKnownSettingsLockState) {
      lastKnownSettingsLockState = store.settingsUnlocked;
      renderPage('settings');
    }
  });

  renderNavbar(navSlot, navigate, () => tour.start());
  renderAll();
}
