import { renderNavbar } from '../components/hamburgerNav.js';
import { mountToastContainer } from '../components/toast.js';
import { renderQuickstartPage } from '../pages/quickstartPage.js';
import { renderReadOnlyBuilderPage } from '../pages/readOnlyBuilderPage.js';
import { renderCrBuilderPage } from '../pages/crBuilderPage.js';
import { renderSchemaPage } from '../pages/schemaPage.js';
import { renderErrorRectifierPage } from '../pages/errorRectifierPage.js';
import { renderSettingsPage } from '../pages/settingsPage.js';
import { renderAboutPage } from '../pages/aboutPage.js';
import { GuidedTour } from '../components/tourOverlay.js';
import { store } from '../state/store.js';
import { initAutoSync, setAutoSyncToastHandler, performPublicDiscovery } from '../services/autoSyncService.js';
const VALID_ROUTES = ['quickstart', 'readonly', 'cr', 'schema-used', 'error-rectifier', 'settings', 'about'];
const SIGNATURE_NAME = 'Subham Ain';
export function mountAppShell(root) {
    root.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    const navSlot = document.createElement('div');
    const mainSlot = document.createElement('main');
    mainSlot.className = 'app-main';
    shell.appendChild(navSlot);
    shell.appendChild(mainSlot);
    root.appendChild(shell);
    const footer = document.createElement('footer');
    footer.className = 'app-footer';
    footer.innerHTML = `<span>SQL Assistant · Version 14.7</span><span>Crafted by ${SIGNATURE_NAME}</span>`;
    root.appendChild(footer);
    mountToastContainer(root);
    setAutoSyncToastHandler((kind, text) => store.pushToast(kind, text));
    initAutoSync();
    // V14.7 — THE fix for "other device is not getting the uploaded schema
    // synced": perform a read-only, unauthenticated discovery pull against
    // the public repository on EVERY app load, regardless of whether the
    // Secret Vault is unlocked. This is what allows a schema uploaded on one
    // device to actually reach another device automatically — previously,
    // discovery was gated entirely behind the password-protected vault being
    // unlocked, so a schema published on Device A would never appear on
    // Device B until someone manually entered the Admin Password there.
    performPublicDiscovery('app-load').catch(() => { });
    function routeFromHash() { const h = window.location.hash.replace('#', ''); return VALID_ROUTES.includes(h) ? h : 'quickstart'; }
    function navigate(route) { window.location.hash = route; }
    const tour = new GuidedTour(navigate);
    function renderPage(route) {
        const prev = mainSlot.firstElementChild;
        if (prev && typeof prev._cleanup === 'function')
            prev._cleanup();
        const pageEl = document.createElement('div');
        pageEl.className = 'page-mount';
        mainSlot.innerHTML = '';
        mainSlot.appendChild(pageEl);
        switch (route) {
            case 'readonly':
                renderReadOnlyBuilderPage(pageEl);
                break;
            case 'cr':
                renderCrBuilderPage(pageEl);
                break;
            case 'schema-used':
                renderSchemaPage(pageEl);
                break;
            case 'error-rectifier':
                renderErrorRectifierPage(pageEl);
                break;
            case 'settings':
                renderSettingsPage(pageEl);
                break;
            case 'about':
                renderAboutPage(pageEl);
                break;
            case 'quickstart':
            default:
                renderQuickstartPage(pageEl, navigate);
                break;
        }
    }
    function renderAll() { const route = routeFromHash(); store.setRoute(route); renderPage(route); }
    window.addEventListener('hashchange', renderAll);
    let lastKnownSettingsLockState = store.settingsUnlocked;
    store.subscribe(() => { if (store.route === 'settings' && store.settingsUnlocked !== lastKnownSettingsLockState) {
        lastKnownSettingsLockState = store.settingsUnlocked;
        renderPage('settings');
    } });
    renderNavbar(navSlot, navigate, () => tour.start(), SIGNATURE_NAME);
    renderAll();
}
