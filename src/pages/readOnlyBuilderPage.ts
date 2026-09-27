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
import { validateFullReadOnly } from '../engines/validationEngine';
import { optimizeSuggestions } from '../engines/optimizeEngine';
import { computeAutoJoinPlan } from '../engines/joinAutoEngine';
import type { Dialect, ColumnDef } from '../types';
import { makeId } from '../utils/id';

// ============================================================================
// readOnlyBuilderPage — V14.2. Key changes from V14.1:
//   - Select Columns tab: bottom "Manual CASE (custom)" / "Manual DECODE
//     (custom)" buttons REMOVED (moved into Advanced Options, spec section
//     23 — "Advanced Options should become the central location for
//     advanced SELECT functionality rather than continuously adding
//     separate buttons to the main Query Builder"). columnPicker now
//     handles per-column Alias/Display-as inline (spec 7-11).
//   - A single "Build Query" button now sits directly below the Manual
//     Selectors tabs (spec section 12) — the only action button there.
//   - Advanced Options gained: Automatic Joins summary + ambiguity
//     resolution, WITH/CTE builder, and the relocated Manual CASE/DECODE
//     (custom) buttons (spec sections 2-5, 13, 20-21, 23).
//   - Still NO blanket `store.subscribe(draw)` — only
//     `schemaService.subscribe(draw)` — preserving the V14.1 no-refresh
//     fix (spec section 32).
// ============================================================================

