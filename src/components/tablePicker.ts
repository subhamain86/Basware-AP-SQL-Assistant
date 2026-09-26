import type { SchemaModel } from '../types';
import { icon } from './icons';

// V14 — adds the required "Module -> Search Table -> Select Table" flow
// (spec section 4.1). The Module dropdown filters the table list; Search
// continues to work (now scoped to whichever module is selected, or across
// all tables when "All Modules" is chosen).
export function renderTablePicker(container: HTMLElement, schema: SchemaModel, selected: string[], onChange: (next: string[]) => void): void {
  let searchTerm = ''; let current = [...selected]; let selectedModule = '';

  function matchesSearch(name: string, module: string): boolean { if (!searchTerm) return true; const t = searchTerm.toLowerCase(); return name.toLowerCase().includes(t) || module.toLowerCase().includes(t); }

  function draw(): void {
    const modules = Array.from(new Set(schema.tables.map((t) => t.module))).sort();
    const tablesInScope = schema.tables.filter((t) => (!selectedModule || t.module === selectedModule) && matchesSearch(t.name, t.module));
    const modulesToRender = selectedModule ? [selectedModule] : Array.from(new Set(tablesInScope.map((t) => t.module)));

    container.innerHTML = `
      <div class="picker">
        <label class="block-label tiny-label" data-tour="module-selector">Module<select class="module-select"><option value="">All Modules</option>${modules.map((m) => `<option value="${m}" ${m === selectedModule ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <div class="picker-search">${icon('search', 14)}<input type="text" class="picker-search-input" placeholder="Search tables…" value="${searchTerm}" /></div>
        <div class="picker-actions"><button type="button" class="btn-link" data-action="select-all">Select all</button><button type="button" class="btn-link" data-action="clear">Clear</button><span class="picker-count">${current.length} selected</span></div>
        <div class="picker-list" role="listbox" aria-multiselectable="true">
          ${modulesToRender.map((m) => { const tables = tablesInScope.filter((t) => t.module === m); if (tables.length === 0) return ''; return `<div class="picker-group-label">${m}</div>${tables.map((t) => `<label class="picker-row" data-table="${t.name}"><input type="checkbox" ${current.includes(t.name) ? 'checked' : ''} /><span class="picker-row-main"><strong>${t.name}</strong><span class="hint">${t.description}</span></span></label>`).join('')}`; }).join('') || '<p class="hint picker-empty">No tables match your search.</p>'}
        </div>
      </div>`;

    container.querySelector<HTMLSelectElement>('.module-select')?.addEventListener('change', (e) => { selectedModule = (e.target as HTMLSelectElement).value; draw(); });
    container.querySelector<HTMLInputElement>('.picker-search-input')?.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; draw(); const input = container.querySelector<HTMLInputElement>('.picker-search-input'); input?.focus(); input?.setSelectionRange(searchTerm.length, searchTerm.length); });
    container.querySelector('[data-action="select-all"]')?.addEventListener('click', () => { current = tablesInScope.map((t) => t.name); onChange([...current]); draw(); });
    container.querySelector('[data-action="clear"]')?.addEventListener('click', () => { current = []; onChange([...current]); draw(); });
    container.querySelectorAll<HTMLElement>('.picker-row').forEach((row) => { row.addEventListener('click', (e) => { e.preventDefault(); const name = row.dataset.table!; current = current.includes(name) ? current.filter((n) => n !== name) : [...current, name]; onChange([...current]); draw(); }); });
  }
  draw();
}
