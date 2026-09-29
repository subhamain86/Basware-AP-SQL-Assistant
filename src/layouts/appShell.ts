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
import { initAutoSync, setAutoSyncToastHandler, performPublicDiscovery } from '../services/autoSyncService';
import type { Route } from '../types';
const VALID_ROUTES: Route[] = ['quickstart', 'readonly', 'cr', 'schema-used', 'error-rectifier', 'settings', 'about'];
const SIGNATURE_NAME = 'Subham Ain';
export function mountAppShell(root: HTMLElement): void {
  root.innerHTML = '';
  const shell = document.createElement('div'); shell.className = 'app-shell';
  const navSlot = document.createElement('div'); const mainSlot = document.createElement('main'); mainSlot.className = 'app-main';
  shell.appendChild(navSlot); shell.appendChild(mainSlot); root.appendChild(shell);
  const footer = document.createElement('footer'); footer.className = 'app-footer';
  footer.innerHTML = `<span>AP-SQL Assistant · Version 16.5</span><span>Crafted by ${SIGNATURE_NAME}</span>`;
  root.appendChild(footer);
  mountToastContainer(root);
  setAutoSyncToastHandler((kind, text) => store.pushToast(kind, text));
  initAutoSync();
  // V16.5: this call is what carries the fix — performPublicDiscovery now
  // also synchronizes the Active Schema pointer (in addition to schema
  // content, which it already did), and it runs here unconditionally on
  // every app load, regardless of whether Settings has ever been unlocked.
  performPublicDiscovery('app-load').catch(() => {});
  function routeFromHash(): Route { const h = window.location.hash.replace('#', '') as Route; return VALID_ROUTES.includes(h) ? h : 'quickstart'; }
  function navigate(route: Route): void { window.location.hash = route; }
  const tour = new GuidedTour(navigate);
  function renderPage(route: Route): void {
    const prev = mainSlot.firstElementChild as any; if (prev && typeof prev._cleanup === 'function') prev._cleanup();
    const pageEl = document.createElement('div'); pageEl.className = 'page-mount'; mainSlot.innerHTML = ''; mainSlot.appendChild(pageEl);
    switch (route) {
      case 'readonly': renderReadOnlyBuilderPage(pageEl); break;
      case 'cr': renderCrBuilderPage(pageEl); break;
      case 'schema-used': renderSchemaPage(pageEl); break;
      case 'error-rectifier': renderErrorRectifierPage(pageEl); break;
      case 'settings': renderSettingsPage(pageEl); break;
      case 'about': renderAboutPage(pageEl); break;
      case 'quickstart': default: renderQuickstartPage(pageEl, navigate); break;
    }
  }
  function renderAll(): void { const route = routeFromHash(); store.setRoute(route); renderPage(route); }
  window.addEventListener('hashchange', renderAll);
  let lastKnownSettingsLockState = store.settingsUnlocked;
  store.subscribe(() => { if (store.route === 'settings' && store.settingsUnlocked !== lastKnownSettingsLockState) { lastKnownSettingsLockState = store.settingsUnlocked; renderPage('settings'); } });
  renderNavbar(navSlot, navigate, () => tour.start(), SIGNATURE_NAME);
  renderAll();
}