export function renderReadOnlyBuilderPage(container: HTMLElement): void {
  const unsubscribeSchema = schemaService.subscribe(draw);
  let activeTabId = 'tables-columns';
  let isBuilding = false;

  function draw(): void {
    const state = store.readOnly;
    const schema = schemaService.getActiveSchema();
    const validation = validateFullReadOnly(state);
    const errorIssues = validation.issues.filter((i) => i.severity === 'error');
    const warnIssues = validation.issues.filter((i) => i.severity === 'warning');

    container.innerHTML = `
      <section class="page page-builder">
        <h1 class="page-title">${icon('table')} Read Only Query Builder</h1>
        <p class="page-subtitle">Generates validated SELECT / WITH statements only — destructive statements are blocked at the engine level, not just the UI. Natural Language and Manual Selectors merge together — use either one, or both.</p>
        <div class="builder-grid-top">
          <div class="builder-panel" data-tour="describe-card">
            <h2>${icon('sparkles', 16)} Describe What You Need <span class="optional">(optional)</span></h2>
            <textarea id="nlDesc" rows="4" placeholder="e.g. Show invoices with their organization, or describe it in your own words">${state.naturalLanguageText}</textarea>
            <div class="row-actions"><label class="inline-label">SQL dialect<select id="dialectSelect">${dialectOptions(state.dialect)}</select></label></div>
            <button id="nlBuildBtn" class="btn btn-primary" ${isBuilding ? 'disabled' : ''}>${icon('zap', 15)} ${isBuilding ? 'Processing…' : 'Build from Description'}</button>
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
          <div class="row-actions build-query-row">
            <button id="buildQueryBtn" class="btn btn-primary">${icon('zap', 15)} Build Query</button>
            <span class="hint">Regenerates the SQL from your current manual selections (this also happens automatically as you make changes).</span>
          </div>
        </div>
        ${errorIssues.length ? `<div class="issue-box">${icon('alert-triangle', 15)}<ul>${errorIssues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
        ${warnIssues.length ? `<div class="issue-box mini warn">${icon('alert-triangle', 14)}<ul>${warnIssues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
      </section>`;

    wireTopRow();
    renderTabsSection(state, schema);
    container.querySelector('#buildQueryBtn')?.addEventListener('click', () => { store.regenerateReadOnlySql(); store.pushToast('info', 'Query rebuilt from manual selections.'); renderSqlOutput(); });
  }

  function dialectOptions(selected: Dialect): string { const list: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic']; return list.map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`).join(''); }

  function wireTopRow(): void {
    container.querySelector<HTMLTextAreaElement>('#nlDesc')?.addEventListener('input', (e) => { store.readOnly.naturalLanguageText = (e.target as HTMLTextAreaElement).value; });
    container.querySelector<HTMLSelectElement>('#dialectSelect')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.dialect = (e.target as HTMLSelectElement).value as Dialect; }); renderSqlOutput(); });
    container.querySelector('#nlBuildBtn')?.addEventListener('click', () => runNlBuild());
    renderSqlOutput();
  }

  async function runNlBuild(preferredColumn?: string): Promise<void> {
    isBuilding = true;
    const nlBtn = container.querySelector<HTMLButtonElement>('#nlBuildBtn');
    if (nlBtn) { nlBtn.disabled = true; nlBtn.innerHTML = `${icon('zap', 15)} Processing…`; }

    const schema = schemaService.getActiveSchema();
    const orchestrated = await orchestrateReadOnlyNlp(store.readOnly.naturalLanguageText, schema);
    const requirement = orchestrated.result;
    if (preferredColumn) requirement.clarifications = [];

    store.mergeReadOnlyFromNlp(requirement);
    const result = aiService.generateSQL(requirement, schema, store.readOnly);

    isBuilding = false;
    if (nlBtn) { nlBtn.disabled = false; nlBtn.innerHTML = `${icon('zap', 15)} Build from Description`; }

    const engineBadge = orchestrated.engineUsed === 'online' ? `<span class="engine-badge engine-online">${icon('cloud', 13)} Online AI/NLP</span>` : `<span class="engine-badge engine-offline">${icon('wifi-off', 13)} Offline/local engine${orchestrated.onlineAttempted ? ' (online attempt failed/unavailable)' : ''}</span>`;
    const notesMount = container.querySelector('#nlNotes');
    if (notesMount) {
      const clarifHtml = requirement.clarifications.length ? `<div class="issue-box mini warn">${icon('alert-triangle', 14)}<div>${requirement.clarifications.map((cq) => `<div>${cq.question}</div><div class="row-actions wrap">${cq.options.map((opt) => `<button type="button" class="btn btn-outline btn-sm clarify-btn" data-col="${opt}">${opt}</button>`).join('')}</div>`).join('')}</div></div>` : '';
      notesMount.innerHTML = `
        <div class="notes-box">
          ${icon('info', 14)}
          <div>
            ${engineBadge}
            <strong class="mt block">Query Plan</strong>
            <ol class="mini-list plan-list">${requirement.queryPlan.map((p) => `<li>${p}</li>`).join('')}</ol>
            <strong>Notes</strong>
            <ul>${requirement.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
            ${result.warnings.length ? `<div class="hint">⚠ ${result.warnings.join(' ')}</div>` : ''}
          </div>
        </div>
        ${clarifHtml}`;
      notesMount.querySelectorAll<HTMLButtonElement>('.clarify-btn').forEach((btn) => { btn.addEventListener('click', () => runNlBuild(btn.dataset.col)); });
    }
    renderTabsSection(store.readOnly, schema);
    renderSqlOutput();
  }

  function renderSqlOutput(): void {
    const mount = container.querySelector<HTMLElement>('#sqlBlockMount');
    if (!mount) return;
    renderSqlCodeBlock(mount, store.readOnly.generatedSql, {
      onCopy: () => { copyTextToClipboard(store.readOnly.generatedSql); store.pushToast('success', 'SQL copied to clipboard.'); },
      onClear: () => { store.resetReadOnly(); store.pushToast('info', 'Query cleared.'); renderTabsSection(store.readOnly, schemaService.getActiveSchema()); renderSqlOutput(); },
      onValidate: () => { const result = validateFullReadOnly(store.readOnly); const mountV = container.querySelector('#validationMount'); if (mountV) mountV.innerHTML = result.valid ? `<div class="issue-box mini ok">${icon('check', 14)} SQL passed validation — no destructive statements detected.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${result.issues.map((i) => `<li>[${i.severity}] ${i.message}</li>`).join('')}</ul></div>`; },
      onRegenerate: () => { store.regenerateReadOnlySql(); store.pushToast('info', 'SQL regenerated from current selections.'); renderSqlOutput(); }
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
    panel.innerHTML = `<div class="tc-grid"><div class="tc-col"><h3>${icon('list', 15)} Select Tables</h3><div id="tablePickerMount"></div></div><div class="tc-col"><h3>${icon('columns', 15)} Select Columns <span class="hint">(Alias/DECODE appear once selected)</span></h3><div id="columnPickerMount"></div></div><div class="tc-col"><h3>${icon('filter', 15)} Filters</h3><div id="filterBuilderMount"></div></div></div>`;
    const tableMount = panel.querySelector<HTMLElement>('#tablePickerMount')!;
    const columnMount = panel.querySelector<HTMLElement>('#columnPickerMount')!;
    const filterMount = panel.querySelector<HTMLElement>('#filterBuilderMount')!;

    function rerenderColumnAndFilterOnly(): void {
      renderColumnPicker(columnMount, schema, store.readOnly.selectedTables, store.readOnly.selectedColumns, columnCallbacks());
      renderFilterBuilder(filterMount, schema, store.readOnly.selectedTables, store.readOnly.filters, onFiltersChange);
    }

    renderTablePicker(tableMount, schema, state.selectedTables, (next) => {
      store.updateReadOnly((s) => { s.selectedTables = next; s.selectedColumns = s.selectedColumns.filter((c) => c.manualExpr || next.includes(c.table)); s.filters = s.filters.filter((f) => next.includes(f.table)); s.sorts = s.sorts.filter((so) => next.includes(so.table)); s.joins = s.joins.filter((j) => next.includes(j.table)); });
      renderSqlOutput();
      rerenderColumnAndFilterOnly();
    });

    function onColumnsChange(next: typeof state.selectedColumns): void {
      store.updateReadOnly((s) => {
        const nextIds = new Set(next.map((c) => c.id));
        const missingManualOnes = s.selectedColumns.filter((c) => c.manualExpr && !nextIds.has(c.id));
        s.selectedColumns = [...next, ...missingManualOnes];
      });
      renderSqlOutput();
    }
    function onFiltersChange(next: typeof state.filters): void { store.updateReadOnly((s) => { s.filters = next; }); renderSqlOutput(); }
    function columnCallbacks() {
      return {
        onChange: onColumnsChange,
        onRequestManualDecodeForColumn: (table: string, column: ColumnDef, existingSpecId: string) => {
          const existing = store.readOnly.selectedColumns.find((c) => c.id === existingSpecId);
          openManualDecodeBuilder(state.dialect, (spec) => {
            store.updateReadOnly((s) => { const idx = s.selectedColumns.findIndex((c) => c.id === existingSpecId); if (idx !== -1) s.selectedColumns[idx] = { ...spec, id: existingSpecId }; });
            renderSqlOutput();
            renderColumnPicker(columnMount, schema, store.readOnly.selectedTables, store.readOnly.selectedColumns, columnCallbacks());
            store.pushToast('success', `Manual DECODE applied to ${table}.${column.name}.`);
          }, { table, column: column.name }, existingSpecId, existing?.alias || undefined);
        }
      };
    }

    renderColumnPicker(columnMount, schema, state.selectedTables, state.selectedColumns, columnCallbacks());
    renderFilterBuilder(filterMount, schema, state.selectedTables, state.filters, onFiltersChange);
  }

  function renderAdvancedTab(panel: HTMLElement, state: typeof store.readOnly, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const allCols = state.selectedTables.flatMap((t) => { const table = schema.tables.find((x) => x.name === t); return table ? table.columns.map((c) => ({ table: t, column: c.name, label: `${t}.${c.name}`, decode: c.decode })) : []; });

    // V14.2 — Automatic Joins summary (spec sections 2-5). Computed fresh
    // on every render so the UI always reflects the current table
    // selection; ambiguous pairs get a dropdown, resolved/unambiguous
    // pairs are shown read-only for transparency.
    const primaryTable = state.selectedTables[0];
    const otherTables = state.selectedTables.slice(1).filter((t) => !state.joins.some((j) => j.table === t));
    const joinPlan = primaryTable ? computeAutoJoinPlan(schema, primaryTable, otherTables, state.joinPathChoices) : null;

    panel.innerHTML = `
      <div class="advanced-grid">
        <div>
          <h3>${icon('route', 15)} Automatic Joins</h3>
          <div id="autoJoinsList" class="mini-list"></div>
          <h3 class="mt">${icon('link', 15)} Explicit Joins <span class="hint">(manual override)</span></h3>
          <div id="joinsList" class="mini-list"></div><button id="addJoinBtn" class="btn btn-outline btn-sm" ${state.selectedTables.length < 2 ? 'disabled' : ''}>${icon('plus', 14)} Add explicit join</button>
          <h3 class="mt">${icon('sort-asc', 15)} Sorting</h3><div id="sortsList" class="mini-list"></div><button id="addSortBtn" class="btn btn-outline btn-sm">${icon('plus', 14)} Add sort</button>
          <h3 class="mt">${icon('layers', 15)} Grouping &amp; Aggregation</h3>
          <label class="block-label">GROUP BY columns<select id="groupBySelect" multiple size="4">${allCols.map((c) => `<option value="${c.table}::${c.column}" ${state.advanced.groupByColumns.includes(`${c.table}.${c.column}`) ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
          <label class="block-label">HAVING clause<input type="text" id="havingInput" value="${state.advanced.havingClause}" placeholder="e.g. COUNT(*) > 1" /></label>
          <div class="row-actions"><select id="aggColSelect">${allCols.map((c) => `<option value="${c.table}::${c.column}">${c.label}</option>`).join('')}</select><select id="aggFnSelect"><option value="COUNT">COUNT</option><option value="SUM">SUM</option><option value="AVG">AVG</option><option value="MIN">MIN</option><option value="MAX">MAX</option></select><button id="addAggBtn" class="btn btn-outline btn-sm">${icon('plus', 14)} Add aggregate</button></div>
        </div>
        <div>
          <h3>${icon('sliders', 15)} Query Shape</h3>
          <label class="inline-check"><input type="checkbox" id="distinctCheck" ${state.advanced.distinct ? 'checked' : ''}/> DISTINCT</label>
          <label class="inline-check"><input type="checkbox" id="recursiveCheck" ${state.advanced.recursive ? 'checked' : ''}/> Recursive hierarchy (WITH RECURSIVE)</label>
          <label class="block-label">ORDER BY is configured under Sorting (left) — LIMIT<input type="number" id="limitInput" min="1" value="${state.advanced.limit ?? ''}" placeholder="none" /></label>
          <label class="block-label">Save as a named view<input type="text" id="viewNameInput" value="${state.advanced.saveAsView ?? ''}" placeholder="e.g. recent_high_value_invoices" /></label>
          <h3 class="mt">${icon('code', 15)} WITH / CTE <span class="hint">(Common Table Expressions)</span></h3>
          <div id="cteList" class="mini-list"></div>
          <button id="addCteBtn" class="btn btn-outline btn-sm">${icon('plus', 14)} Add CTE</button>
          <h3 class="mt">${icon('code', 15)} CASE / DECODE (custom columns)</h3>
          <div class="row-actions wrap"><button type="button" class="btn btn-outline btn-sm" id="addManualCaseBtn">${icon('code', 14)} Manual CASE (custom)</button><button type="button" class="btn btn-outline btn-sm" id="addManualDecodeBtn">${icon('sparkles', 14)} Manual DECODE (custom)</button></div>
          <div id="manualColsList" class="mini-list"></div>
        </div>
      </div>`;

    // --- Automatic Joins rendering ---
    function renderAutoJoinsList(): void {
      const listEl = panel.querySelector('#autoJoinsList'); if (!listEl) return;
      if (!joinPlan || joinPlan.resolutions.length === 0) { listEl.innerHTML = `<p class="hint">${state.selectedTables.length < 2 ? 'Select 2 or more tables (or describe a multi-table requirement) to see automatic joins here.' : 'No additional joins needed yet.'}</p>`; return; }
      listEl.innerHTML = joinPlan.resolutions.map((r) => {
        if (!r.isAmbiguous) {
          const opt = r.options.find((o) => o.id === r.chosenOptionId) || r.options[0];
          return `<div class="mini-row wrap"><span class="hint">${icon('check', 13)} ${r.tableA} ↔ ${r.tableB}:</span> <span>${opt.label}</span></div>`;
        }
        return `<div class="mini-row wrap"><span class="hint">${icon('alert-triangle', 13)} ${r.tableA} ↔ ${r.tableB} — multiple paths found:</span><select class="join-path-select" data-pairkey="${r.pairKey}"><option value="">— choose a relationship —</option>${r.options.map((o) => `<option value="${o.id}" ${o.id === r.chosenOptionId ? 'selected' : ''}>${o.label}</option>`).join('')}</select></div>`;
      }).join('') + (joinPlan.unresolvedWarnings.length ? joinPlan.unresolvedWarnings.map((w) => `<div class="issue-box mini warn">${icon('alert-triangle', 13)} ${w}</div>`).join('') : '');
      listEl.querySelectorAll<HTMLSelectElement>('.join-path-select').forEach((sel) => {
        sel.addEventListener('change', (e) => {
          const key = sel.dataset.pairkey!;
          const value = (e.target as HTMLSelectElement).value;
          store.updateReadOnly((s) => { if (value) s.joinPathChoices[key] = value; else delete s.joinPathChoices[key]; });
          renderSqlOutput();
          renderAdvancedTab(panel, store.readOnly, schema);
        });
      });
    }
    renderAutoJoinsList();

    function renderJoinsList(): void { const list = panel.querySelector('#joinsList'); if (!list) return; list.innerHTML = state.joins.length ? state.joins.map((j, idx) => `<div class="mini-row wrap" data-idx="${idx}"><select class="join-type-select"><option value="INNER JOIN" ${j.joinType === 'INNER JOIN' ? 'selected' : ''}>INNER JOIN</option><option value="LEFT JOIN" ${j.joinType === 'LEFT JOIN' ? 'selected' : ''}>LEFT JOIN</option></select><span class="hint">${j.onLeftTable}.${j.onLeftColumn} = ${j.table}.${j.onRightColumn}</span><button class="icon-btn remove-btn" title="Remove">${icon('trash', 14)}</button></div>`).join('') : '<p class="hint">No explicit manual joins — automatic joins (above) are used instead.</p>'; list.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.join-type-select')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.joins[idx].joinType = (e.target as HTMLSelectElement).value as 'INNER JOIN' | 'LEFT JOIN'; }); renderSqlOutput(); }); row.querySelector('.remove-btn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.joins.splice(idx, 1); }); renderSqlOutput(); renderAdvancedTab(panel, store.readOnly, schema); }); }); }
    renderJoinsList();
    panel.querySelector('#addJoinBtn')?.addEventListener('click', () => { if (state.selectedTables.length < 2) return; const primary = state.selectedTables[0]; const other = state.selectedTables.find((t) => t !== primary && !state.joins.some((j) => j.table === t)); if (!other) { store.pushToast('info', 'All additional tables already have an explicit join configured.'); return; } const primaryTable = schema.tables.find((t) => t.name === primary); const otherTable = schema.tables.find((t) => t.name === other); const fk = otherTable?.columns.find((c) => c.references?.table === primary); const pk = primaryTable?.columns.find((c) => c.isPrimaryKey); store.updateReadOnly((s) => { s.joins.push({ id: makeId('join'), table: other, joinType: 'INNER JOIN', onLeftTable: primary, onLeftColumn: pk?.name || 'ID', onRightColumn: fk?.name || pk?.name || 'ID' }); }); renderSqlOutput(); renderAdvancedTab(panel, store.readOnly, schema); });

    function renderSortsList(): void { const list = panel.querySelector('#sortsList'); if (!list) return; list.innerHTML = state.sorts.map((s, idx) => `<div class="mini-row" data-idx="${idx}"><select class="sort-col-select">${allCols.map((c) => `<option value="${c.table}::${c.column}" ${c.table === s.table && c.column === s.column ? 'selected' : ''}>${c.label}</option>`).join('')}</select><select class="sort-dir-select"><option value="ASC" ${s.direction === 'ASC' ? 'selected' : ''}>ASC</option><option value="DESC" ${s.direction === 'DESC' ? 'selected' : ''}>DESC</option></select><button class="icon-btn remove-btn" title="Remove">${icon('trash', 14)}</button></div>`).join(''); list.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.sort-col-select')?.addEventListener('change', (e) => { const [t, c] = (e.target as HTMLSelectElement).value.split('::'); store.updateReadOnly((s) => { s.sorts[idx].table = t; s.sorts[idx].column = c; }); renderSqlOutput(); }); row.querySelector('.sort-dir-select')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.sorts[idx].direction = (e.target as HTMLSelectElement).value as 'ASC' | 'DESC'; }); renderSqlOutput(); }); row.querySelector('.remove-btn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.sorts.splice(idx, 1); }); renderSqlOutput(); renderSortsList(); }); }); }
    renderSortsList();
    panel.querySelector('#addSortBtn')?.addEventListener('click', () => { if (allCols.length === 0) return; store.updateReadOnly((s) => { s.sorts.push({ id: makeId('sort'), table: allCols[0].table, column: allCols[0].column, direction: 'ASC' }); }); renderSqlOutput(); renderSortsList(); });
    panel.querySelector<HTMLSelectElement>('#groupBySelect')?.addEventListener('change', (e) => { const selected = Array.from((e.target as HTMLSelectElement).selectedOptions).map((o) => o.value.replace('::', '.')); store.updateReadOnly((s) => { s.advanced.groupByColumns = selected; }); renderSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#havingInput')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.havingClause = (e.target as HTMLInputElement).value; }); renderSqlOutput(); });
    panel.querySelector('#addAggBtn')?.addEventListener('click', () => { const colVal = panel.querySelector<HTMLSelectElement>('#aggColSelect')?.value; const fn = panel.querySelector<HTMLSelectElement>('#aggFnSelect')?.value as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; if (!colVal) return; const [t, c] = colVal.split('::'); store.updateReadOnly((s) => { s.selectedColumns.push({ id: makeId('col'), table: t, column: c, alias: '', useDecode: false, aggregate: fn, displayMode: 'raw' }); }); renderSqlOutput(); store.pushToast('success', `${fn}(${t}.${c}) added to SELECT.`); });
    panel.querySelector<HTMLInputElement>('#distinctCheck')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.advanced.distinct = (e.target as HTMLInputElement).checked; }); renderSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#recursiveCheck')?.addEventListener('change', (e) => { store.updateReadOnly((s) => { s.advanced.recursive = (e.target as HTMLInputElement).checked; }); renderSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#limitInput')?.addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value; store.updateReadOnly((s) => { s.advanced.limit = v ? parseInt(v, 10) : null; }); renderSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#viewNameInput')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.saveAsView = (e.target as HTMLInputElement).value || null; }); renderSqlOutput(); });

    // --- WITH / CTE builder (spec 13.1) ---
    function renderCteList(): void {
      const list = panel.querySelector('#cteList'); if (!list) return;
      list.innerHTML = state.advanced.ctes.length ? state.advanced.ctes.map((c, idx) => `<div class="cte-row" data-idx="${idx}"><input type="text" class="cte-name-input" placeholder="cte_name" value="${c.name}" /><textarea class="cte-body-input" rows="3" placeholder="SELECT ...">${c.body}</textarea><button class="icon-btn remove-cte-btn" title="Remove">${icon('trash', 14)}</button></div>`).join('') : '<p class="hint">No CTEs defined yet.</p>';
      list.querySelectorAll<HTMLElement>('.cte-row').forEach((row) => {
        const idx = parseInt(row.dataset.idx || '0', 10);
        row.querySelector('.cte-name-input')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.ctes[idx].name = (e.target as HTMLInputElement).value; }); renderSqlOutput(); });
        row.querySelector('.cte-body-input')?.addEventListener('input', (e) => { store.updateReadOnly((s) => { s.advanced.ctes[idx].body = (e.target as HTMLTextAreaElement).value; }); renderSqlOutput(); });
        row.querySelector('.remove-cte-btn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.advanced.ctes.splice(idx, 1); }); renderSqlOutput(); renderCteList(); });
      });
    }
    renderCteList();
    panel.querySelector('#addCteBtn')?.addEventListener('click', () => { store.updateReadOnly((s) => { s.advanced.ctes.push({ id: makeId('cte'), name: `cte_${s.advanced.ctes.length + 1}`, body: '' }); }); renderSqlOutput(); renderCteList(); });

    // --- Manual CASE/DECODE (custom columns), relocated here from Select Columns (spec 23) ---
    function renderManualCols(): void {
      const mount = panel.querySelector<HTMLElement>('#manualColsList'); if (!mount) return;
      const manualCols = store.readOnly.selectedColumns.filter((c) => c.manualExpr && !state.selectedTables.some((t) => c.table === t));
      mount.innerHTML = manualCols.length ? manualCols.map((c) => `<div class="mini-row"><span class="hint">${c.alias}</span><button class="icon-btn remove-manual-col" data-id="${c.id}" title="Remove">${icon('trash', 14)}</button></div>`).join('') : '<p class="hint">No custom CASE/DECODE columns added yet.</p>';
      mount.querySelectorAll<HTMLButtonElement>('.remove-manual-col').forEach((btn) => { btn.addEventListener('click', () => { store.updateReadOnly((s) => { s.selectedColumns = s.selectedColumns.filter((c) => c.id !== btn.dataset.id); }); renderSqlOutput(); renderManualCols(); }); });
    }
    renderManualCols();
    panel.querySelector('#addManualCaseBtn')?.addEventListener('click', () => { openManualCaseBuilder(state.dialect, (spec) => { store.updateReadOnly((s) => { s.selectedColumns.push(spec); }); renderSqlOutput(); renderManualCols(); store.pushToast('success', `Manual CASE column "${spec.alias}" added.`); }); });
    panel.querySelector('#addManualDecodeBtn')?.addEventListener('click', () => { openManualDecodeBuilder(state.dialect, (spec) => { store.updateReadOnly((s) => { s.selectedColumns.push(spec); }); renderSqlOutput(); renderManualCols(); store.pushToast('success', `Manual DECODE column "${spec.alias}" added.`); }); });
  }

  function renderSummaryTab(panel: HTMLElement, state: typeof store.readOnly): void {
    panel.innerHTML = `
      <div class="summary-grid">
        <div>
          <h3>Natural-language requirement</h3><p class="hint">${state.naturalLanguageText ? state.naturalLanguageText : '(none provided)'}</p>
          <h3 class="mt">Selected tables</h3><p>${state.selectedTables.length ? state.selectedTables.join(', ') : '(none)'}</p>
          <h3 class="mt">Selected columns</h3><ul class="mini-list">${state.selectedColumns.length ? state.selectedColumns.map((c) => `<li>${c.manualExpr ? `Manual: ${c.alias}` : c.aggregate ? `${c.aggregate}(${c.table}.${c.column})` : `${c.table}.${c.column}`}${c.alias && !c.manualExpr ? ` AS ${c.alias}` : ''}${c.displayMode === 'schema-decode' ? ' (schema decode)' : ''}</li>`).join('') : '<li class="hint">(none — SELECT * will be used)</li>'}</ul>
        </div>
        <div>
          <h3>Filters</h3><ul class="mini-list">${state.filters.length ? state.filters.map((f, i) => `<li>${i > 0 ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}${f.value2 ? ' AND ' + f.value2 : ''}</li>`).join('') : '<li class="hint">(none)</li>'}</ul>
          <h3 class="mt">Advanced options</h3>
          <ul class="mini-list"><li>DISTINCT: ${state.advanced.distinct ? 'Yes' : 'No'}</li><li>Sort: ${state.sorts.length ? state.sorts.map((s) => `${s.table}.${s.column} ${s.direction}`).join(', ') : '(none)'}</li><li>Group by: ${state.advanced.groupByColumns.length ? state.advanced.groupByColumns.join(', ') : '(none)'}</li><li>Having: ${state.advanced.havingClause || '(none)'}</li><li>Limit: ${state.advanced.limit ?? '(none)'}</li><li>CTEs: ${state.advanced.ctes.length}</li><li>Explicit joins: ${state.joins.length}</li></ul>
        </div>
      </div>`;
  }

  draw();
  (container as any)._cleanup = () => { unsubscribeSchema(); };
}
