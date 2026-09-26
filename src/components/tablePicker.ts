import type { SchemaModel } from '../types';
import { icon } from './icons';
export function renderTablePicker(container: HTMLElement, schema: SchemaModel, selected: string[], onChange: (next: string[]) => void): void {
  let searchTerm = ''; let current = [...selected];
  function matchesSearch(name: string, module: string): boolean { if (!searchTerm) return true; const t = searchTerm.toLowerCase(); return name.toLowerCase().includes(t) || module.toLowerCase().includes(t); }
  function draw(): void {
    const modules = Array.from(new Set(schema.tables.map((t) => t.module)));
    container.innerHTML = `
      <div class="picker">
        <div class="picker-search">${icon('search', 14)}<input type="text" class="picker-search-input" placeholder="Search tables…" value="${searchTerm}" /></div>
        <div class="picker-actions"><button type="button" class="btn-link" data-action="select-all">Select all</button><button type="button" class="btn-link" data-action="clear">Clear</button><span class="picker-count">${current.length} selected</span></div>
        <div class="picker-list" role="listbox" aria-multiselectable="true">
          ${modules.map((m) => { const tables = schema.tables.filter((t) => t.module === m && matchesSearch(t.name, t.module)); if (tables.length === 0) return ''; return `<div class="picker-group-label">${m}</div>${tables.map((t) => `<label class="picker-row" data-table="${t.name}"><input type="checkbox" ${current.includes(t.name) ? 'checked' : ''} /><span class="picker-row-main"><strong>${t.name}</strong><span class="hint">${t.description}</span></span></label>`).join('')}`; }).join('') || '<p class="hint picker-empty">No tables match your search.</p>'}
        </div>
      </div>`;
    container.querySelector<HTMLInputElement>('.picker-search-input')?.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; draw(); const input = container.querySelector<HTMLInputElement>('.picker-search-input'); input?.focus(); input?.setSelectionRange(searchTerm.length, searchTerm.length); });
    container.querySelector('[data-action="select-all"]')?.addEventListener('click', () => { current = schema.tables.map((t) => t.name); onChange([...current]); draw(); });
    container.querySelector('[data-action="clear"]')?.addEventListener('click', () => { current = []; onChange([...current]); draw(); });
    container.querySelectorAll<HTMLElement>('.picker-row').forEach((row) => { row.addEventListener('click', (e) => { e.preventDefault(); const name = row.dataset.table!; current = current.includes(name) ? current.filter((n) => n !== name) : [...current, name]; onChange([...current]); draw(); }); });
  }
  draw();
}
