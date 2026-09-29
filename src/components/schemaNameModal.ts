import { icon } from './icons';
import { openModal } from './modal';
import { schemaService } from '../services/schemaService';
/**
 * V16.2 fix: the error box is only ever INSERTED into the DOM when there is
 * an actual validation error. On success it is set back to an empty string
 * (removed from the DOM), rather than being permanently present and toggled
 * via the `hidden` attribute. This makes the "no error visible when there
 * is no error" behaviour independent of ANY CSS rule, specificity, or
 * cascade order — an element that was never inserted cannot be displayed
 * by any stylesheet, in any browser, in any embedding context.
 */
export function openSchemaNameModal(opts: { title: string; suggestedName?: string; originalFileName?: string; onConfirm: (name: string) => void }): void {
  const bodyHtml = `<p>${opts.originalFileName ? `Uploaded file: <code>${opts.originalFileName}</code> — this filename will NOT be used as the schema name.` : "Choose a meaningful name for this schema — it will be shown throughout SQL Assistant and preserved across every synchronized device."}</p><label class="block-label">Schema Name *<input id="schemaNameInput" type="text" value="${opts.suggestedName ? opts.suggestedName.replace(/"/g, '&quot;') : ''}"/></label><div id="schemaNameError"></div><div class="modal-actions"><button id="schemaNameCancel" class="btn btn-ghost" type="button">Cancel</button><button id="schemaNameConfirm" class="btn btn-primary" type="button">${icon('check', 14)} Confirm Name</button></div>`;
  const modal = openModal(`${icon('edit', 18)} ${opts.title}`, bodyHtml, { closeOnBackdrop: false });
  const input = modal.element.querySelector<HTMLInputElement>('#schemaNameInput')!;
  const errBox = modal.element.querySelector<HTMLElement>('#schemaNameError')!;
  function validateLive(): void { const err = schemaService.validateNewSchemaName(input.value); errBox.innerHTML = err ? `<div class="issue-box mini">${icon('alert-triangle', 14)} ${err}</div>` : ''; }
  input.addEventListener('input', validateLive);
  modal.element.querySelector('#schemaNameCancel')?.addEventListener('click', () => modal.close());
  modal.element.querySelector('#schemaNameConfirm')?.addEventListener('click', () => {
    const err = schemaService.validateNewSchemaName(input.value);
    if (err) { errBox.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${err}</div>`; return; }
    opts.onConfirm(input.value.trim()); modal.close();
  });
}
