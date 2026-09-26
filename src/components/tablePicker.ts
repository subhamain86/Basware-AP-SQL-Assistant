import type { SchemaModel } from '../types';
import { icon } from './icons';

// ============================================================================
// tablePicker — V14.1. ROOT-CAUSE REWRITE of the "search not working" /
// "page refresh" bugs (spec sections 1, 4, 6): the previous implementation
// replaced the ENTIRE picker's innerHTML (search input included) on every
// keystroke, which destroyed and recreated the <input> DOM node each time —
// requiring a fragile refocus/selectionRange hack, and any parent-level
// re-render happening in between two keystrokes would silently reset the
// search term and selected module back to blank.
//
// The fix: split rendering into a STATIC SHELL (module select + search
// input + action buttons), rendered exactly ONCE, whose event listeners are
// attached once and never touched again — and a separate LIST REGION whose
// innerHTML is the ONLY thing that gets replaced on search/module/selection
// changes. The search <input> element itself is never destroyed, so focus,
// cursor position, and IME composition state are never lost, and there is
// nothing left to "refocus" after the fact.
// ============================================================================
export function renderTablePicker(container: HTMLElement, schema: SchemaModel, selected: string[], onChange: (next: string[]) => void): void {
  let searchTerm = ''; let current = [...selected]; let selectedModule = '';

  function matchesSearch(name: string, module: string): boolean {
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    return name.toLowerCase().includes(t) || module.toLowerCase().includes(t);
  }

  function computeScope(): { tablesInScope: typeof schema.tables; modulesToRender: string[] } {
    const tablesInScope = schema.tables.filter((t) => (!selectedModule || t.module === selectedModule) && matchesSearch(t.name, t.module));
    const modulesToRender = selectedModule ? [selectedModule] : Array.from(new Set(tablesInScope.map((t) => t.module)));
    return { tablesInScope, modulesToRender };
  }

  function renderListOnly(): void {
    const listEl = container.querySelector<HTMLElement>('.picker-list');
    const countEl = container.querySelector<HTMLElement>('.picker-count');
    if (!listEl) return;
    const { tablesInScope, modulesToRender } = computeScope();
    listEl.innerHTML = modulesToRender.map((m) => {
      const tables = tablesInScope.filter((t) => t.module === m);
      if (tables.length === 0) return '';
      return `<div class="picker-group-label">${m}</div>${tables.map((t) => `<label class="picker-row" data-table="${t.name}"><input type="checkbox" ${current.includes(t.name) ? 'checked' : ''} /><span class="picker-row-main"><strong>${t.name}</strong><span class="hint">${t.description}</span></span></label>`).join('')}`;
    }).join('') || '<p class="hint picker-empty">No tables match your search.</p>';
    if (countEl) countEl.textContent = `${current.length} selected`;
    wireRowListeners();
  }

  function wireRowListeners(): void {
    container.querySelectorAll<HTMLElement>('.picker-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.preventDefault();
        const name = row.dataset.table!;
        current = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
        onChange([...current]);
        renderListOnly(); // only the list re-renders — search input untouched
      });
    });
  }

  function renderShellOnce(): void {
    const modules = Array.from(new Set(schema.tables.map((t) => t.module))).sort();
    container.innerHTML = `
      <div class="picker">
        <label class="block-label tiny-label" data-tour="module-selector">Module<select class="module-select"><option value="">All Modules</option>${modules.map((m) => `<option value="${m}">${m}</option>`).join('')}</select></label>
        <div class="picker-search">${icon('search', 14)}<input type="text" class="picker-search-input" placeholder="Search tables…" autocomplete="off" /></div>
        <div class="picker-actions"><button type="button" class="btn-link" data-action="select-all">Select all</button><button type="button" class="btn-link" data-action="clear">Clear</button><span class="picker-count">${current.length} selected</span></div>
        <div class="picker-list" role="listbox" aria-multiselectable="true"></div>
      </div>`;

    const searchInput = container.querySelector<HTMLInputElement>('.picker-search-input')!;
    searchInput.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; renderListOnly(); });

    const moduleSelect = container.querySelector<HTMLSelectElement>('.module-select')!;
    moduleSelect.addEventListener('change', (e) => { selectedModule = (e.target as HTMLSelectElement).value; renderListOnly(); });

    container.querySelector('[data-action="select-all"]')?.addEventListener('click', () => {
      const { tablesInScope } = computeScope();
      current = tablesInScope.map((t) => t.name);
      onChange([...current]);
      renderListOnly();
    });
    container.querySelector('[data-action="clear"]')?.addEventListener('click', () => { current = []; onChange([...current]); renderListOnly(); });

    renderListOnly();
  }

  renderShellOnce();
}
