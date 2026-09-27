import { icon } from '../components/icons';
import { renderTablePicker } from '../components/tablePicker';
import { renderColumnPicker } from '../components/columnPicker';
import { renderFilterBuilder } from '../components/filterBuilder';
import { renderSqlCodeBlock, copyTextToClipboard } from '../components/sqlCodeBlock';
import { renderTabs } from '../components/tabs';
import { openManualCaseBuilder, openManualDecodeBuilder } from '../components/manualExprBuilder';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { aiService } from '../services/aiService';
import { orchestrateReadOnlyNlp } from '../services/nlpOrchestrator';
import { performBackgroundPull, performPublicDiscovery } from '../services/autoSyncService';
import { secretVaultService } from '../services/secretVaultService';
import { validateFullReadOnly } from '../engines/validationEngine';
import { optimizeSuggestions } from '../engines/optimizeEngine';
import type { Dialect } from '../types';
import { makeId } from '../utils/id';
export function renderReadOnlyBuilderPage(container: HTMLElement): void {
  const unsubscribeSchema = schemaService.subscribe(draw);
  let activeTabId = 'tables-columns'; let isBuilding = false;
  performPublicDiscovery('readonly-page-mount').catch(() => {});
  if (secretVaultService.isUnlocked()) performBackgroundPull('readonly-page-mount').catch(() => {});
  function draw(): void {
    const state = store.readOnly; const schema = schemaService.getActiveSchema();
    const validation = validateFullReadOnly(state); const errorIssues = validation.issues.filter((i) => i.severity === 'error'); const warnIssues = validation.issues.filter((i) => i.severity === 'warning');
    container.innerHTML = `<div class="page">
      <h2 class="page-title">${icon('table')} Read Only Query Builder</h2>
      <p class="page-subtitle">Generates validated SELECT / WITH statements only. Natural Language and Manual Selectors merge together — use either one, or both.</p>
      <div class="builder-grid-top">
        <div class="builder-panel narrow" data-tour="describe-card">
          <h2>${icon('sparkles', 16)} Describe What You Need (optional)</h2>
          <textarea id="nlDesc" rows="3" placeholder="e.g. Show invoices with their organization">${state.naturalLanguageText}</textarea>
          <div class="inline-label">SQL dialect<select id="dialectSelect">${dialectOptions(state.dialect)}</select></div>
          <button type="button" class="btn btn-primary" id="nlBuildBtn">${icon('zap', 15)} ${isBuilding ? 'Processing…' : 'Build from Description'}</button>
          <div id="nlNotes"></div>
        </div>
        <div class="builder-panel">
          <h2>${icon('code', 16)} Generated SQL</h2>
          <div id="sqlBlockMount"></div>
        </div>
      </div>
      <div class="builder-panel manual-selectors-panel">
        <h2>${icon('sliders', 16)} Manual Selectors</h2>
        <div id="tabsMount"></div>
        <div class="row-actions build-query-row"><button type="button" class="btn btn-outline" id="buildQueryBtn">${icon('zap', 15)} Build Query</button><span class="hint">Regenerates the SQL from your current manual selections (this also happens automatically as you make changes).</span></div>
        ${errorIssues.length ? `<div class="issue-box mini">${icon('alert-triangle', 15)}<ul>${errorIssues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
        ${warnIssues.length ? `<div class="issue-box warn mini">${icon('alert-triangle', 14)}<ul>${warnIssues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
      </div>
    </div>`;
    wireTopRow(); renderTabsSection(state, schema);
    container.querySelector('#buildQueryBtn')?.addEventListener('click', () => { store.regenerateReadOnlySql(); store.pushToast('info', 'Query rebuilt from manual selections.'); renderSqlOutput(); });
  }
  function dialectOptions(selected: Dialect): string { const list: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic']; return list.map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`).join(''); }
  function wireTopRow(): void {
    container.querySelector('#nlDesc')?.addEventListener('input', (e) => { store.readOnly.naturalLanguageText = (e.target as HTMLTextAreaElement).value; });
    container.querySelector('#dialectSelect')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.dialect = (e.target as HTMLSelectElement).value as Dialect; }); renderSqlOutput(); });
    container.querySelector('#nlBuildBtn')?.addEventListener('click', () => runNlBuild());
    renderSqlOutput();
  }
  async function runNlBuild(preferredColumn?: string): Promise<void> {
    isBuilding = true; const nlBtn = container.querySelector<HTMLButtonElement>('#nlBuildBtn');
    if (nlBtn) { nlBtn.disabled = true; nlBtn.innerHTML = `${icon('zap', 15)} Processing…`; }
    const schema = schemaService.getActiveSchema();
    const orchestrated = await orchestrateReadOnlyNlp(store.readOnly.naturalLanguageText, schema);
    const requirement = orchestrated.result; if (preferredColumn) requirement.clarifications = [];
    store.mergeReadOnlyFromNlp(requirement);
    const result = aiService.generateSQL(requirement, schema, store.readOnly);
    isBuilding = false; if (nlBtn) { nlBtn.disabled = false; nlBtn.innerHTML = `${icon('zap', 15)} Build from Description`; }
    const engineBadge = orchestrated.engineUsed === 'online' ? `${icon('cloud', 13)} Online AI/NLP` : `${icon('wifi-off', 13)} Offline/local engine${orchestrated.onlineAttempted ? ' (online attempt failed/unavailable)' : ''}`;
    const schemaAuditLine = `<div class="schema-audit-line">${icon('database', 12)} Active Schema used: ${schema.name} (v${schema.versionMeta?.version ?? schema.version})</div>`;
    const notesMount = container.querySelector<HTMLElement>('#nlNotes');
    if (notesMount) {
      const clarifHtml = requirement.clarifications.length ? `<div class="issue-box warn mini">${icon('alert-triangle', 14)}${requirement.clarifications.map((cq) => `<div>${cq.question}${cq.options.map((opt) => `<button type="button" class="btn-link clarify-btn" data-col="${opt}">${opt}</button>`).join('')}</div>`).join('')}</div>` : '';
      notesMount.innerHTML = `<div class="engine-badge ${orchestrated.engineUsed === 'online' ? 'engine-online' : 'engine-offline'}">${engineBadge}</div>${schemaAuditLine}<div class="notes-box"><strong>Query Plan</strong><ul class="plan-list">${requirement.queryPlan.map((p) => `<li>${p}</li>`).join('')}</ul><strong>Notes</strong><ul>${requirement.notes.map((n) => `<li>${n}</li>`).join('')}</ul></div>${result.warnings.length ? `<div class="issue-box warn mini">⚠ ${result.warnings.join(' ')}</div>` : ''}${clarifHtml}`;
      notesMount.querySelectorAll<HTMLElement>('.clarify-btn').forEach((btn) => { btn.addEventListener('click', () => runNlBuild(btn.dataset.col)); });
    }
    renderTabsSection(store.readOnly, schema); renderSqlOutput();
  }
  function renderSqlOutput(): void {
    const mount = container.querySelector<HTMLElement>('#sqlBlockMount'); if (!mount) return;
    renderSqlCodeBlock(mount, store.readOnly.generatedSql, {
      onCopy: () => { copyTextToClipboard(store.readOnly.generatedSql); store.pushToast('success', 'SQL copied to clipboard.'); },
      onClear: () => { store.resetReadOnly(); store.pushToast('info', 'Query cleared.'); renderTabsSection(store.readOnly, schemaService.getActiveSchema()); renderSqlOutput(); },
      onValidate: () => { const result = validateFullReadOnly(store.readOnly); const mountV = container.querySelector<HTMLElement>('#validationMount'); if (mountV) mountV.innerHTML = result.valid ? `<div class="issue-box ok mini">${icon('check', 14)} SQL passed validation — no destructive statements detected.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${result.issues.map((i) => `<li>[${i.severity}] ${i.message}</li>`).join('')}</ul></div>`; },
      onRegenerate: () => { store.regenerateReadOnlySql(); store.pushToast('info', 'SQL regenerated from current selections.'); renderSqlOutput(); }
    }, [{ id: 'btnOptimizeToggle', label: 'Optimize', iconName: 'wand', onClick: () => { const mountO = container.querySelector<HTMLElement>('#optimizeMount'); if (!mountO) return; if (mountO.innerHTML.trim()) { mountO.innerHTML = ''; return; } const tips = optimizeSuggestions(store.readOnly); mountO.innerHTML = `<div class="tips-box mini">${icon('wand', 15)}<ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul></div>`; } }]);
  }
  function renderTabsSection(state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const mount = container.querySelector<HTMLElement>('#tabsMount'); if (!mount) return;
    renderTabs(mount, [
      { id: 'tables-columns', label: 'Tables & Columns', render: (panel) => renderTablesColumnsTab(panel, state, schema) },
      { id: 'advanced', label: 'Advanced Options', render: (panel) => renderAdvancedTab(panel, state, schema) },
      { id: 'summary', label: 'Selected / Described Requirements', render: (panel) => renderSummaryTab(panel, state) }
    ], activeTabId, { 'tables-columns': 'tab-tables-columns', advanced: 'tab-advanced', summary: 'tab-summary' }, (id) => { activeTabId = id; });
  }
  function renderTablesColumnsTab(panel: HTMLElement, state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    panel.innerHTML = `<div class="tc-grid" data-tour="module-selector"><div class="tc-col"><h3>${icon('list', 15)} Select Tables</h3><div id="tablePickerMount"></div></div><div class="tc-col"><h3>${icon('columns', 15)} Select Columns (Alias/DECODE appear once selected)</h3><div id="columnPickerMount"></div></div><div class="tc-col"><h3>${icon('filter', 15)} Filters</h3><div id="filterBuilderMount"></div></div></div>`;
    const tableMount = panel.querySelector<HTMLElement>('#tablePickerMount')!;
    renderTablePicker(tableMount, schema, state.selectedTables, (next) => { store.updateReadOnly((s) => { s.selectedTables = next; }); renderTablesColumnsTab(panel, store.readOnly, schema); renderSqlOutput(); });
    const columnMount = panel.querySelector<HTMLElement>('#columnPickerMount')!;
    renderColumnPicker(columnMount, schema, state.selectedTables, state.selectedColumns, { onChange: (next) => { store.updateReadOnly((s) => { s.selectedColumns = next; }); renderSqlOutput(); }, onRequestManualDecodeForColumn: (table, column, existingSpecId) => { openManualDecodeBuilder(state.dialect, (spec) => { store.updateReadOnly((s) => { s.selectedColumns = s.selectedColumns.map((c) => c.id === existingSpecId ? spec : c); }); renderSqlOutput(); }, { table, column: column.name }, existingSpecId, `${column.name}_DESC`); } });
    const filterMount = panel.querySelector<HTMLElement>('#filterBuilderMount')!;
    renderFilterBuilder(filterMount, schema, state.selectedTables, state.filters, (next) => { store.updateReadOnly((s) => { s.filters = next; }); renderSqlOutput(); });
  }
  function renderAdvancedTab(panel: HTMLElement, state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    panel.innerHTML = `<div class="advanced-grid" data-tour="tab-advanced">
      <div>
        <label class="inline-check"><input type="checkbox" id="advDistinct" ${state.advanced.distinct ? 'checked' : ''}/> DISTINCT</label>
        <label class="block-label">GROUP BY columns (comma separated)<input id="advGroupBy" value="${state.advanced.groupByColumns.join(', ')}"/></label>
        <label class="block-label">HAVING clause<input id="advHaving" value="${state.advanced.havingClause}"/></label>
        <label class="block-label">LIMIT<input id="advLimit" type="number" value="${state.advanced.limit ?? ''}"/></label>
        <label class="inline-check"><input type="checkbox" id="advRecursive" ${state.advanced.recursive ? 'checked' : ''}/> Recursive (WITH RECURSIVE)</label>
        <h3 class="mt">CTEs</h3><div id="cteList"></div><button type="button" class="btn btn-outline btn-sm" id="addCteBtn">${icon('plus', 14)} Add CTE</button>
      </div>
      <div>
        <h3>Manual CASE / DECODE Columns</h3><div id="manualColsList"></div>
        <div class="row-actions wrap"><button type="button" class="btn btn-outline btn-sm" id="addManualCaseBtn">${icon('code', 14)} Add Manual CASE</button><button type="button" class="btn btn-outline btn-sm" id="addManualDecodeBtn">${icon('sparkles', 14)} Add Manual DECODE</button></div>
      </div>
    </div>`;
    panel.querySelector('#advDistinct')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.advanced.distinct = (e.target as HTMLInputElement).checked; }); renderSqlOutput(); });
    panel.querySelector('#advGroupBy')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.groupByColumns = (e.target as HTMLInputElement).value.split(',').map((v) => v.trim()).filter(Boolean); }); renderSqlOutput(); });
    panel.querySelector('#advHaving')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.havingClause = (e.target as HTMLInputElement).value; }); renderSqlOutput(); });
    panel.querySelector('#advLimit')?.addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value; store.updateReadOnly((s) => { s.advanced.limit = v ? parseInt(v, 10) : null; }); renderSqlOutput(); });
    panel.querySelector('#advRecursive')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.advanced.recursive = (e.target as HTMLInputElement).checked; }); renderSqlOutput(); });
    function renderCteList(): void {
      const list = panel.querySelector<HTMLElement>('#cteList'); if (!list) return;
      list.innerHTML = state.advanced.ctes.map((c, idx) => `<div class="cte-row" data-idx="${idx}"><input class="cte-name-input" value="${c.name}"/><textarea class="cte-body-input" rows="2">${c.body}</textarea><button type="button" class="icon-btn remove-cte-btn">${icon('trash', 14)}</button></div>`).join('');
      list.querySelectorAll<HTMLElement>('.cte-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.cte-name-input')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.ctes[idx].name = (e.target as HTMLInputElement).value; }); renderSqlOutput(); }); row.querySelector('.cte-body-input')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.ctes[idx].body = (e.target as HTMLTextAreaElement).value; }); renderSqlOutput(); }); row.querySelector('.remove-cte-btn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.advanced.ctes.splice(idx, 1); }); renderSqlOutput(); renderCteList(); }); });
    }
    renderCteList();
    panel.querySelector('#addCteBtn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.advanced.ctes.push({ id: makeId('cte'), name: `cte_${s.advanced.ctes.length + 1}`, body: '' }); }); renderSqlOutput(); renderCteList(); });
    function renderManualCols(): void {
      const mount = panel.querySelector<HTMLElement>('#manualColsList'); if (!mount) return;
      const manualCols = store.readOnly.selectedColumns.filter((c) => c.manualExpr && !state.selectedTables.some((t) => c.table === t));
      mount.innerHTML = manualCols.length ? manualCols.map((c) => `<div class="mini-row"><strong>${c.alias}</strong><button type="button" class="icon-btn remove-manual-col" data-id="${c.id}">${icon('trash', 14)}</button></div>`).join('') : '<div class="hint">No custom CASE/DECODE columns added yet.</div>';
      mount.querySelectorAll<HTMLElement>('.remove-manual-col').forEach((btn) => { btn.addEventListener('click', () => { store.updateReadOnly((s) => { s.selectedColumns = s.selectedColumns.filter((c) => c.id !== btn.dataset.id); }); renderSqlOutput(); renderManualCols(); }); });
    }
    renderManualCols();
    panel.querySelector('#addManualCaseBtn')?.addEventListener('click', () => { openManualCaseBuilder(state.dialect, (spec) => { store.updateReadOnly((s) => { s.selectedColumns.push(spec); }); renderSqlOutput(); renderManualCols(); store.pushToast('success', `Manual CASE column "${spec.alias}" added.`); }); });
    panel.querySelector('#addManualDecodeBtn')?.addEventListener('click', () => { openManualDecodeBuilder(state.dialect, (spec) => { store.updateReadOnly((s) => { s.selectedColumns.push(spec); }); renderSqlOutput(); renderManualCols(); store.pushToast('success', `Manual DECODE column "${spec.alias}" added.`); }); });
  }
  function renderSummaryTab(panel: HTMLElement, state: typeof store.readOnly): void {
    panel.innerHTML = `<div class="summary-grid">
      <div><h3>Natural-language requirement</h3><p>${state.naturalLanguageText ? state.naturalLanguageText : '(none provided)'}</p>
      <h3>Selected tables</h3><p>${state.selectedTables.length ? state.selectedTables.join(', ') : '(none)'}</p>
      <h3>Selected columns</h3><ul>${state.selectedColumns.length ? state.selectedColumns.map((c) => `<li>${c.manualExpr ? `Manual: ${c.alias}` : c.aggregate ? `${c.aggregate}(${c.table}.${c.column})` : `${c.table}.${c.column}`}${c.alias && !c.manualExpr ? ` AS ${c.alias}` : ''}${c.displayMode === 'schema-decode' ? ' (schema decode)' : ''}</li>`).join('') : '<li>(none — SELECT * will be used)</li>'}</ul></div>
      <div><h3>Filters</h3><ul>${state.filters.length ? state.filters.map((f, i) => `<li>${i > 0 ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}${f.value2 ? ' AND ' + f.value2 : ''}</li>`).join('') : '<li>(none)</li>'}</ul>
      <h3>Advanced options</h3><ul><li>DISTINCT: ${state.advanced.distinct ? 'Yes' : 'No'}</li><li>Sort: ${state.sorts.length ? state.sorts.map((s) => `${s.table}.${s.column} ${s.direction}`).join(', ') : '(none)'}</li><li>Group by: ${state.advanced.groupByColumns.length ? state.advanced.groupByColumns.join(', ') : '(none)'}</li><li>Having: ${state.advanced.havingClause || '(none)'}</li><li>Limit: ${state.advanced.limit ?? '(none)'}</li><li>CTEs: ${state.advanced.ctes.length}</li><li>Explicit joins: ${state.joins.length}</li></ul></div>
    </div>`;
  }
  draw();
  (container as any)._cleanup = () => { unsubscribeSchema(); };
}
