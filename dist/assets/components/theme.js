import { store } from '../state/store.js';
export function applyThemeToDocument(theme) { const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme; document.documentElement.setAttribute('data-theme', resolved); document.documentElement.setAttribute('data-theme-pref', theme); }
export function initTheme() { applyThemeToDocument(store.theme); window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (store.theme === 'system')
    applyThemeToDocument('system'); }); store.subscribe(() => applyThemeToDocument(store.theme)); }
