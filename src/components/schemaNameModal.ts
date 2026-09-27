import { icon } from './icons';
import { openModal } from './modal';
import { schemaService } from '../services/schemaService';
export function openSchemaNameModal(opts: { title: string; suggestedName?: string; originalFileName?: string; onConfirm: (name: string) => void }): void {
  const bodyHtml = `
    <p class="hint">${opts.originalFileName ? `Uploaded file: <code>${opts.originalFileName}</code> — this filename will NOT be used as the schema name.` : 'Choose a meaningful name for this schema — it will be shown throughout SQL Assistant and preserved across every synchronized device.'}</p>
    <label class="block-label">Schema Name <span class="req">*</span><input type="text" id="schemaNameInput" value="${opts.suggestedName || ''}" placeholder="e.g. Customer AP Production" autocomplete="off" /></label>
    <div id="schemaNameError"></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="schemaNameCancel">Cancel</button><button type="button" class="btn btn-primary" id="schemaNameConfirm">${icon('check', 14)} Confirm Name</button></div>`;
  const modal = openModal(`${icon('edit', 18)} ${opts.title}`, bodyHtml, { closeOnBackdrop: false });
  const input = modal.element.querySelector<HTMLInputElement>('#schemaNameInput')!;
  const errBox = modal.element.querySelector<HTMLElement>('#schemaNameError')!;
  function validateLive(): void {
    const err = schemaService.validateNewSchemaName(input.value);
    errBox.innerHTML = err ? `<div class="issue-box mini">${icon('alert-triangle', 14)} ${err}</div>` : '';
  }
  input.addEventListener('input', validateLive);
  modal.element.querySelector('#schemaNameCancel')?.addEventListener('click', () => modal.close());
  modal.element.querySelector('#schemaNameConfirm')?.addEventListener('click', () => {
    const err = schemaService.validateNewSchemaName(input.value);
    if (err) { errBox.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${err}</div>`; return; }
    opts.onConfirm(input.value.trim());
    modal.close();
  });
}
