import { icon } from './icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { syncService } from '../services/syncService';
import { isBrowserOnline } from '../services/onlineNlpService';
import type { Route, Theme, SyncSource, SyncTimeOption } from '../types';

interface NavLeaf { id: Route; label: string; icon: Parameters<typeof icon>[0]; tourSelector?: string; }
interface NavGroup { id: string; label: string; icon: Parameters<typeof icon>[0]; children: NavLeaf[]; tourSelector?: string; }
const NAV_STRUCTURE: (NavLeaf | NavGroup)[] = [
  { id: 'quickstart', label: 'Quick Start', icon: 'compass' },
  { id: 'query-builder-group', label: 'Query Builder', icon: 'code', tourSelector: 'nav-query-builder', children: [
    { id: 'readonly', label: 'Read Only Query Builder', icon: 'table', tourSelector: 'nav-readonly' },
    { id: 'cr', label: 'Query Builder for CR', icon: 'edit', tourSelector: 'nav-cr' }
  ]},
  { id: 'schema-used', label: 'Schema', icon: 'database', tourSelector: 'nav-schema' },
  { id: 'error-rectifier', label: 'Error Rectifier', icon: 'bug', tourSelector: 'nav-error' },
  { id: 'settings', label: 'Settings', icon: 'settings', tourSelector: 'nav-settings' },
  { id: 'about', label: 'About', icon: 'info' }
];
function isGroup(entry: NavLeaf | NavGroup): entry is NavGroup { return 'children' in entry; }
const SYNC_SOURCE_LABELS: Record<SyncSource, string> = { 'shared-location': 'Shared Location', github: 'GitHub' };
const SYNC_TIME_LABELS: Record<SyncTimeOption, string> = { manual: 'Manual', '15m': 'Every 15 minutes', '30m': 'Every 30 minutes', '1h': 'Every 1 hour', '4h': 'Every 4 hours', '6h': 'Every 6 hours', daily: 'Daily', custom: 'Custom' };

