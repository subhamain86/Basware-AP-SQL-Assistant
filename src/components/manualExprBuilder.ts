import { icon } from './icons';
import { openModal } from './modal';
import { buildManualCaseExpression, buildManualDecodeExpression } from '../engines/decodeEngine';
import type { Dialect, SelectedColumnSpec } from '../types';
import { makeId } from '../utils/id';
export interface ManualCasePrefill { table: string; column: string; }
export interface ManualDecodePrefill { table: string; column: string; }
export function openManualCaseBuilder(dialect: Dialect, onAdd: (spec: SelectedColumnSpec) => void, prefill?: ManualCasePrefill): void {
  const bodyHtml = `<div class="block-label"><span>Alias *</span><input id="caseAlias" type="text"/></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="caseCancel">Cancel</button><button type="button" class="btn btn-primary" id="caseSave">${icon('save', 14)} Add Column</button></div>`;
  const modal = openModal(`${icon('code', 18)} Manual CASE Expression`, bodyHtml, { wide: true });
  modal.element.querySelector('#caseCancel')?.addEventListener('click', () => modal.close());
  modal.element.querySelector('#caseSave')?.addEventListener('click', () => {
    const alias = (modal.element.querySelector<HTMLInputElement>('#caseAlias')?.value || '').trim();
    if (!alias) return;
    onAdd({ id: makeId('col'), table: '', column: alias, alias, useDecode: false, aggregate: null, manualExpr: buildManualCaseExpression([], '', alias) });
    modal.close();
  });
}
export function openManualDecodeBuilder(dialect: Dialect, onAdd: (spec: SelectedColumnSpec) => void, prefill?: ManualDecodePrefill, replaceSpecId?: string, seedAliasOverride?: string): void {
  const bodyHtml = `<div class="block-label"><span>Source *</span><input id="decodeSource" type="text" value="${prefill ? `${prefill.table}.${prefill.column}` : ''}"/></div><div class="block-label"><span>Alias *</span><input id="decodeAlias" type="text" value="${seedAliasOverride || ''}"/></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="decodeCancel">Cancel</button><button type="button" class="btn btn-primary" id="decodeSave">${icon('save', 14)} Add Column</button></div>`;
  const modal = openModal(`${icon('sparkles', 18)} Manual DECODE Expression`, bodyHtml, { wide: true });
  modal.element.querySelector('#decodeCancel')?.addEventListener('click', () => modal.close());
  modal.element.querySelector('#decodeSave')?.addEventListener('click', () => {
    const source = (modal.element.querySelector<HTMLInputElement>('#decodeSource')?.value || '').trim();
    const alias = (modal.element.querySelector<HTMLInputElement>('#decodeAlias')?.value || '').trim();
    if (!source || !alias) return;
    onAdd({ id: replaceSpecId || makeId('col'), table: replaceSpecId ? (prefill?.table || '') : '', column: replaceSpecId ? (prefill?.column || alias) : alias, alias, useDecode: false, aggregate: null, manualExpr: buildManualDecodeExpression(source, [], '', alias, dialect), displayMode: 'manual-decode' });
    modal.close();
  });
}
