import type { SchemaModel, SelectedColumnSpec, ColumnDef } from '../types';
import { icon } from './icons';
import { makeId } from '../utils/id';
export interface ColumnPickerCallbacks { onChange: (next: SelectedColumnSpec[]) => void; onRequestManualDecodeForColumn: (table: string, column: ColumnDef, existingSpecId: string) => void; }
export function renderColumnPicker(container: HTMLElement, schema: SchemaModel, selectedTables: string[], selectedColumns: SelectedColumnSpec[], callbacks: ColumnPickerCallbacks): void {
  let current = [...selectedColumns];
  function isSelected(table: string, column: string): boolean { return current.some((c) => c.table === table && c.column === column && !c.manualExpr); }
  function renderListOnly(): void {
    const listEl = container.querySelector('.picker-list'); const countEl = container.querySelector('.picker-count');
    if (!listEl) return;
    if (selectedTables.length === 0) { listEl.innerHTML = '<div class="picker-empty">Select one or more tables first.</div>'; if (countEl) countEl.textContent = ''; return; }
    listEl.innerHTML = selectedTables.map((tableName) => {
      const table = schema.tables.find((t) => t.name === tableName); if (!table) return '';
      return `<div class="picker-group-label">${tableName}</div>${table.columns.map((c) => { const selected = isSelected(tableName, c.name); return `<div class="column-row ${selected ? 'is-selected' : ''}" data-table="${tableName}" data-column="${c.name}"><label class="column-row-checkbox-label"><input type="checkbox" class="column-checkbox" ${selected ? 'checked' : ''}/><div><strong>${c.name}</strong> <span class="hint">${c.type}</span></div></label></div>`; }).join('')}`;
    }).join('');
    if (countEl) countEl.textContent = `${current.filter((c) => !c.manualExpr).length} selected`;
    container.querySelectorAll<HTMLElement>('.column-row').forEach((row) => {
      const t = row.dataset.table!; const cName = row.dataset.column!;
      row.querySelector('.column-checkbox')?.addEventListener('click', (e) => { e.stopPropagation(); if (isSelected(t, cName)) current = current.filter((x) => !(x.table === t && x.column === cName && !x.manualExpr)); else current = [...current, { id: makeId('col'), table: t, column: cName, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }]; callbacks.onChange([...current]); renderListOnly(); });
    });
  }
  container.innerHTML = `<div class="picker"><div class="picker-actions"><span class="picker-count"></span></div><div class="picker-list"></div></div>`;
  renderListOnly();
}
