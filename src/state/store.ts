import type { ReadOnlyQueryState, CrQueryState, Route, Theme, ToastMessage, Dialect } from '../types';
import { schemaService } from '../services/schemaService';
import { buildSelectSQL } from '../engines/sqlEngine';
import { buildCrSQL } from '../engines/crEngine';
import { makeId } from '../utils/id';

function emptyReadOnlyState(dialect: Dialect = 'Oracle'): ReadOnlyQueryState {
  return { dialect, naturalLanguageText: '', selectedTables: [], selectedColumns: [], joins: [], filters: [], sorts: [], advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, recursive: false, saveAsView: null, caseExpressions: [], decodeExpressions: [] }, generatedSql: '-- Select at least one table (or describe your requirement above) to generate SQL.', lastGeneratedAt: null };
}
function emptyCrState(dialect: Dialect = 'Oracle'): CrQueryState {
  return { dialect, naturalLanguageText: '', queryType: 'UPDATE', table: null, values: [], filters: [], confirmNoWhere: false, generatedSql: '-- Choose a table for this Change Request.', lastGeneratedAt: null };
}
const SETTINGS_INACTIVITY_MS = 5 * 60 * 1000;

class AppStore {
  private listeners = new Set<() => void>();
  route: Route = 'quickstart';
  theme: Theme = 'system';
  readOnly: ReadOnlyQueryState = emptyReadOnlyState();
  cr: CrQueryState = emptyCrState();
  toasts: ToastMessage[] = [];
  hasSeenWalkthrough = false;
  settingsUnlocked = false;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const savedTheme = localStorage.getItem('sqla.theme.v14');
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') this.theme = savedTheme;
    this.hasSeenWalkthrough = localStorage.getItem('sqla.tourseen.v14') === '1';
    schemaService.subscribe(() => this.regenerateReadOnlySql());
    ['click', 'keydown', 'mousemove'].forEach((evt) => document.addEventListener(evt, () => this.bumpActivity(), { passive: true }));
  }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach((l) => l()); }
  setRoute(route: Route): void { this.route = route; this.notify(); }
  setTheme(theme: Theme): void { this.theme = theme; localStorage.setItem('sqla.theme.v14', theme); this.notify(); }
  markWalkthroughSeen(): void { this.hasSeenWalkthrough = true; localStorage.setItem('sqla.tourseen.v14', '1'); }
  pushToast(kind: ToastMessage['kind'], text: string): void { const toast: ToastMessage = { id: makeId('toast'), kind, text }; this.toasts.push(toast); this.notify(); setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== toast.id); this.notify(); }, 4000); }
  unlockSettings(): void { this.settingsUnlocked = true; this.bumpActivity(); this.notify(); }
  lockSettings(): void { this.settingsUnlocked = false; if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); this.inactivityTimer = null; } this.notify(); }
  private bumpActivity(): void { if (!this.settingsUnlocked) return; if (this.inactivityTimer) clearTimeout(this.inactivityTimer); this.inactivityTimer = setTimeout(() => { this.lockSettings(); this.pushToast('info', 'Settings locked automatically after inactivity.'); }, SETTINGS_INACTIVITY_MS); }

  regenerateReadOnlySql(): void {
    const schema = schemaService.getActiveSchema();
    const validTableNames = new Set(schema.tables.map((t) => t.name));
    const prunedTables = this.readOnly.selectedTables.filter((t) => validTableNames.has(t));
    if (prunedTables.length !== this.readOnly.selectedTables.length) {
      this.readOnly.selectedTables = prunedTables;
      this.readOnly.selectedColumns = this.readOnly.selectedColumns.filter((c) => c.manualExpr || validTableNames.has(c.table));
      this.readOnly.filters = this.readOnly.filters.filter((f) => validTableNames.has(f.table));
      this.readOnly.sorts = this.readOnly.sorts.filter((s) => validTableNames.has(s.table));
      this.readOnly.joins = this.readOnly.joins.filter((j) => validTableNames.has(j.table));
    }
    this.readOnly.generatedSql = buildSelectSQL(this.readOnly, schema);
    this.readOnly.lastGeneratedAt = new Date().toISOString();
    this.notify();
  }
  updateReadOnly(mutator: (s: ReadOnlyQueryState) => void): void { mutator(this.readOnly); this.regenerateReadOnlySql(); }
  resetReadOnly(): void { this.readOnly = emptyReadOnlyState(this.readOnly.dialect); this.regenerateReadOnlySql(); }
  regenerateCrSql(): void { const result = buildCrSQL(this.cr); this.cr.generatedSql = result.sql; this.cr.lastGeneratedAt = new Date().toISOString(); this.notify(); }
  updateCr(mutator: (s: CrQueryState) => void): void { mutator(this.cr); this.regenerateCrSql(); }
  resetCr(): void { this.cr = emptyCrState(this.cr.dialect); this.regenerateCrSql(); }
}
export const store = new AppStore();
