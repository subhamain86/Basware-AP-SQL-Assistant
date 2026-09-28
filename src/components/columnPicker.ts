import type { SchemaModel, SelectedColumnSpec, ColumnDef } from '../types';
import { icon } from './icons';
import { makeId } from '../utils/id';
import { validateAlias } from '../utils/sqlIdentifier';
export interface ColumnPickerCallbacks { onChange: (next: SelectedColumnSpec[]) => void; onRequestManualDecodeForColumn: (table: string, column: ColumnDef, existingSpecId: string) => void; }
export function renderColumnPicker(container: HTMLElement, schema: SchemaModel, selectedTables: string[], selectedColumns: SelectedColumnSpec[], callbacks: ColumnPickerCallbacks): void {
  let searchTerm = ''; let current = [...selectedColumns];
  function realColumnsInScope(): { table: string; column: ColumnDef }[] { return selectedTables.flatMap((tableName) => { const table = schema.tables.find((t) => t.name === tableName); return table ? table.columns.map((c) => ({ table: tableName, column: c })) : []; }); }
  function isSelected(table: string, column: string): boolean { return current.some((c) => c.table === table && c.column === column && !c.manualExpr); }
  function selectedSpec(table: string, column: string): SelectedColumnSpec | undefined { return current.find((c) => c.table === table && c.column === column && !c.manualExpr); }
  function allRealColumnsSelected(): boolean { const scope = realColumnsInScope(); if (scope.length === 0) return false; return scope.every((ref) => isSelected(ref.table, ref.column.name)); }
  function renderColumnRow(tableName: string, c: ColumnDef): string {
    const spec = selectedSpec(tableName, c.name); const selected = !!spec; const hasSchemaDecode = !!c.decode?.length; const mode = spec?.displayMode ?? 'raw';
    const controlsHtml = selected ? `<div class="column-row-controls"><label class="column-inline-label">Alias<input type="text" class="column-alias-input" value="${(spec!.alias || '').replace(/"/g, '&quot;')}"/></label><label class="column-inline-label">Display as<select class="column-mode-select"><option value="raw" ${mode === 'raw' ? 'selected' : ''}>Column</option>${hasSchemaDecode ? `<option value="schema-decode" ${mode === 'schema-decode' ? 'selected' : ''}>Schema DECODE</option>` : ''}<option value="manual-decode">Manual DECODE…</option></select></label></div><div class="column-alias-error"></div>` : '';
    return `<div class="column-row ${selected ? 'is-selected' : ''}" data-table="${tableName}" data-column="${c.name}"><label class="column-row-checkbox-label"><input type="checkbox" class="column-checkbox" ${selected ? 'checked' : ''}/><span><strong>${c.name}</strong> <span class="hint">${c.type}${c.length ? `(${c.length})` : ''}${c.isPrimaryKey ? ' · PK' : ''}${c.isForeignKey ? ' · FK' : ''}</span></span></label>${controlsHtml}</div>`;
  }
  function renderListOnly(): void {
    const listEl = container.querySelector<HTMLElement>('.picker-list'); const countEl = container.querySelector<HTMLElement>('.picker-count'); const selectAllCheckbox = container.querySelector<HTMLInputElement>('.select-all-checkbox'); if (!listEl) return;
    if (selectedTables.length === 0) { listEl.innerHTML = '<p class="hint">Select one or more tables first.</p>'; if (countEl) countEl.textContent = ''; if (selectAllCheckbox) { selectAllCheckbox.checked = false; selectAllCheckbox.disabled = true; } return; }
    if (selectAllCheckbox) { selectAllCheckbox.disabled = false; selectAllCheckbox.checked = allRealColumnsSelected(); }
    const term = searchTerm.toLowerCase();
    listEl.innerHTML = selectedTables.map((tableName) => {
      const table = schema.tables.find((t) => t.name === tableName); if (!table) return '';
      const cols = table.columns.filter((c) => !term || c.name.toLowerCase().includes(term) || c.label.toLowerCase().includes(term)); if (cols.length === 0) return '';
      const rowsHtml = cols.map((c) => renderColumnRow(tableName, c)).join('');
      return `<div class="picker-group-label">${tableName}</div>${rowsHtml}`;
    }).join('') || '<p class="hint">No columns match your search.</p>';
    if (countEl) countEl.textContent = `${current.filter((c) => !c.manualExpr).length} selected`;
    wireRowListeners();
  }
  function wireRowListeners(): void { container.querySelectorAll('.column-row').forEach((row) => { const t = row.getAttribute('data-table')!; const cName = row.getAttribute('data-column')!; const colDef = schema.tables.find((tb) => tb.name === t)?.columns.find((cd) => cd.name === cName); if (!colDef) return; row.querySelector('.column-checkbox')?.addEventListener('click', (e) => { e.stopPropagation(); if (isSelected(t, cName)) current = current.filter((x) => !(x.table === t && x.column === cName && !x.manualExpr)); else current = [...current, { id: makeId('col'), table: t, column: cName, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }]; callbacks.onChange([...current]); renderListOnly(); }); row.querySelector<HTMLInputElement>('.column-alias-input')?.addEventListener('input', (e) => { const value = (e.target as HTMLInputElement).value; const spec = selectedSpec(t, cName); if (!spec) return; const validation = validateAlias(value); const errBox = row.querySelector('.column-alias-error'); if (errBox) errBox.innerHTML = validation.valid ? '' : `<span class="hint">${validation.message}</span>`; if (validation.valid) { (spec as any).alias = value.trim(); callbacks.onChange([...current]); } }); row.querySelector<HTMLSelectElement>('.column-mode-select')?.addEventListener('change', (e) => { const value = (e.target as HTMLSelectElement).value as 'raw' | 'schema-decode' | 'manual-decode'; const spec = selectedSpec(t, cName); if (!spec) return; if (value === 'manual-decode') { callbacks.onRequestManualDecodeForColumn(t, colDef, spec.id); return; } (spec as any).displayMode = value; (spec as any).useDecode = value === 'schema-decode'; callbacks.onChange([...current]); renderListOnly(); }); }); }
  function toggleSelectAll(checked: boolean): void {
    if (checked) { const scope = realColumnsInScope(); scope.forEach((ref) => { if (!isSelected(ref.table, ref.column.name)) current.push({ id: makeId('col'), table: ref.table, column: ref.column.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }); }); }
    else { const scopeTableSet = new Set(selectedTables); current = current.filter((c) => c.manualExpr || !scopeTableSet.has(c.table)); }
    callbacks.onChange([...current]); renderListOnly();
  }
  function renderShellOnce(): void {
    container.innerHTML = `<div class="picker"><div class="picker-search">${icon('search', 14)}<input type="text" class="picker-search-input" placeholder="Search columns"/></div><label class="select-all-row"><input type="checkbox" class="select-all-checkbox"/> ${icon('checkbox-checked', 14)} Select All (all columns for the selected table(s) — search only filters what's shown)</label><div class="picker-actions"><button type="button" class="btn btn-link" data-action="clear">Clear</button><span class="picker-count"></span></div><div class="picker-list"></div></div>`;
    container.querySelector<HTMLInputElement>('.picker-search-input')!.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; renderListOnly(); });
    container.querySelector<HTMLInputElement>('.select-all-checkbox')!.addEventListener('change', (e) => { toggleSelectAll((e.target as HTMLInputElement).checked); });
    container.querySelector('[data-action="clear"]')?.addEventListener('click', () => { current = current.filter((c) => c.manualExpr); callbacks.onChange([...current]); renderListOnly(); });
    renderListOnly();
  }
  renderShellOnce();
  (container as any)._refreshList = renderListOnly;
}
