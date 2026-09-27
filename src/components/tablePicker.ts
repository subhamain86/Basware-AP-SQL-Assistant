import type { SchemaModel } from '../types';
import { icon } from './icons';
export function renderTablePicker(container: HTMLElement, schema: SchemaModel, selected: string[], onChange: (next: string[]) => void): void {
  let searchTerm = ''; let current = [...selected];
  function renderListOnly(): void {
    const listEl = container.querySelector('.picker-list'); const countEl = container.querySelector('.picker-count');
    if (!listEl) return;
    const term = searchTerm.toLowerCase();
    const tables = schema.tables.filter((t) => !term || t.name.toLowerCase().includes(term));
    listEl.innerHTML = tables.map((t) => `<label class="picker-row" data-table="${t.name}"><input type="checkbox" ${current.includes(t.name) ? 'checked' : ''}/><div class="picker-row-main"><strong>${t.name}</strong><span class="hint">${t.description}</span></div></label>`).join('') || '<div class="picker-empty">No tables match your search.</div>';
    if (countEl) countEl.textContent = `${current.length} selected`;
    container.querySelectorAll<HTMLElement>('.picker-row').forEach((row) => { row.addEventListener('click', (e) => { e.preventDefault(); const name = row.dataset.table!; current = current.includes(name) ? current.filter((n) => n !== name) : [...current, name]; onChange([...current]); renderListOnly(); }); });
  }
  container.innerHTML = `<div class="picker"><div class="picker-search">${icon('search', 14)}<input class="picker-search-input" placeholder="Search tables..."/></div><div class="picker-actions"><span class="picker-count"></span></div><div class="picker-list"></div></div>`;
  container.querySelector<HTMLInputElement>('.picker-search-input')!.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; renderListOnly(); });
  renderListOnly();
}
