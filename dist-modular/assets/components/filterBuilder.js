import { icon } from './icons.js';
import { FILTER_OPERATORS, requiresValue, requiresSecondValue } from '../engines/filterEngine.js';
import { makeId } from '../utils/id.js';
export function renderFilterBuilder(container, schema, selectedTables, filters, onChange) {
    let current = [...filters];
    function availableColumns() { return selectedTables.flatMap((t) => { const table = schema.tables.find((x) => x.name === t); return table ? table.columns.map((c) => ({ table: t, column: c.name, label: `${t}.${c.name}` })) : []; }); }
    function draw() {
        const cols = availableColumns();
        if (selectedTables.length === 0) {
            container.innerHTML = '<div class="hint">Select one or more tables first.</div>';
            return;
        }
        container.innerHTML = `<div class="filter-rows">${current.map((f, idx) => { const needsVal = requiresValue(f.operator); const needsVal2 = requiresSecondValue(f.operator); return `<div class="filter-row" data-idx="${idx}"><span class="filter-where-label">${idx > 0 ? `<select class="combinator-select"><option value="AND" ${f.combinator === 'AND' ? 'selected' : ''}>AND</option><option value="OR" ${f.combinator === 'OR' ? 'selected' : ''}>OR</option></select>` : 'WHERE'}</span><select class="col-select">${cols.map((c) => `<option value="${c.table}::${c.column}" ${f.table === c.table && f.column === c.column ? 'selected' : ''}>${c.label}</option>`).join('')}</select><select class="op-select">${FILTER_OPERATORS.map((op) => `<option value="${op}" ${f.operator === op ? 'selected' : ''}>${op}</option>`).join('')}</select>${needsVal ? `<input class="val-input" value="${f.value}" placeholder="value"/>` : ''}${needsVal2 ? `<span>and</span><input class="val2-input" value="${f.value2 || ''}" placeholder="value 2"/>` : ''}<button type="button" class="icon-btn remove-btn">${icon('trash', 14)}</button></div>`; }).join('')}</div><button type="button" class="btn btn-outline btn-sm add-filter-btn">${icon('plus', 14)} Add filter</button>`;
        container.querySelectorAll('.filter-row').forEach((row) => {
            const idx = parseInt(row.dataset.idx || '0', 10);
            row.querySelector('.combinator-select')?.addEventListener('change', (e) => { current[idx].combinator = e.target.value; onChange([...current]); });
            row.querySelector('.col-select')?.addEventListener('change', (e) => { const [t, c] = e.target.value.split('::'); current[idx].table = t; current[idx].column = c; onChange([...current]); });
            row.querySelector('.op-select')?.addEventListener('change', (e) => { current[idx].operator = e.target.value; onChange([...current]); draw(); });
            row.querySelector('.val-input')?.addEventListener('input', (e) => { current[idx].value = e.target.value; onChange([...current]); });
            row.querySelector('.val2-input')?.addEventListener('input', (e) => { current[idx].value2 = e.target.value; onChange([...current]); });
            row.querySelector('.remove-btn')?.addEventListener('click', () => { current.splice(idx, 1); onChange([...current]); draw(); });
        });
        container.querySelector('.add-filter-btn')?.addEventListener('click', () => { if (cols.length === 0)
            return; current.push({ id: makeId('filt'), table: cols[0].table, column: cols[0].column, operator: '=', value: '', combinator: 'AND' }); onChange([...current]); draw(); });
    }
    draw();
}
