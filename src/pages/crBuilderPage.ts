import { icon } from '../components/icons';
import { renderSqlCodeBlock, copyTextToClipboard } from '../components/sqlCodeBlock';
import { renderFilterBuilder } from '../components/filterBuilder';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { aiService } from '../services/aiService';
import { validateCrState } from '../engines/validationEngine';
import type { CrQueryType, Dialect } from '../types';
import { makeId } from '../utils/id';

export function renderCrBuilderPage(container: HTMLElement): void {
  const unsubscribe = store.subscribe(draw);
  const unsubscribeSchema = schemaService.subscribe(draw);

  function draw(): void {
    const state = store.cr;
    const schema = schemaService.getActiveSchema();
    const issues = validateCrState(state);
    const columnsForTable = state.table ? (schema.tables.find((t) => t.name === state.table)?.columns || []) : [];
    const needsWhere = state.queryType !== 'INSERT';

    container.innerHTML = `
      <section class="page page-builder">
        <h1 class="page-title">${icon('code')} Query Builder for CR <span class="badge">Change Request</span></h1>
        <p class="page-subtitle">Generated SQL only — this application does not execute database changes.</p>
        <div class="builder-panel" data-tour="cr-nl-card">
          <h2>${icon('sparkles', 16)} Describe the Change <span class="optional">(optional)</span></h2>
          <textarea id="crNlDesc" rows="2" placeholder='e.g. Update the payment status to PAID for invoice 12345.'>${state.naturalLanguageText}</textarea>
          <button id="crNlBuildBtn" class="btn btn-primary mt">${icon('zap', 15)} Interpret Description</button>
          <div id="crNlNotes"></div>
        </div>
        <div class="builder-grid-top mt">
          <div class="builder-panel">
            <h2>Query Type</h2>
            <div class="segmented" data-tour="cr-query-type">${(['INSERT', 'UPDATE', 'DELETE'] as CrQueryType[]).map((qt) => `<button type="button" data-qt="${qt}" class="seg-btn ${state.queryType === qt ? 'active' : ''}">${qt}</button>`).join('')}</div>
            <label class="inline-label">SQL dialect<select id="crDialectSelect">${dialectOptions(state.dialect)}</select></label>
            <h2 class="mt">Pick Table</h2>
            <select id="crTableSelect"><option value="">— choose a table —</option>${tableOptions(schema, state.table)}</select>
            <h2 class="mt">${state.queryType === 'UPDATE' ? 'Columns to Set' : state.queryType === 'INSERT' ? 'Columns &amp; Values' : 'Values'}</h2>
            ${state.queryType === 'DELETE' ? '<p class="hint">DELETE only needs a WHERE condition below.</p>' : `<div id="crValuesList" class="mini-list"></div><button id="addCrValueBtn" class="btn btn-outline btn-sm" ${state.table ? '' : 'disabled'}>${icon('plus', 14)} Add column</button>`}
            <h2 class="mt">Filters <span class="optional">WHERE Conditions</span></h2>
            ${needsWhere ? '<div class="issue-box mini">⚠️ A WHERE condition is required to identify which records should be updated or deleted.</div>' : ''}
            <div id="crFilterMount"></div>
            ${needsWhere ? `<label class="inline-check"><input type="checkbox" id="confirmNoWhere" ${state.confirmNoWhere ? 'checked' : ''}/> I explicitly confirm this query should have no WHERE condition</label>` : ''}
            ${issues.length ? `<div class="issue-box">${icon('alert-triangle', 15)}<ul>${issues.map((i) => `<li>${i.message}</li>`).join('')}</ul></div>` : ''}
          </div>
          <div class="builder-panel"><h2>Generated SQL</h2><div id="crSqlMount"></div></div>
        </div>
      </section>`;

    wireEvents(state, schema, columnsForTable);
  }

  function dialectOptions(selected: Dialect): string { const list: Dialect[] = ['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic']; return list.map((d) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`).join(''); }
  function tableOptions(schema: ReturnType<typeof schemaService.getActiveSchema>, selected: string | null): string { const modules = Array.from(new Set(schema.tables.map((t) => t.module))); return modules.map((m) => `<optgroup label="${m}">${schema.tables.filter((t) => t.module === m).map((t) => `<option value="${t.name}" ${t.name === selected ? 'selected' : ''}>${t.name}</option>`).join('')}</optgroup>`).join(''); }

  function renderCrSqlOutput(): void {
    const mount = container.querySelector<HTMLElement>('#crSqlMount'); if (!mount) return;
    const blocked = /^-- (Choose a table|Add at least one|A WHERE condition)/.test(store.cr.generatedSql);
    renderSqlCodeBlock(mount, store.cr.generatedSql, { onCopy: () => { copyTextToClipboard(store.cr.generatedSql); store.pushToast('success', 'SQL copied to clipboard.'); }, onClear: () => { store.resetCr(); store.pushToast('info', 'CR query cleared.'); }, onRegenerate: () => { store.regenerateCrSql(); } });
    const copyBtn = mount.querySelector<HTMLButtonElement>('#btnCopySql'); if (copyBtn) copyBtn.disabled = blocked;
  }

  function wireEvents(state: typeof store.cr, schema: ReturnType<typeof schemaService.getActiveSchema>, columnsForTable: ReturnType<typeof schemaService.getActiveSchema>['tables'][number]['columns']): void {
    container.querySelector<HTMLTextAreaElement>('#crNlDesc')?.addEventListener('input', (e) => { store.cr.naturalLanguageText = (e.target as HTMLTextAreaElement).value; });
    container.querySelector('#crNlBuildBtn')?.addEventListener('click', () => {
      const requirement = aiService.planCrQuery(store.cr.naturalLanguageText, schema);
      const notesMount = container.querySelector('#crNlNotes');
      if (notesMount) notesMount.innerHTML = `<div class="notes-box">${icon('info', 14)}<ul>${requirement.notes.map((n) => `<li>${n}</li>`).join('')}</ul></div>`;
      if (requirement.queryType) store.updateCr((s) => { s.queryType = requirement.queryType!; });
      if (requirement.matchedTable) store.updateCr((s) => { s.table = requirement.matchedTable; });
      if (requirement.values.length) store.updateCr((s) => { s.values = requirement.values; });
      if (requirement.filters.length) store.updateCr((s) => { s.filters = requirement.filters; });
      draw();
    });

    container.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((btn) => { btn.addEventListener('click', () => { store.updateCr((s) => { s.queryType = btn.dataset.qt as CrQueryType; }); draw(); }); });
    container.querySelector<HTMLSelectElement>('#crDialectSelect')?.addEventListener('change', (e) => { store.updateCr((s) => { s.dialect = (e.target as HTMLSelectElement).value as Dialect; }); });
    container.querySelector<HTMLSelectElement>('#crTableSelect')?.addEventListener('change', (e) => { store.updateCr((s) => { s.table = (e.target as HTMLSelectElement).value || null; s.values = []; s.filters = []; }); draw(); });
    container.querySelector('#addCrValueBtn')?.addEventListener('click', () => { if (columnsForTable.length === 0) return; store.updateCr((s) => { s.values.push({ id: makeId('crv'), column: columnsForTable[0].name, value: '' }); }); renderValuesList(); renderCrSqlOutput(); });
    container.querySelector<HTMLInputElement>('#confirmNoWhere')?.addEventListener('change', (e) => { store.updateCr((s) => { s.confirmNoWhere = (e.target as HTMLInputElement).checked; }); renderCrSqlOutput(); });

    renderValuesList();
    const filterMount = container.querySelector<HTMLElement>('#crFilterMount');
    if (filterMount) { if (!state.table) filterMount.innerHTML = '<p class="hint picker-empty">Select a table first.</p>'; else renderFilterBuilder(filterMount, schema, [state.table], state.filters, (next) => { store.updateCr((s) => { s.filters = next; }); renderCrSqlOutput(); }); }
    renderCrSqlOutput();

    function renderValuesList(): void {
      const list = container.querySelector('#crValuesList'); if (!list) return;
      list.innerHTML = state.values.map((v, idx) => `<div class="mini-row" data-idx="${idx}"><select class="crv-col-select">${columnsForTable.map((c) => `<option value="${c.name}" ${c.name === v.column ? 'selected' : ''}>${c.name}</option>`).join('')}</select><input type="text" class="crv-val-input" placeholder="value" value="${v.value}" /><button class="icon-btn remove-btn" title="Remove">${icon('trash', 14)}</button></div>`).join('');
      list.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.crv-col-select')?.addEventListener('change', (e) => { store.updateCr((s) => { s.values[idx].column = (e.target as HTMLSelectElement).value; }); renderCrSqlOutput(); }); row.querySelector('.crv-val-input')?.addEventListener('input', (e) => { store.updateCr((s) => { s.values[idx].value = (e.target as HTMLInputElement).value; }); renderCrSqlOutput(); }); row.querySelector('.remove-btn')?.addEventListener('click', () => { store.updateCr((s) => { s.values.splice(idx, 1); }); renderValuesList(); renderCrSqlOutput(); }); });
    }
  }

  draw();
  (container as any)._cleanup = () => { unsubscribe(); unsubscribeSchema(); };
}
