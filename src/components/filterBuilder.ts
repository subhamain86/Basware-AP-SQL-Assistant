import type { SchemaModel, FilterCondition, FilterOperator } from '../types';
import { icon } from './icons';
import { FILTER_OPERATORS, requiresValue, requiresSecondValue } from '../engines/filterEngine';
import { makeId } from '../utils/id';
export function renderFilterBuilder(container: HTMLElement, schema: SchemaModel, selectedTables: string[], filters: FilterCondition[], onChange: (next: FilterCondition[]) => void): void {
  let current = [...filters];
  function availableColumns(): { table: string; column: string; label: string }[] { return selectedTables.flatMap((t) => { const table = schema.tables.find((x) => x.name === t); return table ? table.columns.map((c) => ({ table: t, column: c.name, label: `${t}.${c.name}` })) : []; }); }
  function draw(): void {
    const cols = availableColumns();
    if (selectedTables.length === 0) { container.innerHTML = '<p class="hint picker-empty">Select one or more tables first.</p>'; return; }
    container.innerHTML = `
      <div class="filter-rows">
        ${current.map((f, idx) => { const needsVal = requiresValue(f.operator); const needsVal2 = requiresSecondValue(f.operator); return `<div class="filter-row" data-idx="${idx}">
            ${idx > 0 ? `<select class="combinator-select" aria-label="Combinator"><option value="AND" ${f.combinator === 'AND' ? 'selected' : ''}>AND</option><option value="OR" ${f.combinator === 'OR' ? 'selected' : ''}>OR</option></select>` : '<span class="hint filter-where-label">WHERE</span>'}
            <select class="col-select" aria-label="Column">${cols.map((c) => `<option value="${c.table}::${c.column}" ${c.table === f.table && c.column === f.column ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
            <select class="op-select" aria-label="Operator">${FILTER_OPERATORS.map((op) => `<option value="${op}" ${op === f.operator ? 'selected' : ''}>${op}</option>`).join('')}</select>
            ${needsVal ? `<input type="text" class="val-input" placeholder="value" value="${f.value}" aria-label="Value" />` : ''}
            ${needsVal2 ? `<span class="hint">and</span><input type="text" class="val2-input" placeholder="value 2" value="${f.value2 || ''}" aria-label="Second value" />` : ''}
            <button type="button" class="icon-btn remove-btn" title="Remove filter">${icon('trash', 14)}</button>
          </div>`; }).join('')}
      </div>
      <button type="button" class="btn btn-outline btn-sm add-filter-btn">${icon('plus', 14)} Add filter</button>`;
    container.querySelectorAll<HTMLElement>('.filter-row').forEach((row) => {
      const idx = parseInt(row.dataset.idx || '0', 10);
      row.querySelector('.combinator-select')?.addEventListener('change', (e) => { current[idx].combinator = (e.target as HTMLSelectElement).value as 'AND' | 'OR'; onChange([...current]); });
      row.querySelector('.col-select')?.addEventListener('change', (e) => { const [t, c] = (e.target as HTMLSelectElement).value.split('::'); current[idx].table = t; current[idx].column = c; onChange([...current]); });
      row.querySelector('.op-select')?.addEventListener('change', (e) => { current[idx].operator = (e.target as HTMLSelectElement).value as FilterOperator; onChange([...current]); draw(); });
      row.querySelector('.val-input')?.addEventListener('input', (e) => { current[idx].value = (e.target as HTMLInputElement).value; onChange([...current]); });
      row.querySelector('.val2-input')?.addEventListener('input', (e) => { current[idx].value2 = (e.target as HTMLInputElement).value; onChange([...current]); });
      row.querySelector('.remove-btn')?.addEventListener('click', () => { current.splice(idx, 1); onChange([...current]); draw(); });
    });
    container.querySelector('.add-filter-btn')?.addEventListener('click', () => { if (cols.length === 0) return; current.push({ id: makeId('filt'), table: cols[0].table, column: cols[0].column, operator: '=', value: '', combinator: 'AND' }); onChange([...current]); draw(); });
  }
  draw();
}
