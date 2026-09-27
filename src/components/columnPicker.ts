import type { SchemaModel, SelectedColumnSpec, ColumnDef } from '../types';
import { icon } from './icons';
import { makeId } from '../utils/id';
import { validateAlias } from '../utils/sqlIdentifier';

// ============================================================================
// columnPicker — V14.2. Rewrite for spec sections 6-11:
//   6. Search fix — re-verified static-shell pattern (search input never
//      destroyed, so it can never lose focus or reset on an unrelated
//      re-render), extended to explicitly support "search across multiple
//      selected tables" (already true structurally, now covered by tests).
//   7. Alias — appears ONLY once a column's checkbox is checked. Before
//      selection: just the column name. After selection: name + an
//      inline Alias <input>, validated live via validateAlias().
//   8-10. DECODE — also appears ONLY once selected, as a compact
//      "Display as" <select> with up to 3 options: Raw Column / Schema
//      DECODE (only shown if the column actually has one) / Manual DECODE
//      (custom). Choosing "Manual DECODE" opens the manual builder
//      pre-filled for that exact column; on save, that column's entry is
//      REPLACED in place (same alias preserved) rather than appending a
//      second, duplicate entry (spec section 11).
// ============================================================================

export interface ColumnPickerCallbacks {
  onChange: (next: SelectedColumnSpec[]) => void;
  onRequestManualDecodeForColumn: (table: string, column: ColumnDef, existingSpecId: string) => void;
}

export function renderColumnPicker(container: HTMLElement, schema: SchemaModel, selectedTables: string[], selectedColumns: SelectedColumnSpec[], callbacks: ColumnPickerCallbacks): void {
  let searchTerm = '';
  let current = [...selectedColumns];

  function isSelected(table: string, column: string): boolean { return current.some((c) => c.table === table && c.column === column && !c.manualExpr); }
  function selectedSpec(table: string, column: string): SelectedColumnSpec | undefined { return current.find((c) => c.table === table && c.column === column && !c.manualExpr); }

  function renderListOnly(): void {
    const listEl = container.querySelector<HTMLElement>('.picker-list');
    const countEl = container.querySelector<HTMLElement>('.picker-count');
    if (!listEl) return;
    if (selectedTables.length === 0) { listEl.innerHTML = '<p class="hint picker-empty">Select one or more tables first.</p>'; if (countEl) countEl.textContent = ''; return; }
    const term = searchTerm.toLowerCase();
    listEl.innerHTML = selectedTables.map((tableName) => {
      const table = schema.tables.find((t) => t.name === tableName);
      if (!table) return '';
      const cols = table.columns.filter((c) => !term || c.name.toLowerCase().includes(term) || c.label.toLowerCase().includes(term));
      if (cols.length === 0) return '';
      return `<div class="picker-group-label">${tableName}</div>${cols.map((c) => {
        const spec = selectedSpec(tableName, c.name);
        const selected = !!spec;
        const hasSchemaDecode = !!c.decode?.length;
        const mode = spec?.displayMode ?? 'raw';
        return `
        <div class="column-row ${selected ? 'is-selected' : ''}" data-table="${tableName}" data-column="${c.name}">
          <label class="picker-row column-row-checkbox-label">
            <input type="checkbox" class="column-checkbox" ${selected ? 'checked' : ''} />
            <span class="picker-row-main"><strong>${c.name}</strong><span class="hint">${c.type}${c.length ? `(${c.length})` : ''}${c.isPrimaryKey ? ' · PK' : ''}${c.isForeignKey ? ' · FK' : ''}</span></span>
          </label>
          ${selected ? `
          <div class="column-row-controls">
            <label class="column-inline-label">Alias<input type="text" class="column-alias-input" value="${spec!.alias || ''}" placeholder="(none)" /></label>
            <label class="column-inline-label">Display as<select class="column-mode-select">
              <option value="raw" ${mode === 'raw' ? 'selected' : ''}>Raw Column</option>
              ${hasSchemaDecode ? `<option value="schema-decode" ${mode === 'schema-decode' ? 'selected' : ''}>Schema DECODE</option>` : ''}
              <option value="manual-decode" ${mode === 'manual-decode' ? 'selected' : ''}>Manual DECODE…</option>
            </select></label>
          </div>
          <div class="column-alias-error"></div>` : ''}
        </div>`;
      }).join('')}`;
    }).join('') || '<p class="hint picker-empty">No columns match your search.</p>';
    if (countEl) countEl.textContent = `${current.filter((c) => !c.manualExpr).length} selected`;
    wireRowListeners();
  }

  function wireRowListeners(): void {
    container.querySelectorAll<HTMLElement>('.column-row').forEach((row) => {
      const t = row.dataset.table!; const cName = row.dataset.column!;
      const colDef = schema.tables.find((tb) => tb.name === t)?.columns.find((cd) => cd.name === cName);
      if (!colDef) return;

      row.querySelector('.column-checkbox')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isSelected(t, cName)) {
          current = current.filter((x) => !(x.table === t && x.column === cName && !x.manualExpr));
        } else {
          current = [...current, { id: makeId('col'), table: t, column: cName, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }];
        }
        callbacks.onChange([...current]);
        renderListOnly();
      });

      row.querySelector<HTMLInputElement>('.column-alias-input')?.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        const spec = selectedSpec(t, cName);
        if (!spec) return;
        const validation = validateAlias(value);
        const errBox = row.querySelector<HTMLElement>('.column-alias-error');
        if (errBox) errBox.innerHTML = validation.valid ? '' : `<span class="hint alias-error-text">${validation.message}</span>`;
        if (validation.valid) { spec.alias = value.trim(); callbacks.onChange([...current]); }
      });

      row.querySelector<HTMLSelectElement>('.column-mode-select')?.addEventListener('change', (e) => {
        const value = (e.target as HTMLSelectElement).value as 'raw' | 'schema-decode' | 'manual-decode';
        const spec = selectedSpec(t, cName);
        if (!spec) return;
        if (value === 'manual-decode') {
          // Defer switching the mode until the modal is actually saved —
          // request the manual builder now, keyed to this spec's id so
          // the caller can REPLACE it in place rather than duplicating.
          callbacks.onRequestManualDecodeForColumn(t, colDef, spec.id);
          return;
        }
        spec.displayMode = value;
        spec.useDecode = value === 'schema-decode';
        callbacks.onChange([...current]);
        renderListOnly();
      });
    });
  }

  function renderShellOnce(): void {
    container.innerHTML = `
      <div class="picker">
        <div class="picker-search">${icon('search', 14)}<input type="text" class="picker-search-input" placeholder="Search columns…" autocomplete="off" /></div>
        <div class="picker-actions"><button type="button" class="btn-link" data-action="clear">Clear</button><span class="picker-count">${current.filter((c) => !c.manualExpr).length} selected</span></div>
        <div class="picker-list"></div>
      </div>`;
    const searchInput = container.querySelector<HTMLInputElement>('.picker-search-input')!;
    searchInput.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; renderListOnly(); });
    container.querySelector('[data-action="clear"]')?.addEventListener('click', () => { current = current.filter((c) => c.manualExpr); callbacks.onChange([...current]); renderListOnly(); });
    renderListOnly();
  }

  renderShellOnce();

  // Exposed so the page-level code can update a specific spec's
  // displayMode/manualExpr after the manual-decode modal is saved, then
  // trigger a targeted re-render without rebuilding the search shell.
  (container as any)._refreshList = renderListOnly;
}
