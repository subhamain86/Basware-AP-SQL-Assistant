import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { syncService } from '../services/syncService';
import { decodeLegend } from '../engines/decodeEngine';
import { downloadBlob } from '../utils/dom';
import type { SchemaModel } from '../types';

// ============================================================================
// renderSchemaManagementSection — V14. Now takes an `allowAddImport` flag
// (spec section 7: Add Schema / Import Schema removed from the normal
// Schema page; spec section 11/13: retained ONLY inside Settings > Schema
// Management, behind the admin-password gate). Same function powers both
// call sites so there is exactly one implementation to maintain.
// ============================================================================
export function renderSchemaManagementSection(container: HTMLElement, opts: { allowAddImport: boolean }, onAfterAction?: () => void): void {
  function draw(): void {
    const schemas = schemaService.getAllSchemas();
    container.innerHTML = `
      <div class="schema-list" data-tour="schema-list">
        ${schemas.map((s) => `
          <div class="schema-card ${s.status === 'active' ? 'is-active' : ''}">
            <div class="schema-card-head"><h3>${s.name}</h3><span class="chip chip-${s.status}">${s.status === 'active' ? 'Active' : s.status === 'default' ? 'Default' : 'Inactive'}</span></div>
            <p class="hint">v${s.versionMeta?.version ?? s.version} · ${s.tables.length} tables · updated ${new Date(s.updatedAt).toLocaleString()}</p>
            <p class="hint">Last synced: ${s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : 'never'}${s.versionMeta ? ` · source: ${s.versionMeta.source}` : ''}</p>
            <div class="row-actions wrap">
              ${s.status !== 'active' ? `<button class="btn btn-primary btn-sm" data-action="activate" data-id="${s.id}">${icon('check', 14)} Set Active</button>` : `<span class="hint">${icon('check', 14)} Currently active</span>`}
              <button class="btn btn-outline btn-sm" data-action="export-json" data-id="${s.id}">${icon('download', 14)} Export JSON</button>
              <button class="btn btn-outline btn-sm" data-action="export-csv" data-id="${s.id}">${icon('download', 14)} Export CSV</button>
              ${opts.allowAddImport ? `<button class="btn btn-outline btn-sm" data-action="push-github" data-id="${s.id}">${icon('github', 14)} Push to GitHub</button>` : ''}
              ${opts.allowAddImport && schemas.length > 1 ? `<button class="btn btn-danger btn-sm" data-action="delete-schema" data-id="${s.id}">${icon('trash', 14)} Remove</button>` : ''}
            </div>
          </div>`).join('')}
      </div>
      ${opts.allowAddImport ? `
        <div class="row-actions mt">
          <input type="text" id="newSchemaNameInput" placeholder="New schema name…" />
          <button class="btn btn-outline btn-sm" id="addSchemaBtn">${icon('file-plus', 14)} Add Schema</button>
        </div>
        <h3 class="mt">${icon('upload', 15)} Import Schema</h3>
        <input type="file" id="importSchemaFile" accept=".json" />
        <div id="importSchemaPreview"></div>
        <div class="note-box mini">${icon('cloud', 14)}<div>Newly added/imported schemas are saved locally first. Select <strong>Push to GitHub</strong> on a schema card to make it available across every device/browser once this app is hosted and synchronized (requires the Vault to be unlocked and GitHub configured under Synchronization).</div></div>
      ` : ''}`;

    container.querySelectorAll<HTMLButtonElement>('[data-action="activate"]').forEach((btn) => { btn.addEventListener('click', () => { schemaService.switchActiveSchema(btn.dataset.id!); store.regenerateReadOnlySql(); store.pushToast('success', 'Active schema switched.'); onAfterAction?.(); }); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="export-json"]').forEach((btn) => { btn.addEventListener('click', () => downloadBlob(`schema-${btn.dataset.id}.json`, schemaService.exportSchemaJson(btn.dataset.id!), 'application/json')); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="export-csv"]').forEach((btn) => { btn.addEventListener('click', () => downloadBlob(`schema-${btn.dataset.id}.csv`, schemaService.exportSchemaCsv(btn.dataset.id!), 'text/csv')); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="delete-schema"]').forEach((btn) => { btn.addEventListener('click', () => { const result = schemaService.deleteSchema(btn.dataset.id!); if (result.ok) { store.regenerateReadOnlySql(); store.pushToast('success', 'Schema removed.'); } else store.pushToast('error', result.error || 'Could not remove schema.'); }); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="push-github"]').forEach((btn) => { btn.addEventListener('click', async () => { const schema = schemaService.getSchemaById(btn.dataset.id!); if (!schema) return; btn.disabled = true; const original = btn.innerHTML; btn.innerHTML = 'Pushing…'; const result = await syncService.pushSchemaToGitHub(schema); btn.disabled = false; btn.innerHTML = original; if (result.ok) store.pushToast('success', `"${schema.name}" pushed to GitHub — it will sync to other devices on their next Sync.`); else store.pushToast('error', result.error || 'Push failed.'); }); });
    container.querySelector('#addSchemaBtn')?.addEventListener('click', () => { const input = container.querySelector<HTMLInputElement>('#newSchemaNameInput'); const name = input?.value.trim(); if (!name) { store.pushToast('error', 'Enter a name for the new schema.'); return; } schemaService.addNewSchema(name); store.pushToast('success', `Schema "${name}" created locally. Push it to GitHub to make it available on all devices.`); });
    container.querySelector<HTMLInputElement>('#importSchemaFile')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; const preview = container.querySelector('#importSchemaPreview'); if (!file || !preview) return;
      try { const text = await file.text(); const parsed = JSON.parse(text) as SchemaModel; const result = schemaService.importSchema(parsed); if (result.ok) { preview.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Imported "${parsed.name || 'schema'}" as a new inactive schema. Push it to GitHub to make it available on all devices.</div>`; store.pushToast('success', 'Schema imported.'); } else preview.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; } catch (err) { preview.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} Could not parse file: ${(err as Error).message}</div>`; }
    });
  }
  const unsubscribe = schemaService.subscribe(draw);
  draw();
  (container as any)._cleanup = () => unsubscribe();
}

