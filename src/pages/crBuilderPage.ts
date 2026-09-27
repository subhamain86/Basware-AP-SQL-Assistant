import { icon } from '../components/icons';
import { renderSqlCodeBlock, copyTextToClipboard } from '../components/sqlCodeBlock';
import { renderFilterBuilder } from '../components/filterBuilder';
import { renderTabs } from '../components/tabs';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { aiService } from '../services/aiService';
import { orchestrateCrNlp } from '../services/nlpOrchestrator';
import { validateCrState } from '../engines/validationEngine';
import type { CrQueryType, Dialect } from '../types';
import { makeId } from '../utils/id';

export function renderCrBuilderPage(container: HTMLElement): void {
  const unsubscribeSchema = schemaService.subscribe(draw);
  let activeTabId = 'details';
  let isBuilding = false;

  function draw(): void {
    const state = store.cr;
    const schema = schemaService.getActiveSchema();
    const issues = validateCrState(state);

    container.innerHTML = `
      <section class="page page-builder">
        <h1 class="page-title">${icon('code')} Query Builder for CR <span class="badge">Change Request</span></h1>
        <p class="page-subtitle">Generated SQL only — this application does not execute database changes. Use Natural Language and Manual Selectors independently, or combine both.</p>
        <div class="builder-grid-top">
          <div class="builder-panel" data-tour="cr-describe-card">
            <h2>${icon('sparkles', 16)} Describe the Change <span class="optional">(optional)</span></h2>
            <textarea id="crNlDesc" rows="4" placeholder='e.g. Update the payment status to PAID for invoice 12345.'>${state.naturalLanguageText}</textarea>
            <div class="row-actions"><label class="inline-label">SQL dialect<select id="crDialectSelect">${dialectOptions(state.dialect)}</select></label></div>
            <button id="crNlBuildBtn" class="btn btn-primary" ${isBuilding ? 'disabled' : ''}>${icon('zap', 15)} ${isBuilding ? 'Processing…' : 'Interpret Description'}</button>
            <div id="crNlNotes"></div>
          </div>
          <div class="builder-panel" data-tour="cr-generated-sql-card">
            <h2>${icon('code', 16)} Generated SQL</h2>
            <div id="crSqlMount"></div>
          </div>
        </div>
        <div class="builder-panel manual-selectors-panel">
          <h2>${icon('sliders', 16)} Manual Selectors</h2>
          <div id="crTabsMount"></div>
        </div>
        ${issues.length ? `<div class="issue-box">${icon('alert-triangle', 15)}<ul>${issues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
      </section>`;

    wireTopRow(state, schema);
    renderTabsSection(state, schema);
  }

  function dialectOptions(selected: Dialect): string { const list: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic']; return list.map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`).join(''); }

  function wireTopRow(state: typeof store.cr, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    container.querySelector<HTMLTextAreaElement>('#crNlDesc')?.addEventListener('input', (e) => { store.cr.naturalLanguageText = (e.target as HTMLTextAreaElement).value; });
    container.querySelector<HTMLSelectElement>('#crDialectSelect')?.addEventListener('change', (e) => { store.updateCr((s) => { s.dialect = (e.target as HTMLSelectElement).value as Dialect; }); renderCrSqlOutput(); });
    container.querySelector('#crNlBuildBtn')?.addEventListener('click', () => runCrNlBuild());
    renderCrSqlOutput();
  }

  async function runCrNlBuild(): Promise<void> {
    isBuilding = true;
    const btn = container.querySelector<HTMLButtonElement>('#crNlBuildBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon('zap', 15)} Processing…`; }
    const schema = schemaService.getActiveSchema();
    const orchestrated = await orchestrateCrNlp(store.cr.naturalLanguageText, schema);
    const requirement = orchestrated.result;
    isBuilding = false;
    if (requirement.queryType) store.updateCr((s) => { s.queryType = requirement.queryType!; });
    if (requirement.matchedTable) store.updateCr((s) => { s.table = requirement.matchedTable; });
    if (requirement.values.length) store.updateCr((s) => { s.values = requirement.values; });
    if (requirement.filters.length) store.updateCr((s) => { s.filters = requirement.filters; });

    const engineBadge = orchestrated.engineUsed === 'online' ? `<span class="engine-badge engine-online">${icon('cloud', 13)} Online AI/NLP</span>` : `<span class="engine-badge engine-offline">${icon('wifi-off', 13)} Offline/local engine${orchestrated.onlineAttempted ? ' (online attempt failed/unavailable)' : ''}</span>`;
    const schemaAuditLine = `<div class="schema-audit-line">${icon('database', 12)} Active Schema used: <strong>${schema.name}</strong> (v${schema.versionMeta?.version ?? schema.version})</div>`;
    const notesMount = container.querySelector('#crNlNotes');
    if (notesMount) notesMount.innerHTML = `<div class="notes-box">${icon('info', 14)}<div>${engineBadge}${schemaAuditLine}<ul class="mt">${requirement.notes.map((n) => `<li>${n}</li>`).join('')}</ul></div></div>`;
    renderTabsSection(store.cr, schema);
    renderCrSqlOutput();
    const rebuiltBtn = container.querySelector<HTMLButtonElement>('#crNlBuildBtn');
    if (rebuiltBtn) { rebuiltBtn.disabled = false; rebuiltBtn.innerHTML = `${icon('zap', 15)} Interpret Description`; }
  }

  function renderCrSqlOutput(): void {
    const mount = container.querySelector<HTMLElement>('#crSqlMount'); if (!mount) return;
    const blocked = /^-- (Choose a table|Add at least one|A WHERE condition)/.test(store.cr.generatedSql);
    renderSqlCodeBlock(mount, store.cr.generatedSql, { onCopy: () => { copyTextToClipboard(store.cr.generatedSql); store.pushToast('success', 'SQL copied to clipboard.'); }, onClear: () => { store.resetCr(); store.pushToast('info', 'CR query cleared.'); renderTabsSection(store.cr, schemaService.getActiveSchema()); renderCrSqlOutput(); }, onRegenerate: () => { store.regenerateCrSql(); renderCrSqlOutput(); } });
    const copyBtn = mount.querySelector<HTMLButtonElement>('#btnCopySql'); if (copyBtn) copyBtn.disabled = blocked;
  }

  function renderTabsSection(state: typeof store.cr, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const mount = container.querySelector<HTMLElement>('#crTabsMount'); if (!mount) return;
    renderTabs(mount, [
      { id: 'details', label: 'Query Details', render: (panel) => renderDetailsTab(panel, state, schema) },
      { id: 'summary', label: 'Selected / Described Requirements', render: (panel) => renderSummaryTab(panel, state) }
    ], activeTabId, { details: 'cr-tab-details' }, (id) => { activeTabId = id; });
  }

  function renderDetailsTab(panel: HTMLElement, state: typeof store.cr, schema: ReturnType<typeof schemaService.getActiveSchema>): void {
    const columnsForTable = state.table ? (schema.tables.find((t) => t.name === state.table)?.columns || []) : [];
    const needsWhere = state.queryType !== 'INSERT';
    panel.innerHTML = `
      <div class="tc-grid">
        <div class="tc-col">
          <h3>Query Type</h3>
          <div class="segmented" data-tour="cr-query-type">${(['INSERT', 'UPDATE', 'DELETE'] as CrQueryType[]).map((qt) => `<button type="button" data-qt="${qt}" class="seg-btn ${state.queryType === qt ? 'active' : ''}">${qt}</button>`).join('')}</div>
          <h3 class="mt">Pick Table</h3>
          <select id="crTableSelect"><option value="">— choose a table —</option>${tableOptions(schema, state.table)}</select>
        </div>
        <div class="tc-col">
          <h3>${state.queryType === 'UPDATE' ? 'Columns to Set' : state.queryType === 'INSERT' ? 'Columns &amp; Values' : 'Values'}</h3>
          ${state.queryType === 'DELETE' ? '<p class="hint">DELETE only needs a WHERE condition — no column values required.</p>' : `<div id="crValuesList" class="mini-list"></div><button id="addCrValueBtn" class="btn btn-outline btn-sm" ${state.table ? '' : 'disabled'}>${icon('plus', 14)} Add column</button>`}
        </div>
        <div class="tc-col">
          <h3>Filters <span class="optional">WHERE Conditions</span></h3>
          ${needsWhere ? '<div class="issue-box mini">⚠️ A WHERE condition is required to identify which records should be updated or deleted.</div>' : ''}
          <div id="crFilterMount"></div>
          ${needsWhere ? `<label class="inline-check"><input type="checkbox" id="confirmNoWhere" ${state.confirmNoWhere ? 'checked' : ''}/> I explicitly confirm this query should have no WHERE condition</label>` : ''}
        </div>
      </div>`;

    panel.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((btn) => { btn.addEventListener('click', () => { store.updateCr((s) => { s.queryType = btn.dataset.qt as CrQueryType; }); renderDetailsTab(panel, store.cr, schema); renderCrSqlOutput(); }); });
    panel.querySelector<HTMLSelectElement>('#crTableSelect')?.addEventListener('change', (e) => { store.updateCr((s) => { s.table = (e.target as HTMLSelectElement).value || null; s.values = []; s.filters = []; }); renderDetailsTab(panel, store.cr, schema); renderCrSqlOutput(); });
    panel.querySelector('#addCrValueBtn')?.addEventListener('click', () => { if (columnsForTable.length === 0) return; store.updateCr((s) => { s.values.push({ id: makeId('crv'), column: columnsForTable[0].name, value: '' }); }); renderValuesList(); renderCrSqlOutput(); });
    panel.querySelector<HTMLInputElement>('#confirmNoWhere')?.addEventListener('change', (e) => { store.updateCr((s) => { s.confirmNoWhere = (e.target as HTMLInputElement).checked; }); renderCrSqlOutput(); });
    renderValuesList();
    const filterMount = panel.querySelector<HTMLElement>('#crFilterMount');
    if (filterMount) { if (!state.table) filterMount.innerHTML = '<p class="hint picker-empty">Select a table first.</p>'; else renderFilterBuilder(filterMount, schema, [state.table], state.filters, (next) => { store.updateCr((s) => { s.filters = next; }); renderCrSqlOutput(); }); }
    renderCrSqlOutput();

    function renderValuesList(): void {
      const list = panel.querySelector('#crValuesList'); if (!list) return;
      list.innerHTML = state.values.map((v, idx) => `<div class="mini-row" data-idx="${idx}"><select class="crv-col-select">${columnsForTable.map((c) => `<option value="${c.name}" ${c.name === v.column ? 'selected' : ''}>${c.name}</option>`).join('')}</select><input type="text" class="crv-val-input" placeholder="value" value="${v.value}" /><button class="icon-btn remove-btn" title="Remove">${icon('trash', 14)}</button></div>`).join('');
      list.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.crv-col-select')?.addEventListener('change', (e) => { store.updateCr((s) => { s.values[idx].column = (e.target as HTMLSelectElement).value; }); renderCrSqlOutput(); }); row.querySelector('.crv-val-input')?.addEventListener('input', (e) => { store.updateCr((s) => { s.values[idx].value = (e.target as HTMLInputElement).value; }); renderCrSqlOutput(); }); row.querySelector('.remove-btn')?.addEventListener('click', () => { store.updateCr((s) => { s.values.splice(idx, 1); }); renderValuesList(); renderCrSqlOutput(); }); }); }
  }

  function renderSummaryTab(panel: HTMLElement, state: typeof store.cr): void {
    panel.innerHTML = `
      <div class="summary-grid">
        <div><h3>Natural-language requirement</h3><p class="hint">${state.naturalLanguageText || '(none provided)'}</p><h3 class="mt">Query type</h3><p>${state.queryType}</p><h3 class="mt">Table</h3><p>${state.table || '(none)'}</p></div>
        <div><h3>Values</h3><ul class="mini-list">${state.values.length ? state.values.map((v) => `<li>${v.column} = ${v.value}</li>`).join('') : '<li class="hint">(none)</li>'}</ul><h3 class="mt">Filters</h3><ul class="mini-list">${state.filters.length ? state.filters.map((f, i) => `<li>${i > 0 ? f.combinator + ' ' : ''}${f.table}.${f.column} ${f.operator} ${f.value}</li>`).join('') : '<li class="hint">(none)</li>'}</ul></div>
      </div>`;
  }

  function tableOptions(schema: ReturnType<typeof schemaService.getActiveSchema>, selected: string | null): string { const modules = Array.from(new Set(schema.tables.map((t) => t.module))); return modules.map((m) => `<optgroup label="${m}">${schema.tables.filter((t) => t.module === m).map((t) => `<option value="${t.name}" ${t.name === selected ? 'selected' : ''}>${t.name}</option>`).join('')}</optgroup>`).join(''); }

  draw();
  (container as any)._cleanup = () => { unsubscribeSchema(); };
}
