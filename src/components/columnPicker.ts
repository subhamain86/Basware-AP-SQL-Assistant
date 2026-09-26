import type { SchemaModel, SelectedColumnSpec, ColumnDef } from '../types';
import { icon } from './icons';
import { makeId } from '../utils/id';
import { decodeLegend } from '../engines/decodeEngine';

// ============================================================================
// columnPicker — V14.1. Same static-shell + list-only re-render fix as
// tablePicker (root cause of the search/refresh bugs). ALSO implements spec
// section 7: "Column Name | CASE | DECODE" — every column row now shows
// inline buttons directly beside it:
//   - "CASE"   -> opens the Manual CASE builder (onManualCase callback),
//                 pre-seeded with this column as the likely subject.
//   - "Decode" -> if the column has a SCHEMA-DEFINED decode, shown as a
//                 toggle chip the user can turn on/off (optional — having
//                 a decode available never auto-applies it, per spec 7.2).
//   - "DECODE" -> opens the Manual DECODE builder (onManualDecode
//                 callback) for columns without a suitable existing
//                 definition, pre-seeding the source expression.
// ============================================================================
export interface ColumnPickerCallbacks {
  onChange: (next: SelectedColumnSpec[]) => void;
  onManualCaseForColumn: (table: string, column: ColumnDef) => void;
  onManualDecodeForColumn: (table: string, column: ColumnDef) => void;
}

export function renderColumnPicker(container: HTMLElement, schema: SchemaModel, selectedTables: string[], selectedColumns: SelectedColumnSpec[], callbacks: ColumnPickerCallbacks): void {
  let searchTerm = '';
  let current = [...selectedColumns];

  function isSelected(table: string, column: string): boolean { return current.some((c) => c.table === table && c.column === column); }
  function selectedSpec(table: string, column: string): SelectedColumnSpec | undefined { return current.find((c) => c.table === table && c.column === column); }

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
        const hasSchemaDecode = !!c.decode?.length;
        return `
        <div class="column-row" data-table="${tableName}" data-column="${c.name}">
          <label class="picker-row column-row-checkbox-label">
            <input type="checkbox" class="column-checkbox" ${isSelected(tableName, c.name) ? 'checked' : ''} />
            <span class="picker-row-main"><strong>${c.name}</strong><span class="hint">${c.type}${c.length ? `(${c.length})` : ''}${c.isPrimaryKey ? ' · PK' : ''}${c.isForeignKey ? ' · FK' : ''}</span></span>
          </label>
          <div class="column-row-actions">
            <button type="button" class="chip-btn case-btn" title="Manual CASE for ${c.name}">${icon('code', 12)} CASE</button>
            ${hasSchemaDecode ? `<button type="button" class="chip-btn decode-toggle-btn ${spec?.useDecode ? 'active' : ''}" title="${decodeLegend(c)}" ${isSelected(tableName, c.name) ? '' : 'disabled'}>${icon('sparkles', 12)} Decode</button>` : `<button type="button" class="chip-btn manual-decode-btn" title="Manual DECODE for ${c.name}">${icon('sparkles', 12)} DECODE</button>`}
          </div>
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
        if (isSelected(t, cName)) current = current.filter((x) => !(x.table === t && x.column === cName));
        // V14.1 fix (spec section 7.2): "Having a DECODE available does NOT
        // mean it should automatically be applied. It should be an optional
        // selection." — useDecode must default to false even when the
        // column has a schema-defined decode; the user must explicitly
        // click the "Decode" chip to opt in.
        else current = [...current, { id: makeId('col'), table: t, column: cName, alias: '', useDecode: false, aggregate: null }];
        callbacks.onChange([...current]);
        renderListOnly();
      });

      row.querySelector('.case-btn')?.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onManualCaseForColumn(t, colDef); });
      row.querySelector('.manual-decode-btn')?.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onManualDecodeForColumn(t, colDef); });
      row.querySelector('.decode-toggle-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const spec = selectedSpec(t, cName);
        if (!spec) return; // must be selected first — button is disabled otherwise
        spec.useDecode = !spec.useDecode;
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
}
