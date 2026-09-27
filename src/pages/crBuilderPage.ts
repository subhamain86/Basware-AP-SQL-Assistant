import { icon } from '../components/icons';
import { renderSqlCodeBlock, copyTextToClipboard } from '../components/sqlCodeBlock';
import { renderFilterBuilder } from '../components/filterBuilder';
import { renderTabs } from '../components/tabs';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import type { CrQueryType, Dialect } from '../types';
export function renderCrBuilderPage(container: HTMLElement): void {
  const unsubscribeSchema = schemaService.subscribe(draw);
  function draw(): void {
    const state = store.cr; const schema = schemaService.getActiveSchema();
    container.innerHTML = `<div class="page">
      <h2 class="page-title">${icon('code')} Query Builder for CR</h2>
      <div class="builder-grid-top">
        <div class="builder-panel narrow"><h2>Describe the Change</h2><textarea id="crNlDesc" rows="3">${state.naturalLanguageText}</textarea></div>
        <div class="builder-panel"><h2>${icon('code', 16)} Generated SQL</h2><div id="crSqlMount"></div></div>
      </div>
      <div class="builder-panel manual-selectors-panel"><h2>Manual Selectors</h2><div id="crTabsMount"></div></div>
    </div>`;
    container.querySelector('#crNlDesc')?.addEventListener('input', (e) => { store.cr.naturalLanguageText = (e.target as HTMLTextAreaElement).value; });
    renderTabsSection(state, schema); renderCrSqlOutput();
  }
  function renderCrSqlOutput(): void {
    const mount = container.querySelector<HTMLElement>('#crSqlMount'); if (!mount) return;
    renderSqlCodeBlock(mount, store.cr.generatedSql, { onCopy: () => { copyTextToClipboard(store.cr.generatedSql); store.pushToast('success', 'Copied.'); }, onClear: () => { store.resetCr(); renderCrSqlOutput(); } });
  }
  function renderTabsSection(state: typeof store.cr, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const mount = container.querySelector<HTMLElement>('#crTabsMount'); if (!mount) return;
    renderTabs(mount, [ { id: 'details', label: 'Query Details', render: (panel) => renderDetailsTab(panel, state, schema) } ], 'details');
  }
  function renderDetailsTab(panel: HTMLElement, state: typeof store.cr, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    panel.innerHTML = `<h3>Query Type</h3><div class="segmented">${(['INSERT', 'UPDATE', 'DELETE'] as CrQueryType[]).map((qt) => `<button type="button" class="seg-btn ${state.queryType === qt ? 'active' : ''}" data-qt="${qt}">${qt}</button>`).join('')}</div><h3>Pick Table</h3><select id="crTableSelect"><option value="">— choose a table —</option>${schema.tables.map((t) => `<option value="${t.name}" ${t.name === state.table ? 'selected' : ''}>${t.name}</option>`).join('')}</select><h3>Filters</h3><div id="crFilterMount"></div>`;
    panel.querySelectorAll<HTMLElement>('.seg-btn').forEach((btn) => { btn.addEventListener('click', () => { store.updateCr((s) => { s.queryType = btn.dataset.qt as CrQueryType; }); renderDetailsTab(panel, store.cr, schema); renderCrSqlOutput(); }); });
    panel.querySelector('#crTableSelect')?.addEventListener('change', (e) => { store.updateCr((s) => { s.table = (e.target as HTMLSelectElement).value || null; }); renderDetailsTab(panel, store.cr, schema); renderCrSqlOutput(); });
    const filterMount = panel.querySelector<HTMLElement>('#crFilterMount');
    if (filterMount && state.table) renderFilterBuilder(filterMount, schema, [state.table], state.filters, (next) => { store.updateCr((s) => { s.filters = next; }); renderCrSqlOutput(); });
  }
  draw();
  (container as any)._cleanup = () => { unsubscribeSchema(); };
}
