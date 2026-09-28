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
import { relatableTables } from '../engines/relatedEngine';
import type { Dialect, RelatedFilterMode, ReadOnlyQueryState } from '../types';
import { makeId } from '../utils/id';
function explainQuery(state: ReadOnlyQueryState): string[] {
  const lines: string[] = [];
  if (state.selectedTables.length === 0 && !state.advanced.hierarchy.enabled) return ['Nothing to explain yet — select a table or describe a requirement first.'];
  if (state.advanced.hierarchy.enabled && state.advanced.hierarchy.table) lines.push(`Walks the "${state.advanced.hierarchy.table}" table recursively as a hierarchy/org chart, following ${state.advanced.hierarchy.parentColumn} → ${state.advanced.hierarchy.childColumn}.`);
  else if (state.selectedTables.length) lines.push(`Reads from: ${state.selectedTables.join(', ')}${state.selectedTables.length > 1 ? ' (joined automatically via the Active Schema\'s relationships, or via the explicit joins configured).' : '.'}`);
  const aggregateCols = state.selectedColumns.filter((c) => c.aggregate);
  if (aggregateCols.length) lines.push(`Calculates: ${aggregateCols.map((c) => `${c.aggregate}(${c.table}.${c.column})${c.alias ? ` as "${c.alias}"` : ''}`).join(', ')}.`);
  const decodeCols = state.selectedColumns.filter((c) => c.displayMode === 'schema-decode' || c.displayMode === 'manual-decode');
  if (decodeCols.length) lines.push(`Converts ${decodeCols.length} column(s) from raw stored value(s) to a readable label using a CASE expression (DECODE-as-CASE).`);
  if (state.filters.length) lines.push(`Filters rows where: ${state.filters.map((f, i) => `${i > 0 ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}`).join(' ')}.`);
  if (state.advanced.relatedFilters.length) lines.push(`Only includes/excludes rows based on related records in: ${state.advanced.relatedFilters.map((r) => `${r.mode} ${r.relatedTable}`).join(', ')}.`);
  if (state.advanced.groupByColumns.length) lines.push(`Groups results by: ${state.advanced.groupByColumns.join(', ')}.`);
  if (state.advanced.havingClause.trim()) lines.push(`Keeps only groups where: ${state.advanced.havingClause.trim()}.`);
  if (state.sorts.length) lines.push(`Sorts results by: ${state.sorts.map((s) => `${s.alias || `${s.table}.${s.column}`} ${s.direction}`).join(', ')}.`);
  if (state.advanced.limit) lines.push(`Returns only the top ${state.advanced.limit} result(s).`);
  if (state.advanced.ctes.length) lines.push(`Defines ${state.advanced.ctes.length} named CTE(s)/subquery block(s): ${state.advanced.ctes.map((c) => c.name).join(', ')}.`);
  if (state.advanced.relatedCounts.length) lines.push(`Adds a related-record count for: ${state.advanced.relatedCounts.map((c) => c.relatedTable).join(', ')}.`);
  if (state.advanced.saveAsView?.trim()) lines.push(`Wraps the entire query as a named CTE called "${state.advanced.saveAsView.trim()}".`);
  if (lines.length === 0) lines.push('A straightforward SELECT with no additional filtering, grouping, or sorting.');
  return lines;
}
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
      <p class="page-subtitle">Generates validated SELECT / WITH statements — including complex requirements with joins, aggregations, GROUP BY/HAVING, CASE, and subqueries. Natural Language and Manual Selectors merge together — use either one, or both.</p>

      <div class="builder-top-grid">
        <section class="builder-section builder-section-input">
          <h3 class="section-heading">${icon('sparkles', 16)} Describe What You Need <span class="hint-inline">(Optional)</span></h3>
          <div class="builder-panel describe-panel" data-tour="describe-card">
            <textarea id="nlDesc" rows="6" placeholder="e.g. Show total invoice amount by supplier for the current year, including supplier name, invoice count, average invoice amount, only suppliers whose total is greater than 100000, sorted by total descending, top 20">${state.naturalLanguageText}</textarea>
            <div class="describe-controls">
              <label class="inline-label">SQL dialect<select id="dialectSelect">${dialectOptions(state.dialect)}</select></label>
              <button type="button" class="btn btn-primary" id="nlBuildBtn">${icon('zap', 15)} ${isBuilding ? 'Processing…' : 'Build from Description'}</button>
            </div>
            <div id="nlNotes"></div>
          </div>
        </section>

        <section class="builder-section builder-section-output">
          <h3 class="section-heading">${icon('code', 16)} Generated SQL</h3>
          <div class="builder-panel output-panel">
            <div id="sqlBlockMount"></div>
          </div>
        </section>
      </div>

      <section class="builder-section">
        <h3 class="section-heading">${icon('sliders', 16)} Manual Selectors</h3>
        <div class="builder-panel manual-selectors-panel">
          <div id="tabsMount"></div>
          <div class="row-actions build-query-row"><button type="button" class="btn btn-outline" id="buildQueryBtn">${icon('zap', 15)} Build Query</button><span class="hint">Regenerates the SQL from your current manual selections (this also happens automatically as you make changes).</span></div>
          ${errorIssues.length ? `<div class="issue-box mini">${icon('alert-triangle', 15)}<ul>${errorIssues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
          ${warnIssues.length ? `<div class="issue-box warn mini">${icon('alert-triangle', 14)}<ul>${warnIssues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
        </div>
      </section>
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
    if (nlBtn) { nlBtn.disabled = true; nlBtn.innerHTML = `${icon('refresh', 15, 'icon-spin')} Processing…`; }
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
      onRegenerate: () => { store.regenerateReadOnlySql(); store.pushToast('info', 'SQL regenerated from current selections.'); renderSqlOutput(); },
      onExplain: () => { const mountE = container.querySelector<HTMLElement>('#explainMount'); if (!mountE) return; if (mountE.innerHTML.trim()) { mountE.innerHTML = ''; return; } const lines = explainQuery(store.readOnly); mountE.innerHTML = `<div class="tips-box mini">${icon('brain', 15)}<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>`; }
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
    panel.innerHTML = `<div class="tc-grid" data-tour="module-selector"><div class="tc-col"><h3>${icon('list', 15)} Select Tables</h3><div id="tablePickerMount"></div></div><div class="tc-col"><h3>${icon('columns', 15)} Select Columns (Alias/CASE appear once selected)</h3><div id="columnPickerMount"></div></div><div class="tc-col"><h3>${icon('filter', 15)} Filters</h3><div id="filterBuilderMount"></div></div></div>`;
    const tableMount = panel.querySelector<HTMLElement>('#tablePickerMount')!;
    renderTablePicker(tableMount, schema, state.selectedTables, (next) => { store.updateReadOnly((s) => { s.selectedTables = next; }); renderTablesColumnsTab(panel, store.readOnly, schema); renderSqlOutput(); });
    const columnMount = panel.querySelector<HTMLElement>('#columnPickerMount')!;
    renderColumnPicker(columnMount, schema, state.selectedTables, state.selectedColumns, { onChange: (next) => { store.updateReadOnly((s) => { s.selectedColumns = next; }); renderSqlOutput(); }, onRequestManualDecodeForColumn: (table, column, existingSpecId) => { openManualDecodeBuilder(state.dialect, (spec) => { store.updateReadOnly((s) => { s.selectedColumns = s.selectedColumns.map((c) => c.id === existingSpecId ? spec : c); }); renderSqlOutput(); }, { table, column: column.name }, existingSpecId, column.name); } });
    const filterMount = panel.querySelector<HTMLElement>('#filterBuilderMount')!;
    renderFilterBuilder(filterMount, schema, state.selectedTables, state.filters, (next) => { store.updateReadOnly((s) => { s.filters = next; }); renderSqlOutput(); });
  }
  function renderAdvancedTab(panel: HTMLElement, state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const hasGroupBy = state.advanced.groupByColumns.length > 0;
    const relatable = relatableTables(schema, state.selectedTables);
    const dialectLimitLabel = state.dialect === 'SQL Server' ? 'TOP' : state.dialect === 'Oracle' ? 'FETCH FIRST' : 'LIMIT';
    panel.innerHTML = `<div class="advanced-grid" data-tour="tab-advanced">
      <div class="adv-card">
        <h3>${icon('sliders', 15)} Query shape</h3>
        <label class="inline-check"><input type="checkbox" id="advDistinct" ${state.advanced.distinct ? 'checked' : ''}/> DISTINCT</label>
        <label class="block-label">Give this query a friendly name / CTE<input id="advSaveAsView" value="${state.advanced.saveAsView ?? ''}" placeholder="e.g. HighValueInvoices"/></label>
        <label class="block-label">Limit the number of results <span class="hint-inline">(${dialectLimitLabel} for the current dialect)</span><input id="advLimit" type="number" min="1" value="${state.advanced.limit ?? ''}"/></label>
        <label class="block-label">GROUP BY columns (comma separated)<input id="advGroupBy" value="${state.advanced.groupByColumns.join(', ')}"/></label>
        <label class="block-label ${hasGroupBy ? '' : 'is-disabled-hint'}">Filter on a total after grouping (HAVING)<input id="advHaving" value="${state.advanced.havingClause}" placeholder="e.g. SUM(invoice.invoice_amount) > 100000" ${hasGroupBy ? '' : 'disabled'}/></label>
        ${hasGroupBy ? '' : `<div class="hint">${icon('info', 13)} HAVING requires at least one GROUP BY column — add one above to enable it.</div>`}
      </div>
      <div class="adv-card">
        <h3>${icon('sort-asc', 15)} Order your results (ORDER BY)</h3>
        <div id="sortList"></div>
        <div class="row-actions wrap"><button type="button" class="btn btn-outline btn-sm" id="addSortBtn" ${state.selectedTables.length ? '' : 'disabled'}>${icon('plus', 14)} Add sort column</button><button type="button" class="btn btn-outline btn-sm" id="clearSortBtn">${icon('trash', 14)} Clear all sorting</button></div>
        ${state.selectedTables.length ? '' : `<div class="hint">${icon('info', 13)} Select at least one table to add a sortable column.</div>`}
      </div>
      <div class="adv-card">
        <h3>${icon('link', 15)} Only show records connected to another table</h3>
        <div id="relatedFilterList"></div>
        <div class="row-actions wrap"><button type="button" class="btn btn-outline btn-sm" id="addRelatedFilterBtn" ${relatable.length ? '' : 'disabled'}>${icon('plus', 14)} Add condition</button></div>
        ${relatable.length ? '' : `<div class="hint">${icon('info', 13)} No related tables were found via the Active Schema's relationships for the currently selected table(s).</div>`}
      </div>
      <div class="adv-card">
        <h3>${icon('layers', 15)} Show a related count</h3>
        <div id="relatedCountList"></div>
        <div class="row-actions wrap"><button type="button" class="btn btn-outline btn-sm" id="addRelatedCountBtn" ${relatable.length ? '' : 'disabled'}>${icon('plus', 14)} Add related count</button></div>
        ${relatable.length ? '' : `<div class="hint">${icon('info', 13)} No related tables were found via the Active Schema's relationships for the currently selected table(s).</div>`}
      </div>
      <div class="adv-card">
        <h3>${icon('git-branch', 15)} Show a full org chart or hierarchy</h3>
        <label class="inline-check"><input type="checkbox" id="hierEnabled" ${state.advanced.hierarchy.enabled ? 'checked' : ''}/> Enable recursive hierarchy</label>
        <div id="hierFields" class="${state.advanced.hierarchy.enabled ? '' : 'is-collapsed'}"></div>
        <div class="hint">${icon('info', 13)} Uses ${state.dialect === 'Oracle' ? 'CONNECT BY PRIOR (Oracle hierarchical query)' : 'WITH RECURSIVE'} for the current dialect.</div>
      </div>
      <div class="adv-card">
        <h3>WITH / CTEs</h3><div id="cteList"></div><button type="button" class="btn btn-outline btn-sm" id="addCteBtn">${icon('plus', 14)} Add CTE</button>
        <label class="inline-check mt"><input type="checkbox" id="advRecursive" ${state.advanced.recursive ? 'checked' : ''}/> Recursive (WITH RECURSIVE)</label>
      </div>
      <div class="adv-card">
        <h3>Manual CASE Columns <span class="hint-inline">(includes CASE/DECODE)</span></h3><div id="manualColsList"></div>
        <div class="row-actions wrap"><button type="button" class="btn btn-outline btn-sm" id="addManualCaseBtn">${icon('code', 14)} Add Manual CASE</button><button type="button" class="btn btn-outline btn-sm" id="addManualDecodeBtn">${icon('sparkles', 14)} Add Manual CASE/DECODE Mapping</button></div>
      </div>
    </div>`;
    panel.querySelector('#advDistinct')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.advanced.distinct = (e.target as HTMLInputElement).checked; }); renderSqlOutput(); });
    panel.querySelector('#advSaveAsView')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.saveAsView = (e.target as HTMLInputElement).value || null; }); renderSqlOutput(); });
    panel.querySelector('#advGroupBy')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.groupByColumns = (e.target as HTMLInputElement).value.split(',').map((v) => v.trim()).filter(Boolean); }); renderSqlOutput(); renderAdvancedTab(panel, store.readOnly, schema); });
    panel.querySelector('#advHaving')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.havingClause = (e.target as HTMLInputElement).value; }); renderSqlOutput(); });
    panel.querySelector('#advLimit')?.addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value; store.updateReadOnly((s) => { s.advanced.limit = v ? parseInt(v, 10) : null; }); renderSqlOutput(); });
    panel.querySelector('#advRecursive')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.advanced.recursive = (e.target as HTMLInputElement).checked; }); renderSqlOutput(); });
    function tableColumns(tableName: string): string[] { return schema.tables.find((t) => t.name === tableName)?.columns.map((c) => c.name) || []; }
    function renderSortList(): void {
      const mount = panel.querySelector<HTMLElement>('#sortList'); if (!mount) return;
      mount.innerHTML = state.sorts.length ? state.sorts.map((s, idx) => `<div class="sort-row" data-idx="${idx}">
        <select class="sort-table">${state.selectedTables.map((t) => `<option value="${t}" ${t === s.table ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <select class="sort-column">${tableColumns(s.table).map((c) => `<option value="${c}" ${c === s.column ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <select class="sort-dir"><option value="ASC" ${s.direction === 'ASC' ? 'selected' : ''}>ASC</option><option value="DESC" ${s.direction === 'DESC' ? 'selected' : ''}>DESC</option></select>
        <input class="sort-alias" placeholder="alias (optional)" value="${s.alias || ''}"/>
        <button type="button" class="icon-btn remove-sort-btn" title="Remove">${icon('trash', 14)}</button>
      </div>`).join('') : '<div class="hint">No sort columns added yet — results will be returned in default order.</div>';
      mount.querySelectorAll<HTMLElement>('.sort-row').forEach((row) => {
        const idx = parseInt(row.dataset.idx || '0', 10);
        row.querySelector('.sort-table')?.addEventListener('change', (e) => { const val = (e.target as HTMLSelectElement).value; store.updateReadOnly((s) => { s.sorts[idx].table = val; const cols = tableColumns(val); s.sorts[idx].column = cols[0] || ''; }); renderSqlOutput(); renderSortList(); });
        row.querySelector('.sort-column')?.addEventListener('change', (e) => { const val = (e.target as HTMLSelectElement).value; store.updateReadOnly((s) => { s.sorts[idx].column = val; }); renderSqlOutput(); });
        row.querySelector('.sort-dir')?.addEventListener('change', (e) => { const val = (e.target as HTMLSelectElement).value as 'ASC' | 'DESC'; store.updateReadOnly((s) => { s.sorts[idx].direction = val; }); renderSqlOutput(); });
        row.querySelector('.sort-alias')?.addEventListener('input', (e) => { const val = (e.target as HTMLInputElement).value; store.updateReadOnly((s) => { s.sorts[idx].alias = val || undefined; }); renderSqlOutput(); });
        row.querySelector('.remove-sort-btn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.sorts.splice(idx, 1); }); renderSqlOutput(); renderSortList(); });
      });
    }
    renderSortList();
    panel.querySelector('#addSortBtn')?.addEventListener('click', () => { const t = state.selectedTables[0]; const cols = tableColumns(t); store.updateReadOnly((s) => { s.sorts.push({ id: makeId('sort'), table: t, column: cols[0] || '', direction: 'ASC' }); }); renderSqlOutput(); renderSortList(); });
    panel.querySelector('#clearSortBtn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.sorts = []; }); renderSqlOutput(); renderSortList(); store.pushToast('info', 'All sorting cleared.'); });
    function renderRelatedFilterList(): void {
      const mount = panel.querySelector<HTMLElement>('#relatedFilterList'); if (!mount) return;
      mount.innerHTML = state.advanced.relatedFilters.length ? state.advanced.relatedFilters.map((f, idx) => `<div class="mini-row" data-idx="${idx}">
        <select class="rf-table">${relatable.map((r) => `<option value="${r.table}" ${r.table === f.relatedTable ? 'selected' : ''}>${r.table}</option>`).join('')}</select>
        <select class="rf-mode"><option value="EXISTS" ${f.mode === 'EXISTS' ? 'selected' : ''}>connected to (EXISTS)</option><option value="NOT EXISTS" ${f.mode === 'NOT EXISTS' ? 'selected' : ''}>not connected to (NOT EXISTS)</option></select>
        <button type="button" class="icon-btn remove-rf-btn">${icon('trash', 14)}</button>
      </div>`).join('') : '<div class="hint">No related-table conditions added.</div>';
      mount.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => {
        const idx = parseInt(row.dataset.idx || '0', 10);
        row.querySelector('.rf-table')?.addEventListener('change', (e) => { const val = (e.target as HTMLSelectElement).value; const match = relatable.find((r) => r.table === val); store.updateReadOnly((s) => { s.advanced.relatedFilters[idx].relatedTable = val; s.advanced.relatedFilters[idx].relationshipId = match?.relationshipId || null; }); renderSqlOutput(); });
        row.querySelector('.rf-mode')?.addEventListener('change', (e) => { const val = (e.target as HTMLSelectElement).value as RelatedFilterMode; store.updateReadOnly((s) => { s.advanced.relatedFilters[idx].mode = val; }); renderSqlOutput(); });
        row.querySelector('.remove-rf-btn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.advanced.relatedFilters.splice(idx, 1); }); renderSqlOutput(); renderRelatedFilterList(); });
      });
    }
    renderRelatedFilterList();
    panel.querySelector('#addRelatedFilterBtn')?.addEventListener('click', () => { const r = relatable[0]; if (!r) return; store.updateReadOnly((s) => { s.advanced.relatedFilters.push({ id: makeId('relfilter'), relatedTable: r.table, mode: 'EXISTS', relationshipId: r.relationshipId }); }); renderSqlOutput(); renderRelatedFilterList(); });
    function renderRelatedCountList(): void {
      const mount = panel.querySelector<HTMLElement>('#relatedCountList'); if (!mount) return;
      mount.innerHTML = state.advanced.relatedCounts.length ? state.advanced.relatedCounts.map((c, idx) => `<div class="mini-row" data-idx="${idx}">
        <select class="rc-table">${relatable.map((r) => `<option value="${r.table}" ${r.table === c.relatedTable ? 'selected' : ''}>${r.table}</option>`).join('')}</select>
        <input class="rc-alias" placeholder="count alias" value="${c.alias}"/>
        <button type="button" class="icon-btn remove-rc-btn">${icon('trash', 14)}</button>
      </div>`).join('') : '<div class="hint">No related counts added.</div>';
      mount.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => {
        const idx = parseInt(row.dataset.idx || '0', 10);
        row.querySelector('.rc-table')?.addEventListener('change', (e) => { const val = (e.target as HTMLSelectElement).value; const match = relatable.find((r) => r.table === val); store.updateReadOnly((s) => { s.advanced.relatedCounts[idx].relatedTable = val; s.advanced.relatedCounts[idx].relationshipId = match?.relationshipId || null; if (!s.advanced.relatedCounts[idx].alias) s.advanced.relatedCounts[idx].alias = `${val.toLowerCase()}_count`; }); renderSqlOutput(); renderRelatedCountList(); });
        row.querySelector('.rc-alias')?.addEventListener('input', (e) => { const val = (e.target as HTMLInputElement).value; store.updateReadOnly((s) => { s.advanced.relatedCounts[idx].alias = val; }); renderSqlOutput(); });
        row.querySelector('.remove-rc-btn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.advanced.relatedCounts.splice(idx, 1); }); renderSqlOutput(); renderRelatedCountList(); });
      });
    }
    renderRelatedCountList();
    panel.querySelector('#addRelatedCountBtn')?.addEventListener('click', () => { const r = relatable[0]; if (!r) return; store.updateReadOnly((s) => { s.advanced.relatedCounts.push({ id: makeId('relcount'), relatedTable: r.table, relationshipId: r.relationshipId, alias: `${r.table.toLowerCase()}_count` }); }); renderSqlOutput(); renderRelatedCountList(); });
    function renderHierarchyFields(): void {
      const mount = panel.querySelector<HTMLElement>('#hierFields'); if (!mount) return;
      const h = state.advanced.hierarchy;
      const allTables = schema.tables.map((t) => t.name);
      const cols = h.table ? tableColumns(h.table) : [];
      mount.innerHTML = `
        <label class="block-label">Hierarchy table<select class="hier-table">${allTables.map((t) => `<option value="${t}" ${t === h.table ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="block-label">Parent column (e.g. manager_id)<select class="hier-parent">${cols.map((c) => `<option value="${c}" ${c === h.parentColumn ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="block-label">Child / ID column (e.g. employee_id)<select class="hier-child">${cols.map((c) => `<option value="${c}" ${c === h.childColumn ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="block-label">Starting / root record value <span class="hint-inline">(blank = top of hierarchy, parent IS NULL)</span><input class="hier-root" value="${h.rootValue}"/></label>
        <label class="block-label">Optional maximum depth<input class="hier-depth" type="number" min="1" value="${h.maxDepth ?? ''}"/></label>
        <label class="block-label">CTE name<input class="hier-cte-name" value="${h.cteName}"/></label>
      `;
      mount.querySelector('.hier-table')?.addEventListener('change', (e) => { const val = (e.target as HTMLSelectElement).value; store.updateReadOnly((s) => { s.advanced.hierarchy.table = val; const c = tableColumns(val); s.advanced.hierarchy.parentColumn = c[0] || null; s.advanced.hierarchy.childColumn = c[0] || null; }); renderSqlOutput(); renderHierarchyFields(); });
      mount.querySelector('.hier-parent')?.addEventListener('change', (e) => { const val = (e.target as HTMLSelectElement).value; store.updateReadOnly((s) => { s.advanced.hierarchy.parentColumn = val; }); renderSqlOutput(); });
      mount.querySelector('.hier-child')?.addEventListener('change', (e) => { const val = (e.target as HTMLSelectElement).value; store.updateReadOnly((s) => { s.advanced.hierarchy.childColumn = val; }); renderSqlOutput(); });
      mount.querySelector('.hier-root')?.addEventListener('input', (e) => { const val = (e.target as HTMLInputElement).value; store.updateReadOnly((s) => { s.advanced.hierarchy.rootValue = val; }); renderSqlOutput(); });
      mount.querySelector('.hier-depth')?.addEventListener('input', (e) => { const val = (e.target as HTMLInputElement).value; store.updateReadOnly((s) => { s.advanced.hierarchy.maxDepth = val ? parseInt(val, 10) : null; }); renderSqlOutput(); });
      mount.querySelector('.hier-cte-name')?.addEventListener('input', (e) => { const val = (e.target as HTMLInputElement).value; store.updateReadOnly((s) => { s.advanced.hierarchy.cteName = val; }); renderSqlOutput(); });
    }
    if (state.advanced.hierarchy.enabled) renderHierarchyFields();
    panel.querySelector('#hierEnabled')?.addEventListener('change', (e) => { const checked = (e.target as HTMLInputElement).checked; store.updateReadOnly((s) => { s.advanced.hierarchy.enabled = checked; if (checked && !s.advanced.hierarchy.table) { const t = schema.tables[0]?.name || null; s.advanced.hierarchy.table = t; const c = t ? tableColumns(t) : []; s.advanced.hierarchy.parentColumn = c[0] || null; s.advanced.hierarchy.childColumn = c[0] || null; } }); renderSqlOutput(); renderAdvancedTab(panel, store.readOnly, schema); });
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
      mount.innerHTML = manualCols.length ? manualCols.map((c) => `<div class="mini-row"><strong>${c.alias}</strong><button type="button" class="icon-btn remove-manual-col" data-id="${c.id}">${icon('trash', 14)}</button></div>`).join('') : '<div class="hint">No custom CASE columns added yet.</div>';
      mount.querySelectorAll<HTMLElement>('.remove-manual-col').forEach((btn) => { btn.addEventListener('click', () => { store.updateReadOnly((s) => { s.selectedColumns = s.selectedColumns.filter((c) => c.id !== btn.dataset.id); }); renderSqlOutput(); renderManualCols(); }); });
    }
    renderManualCols();
    panel.querySelector('#addManualCaseBtn')?.addEventListener('click', () => { openManualCaseBuilder(state.dialect, (spec) => { store.updateReadOnly((s) => { s.selectedColumns.push(spec); }); renderSqlOutput(); renderManualCols(); store.pushToast('success', `Manual CASE column "${spec.alias}" added.`); }); });
    panel.querySelector('#addManualDecodeBtn')?.addEventListener('click', () => { openManualDecodeBuilder(state.dialect, (spec) => { store.updateReadOnly((s) => { s.selectedColumns.push(spec); }); renderSqlOutput(); renderManualCols(); store.pushToast('success', `Manual CASE/DECODE column "${spec.alias}" added.`); }); });
  }
  function renderSummaryTab(panel: HTMLElement, state: typeof store.readOnly): void {
    panel.innerHTML = `<div class="summary-grid">
      <div><h3>Natural-language requirement</h3><p>${state.naturalLanguageText ? state.naturalLanguageText : '(none provided)'}</p>
      <h3>Selected tables</h3><p>${state.selectedTables.length ? state.selectedTables.join(', ') : '(none)'}</p>
      <h3>Selected columns</h3><ul>${state.selectedColumns.length ? state.selectedColumns.map((c) => `<li>${c.manualExpr ? `Manual: ${c.alias}` : c.aggregate ? `${c.aggregate}(${c.table}.${c.column})` : `${c.table}.${c.column}`}${c.alias && !c.manualExpr ? ` AS ${c.alias}` : ''}${c.displayMode === 'schema-decode' ? ' (schema CASE/DECODE)' : ''}</li>`).join('') : '<li>(none — SELECT * will be used)</li>'}</ul></div>
      <div><h3>Filters</h3><ul>${state.filters.length ? state.filters.map((f, i) => `<li>${i > 0 ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}${f.value2 ? ' AND ' + f.value2 : ''}</li>`).join('') : '<li>(none)</li>'}</ul>
      <h3>Advanced options</h3><ul><li>DISTINCT: ${state.advanced.distinct ? 'Yes' : 'No'}</li><li>Sort: ${state.sorts.length ? state.sorts.map((s) => `${s.alias || `${s.table}.${s.column}`} ${s.direction}`).join(', ') : '(none)'}</li><li>Group by: ${state.advanced.groupByColumns.length ? state.advanced.groupByColumns.join(', ') : '(none)'}</li><li>Having: ${state.advanced.havingClause || '(none)'}</li><li>Limit: ${state.advanced.limit ?? '(none)'}</li><li>Friendly name / CTE: ${state.advanced.saveAsView || '(none)'}</li><li>Related conditions (EXISTS): ${state.advanced.relatedFilters.length}</li><li>Related counts: ${state.advanced.relatedCounts.length}</li><li>Recursive hierarchy: ${state.advanced.hierarchy.enabled ? `Yes (${state.advanced.hierarchy.table}.${state.advanced.hierarchy.parentColumn} → ${state.advanced.hierarchy.childColumn})` : 'No'}</li><li>CTEs: ${state.advanced.ctes.length}</li><li>Explicit joins: ${state.joins.length}</li></ul></div>
    </div>`;
  }
  draw();
  (container as any)._cleanup = () => { unsubscribeSchema(); };
}
