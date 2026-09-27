import { icon } from '../components/icons';
import { renderTablePicker } from '../components/tablePicker';
import { renderColumnPicker } from '../components/columnPicker';
import { renderFilterBuilder } from '../components/filterBuilder';
import { renderSqlCodeBlock, copyTextToClipboard } from '../components/sqlCodeBlock';
import { renderTabs } from '../components/tabs';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { aiService } from '../services/aiService';
import { orchestrateReadOnlyNlp } from '../services/nlpOrchestrator';
import { performBackgroundPull, performPublicDiscovery } from '../services/autoSyncService';
import { secretVaultService } from '../services/secretVaultService';
import { validateFullReadOnly } from '../engines/validationEngine';
import type { Dialect } from '../types';
export function renderReadOnlyBuilderPage(container: HTMLElement): void {
  const unsubscribeSchema = schemaService.subscribe(draw);
  let activeTabId = 'tables-columns';
  performPublicDiscovery('readonly-page-mount').catch(() => {});
  if (secretVaultService.isUnlocked()) performBackgroundPull('readonly-page-mount').catch(() => {});
  function draw(): void {
    const state = store.readOnly; const schema = schemaService.getActiveSchema();
    const validation = validateFullReadOnly(state);
    container.innerHTML = `<div class="page">
      <h2 class="page-title">${icon('table')} Read Only Query Builder</h2>
      <div class="builder-grid-top">
        <div class="builder-panel narrow" data-tour="describe-card">
          <h2>${icon('sparkles', 16)} Describe What You Need (optional)</h2>
          <textarea id="nlDesc" rows="3">${state.naturalLanguageText}</textarea>
          <div class="inline-label">SQL dialect<select id="dialectSelect">${dialectOptions(state.dialect)}</select></div>
          <button type="button" class="btn btn-primary" id="nlBuildBtn">${icon('zap', 15)} Build from Description</button>
        </div>
        <div class="builder-panel"><h2>${icon('code', 16)} Generated SQL</h2><div id="sqlBlockMount"></div></div>
      </div>
      <div class="builder-panel manual-selectors-panel"><h2>${icon('sliders', 16)} Manual Selectors</h2><div id="tabsMount"></div></div>
    </div>`;
    wireTopRow(); renderTabsSection(state, schema);
  }
  function dialectOptions(selected: Dialect): string { const list: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic']; return list.map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`).join(''); }
  function wireTopRow(): void {
    container.querySelector('#nlDesc')?.addEventListener('input', (e) => { store.readOnly.naturalLanguageText = (e.target as HTMLTextAreaElement).value; });
    container.querySelector('#dialectSelect')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.dialect = (e.target as HTMLSelectElement).value as Dialect; }); renderSqlOutput(); });
    container.querySelector('#nlBuildBtn')?.addEventListener('click', () => runNlBuild());
    renderSqlOutput();
  }
  async function runNlBuild(): Promise<void> {
    const schema = schemaService.getActiveSchema();
    const orchestrated = await orchestrateReadOnlyNlp(store.readOnly.naturalLanguageText, schema);
    store.mergeReadOnlyFromNlp(orchestrated.result);
    aiService.generateSQL(orchestrated.result, schema, store.readOnly);
    renderTabsSection(store.readOnly, schema); renderSqlOutput();
  }
  function renderSqlOutput(): void {
    const mount = container.querySelector<HTMLElement>('#sqlBlockMount'); if (!mount) return;
    renderSqlCodeBlock(mount, store.readOnly.generatedSql, {
      onCopy: () => { copyTextToClipboard(store.readOnly.generatedSql); store.pushToast('success', 'SQL copied.'); },
      onClear: () => { store.resetReadOnly(); renderTabsSection(store.readOnly, schemaService.getActiveSchema()); renderSqlOutput(); },
      onRegenerate: () => { store.regenerateReadOnlySql(); renderSqlOutput(); }
    });
  }
  function renderTabsSection(state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const mount = container.querySelector<HTMLElement>('#tabsMount'); if (!mount) return;
    renderTabs(mount, [
      { id: 'tables-columns', label: 'Tables & Columns', render: (panel) => renderTablesColumnsTab(panel, state, schema) },
      { id: 'summary', label: 'Summary', render: (panel) => renderSummaryTab(panel, state) }
    ], activeTabId, {}, (id) => { activeTabId = id; });
  }
  function renderTablesColumnsTab(panel: HTMLElement, state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    panel.innerHTML = `<div class="tc-grid" data-tour="module-selector"><div class="tc-col"><h3>${icon('list', 15)} Select Tables</h3><div id="tablePickerMount"></div></div><div class="tc-col"><h3>${icon('columns', 15)} Select Columns</h3><div id="columnPickerMount"></div></div><div class="tc-col"><h3>${icon('filter', 15)} Filters</h3><div id="filterBuilderMount"></div></div></div>`;
    renderTablePicker(panel.querySelector<HTMLElement>('#tablePickerMount')!, schema, state.selectedTables, (next) => { store.updateReadOnly((s) => { s.selectedTables = next; }); renderTablesColumnsTab(panel, store.readOnly, schema); renderSqlOutput(); });
    renderColumnPicker(panel.querySelector<HTMLElement>('#columnPickerMount')!, schema, state.selectedTables, state.selectedColumns, { onChange: (next) => { store.updateReadOnly((s) => { s.selectedColumns = next; }); renderSqlOutput(); }, onRequestManualDecodeForColumn: () => {} });
    renderFilterBuilder(panel.querySelector<HTMLElement>('#filterBuilderMount')!, schema, state.selectedTables, state.filters, (next) => { store.updateReadOnly((s) => { s.filters = next; }); renderSqlOutput(); });
  }
  function renderSummaryTab(panel: HTMLElement, state: typeof store.readOnly): void {
    panel.innerHTML = `<div class="summary-grid"><div><h3>Selected tables</h3><p>${state.selectedTables.join(', ') || '(none)'}</p></div></div>`;
  }
  draw();
  (container as any)._cleanup = () => { unsubscribeSchema(); };
}
