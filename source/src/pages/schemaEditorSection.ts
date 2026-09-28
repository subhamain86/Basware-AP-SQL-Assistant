import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { syncService } from '../services/syncService';
import { secretVaultService } from '../services/secretVaultService';
import { renderDataTable } from '../components/dataTable';
import { openModal } from '../components/modal';
import { validateDecodeEntries, buildSchemaDecodeExpression } from '../engines/decodeEngine';
import { verifyPassword } from '../services/passwordService';
import type { SchemaEditorRow, ColumnDataType, ColumnDef, DecodeEntry } from '../types';
import { VALID_DATA_TYPES } from '../types';

function parseDecodeTextForPreview(decodeText: string): DecodeEntry[] {
  return decodeText.split(/[\n;]+/).map((l) => l.trim()).filter((l) => l.length > 0).map((line) => {
    const idx = line.indexOf('=');
    return idx === -1 ? { rawValue: line, label: line } : { rawValue: line.slice(0, idx).trim(), label: line.slice(idx + 1).trim() };
  });
}
const DECODE_EXAMPLE_ENTRIES: DecodeEntry[] = [
  { rawValue: '1', label: 'Approved' },
  { rawValue: '2', label: 'Rejected' },
  { rawValue: '3', label: 'Pending' }
];
function renderDecodeHelpBlock(): string {
  const exampleColumn: ColumnDef = { name: 'STATUS', label: 'Status', type: 'VARCHAR', nullable: false, description: '', decode: DECODE_EXAMPLE_ENTRIES };
  const exampleSql = buildSchemaDecodeExpression('STATUS', exampleColumn, 'STATUS', 'Generic');
  return `<div class="decode-help">
    <div class="decode-help-head">${icon('sparkles', 14)} <strong>What is DECODE/CASE for?</strong></div>
    <p class="hint">SQL Assistant treats DECODE as CASE-based functionality: it lets the Query Builder show a readable label (e.g. "Approved") instead of a raw stored code (e.g. "1") whenever this column is selected with "Schema CASE/DECODE" — the raw value is never changed in the database, only how it is displayed in the generated SQL, and it is ALWAYS rendered as a standard, portable <code>CASE WHEN ... THEN ... END</code> expression — never a database-specific <code>DECODE()</code> function call.</p>
    <p class="hint"><strong>Enter one mapping per line</strong>, as <code>RAW=Label</code> — the part before <code>=</code> is the exact database value; the part after <code>=</code> is what should be displayed instead. Quotes are added automatically — do not type quotes yourself. A semicolon can also separate mappings instead of a new line.</p>
    <div class="decode-example">
      <div class="decode-example-col">
        <div class="decode-example-label">Example — if the database stores:</div>
        <table class="decode-example-table"><tbody>
          ${DECODE_EXAMPLE_ENTRIES.map((e) => `<tr><td class="decode-raw">${e.rawValue}</td><td class="decode-arrow">→</td><td class="decode-label">${e.label}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="decode-example-col">
        <div class="decode-example-label">…you would enter:</div>
        <pre class="decode-example-code">${DECODE_EXAMPLE_ENTRIES.map((e) => `${e.rawValue}=${e.label}`).join('\n')}</pre>
      </div>
    </div>
    <details class="decode-sql-preview-details">
      <summary>${icon('code', 13)} Show the SQL this example would generate</summary>
      <pre class="sql-output decode-sql-mini">${exampleSql}</pre>
    </details>
  </div>`;
}

/** ==========================================================================
 * V15.7 ROOT-CAUSE FIX — Manual Schema Update → GitHub central sync issue
 * ==========================================================================
 * ROOT CAUSE IDENTIFIED: the Save button's own submit handler only ever
 * called `schemaService.upsertRow()` (a purely LOCAL, in-memory + localStorage
 * write) and then reported success and closed the modal. The only mechanism
 * that ever pushed the updated schema registry to the central GitHub
 * repository was `autoSyncService`'s `scheduleBackgroundPush()` — a fully
 * DECOUPLED, 1.2-second-debounced timer that fires independently of the Save
 * action, with its own separate success/failure toast that appears well
 * after the Save modal has already closed. This is exactly the defect
 * described in the bug report: "Manual Save → Local State Updated → GitHub
 * Sync Not Triggered [as part of the same operation]" — the save operation
 * itself never confirmed, or even attempted, a central save; it just relied
 * on a best-effort background timer that the user has no direct visibility
 * into from the Save action itself. If the debounced push were skipped for
 * any reason (e.g. the tab is closed within 1.2s, or the vault is locked at
 * that exact moment), the local save would still report as fully
 * successful even though nothing had reached GitHub.
 *
 * THE FIX: the Save handler below now EXPLICITLY calls and AWAITS
 * `syncService.pushRegistryToGitHub()` as an integral, sequential step of
 * the save workflow itself — immediately after the local row-level update
 * succeeds — and reports ONE OF THREE distinct, honest outcomes tied
 * directly to this specific save:
 *   1. Local update + central GitHub push both succeeded → clear
 *      confirmation that the change is centrally synchronized.
 *   2. Local update succeeded but the Secret Vault is locked → clear
 *      message that the row is saved locally but NOT yet centrally
 *      synchronized, with instructions to unlock Settings.
 *   3. Local update succeeded but the GitHub push itself failed (network,
 *      auth, conflict, etc.) → clear message that the row is saved locally
 *      but central synchronization failed, showing the underlying error,
 *      and explicitly NOT claiming a successful central save.
 * In all three cases the LOCAL row-level update (V15.6's targeted,
 * single-row upsert) is completely unchanged — only ONE row is ever
 * touched, exactly as before — and the existing debounced
 * `autoSyncService` background mechanism is left fully intact as a
 * secondary safety net/retry path (per requirement #6, "allow the existing
 * synchronization mechanism to retry/recover"), it is simply no longer the
 * ONLY thing responsible for actually reaching GitHub after a save.
 * ========================================================================== */
export function renderSchemaEditorSection(container: HTMLElement): void {
  let editingSchemaId = schemaService.getActiveSchema().id;
  let selectedModule: string | null = null;
  let selectedTable: string | null = null;
  let tableApi: ReturnType<typeof renderDataTable<SchemaEditorRow>> | null = null;
  function draw(): void {
    const allSchemas = schemaService.getAllSchemas();
    const editingSchema = schemaService.getSchemaById(editingSchemaId) || allSchemas[0];
    editingSchemaId = editingSchema.id;
    const modules = schemaService.getModulesForSchema(editingSchemaId);
    if (selectedModule && !modules.includes(selectedModule)) { selectedModule = null; selectedTable = null; }
    const tablesInModule = selectedModule ? schemaService.getTablesForModule(editingSchemaId, selectedModule) : [];
    if (selectedTable && !tablesInModule.some((t) => t.name === selectedTable)) selectedTable = null;
    container.innerHTML = `<div class="mt">
      <label class="block-label">Select Schema<select id="editorSchemaSelect">${allSchemas.map((s) => `<option value="${s.id}" ${s.id === editingSchemaId ? 'selected' : ''}>${s.name}${s.status === 'active' ? ' (Active)' : ''}</option>`).join('')}</select></label>
      <div class="editing-schema-banner">${icon('edit', 14)} Editing Schema: <strong>${editingSchema.name}</strong> ${editingSchema.status === 'active' ? '<span class="chip chip-active">Active — changes apply immediately</span>' : '<span class="chip chip-inactive">Inactive — activate it from Schema to use these changes</span>'} <span class="auto-sync-hint">${icon('folder-sync', 12)} Saved rows are synchronized to GitHub immediately as part of Save</span><button type="button" class="btn btn-link sync-now-inline-btn" id="syncNowInlineBtn">${icon('github', 13)} Sync Now</button></div>
      <div id="syncNowInlineResult"></div>
      <div class="form-row-2">
        <label class="block-label">Select Module *<select id="editorModuleSelect"><option value="">— choose a module —</option>${modules.map((m) => `<option value="${m}" ${m === selectedModule ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="block-label">Select Table *<select id="editorTableSelect" ${selectedModule ? '' : 'disabled'}><option value="">— choose a table —</option>${tablesInModule.map((t) => `<option value="${t.name}" ${t.name === selectedTable ? 'selected' : ''}>${t.name}${t.objectType === 'VIEW' ? ' (View)' : ''}</option>`).join('')}</select></label>
      </div>
      ${selectedTable ? `<div class="row-actions"><button type="button" class="btn btn-primary btn-sm" id="addRowBtn">${icon('plus', 14)} Add New Row</button></div>
        <div id="dataTableMount" class="mt"></div>
        <div class="row-actions" id="rowActionsBar" hidden><span id="selectedRowLabel"></span><button type="button" class="btn btn-outline btn-sm" id="editRowBtn">${icon('edit', 14)} Edit</button><button type="button" class="btn btn-danger btn-sm" id="deleteRowBtn">${icon('trash', 14)} Delete</button></div>`
        : `<div class="hint mt">Select a Module, then a Table, to populate its schema data below.</div>`}
    </div>`;
    container.querySelector('#editorSchemaSelect')?.addEventListener('change', (e) => { editingSchemaId = (e.target as HTMLSelectElement).value; selectedModule = null; selectedTable = null; draw(); });
    container.querySelector('#editorModuleSelect')?.addEventListener('change', (e) => { selectedModule = (e.target as HTMLSelectElement).value || null; selectedTable = null; draw(); });
    container.querySelector('#editorTableSelect')?.addEventListener('change', (e) => { selectedTable = (e.target as HTMLSelectElement).value || null; draw(); });
    container.querySelector('#addRowBtn')?.addEventListener('click', () => openRowForm(editingSchema.id, null));
    container.querySelector('#syncNowInlineBtn')?.addEventListener('click', async () => {
      const resultMount = container.querySelector<HTMLElement>('#syncNowInlineResult'); if (!resultMount) return;
      if (!secretVaultService.isUnlocked()) { resultMount.innerHTML = `<div class="issue-box warn mini">${icon('alert-triangle', 14)} Unlock the Secret Vault first (Settings → Security → Enter Admin Password).</div>`; return; }
      resultMount.innerHTML = `<div class="hint">Syncing…</div>`;
      const result = await syncService.pushRegistryToGitHub(`Update ${editingSchema.name} via Manual Schema Update`);
      resultMount.innerHTML = result.ok ? `<div class="issue-box ok mini">${icon('check', 14)} Synced to GitHub.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
      if (result.ok) store.pushToast('success', 'Schema changes synced to GitHub.');
    });
    if (selectedTable) mountTable(editingSchema.id);
  }
  function updateActionsBar(row: SchemaEditorRow | null): void {
    const bar = container.querySelector<HTMLElement>('#rowActionsBar'); const label = container.querySelector<HTMLElement>('#selectedRowLabel'); if (!bar || !label) return;
    if (!row) { bar.hidden = true; return; }
    bar.hidden = false; label.textContent = `Selected: ${row.tableName}.${row.columnName}`;
    const editBtn = container.querySelector<HTMLButtonElement>('#editRowBtn'); const delBtn = container.querySelector<HTMLButtonElement>('#deleteRowBtn');
    if (editBtn) editBtn.onclick = () => openRowForm(editingSchemaId, row);
    if (delBtn) delBtn.onclick = () => startDeleteFlow(editingSchemaId, row);
  }
  function mountTable(schemaId: string): void {
    const mount = container.querySelector<HTMLElement>('#dataTableMount'); if (!mount) return;
    const rows = schemaService.getFlattenedRows(schemaId, selectedModule, selectedTable);
    tableApi = renderDataTable(mount, {
      columns: [
        { key: 'columnName', label: 'Column', sortValue: (r) => r.columnName, width: '16%' },
        { key: 'dataType', label: 'Type', render: (r) => `${r.dataType}${r.length ? `(${r.length})` : ''}`, sortValue: (r) => r.dataType, width: '12%' },
        { key: 'columnDescription', label: 'Description', width: '38%' },
        { key: 'keys', label: 'Keys', render: (r) => `${r.isPrimaryKey ? 'PK' : ''}${r.isForeignKey ? ` FK→${r.fkTable}.${r.fkColumn}` : ''}`, width: '20%' },
        { key: 'nullable', label: 'Null?', render: (r) => r.nullable ? 'Yes' : 'No', width: '8%' }
      ], rows, getRowId: (r) => r.rowId, pageSize: 50, searchPredicate: (r, term) => [r.columnName, r.columnDescription, r.alias].some((v) => (v || '').toLowerCase().includes(term)), onRowClick: (row) => updateActionsBar(row), emptyMessage: `No columns in ${selectedTable} yet. Select "Add New Row" to create the first one.`
    });
    updateActionsBar(null);
  }
  function refreshTable(): void { if (tableApi) tableApi.refresh(schemaService.getFlattenedRows(editingSchemaId, selectedModule, selectedTable)); updateActionsBar(null); }

  /** V15.7 — describes the outcome of the explicit, awaited central-sync
   * attempt that now runs as part of every successful Save, distinguishing
   * the three honest outcomes described in the fix rationale above. */
  function describeCentralSyncOutcome(pushResult: { ok: boolean; error?: string; requiresPullFirst?: boolean } | { skipped: true }): { html: string; toastKind: 'success' | 'warning' | 'error'; toastText: string } {
    if ('skipped' in pushResult) {
      return {
        html: `<div class="issue-box warn mini">${icon('alert-triangle', 14)} Saved locally, but NOT yet synchronized to the central GitHub schema — the Secret Vault is locked. Unlock Settings (Admin Password) to publish this change.</div>`,
        toastKind: 'warning',
        toastText: 'Row saved locally. Unlock Settings to synchronize this change to the central GitHub schema.'
      };
    }
    if (pushResult.ok) {
      return {
        html: `<div class="issue-box ok mini">${icon('check', 14)} Saved locally and synchronized to the central GitHub schema.</div>`,
        toastKind: 'success',
        toastText: 'Row saved and synchronized to the central GitHub schema.'
      };
    }
    return {
      html: `<div class="issue-box mini">${icon('alert-triangle', 14)} Saved locally, but central GitHub synchronization FAILED: ${pushResult.error || 'unknown error'}${pushResult.requiresPullFirst ? ' Pull the latest version first, then try "Sync Now".' : ' The background sync will retry automatically, or use "Sync Now" above.'}</div>`,
      toastKind: 'error',
      toastText: `Row saved locally, but central synchronization failed: ${pushResult.error || 'unknown error'}.`
    };
  }

  function openRowForm(schemaId: string, existing: SchemaEditorRow | null): void {
    const schema = schemaService.getSchemaById(schemaId)!; const isEdit = !!existing;
    const r: SchemaEditorRow = existing || { rowId: '', module: selectedModule || '', tableName: selectedTable || '', tableDescription: schema.tables.find((t) => t.name === selectedTable)?.description || '', columnName: '', columnDescription: '', dataType: 'VARCHAR', length: null, precision: null, nullable: true, alias: '', decodeText: '', isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' };
    const dataTypeOptions = (VALID_DATA_TYPES as ColumnDataType[]).map((t) => `<option value="${t}" ${t === r.dataType ? 'selected' : ''}>${t}</option>`).join('');
    const tableNameList = Array.from(new Set(schema.tables.map((t) => t.name)));
    const bodyHtml = `<form id="rowForm">
      <h4>Table Information</h4>
      <div class="form-row-2"><label class="block-label">Module<input id="f_module" value="${r.module}"/></label><label class="block-label">Table Name *<input id="f_tableName" list="tableNameList" value="${r.tableName}"/><datalist id="tableNameList">${tableNameList.map((n) => `<option value="${n}"></option>`).join('')}</datalist></label></div>
      <label class="block-label">Table Description<input id="f_tableDescription" value="${r.tableDescription}"/></label>
      <h4 class="mt">Column Information</h4>
      <div class="form-row-2"><label class="block-label">Column Name *<input id="f_columnName" value="${r.columnName}"/></label><label class="block-label">Column Description<input id="f_columnDescription" value="${r.columnDescription}"/></label></div>
      <div class="form-row-3"><label class="block-label">Data Type<select id="f_dataType">${dataTypeOptions}</select></label><label class="block-label">Length<input id="f_length" type="number" value="${r.length ?? ''}"/></label><label class="block-label">Precision<input id="f_precision" type="number" value="${r.precision ?? ''}"/></label></div>
      <label class="inline-check"><input type="checkbox" id="f_nullable" ${r.nullable ? 'checked' : ''}/> Nullable</label>
      <h4 class="mt">Metadata</h4>
      <label class="block-label">Alias<input id="f_alias" value="${r.alias}"/></label>
      ${renderDecodeHelpBlock()}
      <label class="block-label">Decode / CASE mappings<textarea id="f_decode" rows="4" placeholder="1=Approved&#10;2=Rejected&#10;3=Pending">${r.decodeText}</textarea></label>
      <div id="decodePreviewMount" class="decode-preview"></div>
      <div id="decodeIssuesLive"></div>
      <label class="inline-check"><input type="checkbox" id="f_isPrimaryKey" ${r.isPrimaryKey ? 'checked' : ''}/> Primary Key</label>
      <label class="inline-check"><input type="checkbox" id="f_isForeignKey" ${r.isForeignKey ? 'checked' : ''}/> Foreign Key</label>
      <div id="fkFields" class="form-row-2" ${r.isForeignKey ? '' : 'hidden'}><label class="block-label">References Table<input id="f_fkTable" value="${r.fkTable}"/></label><label class="block-label">References Column<input id="f_fkColumn" value="${r.fkColumn}"/></label></div>
      <div id="rowFormIssues"></div>
      <div id="rowFormSyncStatus"></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="rowFormCancel">Cancel</button><button type="submit" class="btn btn-primary" id="rowFormSaveBtn">${icon('save', 14)} Save</button></div>
    </form>`;
    const modal = openModal(`${icon(isEdit ? 'edit' : 'plus', 18)} ${isEdit ? 'Edit Row' : 'Add New Row'}`, bodyHtml, { wide: true, closeOnBackdrop: false });
    const form = modal.element.querySelector<HTMLFormElement>('#rowForm')!;
    form.querySelector('#f_isForeignKey')?.addEventListener('change', (e) => { const fkFields = form.querySelector<HTMLElement>('#fkFields'); if (fkFields) fkFields.hidden = !(e.target as HTMLInputElement).checked; });
    form.querySelector('#rowFormCancel')?.addEventListener('click', () => modal.close());
    function renderDecodePreview(): void {
      const decodeInput = form.querySelector<HTMLTextAreaElement>('#f_decode'); if (!decodeInput) return;
      const previewMount = form.querySelector<HTMLElement>('#decodePreviewMount');
      const issuesMount = form.querySelector<HTMLElement>('#decodeIssuesLive');
      const text = decodeInput.value;
      if (!text.trim()) { if (previewMount) previewMount.innerHTML = ''; if (issuesMount) issuesMount.innerHTML = ''; return; }
      const entries = parseDecodeTextForPreview(text);
      const issues = validateDecodeEntries(entries);
      if (issuesMount) issuesMount.innerHTML = issues.length ? `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${issues.map((m) => `<li>${m}</li>`).join('')}</ul></div>` : '';
      if (previewMount) {
        if (issues.length || entries.length === 0) { previewMount.innerHTML = ''; return; }
        const colName = (form.querySelector<HTMLInputElement>('#f_columnName')?.value || 'COLUMN').trim() || 'COLUMN';
        const previewCol: ColumnDef = { name: colName, label: colName, type: 'VARCHAR', nullable: true, description: '', decode: entries };
        const sql = buildSchemaDecodeExpression(colName, previewCol, colName, 'Generic');
        previewMount.innerHTML = `<div class="decode-live-preview"><div class="decode-help-head">${icon('eye', 13)} <strong>Preview</strong> <span class="hint-inline">(${entries.length} mapping${entries.length === 1 ? '' : 's'} detected — rendered as CASE)</span></div><pre class="sql-output decode-sql-mini">${sql}</pre></div>`;
      }
    }
    form.querySelector('#f_decode')?.addEventListener('input', renderDecodePreview);
    renderDecodePreview();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const issuesMount = form.querySelector<HTMLElement>('#rowFormIssues')!;
      const syncStatusMount = form.querySelector<HTMLElement>('#rowFormSyncStatus')!;
      const saveBtn = form.querySelector<HTMLButtonElement>('#rowFormSaveBtn')!;
      const candidate: SchemaEditorRow = { rowId: '', module: (form.querySelector<HTMLInputElement>('#f_module')!.value || 'General').trim(), tableName: form.querySelector<HTMLInputElement>('#f_tableName')!.value.trim(), tableDescription: form.querySelector<HTMLInputElement>('#f_tableDescription')!.value.trim(), columnName: form.querySelector<HTMLInputElement>('#f_columnName')!.value.trim(), columnDescription: form.querySelector<HTMLInputElement>('#f_columnDescription')!.value.trim(), dataType: form.querySelector<HTMLSelectElement>('#f_dataType')!.value as ColumnDataType, length: form.querySelector<HTMLInputElement>('#f_length')!.value ? parseInt(form.querySelector<HTMLInputElement>('#f_length')!.value, 10) : null, precision: form.querySelector<HTMLInputElement>('#f_precision')!.value ? parseInt(form.querySelector<HTMLInputElement>('#f_precision')!.value, 10) : null, nullable: form.querySelector<HTMLInputElement>('#f_nullable')!.checked, alias: form.querySelector<HTMLInputElement>('#f_alias')!.value.trim(), decodeText: form.querySelector<HTMLTextAreaElement>('#f_decode')!.value, isPrimaryKey: form.querySelector<HTMLInputElement>('#f_isPrimaryKey')!.checked, isForeignKey: form.querySelector<HTMLInputElement>('#f_isForeignKey')!.checked, fkTable: form.querySelector<HTMLInputElement>('#f_fkTable')?.value.trim() || '', fkColumn: form.querySelector<HTMLInputElement>('#f_fkColumn')?.value.trim() || '' };
      const requiredIssues: string[] = []; if (!candidate.tableName) requiredIssues.push('Table Name is required.'); if (!candidate.columnName) requiredIssues.push('Column Name is required.');
      if (requiredIssues.length) { issuesMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${requiredIssues.map((m) => `<li>${m}</li>`).join('')}</ul></div>`; return; }

      // Step 1 — validate + apply the targeted, single-row LOCAL update
      // (V15.6 logic, unchanged).
      const engineIssues = await schemaService.upsertRow(schemaId, candidate, isEdit ? existing!.rowId : null);
      if (engineIssues.length) { issuesMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${engineIssues.map((m) => `<li>${m}</li>`).join('')}</ul></div>`; return; }
      issuesMount.innerHTML = '';

      // Step 2 — V15.7 fix: explicitly attempt + AWAIT the central GitHub
      // sync as an integral part of this same Save action, instead of
      // relying solely on the decoupled background auto-sync timer.
      saveBtn.disabled = true; saveBtn.innerHTML = `${icon('refresh', 14, 'icon-spin')} Saving &amp; syncing…`;
      syncStatusMount.innerHTML = `<div class="hint">${icon('folder-sync', 13)} Row saved locally — synchronizing to the central GitHub schema…</div>`;
      let outcome: ReturnType<typeof describeCentralSyncOutcome>;
      if (!secretVaultService.isUnlocked()) {
        outcome = describeCentralSyncOutcome({ skipped: true });
      } else {
        const pushResult = await syncService.pushRegistryToGitHub(`Update ${candidate.tableName}.${candidate.columnName} via Manual Schema Update`);
        outcome = describeCentralSyncOutcome(pushResult);
      }
      saveBtn.disabled = false; saveBtn.innerHTML = `${icon('save', 14)} Save`;
      syncStatusMount.innerHTML = outcome.html;
      store.pushToast(outcome.toastKind, outcome.toastText);

      // Step 3 — UI update: keep the user on the current page (schema /
      // module / table selections untouched), refresh only the data table
      // in place, and close the modal. The modal briefly shows the sync
      // outcome above before closing so a failed central sync is never
      // silently missed.
      refreshTable();
      setTimeout(() => modal.close(), outcome.toastKind === 'error' ? 1800 : 900);
    });
  }
  function startDeleteFlow(schemaId: string, row: SchemaEditorRow): void {
    const schema = schemaService.getSchemaById(schemaId)!;
    const modal1 = openModal(`${icon('alert-triangle', 18)} Confirm Delete`, `<p>Are you sure you want to delete this schema record?</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="c1Cancel">Cancel</button><button type="button" class="btn btn-danger" id="c1Continue">Continue</button></div>`);
    modal1.element.querySelector('#c1Cancel')?.addEventListener('click', () => modal1.close());
    modal1.element.querySelector('#c1Continue')?.addEventListener('click', () => { modal1.close(); showConfirm2(); });
    function showConfirm2(): void {
      const modal2 = openModal(`${icon('alert-triangle', 18)} Confirm Details`, `<p>You are about to permanently delete:</p><ul><li>Schema: ${schema.name}</li><li>Table: ${row.tableName}</li><li>Column: ${row.columnName}</li></ul><p>This change will modify the selected schema.</p><p>Do you want to continue?</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="c2Cancel">Cancel</button><button type="button" class="btn btn-danger" id="c2Continue">Continue</button></div>`);
      modal2.element.querySelector('#c2Cancel')?.addEventListener('click', () => modal2.close());
      modal2.element.querySelector('#c2Continue')?.addEventListener('click', () => { modal2.close(); showConfirm3(); });
    }
    function showConfirm3(): void {
      const modal3 = openModal(`${icon('lock', 18)} Final Confirmation`, `<p>Enter the Admin Password to permanently delete this schema record.</p><label class="block-label">Admin Password<input type="password" id="c3Password"/></label><div class="issue-box mini" id="c3Error" hidden>${icon('alert-triangle', 14)} Incorrect password.</div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="c3Cancel">Cancel</button><button type="button" class="btn btn-danger" id="c3Delete">Delete Permanently</button></div>`, { closeOnBackdrop: false });
      modal3.element.querySelector('#c3Cancel')?.addEventListener('click', () => modal3.close());
      modal3.element.querySelector('#c3Delete')?.addEventListener('click', async () => {
        const pwInput = modal3.element.querySelector<HTMLInputElement>('#c3Password')!; const errBox = modal3.element.querySelector<HTMLElement>('#c3Error')!;
        const ok = await verifyPassword(pwInput.value); if (!ok) { errBox.removeAttribute('hidden'); return; }
        const result = await schemaService.deleteRow(schemaId, row.rowId); modal3.close();
        if (result.ok) {
          store.pushToast('success', `Deleted ${row.tableName}.${row.columnName}.`);
          refreshTable();
          if (secretVaultService.isUnlocked()) {
            const pushResult = await syncService.pushRegistryToGitHub(`Delete ${row.tableName}.${row.columnName} via Manual Schema Update`);
            if (pushResult.ok) store.pushToast('success', 'Deletion synchronized to the central GitHub schema.');
            else store.pushToast('error', `Deletion saved locally, but central synchronization failed: ${pushResult.error || 'unknown error'}.`);
          } else {
            store.pushToast('warning', 'Deletion saved locally. Unlock Settings to synchronize this change to the central GitHub schema.');
          }
        } else store.pushToast('error', result.error || 'Delete failed.');
      });
    }
  }
  draw();
}
