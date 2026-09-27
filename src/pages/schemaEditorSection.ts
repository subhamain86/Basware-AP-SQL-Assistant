import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { renderDataTable } from '../components/dataTable';
import { openModal } from '../components/modal';
import { validateSingleRowAgainstSchema } from '../engines/schemaIntegrityEngine';
import { verifyPassword } from '../services/passwordService';
import { syncService } from '../services/syncService';
import { secretVaultService } from '../services/secretVaultService';
import type { SchemaEditorRow, ColumnDataType } from '../types';
import { VALID_DATA_TYPES } from '../types';

// schemaEditorSection — V14.2. Workflow unchanged: Select Schema -> Select
// Module -> Select Table -> Populate Table. Uses the secretVaultService for
// the inline "Sync Now" shortcut.
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

    container.innerHTML = `
      <label class="block-label" data-tour="schema-editor-select">Select Schema
        <select id="editorSchemaSelect">${allSchemas.map((s) => `<option value="${s.id}" ${s.id === editingSchema.id ? 'selected' : ''}>${s.name}${s.status === 'active' ? ' (Active)' : ''}</option>`).join('')}</select>
      </label>
      <p class="editing-schema-banner">${icon('edit', 14)} Editing Schema: <strong>${editingSchema.name}</strong>${editingSchema.status === 'active' ? ' <span class="chip chip-active">Active — changes apply immediately</span>' : ' <span class="chip chip-inactive">Inactive — activate it from Schema to use these changes</span>'}
        <button type="button" class="btn btn-outline btn-sm sync-now-inline-btn" id="syncNowInlineBtn">${icon('github', 13)} Sync Now</button>
      </p>
      <div id="syncNowInlineResult"></div>

      <div class="form-row-2" data-tour="schema-editor-module-table">
        <label class="block-label">Select Module <span class="req">*</span><select id="editorModuleSelect"><option value="">— choose a module —</option>${modules.map((m) => `<option value="${m}" ${m === selectedModule ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="block-label">Select Table <span class="req">*</span><select id="editorTableSelect" ${selectedModule ? '' : 'disabled'}><option value="">— choose a table —</option>${tablesInModule.map((t) => `<option value="${t.name}" ${t.name === selectedTable ? 'selected' : ''}>${t.name}${t.objectType === 'VIEW' ? ' (View)' : ''}</option>`).join('')}</select></label>
      </div>

      ${selectedTable ? `
        <div class="row-actions" data-tour="schema-editor-add"><button class="btn btn-primary btn-sm" id="addRowBtn">${icon('plus', 14)} Add New Row</button></div>
        <div id="dataTableMount" class="mt" data-tour="schema-editor-table"></div>
        <div class="row-actions mt" id="rowActionsBar" data-tour="schema-editor-actions" hidden>
          <span class="hint" id="selectedRowLabel"></span>
          <button class="btn btn-outline btn-sm" id="editRowBtn">${icon('edit', 14)} Edit</button>
          <button class="btn btn-danger btn-sm" id="deleteRowBtn">${icon('trash', 14)} Delete</button>
        </div>
      ` : `<p class="hint picker-empty mt">Select a Module, then a Table, to populate its schema data below.</p>`}
    `;

    container.querySelector<HTMLSelectElement>('#editorSchemaSelect')?.addEventListener('change', (e) => { editingSchemaId = (e.target as HTMLSelectElement).value; selectedModule = null; selectedTable = null; draw(); });
    container.querySelector<HTMLSelectElement>('#editorModuleSelect')?.addEventListener('change', (e) => { selectedModule = (e.target as HTMLSelectElement).value || null; selectedTable = null; draw(); });
    container.querySelector<HTMLSelectElement>('#editorTableSelect')?.addEventListener('change', (e) => { selectedTable = (e.target as HTMLSelectElement).value || null; draw(); });
    container.querySelector('#addRowBtn')?.addEventListener('click', () => openRowForm(editingSchema.id, null));
    container.querySelector('#syncNowInlineBtn')?.addEventListener('click', async () => {
      const resultMount = container.querySelector('#syncNowInlineResult'); if (!resultMount) return;
      if (!secretVaultService.isUnlocked()) { resultMount.innerHTML = `<div class="issue-box mini warn">${icon('alert-triangle', 14)} Unlock the Secret Vault first (Settings → Security → Enter Admin Password).</div>`; return; }
      resultMount.innerHTML = `<div class="hint">Syncing…</div>`;
      const result = await syncService.pushRegistryToGitHub(`Update ${editingSchema.name} via Manual Schema Update`);
      resultMount.innerHTML = result.ok ? `<div class="issue-box mini ok">${icon('check', 14)} Synced to GitHub.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
      if (result.ok) store.pushToast('success', 'Schema changes synced to GitHub.');
    });
    if (selectedTable) mountTable(editingSchema.id);
  }

  function updateActionsBar(row: SchemaEditorRow | null): void {
    const bar = container.querySelector<HTMLElement>('#rowActionsBar'); const label = container.querySelector<HTMLElement>('#selectedRowLabel');
    if (!bar || !label) return;
    if (!row) { bar.hidden = true; return; }
    bar.hidden = false; label.textContent = `Selected: ${row.tableName}.${row.columnName}`;
    const editBtn = container.querySelector<HTMLButtonElement>('#editRowBtn'); const delBtn = container.querySelector<HTMLButtonElement>('#deleteRowBtn');
    if (editBtn) editBtn.onclick = () => openRowForm(editingSchemaId, row);
    if (delBtn) delBtn.onclick = () => startDeleteFlow(editingSchemaId, row);
  }

  function mountTable(schemaId: string): void {
    const mount = container.querySelector<HTMLElement>('#dataTableMount'); if (!mount) return;
    const rows = schemaService.getFlattenedRows(schemaId, selectedModule, selectedTable);
    tableApi = renderDataTable<SchemaEditorRow>(mount, {
      columns: [
        { key: 'columnName', label: 'Column', sortValue: (r) => r.columnName, width: '16%' },
        { key: 'dataType', label: 'Type', render: (r) => `${r.dataType}${r.length ? `(${r.length})` : ''}`, sortValue: (r) => r.dataType, width: '12%' },
        { key: 'columnDescription', label: 'Description', width: '38%' },
        { key: 'keys', label: 'Keys', render: (r) => `${r.isPrimaryKey ? '<span class="chip chip-pk">PK</span>' : ''}${r.isForeignKey ? `<span class="chip chip-fk">FK→${r.fkTable}.${r.fkColumn}</span>` : ''}`, width: '20%' },
        { key: 'nullable', label: 'Null?', render: (r) => r.nullable ? 'Yes' : 'No', width: '8%' }
      ],
      rows, getRowId: (r) => r.rowId, pageSize: 50,
      searchPredicate: (r, term) => [r.columnName, r.columnDescription, r.alias].some((v) => (v || '').toLowerCase().includes(term)),
      onRowClick: (row) => updateActionsBar(row),
      emptyMessage: `No columns in ${selectedTable} yet. Select "Add New Row" to create the first one.`
    });
    updateActionsBar(null);
  }

  function refreshTable(): void { if (tableApi) tableApi.refresh(schemaService.getFlattenedRows(editingSchemaId, selectedModule, selectedTable)); updateActionsBar(null); }

  function openRowForm(schemaId: string, existing: SchemaEditorRow | null): void {
    const schema = schemaService.getSchemaById(schemaId)!;
    const isEdit = !!existing;
    const r: SchemaEditorRow = existing || { rowId: '', module: selectedModule || '', tableName: selectedTable || '', tableDescription: schema.tables.find((t) => t.name === selectedTable)?.description || '', columnName: '', columnDescription: '', dataType: 'VARCHAR', length: null, precision: null, nullable: true, alias: '', decodeText: '', isPrimaryKey: false, isForeignKey: false, fkTable: '', fkColumn: '' };
    const dataTypeOptions = (VALID_DATA_TYPES as ColumnDataType[]).map((t) => `<option value="${t}" ${t === r.dataType ? 'selected' : ''}>${t}</option>`).join('');
    const tableNameList = Array.from(new Set(schema.tables.map((t) => t.name)));

    const bodyHtml = `
      <form id="rowForm" class="row-form">
        <h4>Table Information</h4>
        <label class="block-label">Module<input type="text" id="f_module" value="${r.module}" list="moduleList" /></label>
        <label class="block-label">Table Name <span class="req">*</span><input type="text" id="f_tableName" value="${r.tableName}" list="tableNameList" /></label>
        <datalist id="tableNameList">${tableNameList.map((n) => `<option value="${n}">`).join('')}</datalist>
        <label class="block-label">Table Description<input type="text" id="f_tableDescription" value="${r.tableDescription}" /></label>
        <h4 class="mt">Column Information</h4>
        <label class="block-label">Column Name <span class="req">*</span><input type="text" id="f_columnName" value="${r.columnName}" /></label>
        <label class="block-label">Column Description<input type="text" id="f_columnDescription" value="${r.columnDescription}" /></label>
        <div class="form-row-3">
          <label class="block-label">Data Type<select id="f_dataType">${dataTypeOptions}</select></label>
          <label class="block-label">Length<input type="number" id="f_length" min="0" value="${r.length ?? ''}" /></label>
          <label class="block-label">Precision<input type="number" id="f_precision" min="0" value="${r.precision ?? ''}" /></label>
        </div>
        <label class="inline-check"><input type="checkbox" id="f_nullable" ${r.nullable ? 'checked' : ''}/> Nullable</label>
        <h4 class="mt">Metadata</h4>
        <label class="block-label">Alias<input type="text" id="f_alias" value="${r.alias}" /></label>
        <label class="block-label">Decode <span class="hint">(one "RAW=Label" per line)</span><textarea id="f_decode" rows="3">${r.decodeText}</textarea></label>
        <label class="inline-check"><input type="checkbox" id="f_isPrimaryKey" ${r.isPrimaryKey ? 'checked' : ''}/> Primary Key</label>
        <label class="inline-check"><input type="checkbox" id="f_isForeignKey" ${r.isForeignKey ? 'checked' : ''}/> Foreign Key</label>
        <div id="fkFields" class="form-row-2" ${r.isForeignKey ? '' : 'hidden'}>
          <label class="block-label">References Table<input type="text" id="f_fkTable" value="${r.fkTable}" list="tableNameList" /></label>
          <label class="block-label">References Column<input type="text" id="f_fkColumn" value="${r.fkColumn}" /></label>
        </div>
        <div id="rowFormIssues"></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" id="rowFormCancel">Cancel</button><button type="submit" class="btn btn-primary" id="rowFormSave">${icon('save', 14)} Save</button></div>
      </form>`;

    const modal = openModal(`${icon(isEdit ? 'edit' : 'plus', 18)} ${isEdit ? 'Edit Row' : 'Add New Row'}`, bodyHtml, { wide: true });
    const form = modal.element.querySelector<HTMLFormElement>('#rowForm')!;
    form.querySelector<HTMLInputElement>('#f_isForeignKey')?.addEventListener('change', (e) => { const fkFields = form.querySelector<HTMLElement>('#fkFields'); if (fkFields) fkFields.hidden = !(e.target as HTMLInputElement).checked; });
    form.querySelector('#rowFormCancel')?.addEventListener('click', () => modal.close());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const issuesMount = form.querySelector<HTMLElement>('#rowFormIssues')!;
      const candidate: SchemaEditorRow = {
        rowId: '', module: (form.querySelector<HTMLInputElement>('#f_module')!.value || 'General').trim(), tableName: form.querySelector<HTMLInputElement>('#f_tableName')!.value.trim(),
        tableDescription: form.querySelector<HTMLInputElement>('#f_tableDescription')!.value.trim(), columnName: form.querySelector<HTMLInputElement>('#f_columnName')!.value.trim(),
        columnDescription: form.querySelector<HTMLInputElement>('#f_columnDescription')!.value.trim(), dataType: form.querySelector<HTMLSelectElement>('#f_dataType')!.value as ColumnDataType,
        length: form.querySelector<HTMLInputElement>('#f_length')!.value ? parseInt(form.querySelector<HTMLInputElement>('#f_length')!.value, 10) : null,
        precision: form.querySelector<HTMLInputElement>('#f_precision')!.value ? parseInt(form.querySelector<HTMLInputElement>('#f_precision')!.value, 10) : null,
        nullable: form.querySelector<HTMLInputElement>('#f_nullable')!.checked, alias: form.querySelector<HTMLInputElement>('#f_alias')!.value.trim(),
        decodeText: form.querySelector<HTMLTextAreaElement>('#f_decode')!.value, isPrimaryKey: form.querySelector<HTMLInputElement>('#f_isPrimaryKey')!.checked,
        isForeignKey: form.querySelector<HTMLInputElement>('#f_isForeignKey')!.checked, fkTable: form.querySelector<HTMLInputElement>('#f_fkTable')?.value.trim() || '', fkColumn: form.querySelector<HTMLInputElement>('#f_fkColumn')?.value.trim() || ''
      };
      const preIssues = validateSingleRowAgainstSchema(schema, candidate.tableName, candidate.columnName, isEdit ? existing!.tableName : null, isEdit ? existing!.columnName : null);
      const requiredIssues: string[] = [];
      if (!candidate.tableName) requiredIssues.push('Table Name is required.');
      if (!candidate.columnName) requiredIssues.push('Column Name is required.');
      const allIssues = [...requiredIssues, ...preIssues.map((i) => i.message)];
      if (allIssues.length) { issuesMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${allIssues.map((m) => `<li>${m}</li>`).join('')}</ul></div>`; return; }
      const engineIssues = await schemaService.upsertRow(schemaId, candidate, isEdit ? existing!.rowId : null);
      if (engineIssues.length) { issuesMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${engineIssues.map((m) => `<li>${m}</li>`).join('')}</ul></div>`; return; }
      store.pushToast('success', `${isEdit ? 'Updated' : 'Added'} ${candidate.tableName}.${candidate.columnName}. Query Builder and AI engines will use this immediately if this is the active schema.`);
      modal.close(); refreshTable();
    });
  }

  function startDeleteFlow(schemaId: string, row: SchemaEditorRow): void {
    const schema = schemaService.getSchemaById(schemaId)!;
    const modal1 = openModal(`${icon('alert-triangle', 18)} Confirm Delete`, `<p>Are you sure you want to delete this schema record?</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="c1Cancel">Cancel</button><button type="button" class="btn btn-danger" id="c1Continue">Continue</button></div>`);
    modal1.element.querySelector('#c1Cancel')?.addEventListener('click', () => modal1.close());
    modal1.element.querySelector('#c1Continue')?.addEventListener('click', () => { modal1.close(); showConfirm2(); });

    function showConfirm2(): void {
      const modal2 = openModal(`${icon('alert-triangle', 18)} Confirm Details`, `<p>You are about to permanently delete:</p><ul class="mini-list"><li><strong>Schema:</strong> ${schema.name}</li><li><strong>Table:</strong> ${row.tableName}</li><li><strong>Column:</strong> ${row.columnName}</li></ul><p class="hint">This change will modify the selected schema.</p><p>Do you want to continue?</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="c2Cancel">Cancel</button><button type="button" class="btn btn-danger" id="c2Continue">Continue</button></div>`);
      modal2.element.querySelector('#c2Cancel')?.addEventListener('click', () => modal2.close());
      modal2.element.querySelector('#c2Continue')?.addEventListener('click', () => { modal2.close(); showConfirm3(); });
    }
    function showConfirm3(): void {
      const modal3 = openModal(`${icon('lock', 18)} Final Confirmation`, `<p>Enter the Admin Password to permanently delete this schema record.</p><label class="block-label">Admin Password<input type="password" id="c3Password" autocomplete="off" /></label><div id="c3Error" class="issue-box mini" hidden>Incorrect password.</div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="c3Cancel">Cancel</button><button type="button" class="btn btn-danger" id="c3Delete">Delete Permanently</button></div>`, { closeOnBackdrop: false });
      modal3.element.querySelector('#c3Cancel')?.addEventListener('click', () => modal3.close());
      modal3.element.querySelector('#c3Delete')?.addEventListener('click', async () => {
        const pwInput = modal3.element.querySelector<HTMLInputElement>('#c3Password')!; const errBox = modal3.element.querySelector<HTMLElement>('#c3Error')!;
        const ok = await verifyPassword(pwInput.value);
        if (!ok) { errBox.removeAttribute('hidden'); return; }
        const result = await schemaService.deleteRow(schemaId, row.rowId);
        modal3.close();
        if (result.ok) { store.pushToast('success', `Deleted ${row.tableName}.${row.columnName}.`); refreshTable(); } else store.pushToast('error', result.error || 'Delete failed.');
      });
    }
  }

  draw();
}
