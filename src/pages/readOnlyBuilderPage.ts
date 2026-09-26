import { icon } from '../components/icons';
import { renderTablePicker } from '../components/tablePicker';
import { renderColumnPicker } from '../components/columnPicker';
import { renderFilterBuilder } from '../components/filterBuilder';
import { renderSqlCodeBlock, copyTextToClipboard } from '../components/sqlCodeBlock';
import { renderTabs } from '../components/tabs';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { aiService } from '../services/aiService';
import { validateFullReadOnly } from '../engines/validationEngine';
import { optimizeSuggestions } from '../engines/optimizeEngine';
import { decodeLegend } from '../engines/decodeEngine';
import type { Dialect } from '../types';
import { makeId } from '../utils/id';

export function renderReadOnlyBuilderPage(container: HTMLElement): void {
  const unsubscribe = store.subscribe(draw);
  const unsubscribeSchema = schemaService.subscribe(draw);
  let activeTabId = 'tables-columns';

  function draw(): void {
    const state = store.readOnly;
    const schema = schemaService.getActiveSchema();
    const validation = validateFullReadOnly(state);
    const errorIssues = validation.issues.filter((i) => i.severity === 'error');
    const warnIssues = validation.issues.filter((i) => i.severity === 'warning');

    container.innerHTML = `
      <section class="page page-builder">
        <h1 class="page-title">${icon('table')} Read Only Query Builder</h1>
        <p class="page-subtitle">Generates validated SELECT / WITH statements only — destructive statements are blocked at the engine level, not just the UI.</p>
        <div class="builder-grid-top">
          <div class="builder-panel" data-tour="describe-card">
            <h2>${icon('sparkles', 16)} Describe What You Need <span class="optional">(optional)</span></h2>
            <textarea id="nlDesc" rows="4" placeholder="e.g. Show invoices this month where the amount is greater than 10000, including supplier name">${state.naturalLanguageText}</textarea>
            <div class="row-actions"><label class="inline-label">SQL dialect<select id="dialectSelect">${dialectOptions(state.dialect)}</select></label></div>
            <button id="nlBuildBtn" class="btn btn-primary">${icon('zap', 15)} Build Query</button>
            <div id="nlNotes"></div>
          </div>
          <div class="builder-panel" data-tour="generated-sql-card">
            <h2>${icon('code', 16)} Generated SQL</h2>
            <div id="sqlBlockMount"></div>
            <div id="validationMount"></div>
            <div id="optimizeMount"></div>
          </div>
        </div>
        <div class="builder-panel manual-selectors-panel">
          <h2>${icon('sliders', 16)} Manual Selectors</h2>
          <div id="tabsMount"></div>
        </div>
        ${errorIssues.length ? `<div class="issue-box">${icon('alert-triangle', 15)}<ul>${errorIssues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
        ${warnIssues.length ? `<div class="issue-box mini warn">${icon('alert-triangle', 14)}<ul>${warnIssues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
      </section>`;

    wireTopRow();
    renderTabsSection(state, schema);
  }

  function dialectOptions(selected: Dialect): string { const list: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic']; return list.map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`).join(''); }

  function wireTopRow(): void {
    container.querySelector<HTMLTextAreaElement>('#nlDesc')?.addEventListener('input', (e) => { store.readOnly.naturalLanguageText = (e.target as HTMLTextAreaElement).value; });
    container.querySelector<HTMLSelectElement>('#dialectSelect')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.dialect = (e.target as HTMLSelectElement).value as Dialect; }); });
    container.querySelector('#nlBuildBtn')?.addEventListener('click', () => runNlBuild());
    renderSqlOutput();
  }

  function runNlBuild(preferredColumn?: string): void {
    const schema = schemaService.getActiveSchema();
    const requirement = aiService.planQuery(store.readOnly.naturalLanguageText, schema);
    if (preferredColumn) { requirement.clarifications = []; }
    const result = aiService.generateSQL(requirement, schema, store.readOnly);
    store.updateReadOnly((s) => {
      if (requirement.matchedTables.length) s.selectedTables = requirement.matchedTables;
      if (requirement.matchedColumns.length) s.selectedColumns = requirement.matchedColumns;
      if (requirement.matchedFilters.length) s.filters = requirement.matchedFilters;
      if (requirement.matchedSorts.length) s.sorts = requirement.matchedSorts;
      if (requirement.limit) s.advanced.limit = requirement.limit;
      if (requirement.distinct) s.advanced.distinct = true;
    });
    const notesMount = container.querySelector('#nlNotes');
    if (notesMount) {
      const clarifHtml = requirement.clarifications.length ? `
        <div class="issue-box mini warn">
          ${icon('alert-triangle', 14)}
          <div>
            ${requirement.clarifications.map((cq) => `<div>${cq.question}</div><div class="row-actions wrap">${cq.options.map((opt) => `<button type="button" class="btn btn-outline btn-sm clarify-btn" data-col="${opt}">${opt}</button>`).join('')}</div>`).join('')}
          </div>
        </div>` : '';
      notesMount.innerHTML = `
        <div class="notes-box">
          ${icon('info', 14)}
          <div>
            <strong>Query Plan</strong>
            <ol class="mini-list plan-list">${requirement.queryPlan.map((p) => `<li>${p}</li>`).join('')}</ol>
            <strong>Notes</strong>
            <ul>${requirement.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
            ${result.warnings.length ? `<div class="hint">⚠ ${result.warnings.join(' ')}</div>` : ''}
          </div>
        </div>
        ${clarifHtml}`;
      notesMount.querySelectorAll<HTMLButtonElement>('.clarify-btn').forEach((btn) => { btn.addEventListener('click', () => runNlBuild(btn.dataset.col)); });
    }
    renderSqlOutput();
  }

  function renderSqlOutput(): void {
    const mount = container.querySelector<HTMLElement>('#sqlBlockMount');
    if (!mount) return;
    renderSqlCodeBlock(mount, store.readOnly.generatedSql, {
      onCopy: () => { copyTextToClipboard(store.readOnly.generatedSql); store.pushToast('success', 'SQL copied to clipboard.'); },
      onClear: () => { store.resetReadOnly(); store.pushToast('info', 'Query cleared.'); },
      onValidate: () => {
        const result = validateFullReadOnly(store.readOnly);
        const mountV = container.querySelector('#validationMount');
        if (mountV) mountV.innerHTML = result.valid ? `<div class="issue-box mini ok">${icon('check', 14)} SQL passed validation — no destructive statements detected.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${result.issues.map((i) => `<li>[${i.severity}] ${i.message}</li>`).join('')}</ul></div>`;
      },
      onRegenerate: () => { store.regenerateReadOnlySql(); store.pushToast('info', 'SQL regenerated from current selections.'); }
    }, [{ id: 'btnOptimizeToggle', label: 'Optimize', iconName: 'wand', onClick: () => { const mountO = container.querySelector('#optimizeMount'); if (!mountO) return; if (mountO.innerHTML.trim()) { mountO.innerHTML = ''; return; } const tips = optimizeSuggestions(store.readOnly); mountO.innerHTML = `<div class="tips-box">${icon('wand', 15)}<ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul></div>`; } }]);
  }

  function renderTabsSection(state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const mount = container.querySelector<HTMLElement>('#tabsMount');
    if (!mount) return;
    renderTabs(mount, [
      { id: 'tables-columns', label: 'Tables & Columns', render: (panel) => renderTablesColumnsTab(panel, state, schema) },
      { id: 'advanced', label: 'Advanced Options', render: (panel) => renderAdvancedTab(panel, state, schema) },
      { id: 'summary', label: 'Selected / Described Requirements', render: (panel) => renderSummaryTab(panel, state) }
    ], activeTabId, { 'tables-columns': 'tab-tables-columns', advanced: 'tab-advanced', summary: 'tab-summary' }, (id) => { activeTabId = id; });
  }

  function renderTablesColumnsTab(panel: HTMLElement, state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    panel.innerHTML = `<div class="tc-grid"><div class="tc-col"><h3>${icon('list', 15)} Select Tables</h3><div id="tablePickerMount"></div></div><div class="tc-col"><h3>${icon('columns', 15)} Select Columns</h3><div id="columnPickerMount"></div></div><div class="tc-col"><h3>${icon('filter', 15)} Filters</h3><div id="filterBuilderMount"></div></div></div>`;
    const tableMount = panel.querySelector<HTMLElement>('#tablePickerMount')!; const columnMount = panel.querySelector<HTMLElement>('#columnPickerMount')!; const filterMount = panel.querySelector<HTMLElement>('#filterBuilderMount')!;
    renderTablePicker(tableMount, schema, state.selectedTables, (next) => {
      store.updateReadOnly((s) => { s.selectedTables = next; s.selectedColumns = s.selectedColumns.filter((c) => next.includes(c.table)); s.filters = s.filters.filter((f) => next.includes(f.table)); s.sorts = s.sorts.filter((so) => next.includes(so.table)); s.joins = s.joins.filter((j) => next.includes(j.table)); });
      renderSqlOutput();
      renderColumnPicker(columnMount, schema, store.readOnly.selectedTables, store.readOnly.selectedColumns, onColumnsChange);
      renderFilterBuilder(filterMount, schema, store.readOnly.selectedTables, store.readOnly.filters, onFiltersChange);
    });
    function onColumnsChange(next: typeof state.selectedColumns): void { store.updateReadOnly((s) => { s.selectedColumns = next; }); renderSqlOutput(); }
    function onFiltersChange(next: typeof state.filters): void { store.updateReadOnly((s) => { s.filters = next; }); renderSqlOutput(); }
    renderColumnPicker(columnMount, schema, state.selectedTables, state.selectedColumns, onColumnsChange);
    renderFilterBuilder(filterMount, schema, state.selectedTables, state.filters, onFiltersChange);
  }

  function renderAdvancedTab(panel: HTMLElement, state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const allCols = state.selectedTables.flatMap((t) => { const table = schema.tables.find((x) => x.name === t); return table ? table.columns.map((c) => ({ table: t, column: c.name, label: `${t}.${c.name}`, decode: c.decode })) : []; });
    panel.innerHTML = `
      <div class="advanced-grid">
        <div>
          <h3>${icon('sort-asc', 15)} Sorting</h3><div id="sortsList" class="mini-list"></div><button id="addSortBtn" class="btn btn-outline btn-sm">${icon('plus', 14)} Add sort</button>
          <h3 class="mt">${icon('layers', 15)} Grouping &amp; Aggregation</h3>
          <label class="block-label">Group by columns<select id="groupBySelect" multiple size="4">${allCols.map((c) => `<option value="${c.table}::${c.column}" ${state.advanced.groupByColumns.includes(`${c.table}.${c.column}`) ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
          <label class="block-label">HAVING clause<input type="text" id="havingInput" value="${state.advanced.havingClause}" placeholder="e.g. COUNT(*) > 1" /></label>
          <h3 class="mt">Aggregate a column</h3>
          <div class="row-actions"><select id="aggColSelect">${allCols.map((c) => `<option value="${c.table}::${c.column}">${c.label}</option>`).join('')}</select><select id="aggFnSelect"><option value="COUNT">COUNT</option><option value="SUM">SUM</option><option value="AVG">AVG</option><option value="MIN">MIN</option><option value="MAX">MAX</option></select><button id="addAggBtn" class="btn btn-outline btn-sm">${icon('plus', 14)} Add</button></div>
        </div>
        <div>
          <h3>${icon('link', 15)} Joins</h3><div id="joinsList" class="mini-list"></div><button id="addJoinBtn" class="btn btn-outline btn-sm" ${state.selectedTables.length < 2 ? 'disabled' : ''}>${icon('plus', 14)} Add explicit join</button>
          <p class="hint">Joins between selected tables are inferred automatically from schema relationships.</p>
          <h3 class="mt">Other options</h3>
          <label class="inline-check"><input type="checkbox" id="distinctCheck" ${state.advanced.distinct ? 'checked' : ''}/> DISTINCT</label>
          <label class="inline-check"><input type="checkbox" id="recursiveCheck" ${state.advanced.recursive ? 'checked' : ''}/> Recursive hierarchy (WITH RECURSIVE)</label>
          <label class="block-label">Result limit<input type="number" id="limitInput" min="1" value="${state.advanced.limit ?? ''}" placeholder="none" /></label>
          <label class="block-label">Save as a named view<input type="text" id="viewNameInput" value="${state.advanced.saveAsView ?? ''}" placeholder="e.g. recent_high_value_invoices" /></label>
          <h3 class="mt">${icon('code', 15)} CASE / DECODE columns</h3><div id="decodeColsList" class="mini-list"></div>
        </div>
      </div>`;
    function renderSortsList(): void {
      const list = panel.querySelector('#sortsList'); if (!list) return;
      list.innerHTML = state.sorts.map((s, idx) => `<div class="mini-row" data-idx="${idx}"><select class="sort-col-select">${allCols.map((c) => `<option value="${c.table}::${c.column}" ${c.table === s.table && c.column === s.column ? 'selected' : ''}>${c.label}</option>`).join('')}</select><select class="sort-dir-select"><option value="ASC" ${s.direction === 'ASC' ? 'selected' : ''}>ASC</option><option value="DESC" ${s.direction === 'DESC' ? 'selected' : ''}>DESC</option></select><button class="icon-btn remove-btn" title="Remove">${icon('trash', 14)}</button></div>`).join('');
      list.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.sort-col-select')?.addEventListener('change', (e) => { const [t, c] = (e.target as HTMLSelectElement).value.split('::'); store.updateReadOnly((s) => { s.sorts[idx].table = t; s.sorts[idx].column = c; }); renderSqlOutput(); }); row.querySelector('.sort-dir-select')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.sorts[idx].direction = (e.target as HTMLSelectElement).value as 'ASC' | 'DESC'; }); renderSqlOutput(); }); row.querySelector('.remove-btn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.sorts.splice(idx, 1); }); renderSqlOutput(); renderSortsList(); }); });
    }
    renderSortsList();
    panel.querySelector('#addSortBtn')?.addEventListener('click', () => { if (allCols.length === 0) return; store.updateReadOnly((s) => { s.sorts.push({ id: makeId('sort'), table: allCols[0].table, column: allCols[0].column, direction: 'ASC' }); }); renderSqlOutput(); renderSortsList(); });
    panel.querySelector<HTMLSelectElement>('#groupBySelect')?.addEventListener('change', (e) => { const selected = Array.from((e.target as HTMLSelectElement).selectedOptions).map((o) => o.value.replace('::', '.')); store.updateReadOnly((s) => { s.advanced.groupByColumns = selected; }); renderSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#havingInput')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.havingClause = (e.target as HTMLInputElement).value; }); renderSqlOutput(); });
    panel.querySelector('#addAggBtn')?.addEventListener('click', () => { const colVal = panel.querySelector<HTMLSelectElement>('#aggColSelect')?.value; const fn = panel.querySelector<HTMLSelectElement>('#aggFnSelect')?.value as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; if (!colVal) return; const [t, c] = colVal.split('::'); store.updateReadOnly((s) => { s.selectedColumns.push({ id: makeId('col'), table: t, column: c, alias: '', useDecode: false, aggregate: fn }); }); renderSqlOutput(); store.pushToast('success', `${fn}(${t}.${c}) added to SELECT.`); });
    function renderJoinsList(): void { const list = panel.querySelector('#joinsList'); if (!list) return; list.innerHTML = state.joins.map((j, idx) => `<div class="mini-row wrap" data-idx="${idx}"><select class="join-type-select"><option value="INNER JOIN" ${j.joinType === 'INNER JOIN' ? 'selected' : ''}>INNER JOIN</option><option value="LEFT JOIN" ${j.joinType === 'LEFT JOIN' ? 'selected' : ''}>LEFT JOIN</option></select><span class="hint">${j.onLeftTable}.${j.onLeftColumn} = ${j.table}.${j.onRightColumn}</span><button class="icon-btn remove-btn" title="Remove">${icon('trash', 14)}</button></div>`).join(''); list.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.join-type-select')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.joins[idx].joinType = (e.target as HTMLSelectElement).value as 'INNER JOIN' | 'LEFT JOIN'; }); renderSqlOutput(); }); row.querySelector('.remove-btn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.joins.splice(idx, 1); }); renderSqlOutput(); renderJoinsList(); }); }); }
    renderJoinsList();
    panel.querySelector('#addJoinBtn')?.addEventListener('click', () => { if (state.selectedTables.length < 2) return; const primary = state.selectedTables[0]; const other = state.selectedTables.find((t) => t !== primary && !state.joins.some((j) => j.table === t)); if (!other) { store.pushToast('info', 'All additional tables already have an explicit or inferred join.'); return; } const primaryTable = schema.tables.find((t) => t.name === primary); const otherTable = schema.tables.find((t) => t.name === other); const fk = otherTable?.columns.find((c) => c.references?.table === primary); const pk = primaryTable?.columns.find((c) => c.isPrimaryKey); store.updateReadOnly((s) => { s.joins.push({ id: makeId('join'), table: other, joinType: 'INNER JOIN', onLeftTable: primary, onLeftColumn: pk?.name || 'ID', onRightColumn: fk?.name || pk?.name || 'ID' }); }); renderSqlOutput(); renderJoinsList(); });
    panel.querySelector<HTMLInputElement>('#distinctCheck')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.advanced.distinct = (e.target as HTMLInputElement).checked; }); renderSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#recursiveCheck')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.advanced.recursive = (e.target as HTMLInputElement).checked; }); renderSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#limitInput')?.addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value; store.updateReadOnly((s) => { s.advanced.limit = v ? parseInt(v, 10) : null; }); renderSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#viewNameInput')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.saveAsView = (e.target as HTMLInputElement).value || null; }); renderSqlOutput(); });
    const decodeList = panel.querySelector('#decodeColsList');
    if (decodeList) { const decodeCols = state.selectedColumns.filter((c) => { const colDef = schema.tables.find((t) => t.name === c.table)?.columns.find((cd) => cd.name === c.column); return colDef?.decode?.length; }); decodeList.innerHTML = decodeCols.length ? decodeCols.map((c) => { const colDef = schema.tables.find((t) => t.name === c.table)?.columns.find((cd) => cd.name === c.column)!; return `<div class="mini-row"><label class="inline-check tiny"><input type="checkbox" class="decode-toggle" data-table="${c.table}" data-column="${c.column}" ${c.useDecode ? 'checked' : ''}/> ${c.table}.${c.column}</label><span class="hint">${decodeLegend(colDef)}</span></div>`; }).join('') : '<p class="hint">No decode-enabled columns selected yet.</p>'; decodeList.querySelectorAll<HTMLInputElement>('.decode-toggle').forEach((cb) => { cb.addEventListener('change', () => { const t = cb.dataset.table!; const c = cb.dataset.column!; store.updateReadOnly((s) => { const target = s.selectedColumns.find((x) => x.table === t && x.column === c); if (target) target.useDecode = cb.checked; }); renderSqlOutput(); }); }); }
  }

  function renderSummaryTab(panel: HTMLElement, state: typeof store.readOnly): void {
    panel.innerHTML = `
      <div class="summary-grid">
        <div>
          <h3>Natural-language requirement</h3><p class="hint">${state.naturalLanguageText ? state.naturalLanguageText : '(none provided)'}</p>
          <h3 class="mt">Selected tables</h3><p>${state.selectedTables.length ? state.selectedTables.join(', ') : '(none)'}</p>
          <h3 class="mt">Selected columns</h3><ul class="mini-list">${state.selectedColumns.length ? state.selectedColumns.map((c) => `<li>${c.aggregate ? `${c.aggregate}(${c.table}.${c.column})` : `${c.table}.${c.column}`}${c.alias ? ` AS ${c.alias}` : ''}${c.useDecode ? ' (decoded)' : ''}</li>`).join('') : '<li class="hint">(none — SELECT * will be used)</li>'}</ul>
        </div>
        <div>
          <h3>Filters</h3><ul class="mini-list">${state.filters.length ? state.filters.map((f, i) => `<li>${i > 0 ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}${f.value2 ? ' AND ' + f.value2 : ''}</li>`).join('') : '<li class="hint">(none)</li>'}</ul>
          <h3 class="mt">Advanced options</h3>
          <ul class="mini-list"><li>DISTINCT: ${state.advanced.distinct ? 'Yes' : 'No'}</li><li>Sort: ${state.sorts.length ? state.sorts.map((s) => `${s.table}.${s.column} ${s.direction}`).join(', ') : '(none)'}</li><li>Group by: ${state.advanced.groupByColumns.length ? state.advanced.groupByColumns.join(', ') : '(none)'}</li><li>Having: ${state.advanced.havingClause || '(none)'}</li><li>Limit: ${state.advanced.limit ?? '(none)'}</li><li>Joins: ${state.joins.length} explicit</li></ul>
        </div>
      </div>`;
  }

  draw();
  (container as any)._cleanup = () => { unsubscribe(); unsubscribeSchema(); };
}
