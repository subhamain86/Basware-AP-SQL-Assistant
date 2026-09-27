import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { syncService } from '../services/syncService';
import { decodeLegend } from '../engines/decodeEngine';
import { downloadBlob } from '../utils/dom';
import type { SchemaModel } from '../types';

export function renderSchemaManagementSection(container: HTMLElement, opts: { allowAddImport: boolean }, onAfterAction?: () => void): void {
  function draw(): void {
    const schemas = schemaService.getAllSchemas();
    container.innerHTML = `
      ${opts.allowAddImport ? `
        <div class="note-box mini simple-sync-cta">${icon('cloud', 15)}<div><strong>New machine?</strong> Enter the Admin Password in Settings to unlock the Secret Vault, then select <strong>Sync with GitHub</strong> below — no repository details required.</div></div>
        <div class="row-actions mt">
          <button class="btn btn-primary" id="simpleSyncBtn">${icon('github', 15)} Sync with GitHub</button>
        </div>
        <div id="simpleSyncResult" class="mt"></div>
      ` : ''}
      <div class="schema-list mt" data-tour="schema-list">
        ${schemas.map((s) => `
          <div class="schema-card ${s.status === 'active' ? 'is-active' : ''}">
            <div class="schema-card-head"><h3>${s.name}</h3><span class="chip chip-${s.status}">${s.status === 'active' ? 'Active' : s.status === 'default' ? 'Default' : 'Inactive'}</span></div>
            <p class="hint">v${s.versionMeta?.version ?? s.version} · ${s.tables.length} tables · updated ${new Date(s.updatedAt).toLocaleString()}</p>
            <p class="hint">Last synced: ${s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : 'never'}${s.versionMeta ? ` · source: ${s.versionMeta.source}` : ''}</p>
            <div class="row-actions wrap">
              ${s.status !== 'active' ? `<button class="btn btn-primary btn-sm" data-action="activate" data-id="${s.id}">${icon('check', 14)} Set Active</button>` : `<span class="hint">${icon('check', 14)} Currently active</span>`}
              <button class="btn btn-outline btn-sm" data-action="export-json" data-id="${s.id}">${icon('download', 14)} Export JSON</button>
              <button class="btn btn-outline btn-sm" data-action="export-csv" data-id="${s.id}">${icon('download', 14)} Export CSV</button>
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
        <details class="advanced-sync-details mt">
          <summary>${icon('github', 14)} Advanced: manual push/pull</summary>
          <div class="row-actions mt">
            <button class="btn btn-outline btn-sm" id="pushRegistryBtn">${icon('github', 14)} Push All Schemas to GitHub</button>
            <button class="btn btn-outline btn-sm" id="pullRegistryBtn">${icon('folder-sync', 14)} Pull Schemas from GitHub</button>
          </div>
          <div id="registrySyncResult" class="mt"></div>
        </details>
      ` : ''}`;

    container.querySelectorAll<HTMLButtonElement>('[data-action="activate"]').forEach((btn) => { btn.addEventListener('click', () => { schemaService.switchActiveSchema(btn.dataset.id!); store.regenerateReadOnlySql(); store.pushToast('success', 'Active schema switched.'); onAfterAction?.(); }); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="export-json"]').forEach((btn) => { btn.addEventListener('click', () => downloadBlob(`schema-${btn.dataset.id}.json`, schemaService.exportSchemaJson(btn.dataset.id!), 'application/json')); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="export-csv"]').forEach((btn) => { btn.addEventListener('click', () => downloadBlob(`schema-${btn.dataset.id}.csv`, schemaService.exportSchemaCsv(btn.dataset.id!), 'text/csv')); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="delete-schema"]').forEach((btn) => { btn.addEventListener('click', () => { const result = schemaService.deleteSchema(btn.dataset.id!); if (result.ok) { store.regenerateReadOnlySql(); store.pushToast('success', 'Schema removed.'); } else store.pushToast('error', result.error || 'Could not remove schema.'); }); });
    container.querySelector('#addSchemaBtn')?.addEventListener('click', () => { const input = container.querySelector<HTMLInputElement>('#newSchemaNameInput'); const name = input?.value.trim(); if (!name) { store.pushToast('error', 'Enter a name for the new schema.'); return; } schemaService.addNewSchema(name); store.pushToast('success', `Schema "${name}" created locally. Select "Sync with GitHub" to share it.`); });
    container.querySelector<HTMLInputElement>('#importSchemaFile')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; const preview = container.querySelector('#importSchemaPreview'); if (!file || !preview) return;
      try { const text = await file.text(); const parsed = JSON.parse(text) as SchemaModel; const result = schemaService.importSchema(parsed); if (result.ok) { preview.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Imported "${parsed.name || 'schema'}" as a new inactive schema. Select "Sync with GitHub" to share it.</div>`; store.pushToast('success', 'Schema imported.'); } else preview.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; } catch (err) { preview.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} Could not parse file: ${(err as Error).message}</div>`; }
    });

    container.querySelector('#simpleSyncBtn')?.addEventListener('click', async () => {
      const btn = container.querySelector<HTMLButtonElement>('#simpleSyncBtn')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Syncing…';
      const result = await syncService.syncWithGitHubSimple();
      btn.disabled = false; btn.innerHTML = original;
      const resultMount = container.querySelector('#simpleSyncResult');
      if (!resultMount) return;
      if (!result.ok) { resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; return; }
      const parts: string[] = [];
      if (result.newSchemasAdded.length) parts.push(`Added ${result.newSchemasAdded.length} new schema(s): ${result.newSchemasAdded.join(', ')}.`);
      if (result.unchanged) parts.push(`${result.unchanged} schema(s) already up to date.`);
      if (result.conflicts.length) { parts.push(`${result.conflicts.length} schema(s) have conflicting changes — resolve below.`); resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} ${parts.join(' ')}</div>` + renderConflictList(result.conflicts); wireConflictButtons(result.conflicts, resultMount, onAfterAction); }
      else resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} ${parts.length ? parts.join(' ') : 'Everything is already in sync.'}</div>`;
      store.pushToast('success', 'Synchronized with GitHub.');
      onAfterAction?.();
    });

    container.querySelector('#pushRegistryBtn')?.addEventListener('click', async () => {
      const btn = container.querySelector<HTMLButtonElement>('#pushRegistryBtn')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Pushing…';
      const result = await syncService.pushRegistryToGitHub();
      btn.disabled = false; btn.innerHTML = original;
      const resultMount = container.querySelector('#registrySyncResult');
      if (resultMount) resultMount.innerHTML = result.ok ? `<div class="issue-box mini ok">${icon('check', 14)} All schemas pushed to GitHub successfully.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}${result.requiresPullFirst ? ' Pull the latest version first.' : ''}</div>`;
      if (result.ok) { store.pushToast('success', 'Schemas synchronized to GitHub.'); onAfterAction?.(); }
    });
    container.querySelector('#pullRegistryBtn')?.addEventListener('click', async () => {
      const btn = container.querySelector<HTMLButtonElement>('#pullRegistryBtn')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Pulling…';
      const result = await syncService.pullRegistryFromGitHub();
      btn.disabled = false; btn.innerHTML = original;
      const resultMount = container.querySelector('#registrySyncResult');
      if (!resultMount) return;
      if (!result.ok) { resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; return; }
      const parts: string[] = [];
      if (result.newSchemasAdded.length) parts.push(`Added ${result.newSchemasAdded.length} new schema(s): ${result.newSchemasAdded.join(', ')}.`);
      if (result.unchanged) parts.push(`${result.unchanged} schema(s) already up to date.`);
      if (result.conflicts.length) { parts.push(`${result.conflicts.length} schema(s) have conflicting changes — resolve below.`); resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} ${parts.join(' ')}</div>` + renderConflictList(result.conflicts); wireConflictButtons(result.conflicts, resultMount, onAfterAction); }
      else resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} ${parts.length ? parts.join(' ') : 'Everything is already in sync.'}</div>`;
      store.pushToast('success', 'Pulled from GitHub.');
      onAfterAction?.();
    });
  }
  const unsubscribe = schemaService.subscribe(draw);
  draw();
  (container as any)._cleanup = () => unsubscribe();
}

