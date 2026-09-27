import type { Theme } from '../types';
import { store } from '../state/store';
export function applyThemeToDocument(theme: Theme): void { const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme; document.documentElement.setAttribute('data-theme', resolved); document.documentElement.setAttribute('data-theme-pref', theme); }
export function initTheme(): void { applyThemeToDocument(store.theme); window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (store.theme === 'system') applyThemeToDocument('system'); }); store.subscribe(() => applyThemeToDocument(store.theme)); }
