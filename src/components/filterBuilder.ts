import type { SchemaModel, FilterCondition, FilterOperator } from '../types';
import { icon } from './icons';
import { FILTER_OPERATORS } from '../engines/filterEngine';
import { makeId } from '../utils/id';
export function renderFilterBuilder(container: HTMLElement, schema: SchemaModel, selectedTables: string[], filters: FilterCondition[], onChange: (next: FilterCondition[]) => void): void {
  let current = [...filters];
  function availableColumns(): { table: string; column: string; label: string }[] { return selectedTables.flatMap((t) => { const table = schema.tables.find((x) => x.name === t); return table ? table.columns.map((c) => ({ table: t, column: c.name, label: `${t}.${c.name}` })) : []; }); }
  function draw(): void {
    const cols = availableColumns();
    if (selectedTables.length === 0) { container.innerHTML = '<div class="hint">Select one or more tables first.</div>'; return; }
    container.innerHTML = `<div class="filter-rows">${current.map((f, idx) => `<div class="filter-row" data-idx="${idx}"><select class="col-select">${cols.map((c) => `<option value="${c.table}::${c.column}" ${f.table === c.table && f.column === c.column ? 'selected' : ''}>${c.label}</option>`).join('')}</select><select class="op-select">${FILTER_OPERATORS.map((op) => `<option value="${op}" ${f.operator === op ? 'selected' : ''}>${op}</option>`).join('')}</select><input class="val-input" value="${f.value}" placeholder="value"/><button type="button" class="icon-btn remove-btn">${icon('trash', 14)}</button></div>`).join('')}</div><button type="button" class="btn btn-outline btn-sm add-filter-btn">${icon('plus', 14)} Add filter</button>`;
    container.querySelectorAll<HTMLElement>('.filter-row').forEach((row) => {
      const idx = parseInt(row.dataset.idx || '0', 10);
      row.querySelector('.col-select')?.addEventListener('change', (e) => { const [t, c] = (e.target as HTMLSelectElement).value.split('::'); current[idx].table = t; current[idx].column = c; onChange([...current]); });
      row.querySelector('.op-select')?.addEventListener('change', (e) => { current[idx].operator = (e.target as HTMLSelectElement).value as FilterOperator; onChange([...current]); });
      row.querySelector('.val-input')?.addEventListener('input', (e) => { current[idx].value = (e.target as HTMLInputElement).value; onChange([...current]); });
      row.querySelector('.remove-btn')?.addEventListener('click', () => { current.splice(idx, 1); onChange([...current]); draw(); });
    });
    container.querySelector('.add-filter-btn')?.addEventListener('click', () => { if (cols.length === 0) return; current.push({ id: makeId('filt'), table: cols[0].table, column: cols[0].column, operator: '=', value: '', combinator: 'AND' }); onChange([...current]); draw(); });
  }
  draw();
}