function renderConflictList(conflicts: Awaited<ReturnType<typeof syncService.pullRegistryFromGitHub>>['conflicts']): string {
  return conflicts.map((c) => `
    <div class="conflict-card" data-schema-id="${c.schemaId}">
      <div class="conflict-card-head">${icon('shield-alert', 15)} <strong>${c.schemaName}</strong></div>
      <p class="hint">Local version: ${c.localVersion} · Remote version: ${c.remoteVersion}</p>
      <p class="hint">Changed: ${c.changedPaths.slice(0, 6).join(', ')}${c.changedPaths.length > 6 ? ` and ${c.changedPaths.length - 6} more…` : ''}</p>
      <div class="row-actions">
        <button type="button" class="btn btn-outline btn-sm conflict-use-local" data-schema-id="${c.schemaId}">Use Local</button>
        <button type="button" class="btn btn-primary btn-sm conflict-use-remote" data-schema-id="${c.schemaId}">Use Remote</button>
      </div>
    </div>`).join('');
}
function wireConflictButtons(conflicts: Awaited<ReturnType<typeof syncService.pullRegistryFromGitHub>>['conflicts'], mount: Element, onAfterAction?: () => void): void {
  conflicts.forEach((c) => {
    mount.querySelector(`.conflict-use-local[data-schema-id="${c.schemaId}"]`)?.addEventListener('click', () => { syncService.resolveConflict(c.schemaId, 'local', c.remoteSchema); store.pushToast('info', `Kept local version of "${c.schemaName}".`); mount.querySelector(`.conflict-card[data-schema-id="${c.schemaId}"]`)?.remove(); onAfterAction?.(); });
    mount.querySelector(`.conflict-use-remote[data-schema-id="${c.schemaId}"]`)?.addEventListener('click', () => { syncService.resolveConflict(c.schemaId, 'remote', c.remoteSchema); store.pushToast('success', `Applied remote version of "${c.schemaName}".`); mount.querySelector(`.conflict-card[data-schema-id="${c.schemaId}"]`)?.remove(); onAfterAction?.(); });
  });
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
        <h2 class="section-title">${icon('table', 15)} Tables &amp; Views in Active Schema (${active.name})</h2>
        <div class="row-actions wrap" data-tour="schema-module-selector">
          <label class="inline-label">Module<select id="schemaModuleSelect"><option value="">All Modules</option>${modules.map((m) => `<option value="${m}" ${m === selectedModule ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <div class="picker-search" style="flex:1; min-width:200px;">${icon('search', 14)}<input type="text" id="schemaTableSearch" placeholder="Search table…" value="${searchTerm}" /></div>
        </div>
        <div class="schema-results" id="tablesReadOnlyList">
          ${tablesInScope.length ? tablesInScope.map((t) => renderTableCard(t)).join('') : '<p class="hint picker-empty">No tables match the current Module/Search filter.</p>'}
        </div>
        <div class="note-box mini">${icon('lock', 14)}<div>Need to add, edit, or delete tables/columns, or add/import/sync a whole schema? That's inside password-protected <strong>Settings</strong> (Manual Schema Update and Schema Management tabs).</div></div>
      </section>`;

    container.querySelector<HTMLSelectElement>('#schemaModuleSelect')?.addEventListener('change', (e) => { selectedModule = (e.target as HTMLSelectElement).value; draw(); });
    const searchInput = container.querySelector<HTMLInputElement>('#schemaTableSearch');
    searchInput?.addEventListener('input', (e) => {
      searchTerm = (e.target as HTMLInputElement).value;
      const listMount = container.querySelector<HTMLElement>('#tablesReadOnlyList');
      if (listMount) {
        const active2 = schemaService.getActiveSchema();
        const scoped = active2.tables.filter((t) => (!selectedModule || t.module === selectedModule) && (!searchTerm || t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.description.toLowerCase().includes(searchTerm.toLowerCase())));
        listMount.innerHTML = scoped.length ? scoped.map((t) => renderTableCard(t)).join('') : '<p class="hint picker-empty">No tables match the current Module/Search filter.</p>';
      }
    });

    const mgmtMount = container.querySelector<HTMLElement>('#schemaMgmtMount');
    if (mgmtMount) renderSchemaManagementSection(mgmtMount, { allowAddImport: false }, draw);
  }

  function renderTableCard(t: ReturnType<typeof schemaService.getActiveSchema>['tables'][number]): string {
    const isView = t.objectType === 'VIEW';
    return `
      <div class="schema-table-card">
        <div class="schema-table-head"><span class="icon-badge">${icon(isView ? 'eye' : 'table', 16)}</span><div><h3>${t.name}${isView ? ' <span class="chip chip-view">VIEW</span>' : ''}</h3><span class="hint">${t.module} · ${t.description}</span></div></div>
        <table class="schema-col-table">
          <thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>Keys</th><th>Decode</th></tr></thead>
          <tbody>${t.columns.map((c) => `<tr><td>${c.name}</td><td>${c.type}${c.length ? `(${c.length})` : ''}</td><td>${c.nullable ? 'Yes' : 'No'}</td><td>${c.isPrimaryKey ? '<span class="chip chip-pk">PK</span>' : ''}${c.isForeignKey ? `<span class="chip chip-fk">FK→${c.references?.table}.${c.references?.column}</span>` : ''}</td><td>${c.decode?.length ? `<span class="hint">${decodeLegend(c)}</span>` : ''}</td></tr>`).join('')}</tbody>
        </table>
      </div>`;
  }
  draw();
}