export function renderSchemaPage(container: HTMLElement): void {
  let selectedModule = '';
  let searchTerm = '';

  function draw(): void {
    const active = schemaService.getActiveSchema();
    const modules = schemaService.getModulesForSchema(active.id);
    const tablesInScope = active.tables.filter((t) => (!selectedModule || t.module === selectedModule) && (!searchTerm || t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.description.toLowerCase().includes(searchTerm.toLowerCase())));

    container.innerHTML = `
      <section class="page page-schema">
        <h1 class="page-title">${icon('database')} Schema</h1>
        <p class="page-subtitle">The active schema is the single source of truth for all SQL generation.</p>
        <h2 class="section-title">${icon('list', 15)} Stored Schemas</h2>
        <div id="schemaMgmtMount"></div>
        <h2 class="section-title">${icon('table', 15)} Tables in Active Schema (${active.name})</h2>
        <div class="row-actions wrap" data-tour="schema-module-selector">
          <label class="inline-label">Module<select id="schemaModuleSelect"><option value="">All Modules</option>${modules.map((m) => `<option value="${m}" ${m === selectedModule ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <div class="picker-search" style="flex:1; min-width:200px;">${icon('search', 14)}<input type="text" id="schemaTableSearch" placeholder="Search table…" value="${searchTerm}" /></div>
        </div>
        <div class="schema-results" id="tablesReadOnlyList">
          ${tablesInScope.length ? tablesInScope.map((t) => `
            <div class="schema-table-card">
              <div class="schema-table-head"><span class="icon-badge">${icon('table', 16)}</span><div><h3>${t.name}</h3><span class="hint">${t.module} · ${t.description}</span></div></div>
              <table class="schema-col-table">
                <thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>Keys</th><th>Decode</th></tr></thead>
                <tbody>${t.columns.map((c) => `<tr><td>${c.name}</td><td>${c.type}${c.length ? `(${c.length})` : ''}</td><td>${c.nullable ? 'Yes' : 'No'}</td><td>${c.isPrimaryKey ? '<span class="chip chip-pk">PK</span>' : ''}${c.isForeignKey ? `<span class="chip chip-fk">FK→${c.references?.table}.${c.references?.column}</span>` : ''}</td><td>${c.decode?.length ? `<span class="hint">${decodeLegend(c)}</span>` : ''}</td></tr>`).join('')}</tbody>
              </table>
            </div>`).join('') : '<p class="hint picker-empty">No tables match the current Module/Search filter.</p>'}
        </div>
        <div class="note-box mini">${icon('lock', 14)}<div>Need to add, edit, or delete tables/columns, or add/import a whole schema? That's inside password-protected <strong>Settings</strong> (Manual Schema Update and Schema Management tabs).</div></div>
      </section>`;

    container.querySelector<HTMLSelectElement>('#schemaModuleSelect')?.addEventListener('change', (e) => { selectedModule = (e.target as HTMLSelectElement).value; draw(); });
    container.querySelector<HTMLInputElement>('#schemaTableSearch')?.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; draw(); const input = container.querySelector<HTMLInputElement>('#schemaTableSearch'); input?.focus(); input?.setSelectionRange(searchTerm.length, searchTerm.length); });

    const mgmtMount = container.querySelector<HTMLElement>('#schemaMgmtMount');
    if (mgmtMount) renderSchemaManagementSection(mgmtMount, { allowAddImport: false }, draw);
  }
  draw();
}
