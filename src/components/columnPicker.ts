import type { SchemaModel, SelectedColumnSpec } from '../types';
import { icon } from './icons';
import { makeId } from '../utils/id';
export function renderColumnPicker(container: HTMLElement, schema: SchemaModel, selectedTables: string[], selectedColumns: SelectedColumnSpec[], onChange: (next: SelectedColumnSpec[]) => void): void {
  let searchTerm = ''; let current = [...selectedColumns];
  function isSelected(table: string, column: string): boolean { return current.some((c) => c.table === table && c.column === column); }
  function draw(): void {
    if (selectedTables.length === 0) { container.innerHTML = '<p class="hint picker-empty">Select one or more tables first.</p>'; return; }
    const term = searchTerm.toLowerCase();
    container.innerHTML = `
      <div class="picker">
        <div class="picker-search">${icon('search', 14)}<input type="text" class="picker-search-input" placeholder="Search columns…" value="${searchTerm}" /></div>
        <div class="picker-actions"><button type="button" class="btn-link" data-action="clear">Clear</button><span class="picker-count">${current.length} selected</span></div>
        <div class="picker-list">
          ${selectedTables.map((tableName) => { const table = schema.tables.find((t) => t.name === tableName); if (!table) return ''; const cols = table.columns.filter((c) => !term || c.name.toLowerCase().includes(term) || c.label.toLowerCase().includes(term)); if (cols.length === 0) return ''; return `<div class="picker-group-label">${tableName}</div>${cols.map((c) => `<label class="picker-row" data-table="${tableName}" data-column="${c.name}"><input type="checkbox" ${isSelected(tableName, c.name) ? 'checked' : ''} /><span class="picker-row-main"><strong>${c.name}</strong><span class="hint">${c.type}${c.length ? `(${c.length})` : ''}${c.isPrimaryKey ? ' · PK' : ''}${c.isForeignKey ? ' · FK' : ''}${c.decode?.length ? ' · decode available' : ''}</span></span></label>`).join('')}`; }).join('') || '<p class="hint picker-empty">No columns match your search.</p>'}
        </div>
      </div>`;
    container.querySelector<HTMLInputElement>('.picker-search-input')?.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; draw(); const input = container.querySelector<HTMLInputElement>('.picker-search-input'); input?.focus(); input?.setSelectionRange(searchTerm.length, searchTerm.length); });
    container.querySelector('[data-action="clear"]')?.addEventListener('click', () => { current = []; onChange([...current]); draw(); });
    container.querySelectorAll<HTMLElement>('.picker-row').forEach((row) => { row.addEventListener('click', (e) => { e.preventDefault(); const t = row.dataset.table!; const c = row.dataset.column!; if (isSelected(t, c)) current = current.filter((x) => !(x.table === t && x.column === c)); else { const colDef = schema.tables.find((tb) => tb.name === t)?.columns.find((cd) => cd.name === c); current = [...current, { id: makeId('col'), table: t, column: c, alias: '', useDecode: !!colDef?.decode?.length, aggregate: null }]; } onChange([...current]); draw(); }); });
  }
  draw();
}