export function renderNavbar(container: HTMLElement, onNavigate: (r: Route) => void, onStartTour: () => void, signatureName: string): void {
  let menuOpen = false;
  let expandedGroup: string | null = null;
  let sourceMenuOpen = false;
  let timeMenuOpen = false;

  function activeRoute(): Route { return store.route; }
  function routeIsInGroup(group: NavGroup): boolean { return group.children.some((c) => c.id === activeRoute()); }

  function draw(): void {
    const activeSchema = schemaService.getActiveSchema();
    const cfg = syncService.getConfig();
    const settingsLockIcon = store.settingsUnlocked ? 'unlock' : 'lock';
    const online = isBrowserOnline();

    container.innerHTML = `
      <nav class="navbar">
        <div class="container-fluid navbar-inner">
          <div class="navbar-left-cluster">
            <button class="navbar-toggler" id="navToggle" type="button" aria-label="Toggle navigation menu" aria-expanded="${menuOpen}" data-tour="hamburger-btn">${icon('menu', 22)}</button>
            <div class="hero-brand-row" data-tour="brand">
              <span class="app-logo-badge">${icon('logo', 24)}</span>
              <div class="brand-text"><span class="builder-heading">SQL Assistant</span><span class="small">V14.1</span></div>
            </div>
          </div>

          <div class="navbar-sync-cluster" data-tour="navbar-sync">
            <div class="sync-dropdown-wrap">
              <button class="sync-dropdown-btn" id="syncSourceBtn" type="button" aria-haspopup="true" aria-expanded="${sourceMenuOpen}">${icon('folder-sync', 15)} ${SYNC_SOURCE_LABELS[cfg.source]} ${icon('chevron-down', 13)}</button>
              <div class="sync-dropdown-menu" id="syncSourceMenu" ${sourceMenuOpen ? '' : 'hidden'}>
                <button type="button" data-source="shared-location">${icon('folder', 14)} Shared Location</button>
                <button type="button" data-source="github">${icon('github', 14)} GitHub</button>
              </div>
            </div>
            <div class="sync-dropdown-wrap">
              <button class="sync-dropdown-btn" id="syncTimeBtn" type="button" aria-haspopup="true" aria-expanded="${timeMenuOpen}">${icon('clock', 15)} ${SYNC_TIME_LABELS[cfg.time]} ${icon('chevron-down', 13)}</button>
              <div class="sync-dropdown-menu" id="syncTimeMenu" ${timeMenuOpen ? '' : 'hidden'}>
                ${(Object.keys(SYNC_TIME_LABELS) as SyncTimeOption[]).map((t) => `<button type="button" data-time="${t}">${SYNC_TIME_LABELS[t]}</button>`).join('')}
              </div>
            </div>
          </div>

          <div class="navbar-right-cluster">
            <span class="schema-badge" data-tour="active-schema-badge" title="Active schema">${icon('database', 14)} ${activeSchema.name}</span>
            <span class="net-status-badge ${online ? 'is-online' : 'is-offline'}" title="${online ? 'Browser reports online' : 'Browser reports offline — NLP will use the local engine'}">${icon(online ? 'wifi' : 'wifi-off', 14)}</span>
            <span class="settings-lock-badge ${store.settingsUnlocked ? 'is-unlocked' : ''}" title="Settings ${store.settingsUnlocked ? 'unlocked' : 'locked'}">${icon(settingsLockIcon, 14)}</span>
            <div class="theme-toggle-wrap" data-tour="theme-toggle">
              <button id="themeBtn" class="btn btn-ghost btn-sm icon-only" type="button" aria-haspopup="true" aria-expanded="false" title="Theme">${icon(themeIconName(), 18)}</button>
              <div id="themeMenu" class="theme-menu" hidden>
                <button data-theme-choice="system" type="button">${icon('monitor', 15)} System Default</button>
                <button data-theme-choice="light" type="button">${icon('sun', 15)} Light</button>
                <button data-theme-choice="dark" type="button">${icon('moon', 15)} Dark</button>
              </div>
            </div>
            <button class="btn btn-outline btn-sm navbar-tour-btn" id="tourBtnNav" type="button" data-tour="guided-walkthrough-btn">${icon('play', 15)}<span class="tour-btn-label">Guided Walkthrough</span></button>
            <span class="navbar-signature" data-tour="signature" title="Crafted by ${signatureName}">${icon('user', 14)} ${signatureName}</span>
          </div>
        </div>
      </nav>
      <div class="hamburger-overlay ${menuOpen ? 'open' : ''}" id="hamburgerOverlay" ${menuOpen ? '' : 'hidden'}>
        <div class="hamburger-panel" role="dialog" aria-modal="true" aria-label="Navigation menu" data-tour="hamburger-panel">
          <div class="hamburger-panel-header">
            <span class="hamburger-panel-title">${icon('menu', 18)} Navigation</span>
            <button type="button" class="icon-btn" id="hamburgerCloseBtn" aria-label="Close menu">${icon('x', 18)}</button>
          </div>
          <div class="hamburger-panel-body">
            ${NAV_STRUCTURE.map((entry) => {
              if (isGroup(entry)) {
                const inGroup = routeIsInGroup(entry);
                const isExpanded = expandedGroup === entry.id || inGroup;
                return `<div class="hb-group">
                    <button type="button" class="hb-group-toggle ${inGroup ? 'active' : ''}" data-group="${entry.id}" ${entry.tourSelector ? `data-tour="${entry.tourSelector}"` : ''} aria-expanded="${isExpanded}">
                      <span class="hb-group-toggle-main">${icon(entry.icon, 18)}<span>${entry.label}</span></span>
                      <span class="hb-group-chevron">${icon('chevron-down', 15, isExpanded ? 'rotated' : '')}</span>
                    </button>
                    <div class="hb-group-children" ${isExpanded ? '' : 'hidden'}>${entry.children.map((c) => `<a href="#${c.id}" data-route="${c.id}" ${c.tourSelector ? `data-tour="${c.tourSelector}"` : ''} class="hb-link hb-link-child ${activeRoute() === c.id ? 'active' : ''}">${icon(c.icon, 16)}<span>${c.label}</span></a>`).join('')}</div>
                  </div>`;
              }
              return `<a href="#${entry.id}" data-route="${entry.id}" ${entry.tourSelector ? `data-tour="${entry.tourSelector}"` : ''} class="hb-link ${activeRoute() === entry.id ? 'active' : ''}">${icon(entry.icon, 18)}<span>${entry.label}</span>${entry.id === 'settings' ? icon(settingsLockIcon, 14, 'hb-lock-icon') : ''}</a>`;
            }).join('')}
            <div class="hb-divider"></div>
            <div class="hb-mobile-sync">
              <label class="hb-mobile-sync-label">${icon('folder-sync', 14)} Sync Source</label>
              <select id="hbSyncSourceSelect" class="hb-mobile-sync-select">
                <option value="shared-location" ${cfg.source === 'shared-location' ? 'selected' : ''}>Shared Location</option>
                <option value="github" ${cfg.source === 'github' ? 'selected' : ''}>GitHub</option>
              </select>
              <label class="hb-mobile-sync-label mt">${icon('clock', 14)} Sync Time</label>
              <select id="hbSyncTimeSelect" class="hb-mobile-sync-select">
                ${(Object.keys(SYNC_TIME_LABELS) as SyncTimeOption[]).map((t) => `<option value="${t}" ${cfg.time === t ? 'selected' : ''}>${SYNC_TIME_LABELS[t]}</option>`).join('')}
              </select>
            </div>
            <div class="hb-divider"></div>
            <button type="button" class="hb-link hb-tour-btn" id="tourBtnHb">${icon('play', 18)}<span>Guided Walkthrough</span></button>
            <div class="hb-signature">${icon('user', 14)} ${signatureName}</div>
          </div>
        </div>
      </div>`;
    wireEvents();
  }

  function themeIconName(): Parameters<typeof icon>[0] { return store.theme === 'light' ? 'sun' : store.theme === 'dark' ? 'moon' : 'monitor'; }
  function closeMenu(): void { menuOpen = false; expandedGroup = null; draw(); }
  function openMenu(): void { menuOpen = true; draw(); }

  function wireEvents(): void {
    container.querySelector<HTMLButtonElement>('#navToggle')?.addEventListener('click', () => { menuOpen ? closeMenu() : openMenu(); });
    container.querySelector('#hamburgerCloseBtn')?.addEventListener('click', closeMenu);
    container.querySelector('#hamburgerOverlay')?.addEventListener('click', (e) => { if (e.target === container.querySelector('#hamburgerOverlay')) closeMenu(); });
    if (menuOpen) { const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeMenu(); document.removeEventListener('keydown', escHandler); } }; document.addEventListener('keydown', escHandler); }

    container.querySelectorAll<HTMLButtonElement>('.hb-group-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const gid = btn.dataset.group!; expandedGroup = expandedGroup === gid ? null : gid; draw(); });
    });
    container.querySelectorAll<HTMLAnchorElement>('[data-route]').forEach((a) => { a.addEventListener('click', (e) => { e.preventDefault(); onNavigate(a.dataset.route as Route); closeMenu(); }); });
    container.querySelector('#tourBtnHb')?.addEventListener('click', () => { closeMenu(); onStartTour(); });
    container.querySelector('#tourBtnNav')?.addEventListener('click', () => { onStartTour(); });

    const themeBtn = container.querySelector<HTMLButtonElement>('#themeBtn'); const themeMenu = container.querySelector<HTMLDivElement>('#themeMenu');
    themeBtn?.addEventListener('click', (e) => { e.stopPropagation(); const isHidden = themeMenu?.hasAttribute('hidden'); if (isHidden) themeMenu?.removeAttribute('hidden'); else themeMenu?.setAttribute('hidden', ''); themeBtn.setAttribute('aria-expanded', String(!!isHidden)); });
    container.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((btn) => { btn.addEventListener('click', (e) => { e.stopPropagation(); store.setTheme(btn.dataset.themeChoice as Theme); themeMenu?.setAttribute('hidden', ''); }); });

    const sourceBtn = container.querySelector<HTMLButtonElement>('#syncSourceBtn'); const sourceMenu = container.querySelector<HTMLDivElement>('#syncSourceMenu');
    sourceBtn?.addEventListener('click', (e) => { e.stopPropagation(); sourceMenuOpen = !sourceMenuOpen; timeMenuOpen = false; draw(); });
    container.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((btn) => { btn.addEventListener('click', (e) => { e.stopPropagation(); syncService.setSource(btn.dataset.source as SyncSource); sourceMenuOpen = false; draw(); store.pushToast('info', `Sync source set to ${SYNC_SOURCE_LABELS[btn.dataset.source as SyncSource]}.`); }); });
    const timeBtn = container.querySelector<HTMLButtonElement>('#syncTimeBtn'); const timeMenu = container.querySelector<HTMLDivElement>('#syncTimeMenu');
    timeBtn?.addEventListener('click', (e) => { e.stopPropagation(); timeMenuOpen = !timeMenuOpen; sourceMenuOpen = false; draw(); });
    container.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((btn) => { btn.addEventListener('click', (e) => { e.stopPropagation(); syncService.setTime(btn.dataset.time as SyncTimeOption); timeMenuOpen = false; draw(); store.pushToast('info', `Sync time set to ${SYNC_TIME_LABELS[btn.dataset.time as SyncTimeOption]}.`); }); });
    container.querySelector<HTMLSelectElement>('#hbSyncSourceSelect')?.addEventListener('change', (e) => { syncService.setSource((e.target as HTMLSelectElement).value as SyncSource); });
    container.querySelector<HTMLSelectElement>('#hbSyncTimeSelect')?.addEventListener('change', (e) => { syncService.setTime((e.target as HTMLSelectElement).value as SyncTimeOption); });
    document.addEventListener('click', () => { themeMenu?.setAttribute('hidden', ''); if (sourceMenuOpen || timeMenuOpen) { sourceMenuOpen = false; timeMenuOpen = false; draw(); } });
  }

  store.subscribe(draw);
  schemaService.subscribe(draw);
  syncService.subscribe(draw);
  window.addEventListener('online', draw);
  window.addEventListener('offline', draw);
  draw();
}
