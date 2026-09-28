import { icon } from '../components/icons';
import { renderSqlCodeBlock, copyTextToClipboard } from '../components/sqlCodeBlock';
import { renderFilterBuilder } from '../components/filterBuilder';
import { renderTabs } from '../components/tabs';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { orchestrateCrNlp } from '../services/nlpOrchestrator';
import { validateCrState } from '../engines/validationEngine';
import type { CrQueryType, Dialect } from '../types';
import { makeId } from '../utils/id';
export function renderCrBuilderPage(container: HTMLElement): void {
  const unsubscribeSchema = schemaService.subscribe(draw);
  let activeTabId = 'details'; let isBuilding = false;
  function draw(): void {
    const state = store.cr; const schema = schemaService.getActiveSchema(); const issues = validateCrState(state);
    container.innerHTML = `<div class="page"><h1 class="page-title">${icon('code')} Query Builder for CR (Change Request)</h1><p class="page-subtitle">Generated SQL only — this application does not execute database changes. Use Natural Language and Manual Selectors independently, or combine both.</p>
      <div class="builder-grid-top">
        <div class="builder-panel narrow"><h2>${icon('sparkles', 16)} Describe the Change (optional)</h2><textarea id="crNlDesc" rows="3">${state.naturalLanguageText}</textarea><label class="inline-label">SQL dialect<select id="crDialectSelect">${dialectOptions(state.dialect)}</select></label><div class="row-actions"><button id="crNlBuildBtn" class="btn btn-primary" type="button">${icon('zap', 15)} ${isBuilding ? 'Processing…' : 'Interpret Description'}</button></div><div id="crNlNotes"></div></div>
        <div class="builder-panel"><h2>${icon('code', 16)} Generated SQL</h2><div id="crSqlMount"></div></div>
      </div>
      <div class="manual-selectors-panel"><h2>${icon('sliders', 16)} Manual Selectors</h2><div id="crTabsMount"></div>
      ${issues.length ? `<div class="issue-box">${icon('alert-triangle', 15)}<ul>${issues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}</div></div>`;
    wireTopRow(state, schema); renderTabsSection(state, schema);
  }
  function dialectOptions(selected: Dialect): string { const list: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic']; return list.map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`).join(''); }
  function wireTopRow(state: typeof store.cr, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    container.querySelector<HTMLTextAreaElement>('#crNlDesc')?.addEventListener('input', (e) => { store.cr.naturalLanguageText = (e.target as HTMLTextAreaElement).value; });
    container.querySelector<HTMLSelectElement>('#crDialectSelect')?.addEventListener('change', (e) => { store.updateCr((s) => { s.dialect = (e.target as HTMLSelectElement).value as Dialect; }); renderCrSqlOutput(); });
    container.querySelector('#crNlBuildBtn')?.addEventListener('click', () => runCrNlBuild());
    renderCrSqlOutput();
  }
  async function runCrNlBuild(): Promise<void> {
    isBuilding = true; const btn = container.querySelector<HTMLButtonElement>('#crNlBuildBtn'); if (btn) { btn.disabled = true; btn.innerHTML = `${icon('zap', 15)} Processing…`; }
    const schema = schemaService.getActiveSchema();
    const orchestrated = await orchestrateCrNlp(store.cr.naturalLanguageText, schema);
    const requirement = orchestrated.result; isBuilding = false;
    if (requirement.queryType) store.updateCr((s) => { s.queryType = requirement.queryType!; });
    if (requirement.matchedTable) store.updateCr((s) => { s.table = requirement.matchedTable; });
    if (requirement.values.length) store.updateCr((s) => { s.values = requirement.values; });
    if (requirement.filters.length) store.updateCr((s) => { s.filters = requirement.filters; });
    const engineBadge = orchestrated.engineUsed === 'copilot' ? `<span class="engine-badge engine-online">${icon('bot', 13)} M365 Copilot Enterprise + Offline Engine</span>` : orchestrated.engineUsed === 'online' ? `<span class="engine-badge engine-online">${icon('cloud', 13)} Online AI/NLP</span>` : `<span class="engine-badge engine-offline">${icon('wifi-off', 13)} Offline/local engine${orchestrated.onlineAttempted ? ' (online attempt failed/unavailable)' : ''}</span>`;
    const schemaAuditLine = `<div class="schema-audit-line">${icon('database', 12)} Active Schema used: ${schema.name} (v${schema.versionMeta?.version ?? schema.version})</div>`;
    const notesMount = container.querySelector<HTMLElement>('#crNlNotes');
    if (notesMount) notesMount.innerHTML = `${icon('info', 14)}${engineBadge}${schemaAuditLine}<ul class="plan-list">${requirement.notes.map((n) => `<li>${n}</li>`).join('')}</ul>`;
    const rebuiltBtn = container.querySelector<HTMLButtonElement>('#crNlBuildBtn'); if (rebuiltBtn) { rebuiltBtn.disabled = false; rebuiltBtn.innerHTML = `${icon('zap', 15)} Interpret Description`; }
    renderTabsSection(store.cr, schema); renderCrSqlOutput();
  }
  function renderCrSqlOutput(): void {
    const mount = container.querySelector<HTMLElement>('#crSqlMount'); if (!mount) return;
    renderSqlCodeBlock(mount, store.cr.generatedSql, { onCopy: () => { copyTextToClipboard(store.cr.generatedSql); store.pushToast('success', 'SQL copied to clipboard.'); }, onClear: () => { store.resetCr(); store.pushToast('info', 'CR query cleared.'); renderTabsSection(store.cr, schemaService.getActiveSchema()); renderCrSqlOutput(); }, onRegenerate: () => { store.regenerateCrSql(); renderCrSqlOutput(); } });
  }
  function renderTabsSection(state: typeof store.cr, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const mount = container.querySelector<HTMLElement>('#crTabsMount'); if (!mount) return;
    renderTabs(mount, [{ id: 'details', label: 'Query Details', render: (panel) => renderDetailsTab(panel, state, schema) }, { id: 'summary', label: 'Selected / Described Requirements', render: (panel) => renderSummaryTab(panel, state) }], activeTabId, { details: 'cr-tab-details' }, (id) => { activeTabId = id; });
  }
  function renderDetailsTab(panel: HTMLElement, state: typeof store.cr, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const columnsForTable = state.table ? (schema.tables.find((t) => t.name === state.table)?.columns || []) : []; const needsWhere = state.queryType !== 'INSERT';
    panel.innerHTML = `<div data-tour="cr-query-type"><h3>Query Type</h3><div class="segmented">${(['INSERT', 'UPDATE', 'DELETE'] as CrQueryType[]).map((qt) => `<button type="button" class="seg-btn ${state.queryType === qt ? 'active' : ''}" data-qt="${qt}">${qt}</button>`).join('')}</div></div><h3>Pick Table</h3><select id="crTableSelect"><option value="">— choose a table —</option>${tableOptions(schema, state.table)}</select><h3>${state.queryType === 'UPDATE' ? 'Columns to Set' : state.queryType === 'INSERT' ? 'Columns & Values' : 'Values'}</h3>${state.queryType === 'DELETE' ? '<p class="hint">DELETE only needs a WHERE condition — no column values required.</p>' : `<div id="crValuesList"></div><button type="button" class="btn btn-link" id="addCrValueBtn">${icon('plus', 14)} Add column</button>`}<h3>Filters (WHERE Conditions)</h3><div id="crFilterMount"></div>${needsWhere ? `<div class="issue-box warn mini">⚠️ A WHERE condition is required to identify which records should be updated or deleted.</div><label class="inline-check"><input type="checkbox" id="confirmNoWhere" ${state.confirmNoWhere ? 'checked' : ''}/> I explicitly confirm this query should have no WHERE condition</label>` : ''}`;
    panel.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((btn) => { btn.addEventListener('click', () => { store.updateCr((s) => { s.queryType = btn.dataset.qt as CrQueryType; }); renderDetailsTab(panel, store.cr, schema); renderCrSqlOutput(); }); });
    panel.querySelector<HTMLSelectElement>('#crTableSelect')?.addEventListener('change', (e) => { store.updateCr((s) => { s.table = (e.target as HTMLSelectElement).value || null; s.values = []; s.filters = []; }); renderDetailsTab(panel, store.cr, schema); renderCrSqlOutput(); });
    panel.querySelector('#addCrValueBtn')?.addEventListener('click', () => { if (columnsForTable.length === 0) return; store.updateCr((s) => { s.values.push({ id: makeId('crv'), column: columnsForTable[0].name, value: '' }); }); renderValuesList(); renderCrSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#confirmNoWhere')?.addEventListener('change', (e) => { store.updateCr((s) => { s.confirmNoWhere = (e.target as HTMLInputElement).checked; }); renderCrSqlOutput(); });
    renderValuesList();
    const filterMount = panel.querySelector<HTMLElement>('#crFilterMount');
    if (filterMount) { if (!state.table) filterMount.innerHTML = '<p class="hint">Select a table first.</p>'; else renderFilterBuilder(filterMount, schema, [state.table], state.filters, (next) => { store.updateCr((s) => { s.filters = next; }); renderCrSqlOutput(); }); }
    renderCrSqlOutput();
    function renderValuesList(): void {
      const list = panel.querySelector<HTMLElement>('#crValuesList'); if (!list) return;
      list.innerHTML = state.values.map((v, idx) => `<div class="mini-row wrap" data-idx="${idx}"><select class="crv-col-select">${columnsForTable.map((c) => `<option value="${c.name}" ${c.name === v.column ? 'selected' : ''}>${c.name}</option>`).join('')}</select><input type="text" class="crv-val-input" value="${(v.value || '').replace(/"/g, '&quot;')}" placeholder="value"/><button type="button" class="icon-btn remove-btn">${icon('trash', 14)}</button></div>`).join('');
      list.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.crv-col-select')?.addEventListener('change', (e) => { store.updateCr((s) => { s.values[idx].column = (e.target as HTMLSelectElement).value; }); renderCrSqlOutput(); }); row.querySelector('.crv-val-input')?.addEventListener('input', (e) => { store.updateCr((s) => { s.values[idx].value = (e.target as HTMLInputElement).value; }); renderCrSqlOutput(); }); row.querySelector('.remove-btn')?.addEventListener('click', () => { store.updateCr((s) => { s.values.splice(idx, 1); }); renderValuesList(); renderCrSqlOutput(); }); });
    }
  }
  function renderSummaryTab(panel: HTMLElement, state: typeof store.cr): void {
    panel.innerHTML = `<h3>Natural-language requirement</h3><p>${state.naturalLanguageText || '(none provided)'}</p><h3>Query type</h3><p>${state.queryType}</p><h3>Table</h3><p>${state.table || '(none)'}</p><h3>Values</h3><p>${state.values.length ? state.values.map((v) => `${v.column} = ${v.value}`).join('<br/>') : '(none)'}</p><h3>Filters</h3><p>${state.filters.length ? state.filters.map((f, i) => `${i > 0 ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}`).join('<br/>') : '(none)'}</p>`;
  }
  function tableOptions(schema: ReturnType<typeof schemaService.getActiveSchema>, selected: string | null): string { const modules = Array.from(new Set(schema.tables.map((t) => t.module))); return modules.map((m) => `<optgroup label="${m}">${schema.tables.filter((t) => t.module === m).map((t) => `<option value="${t.name}" ${t.name === selected ? 'selected' : ''}>${t.name}</option>`).join('')}</optgroup>`).join(''); }
  draw();
  (container as any)._cleanup = () => { unsubscribeSchema(); };
}
