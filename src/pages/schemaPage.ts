import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { syncService } from '../services/syncService';
import { secretVaultService } from '../services/secretVaultService';
import { performBackgroundPull, performPublicDiscovery } from '../services/autoSyncService';
import { renderConflictBanner } from '../components/conflictBanner';
import { openSchemaNameModal } from '../components/schemaNameModal';
import { decodeLegend } from '../engines/decodeEngine';
import { downloadBlob } from '../utils/dom';
import { safeTrim } from '../utils/validation';
import type { SchemaModel } from '../types';

/**
 * Conditionally rendered GitHub-sync error indicator, driven by
 * syncService.getLastError(). Renders nothing at all when null — no empty
 * box, no placeholder — and clears itself the moment a later sync succeeds.
 */
function renderSyncErrorIndicator(container: HTMLElement): void {
  function draw(): void {
    const message = syncService.getLastError();
    container.innerHTML = message ? `<div class="issue-box mini sync-error-indicator">${icon('alert-triangle', 14)} ${message}<button type="button" class="btn btn-link btn-sm sync-error-dismiss">Dismiss</button></div>` : '';
    container.querySelector('.sync-error-dismiss')?.addEventListener('click', () => syncService.clearLastError());
  }
  const unsubscribe = syncService.subscribe(draw); draw();
  (container as any)._cleanup = () => unsubscribe();
}

