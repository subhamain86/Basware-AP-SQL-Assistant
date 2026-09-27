import { icon } from './icons';
import { openModal } from './modal';
import { schemaService } from '../services/schemaService';
export function openSchemaNameModal(opts: { title: string; suggestedName?: string; originalFileName?: string; onConfirm: (name: string) => void }): void {
  const bodyHtml = `<div class="block-label"><span>Schema Name *</span><input id="schemaNameInput" type="text" value="${opts.suggestedName || ''}"/></div><div id="schemaNameError" class="issue-box mini" hidden></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="schemaNameCancel">Cancel</button><button type="button" class="btn btn-primary" id="schemaNameConfirm">${icon('check', 14)} Confirm Name</button></div>`;
  const modal = openModal(`${icon('edit', 18)} ${opts.title}`, bodyHtml, { closeOnBackdrop: false });
  const input = modal.element.querySelector<HTMLInputElement>('#schemaNameInput')!;
  modal.element.querySelector('#schemaNameCancel')?.addEventListener('click', () => modal.close());
  modal.element.querySelector('#schemaNameConfirm')?.addEventListener('click', () => { const err = schemaService.validateNewSchemaName(input.value); if (err) return; opts.onConfirm(input.value.trim()); modal.close(); });
}
