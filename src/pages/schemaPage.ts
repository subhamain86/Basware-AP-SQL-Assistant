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
export function renderSchemaManagementSection(container: HTMLElement, opts: { allowAddImport: boolean }, onAfterAction?: () => void): void {
  function draw(): void {
    const schemas = schemaService.getAllSchemas();
    container.innerHTML = `${opts.allowAddImport ? `<div id="conflictBannerMount"></div><button type="button" class="btn btn-outline btn-sm" id="simpleSyncBtn">${icon('github', 15)} Sync with GitHub Now</button><div id="simpleSyncResult"></div>` : ''}
    <div class="schema-list">${schemas.map((s) => `<div class="schema-card ${s.status === 'active' ? 'is-active' : ''}"><div class="schema-card-head"><h3>${s.name}</h3><span class="chip chip-${s.status}">${s.status === 'active' ? 'Active' : 'Inactive'}</span></div><div class="hint">${s.tables.length} tables · updated ${new Date(s.updatedAt).toLocaleString()}</div><div class="row-actions wrap">${s.status !== 'active' ? `<button type="button" class="btn btn-outline btn-sm" data-action="activate" data-id="${s.id}">${icon('check', 14)} Set Active</button>` : `<span class="hint">${icon('check', 14)} Currently active</span>`}<button type="button" class="btn btn-ghost btn-sm" data-action="export-json" data-id="${s.id}">${icon('download', 14)} Export JSON</button>${opts.allowAddImport && schemas.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-action="delete-schema" data-id="${s.id}">${icon('trash', 14)} Remove</button>` : ''}</div></div>`).join('')}</div>
    ${opts.allowAddImport ? `<div class="row-actions wrap mt"><button type="button" class="btn btn-outline btn-sm" id="addSchemaBtn">${icon('file-plus', 14)} Add Schema</button><label class="btn btn-outline btn-sm file-input-label">${icon('upload', 14)} Import Schema<input type="file" id="importSchemaFile" accept="application/json" hidden/></label></div><div id="importSchemaPreview"></div>` : ''}`;
    if (opts.allowAddImport) { const cbMount = container.querySelector<HTMLElement>('#conflictBannerMount'); if (cbMount) renderConflictBanner(cbMount, onAfterAction); }
    container.querySelectorAll<HTMLElement>('[data-action="activate"]').forEach((btn) => { btn.addEventListener('click', () => { schemaService.switchActiveSchema(btn.dataset.id!); store.regenerateReadOnlySql(); store.pushToast('success', 'Active schema switched.'); onAfterAction?.(); }); });
    container.querySelectorAll<HTMLElement>('[data-action="export-json"]').forEach((btn) => { btn.addEventListener('click', () => downloadBlob(`schema-${btn.dataset.id}.json`, schemaService.exportSchemaJson(btn.dataset.id!), 'application/json')); });
    container.querySelectorAll<HTMLElement>('[data-action="delete-schema"]').forEach((btn) => { btn.addEventListener('click', () => { const result = schemaService.deleteSchema(btn.dataset.id!); if (result.ok) { store.regenerateReadOnlySql(); store.pushToast('success', 'Schema removed.'); } }); });
    container.querySelector('#addSchemaBtn')?.addEventListener('click', () => { openSchemaNameModal({ title: 'Name the New Schema', onConfirm: (name) => { const result = schemaService.addNewSchema(name); if (result.ok) store.pushToast('success', `Schema "${name}" created.`); } }); });
    container.querySelector('#importSchemaFile')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; const preview = container.querySelector<HTMLElement>('#importSchemaPreview'); if (!file || !preview) return;
      try { const text = await file.text(); const parsed = JSON.parse(text) as SchemaModel; const suggested = safeTrim(parsed?.name) || file.name.replace(/\.[^.]+$/, '');
        openSchemaNameModal({ title: 'Name the Imported Schema', suggestedName: suggested, onConfirm: (name) => { const result = schemaService.importSchema(parsed, name, file.name); if (result.ok) { preview.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} Imported.</div>`; store.pushToast('success', 'Schema imported.'); } } });
      } catch (err) { preview.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} Could not parse file.</div>`; }
      (e.target as HTMLInputElement).value = '';
    });
    container.querySelector('#simpleSyncBtn')?.addEventListener('click', async () => {
      const btn = container.querySelector<HTMLButtonElement>('#simpleSyncBtn')!; btn.disabled = true;
      const result = await syncService.syncWithGitHubSimple(); btn.disabled = false;
      const resultMount = container.querySelector<HTMLElement>('#simpleSyncResult'); if (!resultMount) return;
      resultMount.innerHTML = result.ok ? `<div class="issue-box ok mini">${icon('check', 14)} Synced.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
      onAfterAction?.();
    });
  }
  const unsubscribeSchema = schemaService.subscribe(draw); const unsubscribeSync = syncService.subscribe(draw); draw();
  (container as any)._cleanup = () => { unsubscribeSchema(); unsubscribeSync(); };
}
export function renderSchemaPage(container: HTMLElement): void {
  performPublicDiscovery('schema-page-mount').catch(() => {});
  if (secretVaultService.isUnlocked()) performBackgroundPull('schema-page-mount').catch(() => {});
  function draw(): void {
    const active = schemaService.getActiveSchema();
    container.innerHTML = `<div class="page">
      <h2 class="page-title">${icon('database')} Schema</h2>
      <p class="page-subtitle">The active schema is the single source of truth for all SQL generation.</p>
      <h3 class="section-title">${icon('list', 15)} Stored Schemas</h3>
      <div id="schemaMgmtMount"></div>
      <h3 class="section-title" data-tour="schema-module-selector">${icon('table', 15)} Tables & Views in Active Schema (${active.name})</h3>
      <div class="schema-results">${active.tables.map((t) => renderTableCard(t)).join('')}</div>
    </div>`;
    const mgmtMount = container.querySelector<HTMLElement>('#schemaMgmtMount'); if (mgmtMount) renderSchemaManagementSection(mgmtMount, { allowAddImport: false }, draw);
  }
  function renderTableCard(t: ReturnType<typeof schemaService.getActiveSchema>['tables'][number]): string {
    return `<div class="schema-table-card"><div class="schema-table-head">${icon('table', 16)}<h3>${t.name}</h3></div><p class="hint">${t.module} · ${t.description}</p><table class="schema-col-table"><thead><tr><th>Column</th><th>Type</th><th>Decode</th></tr></thead><tbody>${t.columns.map((c) => `<tr><td>${c.name}</td><td>${c.type}</td><td>${c.decode?.length ? decodeLegend(c) : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  draw();
}