export function renderSchemaManagementSection(container: HTMLElement, opts: { allowAddImport: boolean }, onAfterAction?: () => void): void {
  function draw(): void {
    const schemas = schemaService.getAllSchemas();
    container.innerHTML = `${opts.allowAddImport ? `<div id="conflictBannerMount"></div><div id="syncErrorMount"></div><div class="auto-sync-hint">${icon('cloud', 15)}<span>Automatic sync: creating, importing, updating, or renaming a schema automatically synchronizes it to the repository once the Secret Vault is unlocked (Settings → Security → Enter Admin Password) — no manual Pull Request needed.</span></div><div class="row-actions"><button id="simpleSyncBtn" class="btn btn-outline btn-sm" type="button">${icon('github', 15)} Sync with GitHub Now</button></div>` : ''}
    <div class="schema-list">${schemas.map((s) => `<div class="schema-card ${s.status === 'active' ? 'is-active' : ''}"><div class="schema-card-head"><h3>${s.name}</h3><span class="chip ${s.status === 'active' ? 'chip-active' : s.status === 'default' ? 'chip-default' : 'chip-inactive'}">${s.status === 'active' ? 'Active' : s.status === 'default' ? 'Default' : 'Inactive'}</span></div><p class="hint">v${s.versionMeta?.version ?? s.version} · ${s.tables.length} tables · updated ${new Date(s.updatedAt).toLocaleString()}</p><p class="hint">Last synced: ${s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : 'never'}${s.versionMeta ? ` · source: ${s.versionMeta.source}` : ''}${s.originalFileName ? ` · imported from: ${s.originalFileName}` : ''}</p><div class="row-actions wrap">${s.status !== 'active' ? `<button type="button" class="btn btn-outline btn-sm" data-action="activate" data-id="${s.id}">${icon('check', 14)} Set Active</button>` : `<span class="chip chip-active">${icon('check', 14)} Currently active</span>`}${opts.allowAddImport ? `<button type="button" class="btn btn-ghost btn-sm" data-action="rename" data-id="${s.id}">${icon('edit', 14)} Rename</button>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-action="export-json" data-id="${s.id}">${icon('download', 14)} Export JSON</button><button type="button" class="btn btn-ghost btn-sm" data-action="export-csv" data-id="${s.id}">${icon('download', 14)} Export CSV</button>${opts.allowAddImport && schemas.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-action="delete-schema" data-id="${s.id}">${icon('trash', 14)} Remove</button>` : ''}</div></div>`).join('')}</div>
    ${opts.allowAddImport ? `<div class="row-actions mt"><button id="addSchemaBtn" class="btn btn-outline btn-sm" type="button">${icon('file-plus', 14)} Add Schema</button><label class="btn btn-outline btn-sm file-input-label">${icon('upload', 14)} Import Schema<input type="file" id="importSchemaFile" accept=".json" hidden/></label></div><div id="importSchemaPreview"></div><details class="advanced-sync-details mt"><summary>${icon('github', 14)} Advanced: manual push/pull</summary><div class="row-actions"><button id="pushRegistryBtn" class="btn btn-ghost btn-sm" type="button">${icon('github', 14)} Push All Schemas to GitHub</button><button id="pullRegistryBtn" class="btn btn-ghost btn-sm" type="button">${icon('folder-sync', 14)} Pull Schemas from GitHub</button></div><div id="registrySyncResult"></div></details>` : ''}<div id="simpleSyncResult"></div>`;
    if (opts.allowAddImport) {
      const cbMount = container.querySelector<HTMLElement>('#conflictBannerMount'); if (cbMount) renderConflictBanner(cbMount, onAfterAction);
      const errMount = container.querySelector<HTMLElement>('#syncErrorMount'); if (errMount) renderSyncErrorIndicator(errMount);
    }
    container.querySelectorAll<HTMLButtonElement>('[data-action="activate"]').forEach((btn) => { btn.addEventListener('click', () => { schemaService.switchActiveSchema(btn.dataset.id!); store.regenerateReadOnlySql(); store.pushToast('success', 'Active schema switched.'); onAfterAction?.(); }); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="rename"]').forEach((btn) => { btn.addEventListener('click', () => { const schema = schemaService.getSchemaById(btn.dataset.id!); if (!schema) return; openSchemaNameModal({ title: `Rename "${schema.name}"`, suggestedName: schema.name, onConfirm: (newName) => { const result = schemaService.renameSchema(schema.id, newName); if (result.ok) { store.pushToast('success', `Renamed to "${newName}".`); onAfterAction?.(); } else store.pushToast('error', result.error || 'Rename failed.'); } }); }); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="export-json"]').forEach((btn) => { btn.addEventListener('click', () => downloadBlob(`schema-${btn.dataset.id}.json`, schemaService.exportSchemaJson(btn.dataset.id!), 'application/json')); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="export-csv"]').forEach((btn) => { btn.addEventListener('click', () => downloadBlob(`schema-${btn.dataset.id}.csv`, schemaService.exportSchemaCsv(btn.dataset.id!), 'text/csv')); });
    container.querySelectorAll<HTMLButtonElement>('[data-action="delete-schema"]').forEach((btn) => { btn.addEventListener('click', () => { const result = schemaService.deleteSchema(btn.dataset.id!); if (result.ok) { store.regenerateReadOnlySql(); store.pushToast('success', 'Schema removed.'); } else store.pushToast('error', result.error || 'Could not remove schema.'); }); });
    container.querySelector('#addSchemaBtn')?.addEventListener('click', () => { openSchemaNameModal({ title: 'Name the New Schema', onConfirm: (name) => { const result = schemaService.addNewSchema(name); if (result.ok) store.pushToast('success', `Schema "${name}" created — it will sync automatically once the Secret Vault is unlocked.`); else store.pushToast('error', result.error || 'Could not create schema.'); } }); });
    container.querySelector<HTMLInputElement>('#importSchemaFile')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; const preview = container.querySelector<HTMLElement>('#importSchemaPreview'); if (!file || !preview) return;
      const originalFileName = safeTrim(file.name);
      preview.innerHTML = '';
      try {
        const text = await file.text(); const parsed = JSON.parse(text) as SchemaModel;
        const suggested = safeTrim(parsed?.name) || originalFileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 _\-.]/g, '_');
        openSchemaNameModal({ title: 'Name the Imported Schema', suggestedName: suggested, originalFileName, onConfirm: (name) => {
          const result = schemaService.importSchema(parsed, name, originalFileName);
          const freshPreview = container.querySelector<HTMLElement>('#importSchemaPreview') || preview;
          if (result.ok) { freshPreview.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} ${result.replacedExisting ? `Updated existing schema "${name}" in place` : `Imported as "${name}"`} — it will sync automatically once the Secret Vault is unlocked.</div>`; store.pushToast('success', 'Schema imported.'); }
          else freshPreview.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
        } });
      } catch (err) { preview.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} Could not parse file: ${(err as Error).message}</div>`; }
      (e.target as HTMLInputElement).value = '';
    });
    container.querySelector('#simpleSyncBtn')?.addEventListener('click', async () => {
      const btn = container.querySelector<HTMLButtonElement>('#simpleSyncBtn')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Syncing…';
      const result = await syncService.syncWithGitHubSimple(); btn.disabled = false; btn.innerHTML = original;
      const resultMount = container.querySelector<HTMLElement>('#simpleSyncResult'); if (!resultMount) return;
      if (!result.ok) { resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; return; }
      const parts: string[] = []; if (result.newSchemasAdded.length) parts.push(`Added ${result.newSchemasAdded.length} new schema(s): ${result.newSchemasAdded.join(', ')}.`); if (result.updatedSchemas.length) parts.push(`Updated ${result.updatedSchemas.length} schema(s): ${result.updatedSchemas.join(', ')}.`); if (result.unchanged) parts.push(`${result.unchanged} schema(s) already up to date.`); if (result.conflicts.length) parts.push(`${result.conflicts.length} schema(s) have conflicting changes — resolve them above.`);
      resultMount.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} ${parts.length ? parts.join(' ') : 'Everything is already in sync.'}</div>`;
      store.pushToast('success', 'Synchronized with GitHub.'); onAfterAction?.();
    });
    container.querySelector('#pushRegistryBtn')?.addEventListener('click', async () => { const btn = container.querySelector<HTMLButtonElement>('#pushRegistryBtn')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Pushing…'; const result = await syncService.pushRegistryToGitHub(); btn.disabled = false; btn.innerHTML = original; const resultMount = container.querySelector<HTMLElement>('#registrySyncResult'); if (resultMount) resultMount.innerHTML = result.ok ? `<div class="issue-box ok mini">${icon('check', 14)} All schemas pushed to GitHub successfully.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}${result.requiresPullFirst ? ' Pull the latest version first.' : ''}</div>`; if (result.ok) { store.pushToast('success', 'Schemas synchronized to GitHub.'); onAfterAction?.(); } });
    container.querySelector('#pullRegistryBtn')?.addEventListener('click', async () => { const btn = container.querySelector<HTMLButtonElement>('#pullRegistryBtn')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Pulling…'; const result = await syncService.pullRegistryFromGitHub(); btn.disabled = false; btn.innerHTML = original; const resultMount = container.querySelector<HTMLElement>('#registrySyncResult'); if (!resultMount) return; if (!result.ok) { resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; return; } const parts: string[] = []; if (result.newSchemasAdded.length) parts.push(`Added ${result.newSchemasAdded.length} new schema(s): ${result.newSchemasAdded.join(', ')}.`); if (result.updatedSchemas.length) parts.push(`Updated ${result.updatedSchemas.length} schema(s).`); if (result.unchanged) parts.push(`${result.unchanged} schema(s) already up to date.`); if (result.conflicts.length) parts.push(`${result.conflicts.length} schema(s) have conflicting changes — resolve them above.`); resultMount.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} ${parts.length ? parts.join(' ') : 'Everything is already in sync.'}</div>`; store.pushToast('success', 'Pulled from GitHub.'); onAfterAction?.(); });
  }
  const unsubscribeSchema = schemaService.subscribe(draw); const unsubscribeSync = syncService.subscribe(draw); draw();
  (container as any)._cleanup = () => { unsubscribeSchema(); unsubscribeSync(); };
}
export function renderSchemaPage(container: HTMLElement): void {
  let selectedModule = ''; let searchTerm = '';
  performPublicDiscovery('schema-page-mount').catch(() => {});
  if (secretVaultService.isUnlocked()) performBackgroundPull('schema-page-mount').catch(() => {});
  function draw(): void {
    const active = schemaService.getActiveSchema(); const modules = schemaService.getModulesForSchema(active.id);
    const tablesInScope = active.tables.filter((t) => (!selectedModule || t.module === selectedModule) && (!searchTerm || t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.description.toLowerCase().includes(searchTerm.toLowerCase())));
    container.innerHTML = `<div class="page"><h1 class="page-title">${icon('database')} Schema</h1><p class="page-subtitle">The active schema is the single source of truth for all SQL generation.</p><h2 class="section-title">${icon('list', 15)} Stored Schemas</h2><div id="schemaMgmtMount"></div><h2 class="section-title" data-tour="schema-module-selector">${icon('table', 15)} Tables & Views in Active Schema (${active.name})</h2><div class="row-actions"><select id="schemaModuleSelect"><option value="">All Modules</option>${modules.map((m) => `<option value="${m}" ${m === selectedModule ? 'selected' : ''}>${m}</option>`).join('')}</select><div class="picker-search">${icon('search', 14)}<input type="text" id="schemaTableSearch" placeholder="Search tables" value="${searchTerm}"/></div></div><div id="tablesReadOnlyList" class="schema-results">${tablesInScope.length ? tablesInScope.map((t) => renderTableCard(t)).join('') : '<p class="hint">No tables match the current Module/Search filter.</p>'}</div><p class="hint mt">${icon('lock', 14)} Need to add, edit, or delete tables/columns, or add/import/sync a whole schema? That's inside password-protected Settings (Manual Schema Update and Schema Management tabs).</p></div>`;
    container.querySelector<HTMLSelectElement>('#schemaModuleSelect')?.addEventListener('change', (e) => { selectedModule = (e.target as HTMLSelectElement).value; draw(); });
    const searchInput = container.querySelector<HTMLInputElement>('#schemaTableSearch');
    searchInput?.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; const listMount = container.querySelector<HTMLElement>('#tablesReadOnlyList'); if (listMount) { const active2 = schemaService.getActiveSchema(); const scoped = active2.tables.filter((t) => (!selectedModule || t.module === selectedModule) && (!searchTerm || t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.description.toLowerCase().includes(searchTerm.toLowerCase()))); listMount.innerHTML = scoped.length ? scoped.map((t) => renderTableCard(t)).join('') : '<p class="hint">No tables match the current Module/Search filter.</p>'; } });
    const mgmtMount = container.querySelector<HTMLElement>('#schemaMgmtMount'); if (mgmtMount) renderSchemaManagementSection(mgmtMount, { allowAddImport: false }, draw);
  }
  function renderTableCard(t: ReturnType<typeof schemaService.getActiveSchema>['tables'][number]): string {
    const isView = t.objectType === 'VIEW';
    return `<div class="schema-table-card"><div class="schema-table-head">${icon(isView ? 'eye' : 'table', 16)}<h3>${t.name}${isView ? ' <span class="chip chip-view">VIEW</span>' : ''}</h3></div><p class="hint">${t.module} · ${t.description}</p><table class="schema-col-table"><thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>Keys</th><th>Decode</th></tr></thead><tbody>${t.columns.map((c) => `<tr><td>${c.name}</td><td>${c.type}${c.length ? `(${c.length})` : ''}</td><td>${c.nullable ? 'Yes' : 'No'}</td><td>${c.isPrimaryKey ? 'PK' : ''}${c.isForeignKey ? `FK→${c.references?.table}.${c.references?.column}` : ''}</td><td>${c.decode?.length ? decodeLegend(c) : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  draw();
}
