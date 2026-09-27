import { icon } from './icons.js';
import { openModal } from './modal.js';
import { schemaService } from '../services/schemaService.js';
export function openSchemaNameModal(opts) {
    const bodyHtml = `<div class="block-label">${opts.originalFileName ? `Uploaded file: <code>${opts.originalFileName}</code> — this filename will NOT be used as the schema name.` : 'Choose a meaningful name for this schema — it will be shown throughout SQL Assistant and preserved across every synchronized device.'}<span>Schema Name *</span><input id="schemaNameInput" type="text" value="${opts.suggestedName || ''}"/></div><div id="schemaNameError" class="issue-box mini" hidden></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="schemaNameCancel">Cancel</button><button type="button" class="btn btn-primary" id="schemaNameConfirm">${icon('check', 14)} Confirm Name</button></div>`;
    const modal = openModal(`${icon('edit', 18)} ${opts.title}`, bodyHtml, { closeOnBackdrop: false });
    const input = modal.element.querySelector('#schemaNameInput');
    const errBox = modal.element.querySelector('#schemaNameError');
    function validateLive() { const err = schemaService.validateNewSchemaName(input.value); errBox.hidden = !err; errBox.innerHTML = err ? `${icon('alert-triangle', 14)} ${err}` : ''; }
    input.addEventListener('input', validateLive);
    modal.element.querySelector('#schemaNameCancel')?.addEventListener('click', () => modal.close());
    modal.element.querySelector('#schemaNameConfirm')?.addEventListener('click', () => { const err = schemaService.validateNewSchemaName(input.value); if (err) {
        errBox.hidden = false;
        errBox.innerHTML = `${icon('alert-triangle', 14)} ${err}`;
        return;
    } opts.onConfirm(input.value.trim()); modal.close(); });
}
