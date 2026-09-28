import { icon } from './icons';
import { openModal } from './modal';
import { buildManualCaseExpression, buildManualDecodeExpression } from '../engines/decodeEngine';
import type { Dialect, SelectedColumnSpec } from '../types';
import { makeId } from '../utils/id';
export interface ManualCasePrefill { table: string; column: string; }
export interface ManualDecodePrefill { table: string; column: string; }
export function openManualCaseBuilder(dialect: Dialect, onAdd: (spec: SelectedColumnSpec) => void, prefill?: ManualCasePrefill): void {
  const seedExpr = prefill ? `${prefill.table}.${prefill.column} = 'X'` : '';
  const bodyHtml = `<p class="hint">Build a CASE expression manually — useful when the column you need doesn't already have a schema-defined CASE/DECODE.</p><div id="whenRows"></div><button type="button" class="btn btn-link" id="addWhenBtn">${icon('plus', 14)} Add WHEN</button><label class="block-label mt">ELSE value<input type="text" id="caseElse"/></label><label class="block-label">Alias *<input type="text" id="caseAlias" value="${prefill ? `${prefill.column}_LABEL` : ''}"/></label><div id="caseIssues"></div><div class="modal-actions"><button id="caseCancel" class="btn btn-ghost" type="button">Cancel</button><button id="caseSave" class="btn btn-primary" type="button">${icon('save', 14)} Add Column</button></div>`;
  const modal = openModal(`${icon('code', 18)} Manual CASE Expression${prefill ? ` — ${prefill.table}.${prefill.column}` : ''}`, bodyHtml, { wide: true });
  const whenRowsEl = modal.element.querySelector<HTMLElement>('#whenRows')!;
  let whens: { whenExpr: string; thenValue: string }[] = [{ whenExpr: seedExpr, thenValue: '' }];
  function renderWhens(): void {
    whenRowsEl.innerHTML = whens.map((w, i) => `<div class="mini-row wrap" data-idx="${i}"><input type="text" class="when-expr" placeholder="e.g. TABLE.STATUS = 'A'" value="${w.whenExpr.replace(/"/g, '&quot;')}"/><span>THEN</span><input type="text" class="when-then" placeholder="label" value="${w.thenValue.replace(/"/g, '&quot;')}"/><button type="button" class="icon-btn remove-when">${icon('trash', 14)}</button></div>`).join('');
    whenRowsEl.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.when-expr')?.addEventListener('input', (e) => { whens[idx].whenExpr = (e.target as HTMLInputElement).value; }); row.querySelector('.when-then')?.addEventListener('input', (e) => { whens[idx].thenValue = (e.target as HTMLInputElement).value; }); row.querySelector('.remove-when')?.addEventListener('click', () => { whens.splice(idx, 1); renderWhens(); }); });
  }
  renderWhens();
  modal.element.querySelector('#addWhenBtn')?.addEventListener('click', () => { whens.push({ whenExpr: '', thenValue: '' }); renderWhens(); });
  modal.element.querySelector('#caseCancel')?.addEventListener('click', () => modal.close());
  modal.element.querySelector('#caseSave')?.addEventListener('click', () => {
    const alias = (modal.element.querySelector<HTMLInputElement>('#caseAlias')?.value || '').trim();
    const elseVal = modal.element.querySelector<HTMLInputElement>('#caseElse')?.value || '';
    const issuesMount = modal.element.querySelector<HTMLElement>('#caseIssues')!;
    const issues: string[] = []; if (!alias) issues.push('Alias is required.');
    const validWhens = whens.filter((w) => w.whenExpr.trim() && w.thenValue.trim()); if (validWhens.length === 0) issues.push('Add at least one complete WHEN / THEN pair.');
    if (issues.length) { issuesMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${issues.map((i) => `<li>${i}</li>`).join('')}</ul></div>`; return; }
    const expr = buildManualCaseExpression(validWhens, elseVal, alias);
    onAdd({ id: makeId('col'), table: '', column: alias, alias, useDecode: false, aggregate: null, manualExpr: expr }); modal.close();
  });
}
export function openManualDecodeBuilder(dialect: Dialect, onAdd: (spec: SelectedColumnSpec) => void, prefill?: ManualDecodePrefill, replaceSpecId?: string, seedAliasOverride?: string): void {
  const seedSource = prefill ? `${prefill.table}.${prefill.column}` : '';
  const seedAlias = seedAliasOverride || (prefill ? `${prefill.column}_DESC` : '');
  const bodyHtml = `<p class="hint">Build a DECODE (Oracle) / CASE (other dialects) expression manually.</p><label class="block-label">Source column/expression *<input type="text" id="decodeSource" value="${seedSource.replace(/"/g, '&quot;')}"/></label><div id="pairRows"></div><button type="button" class="btn btn-link" id="addPairBtn">${icon('plus', 14)} Add raw=label pair</button><label class="block-label mt">ELSE value<input type="text" id="decodeElse"/></label><label class="block-label">Alias *<input type="text" id="decodeAlias" value="${seedAlias.replace(/"/g, '&quot;')}"/></label><div id="decodeIssues"></div><div class="modal-actions"><button id="decodeCancel" class="btn btn-ghost" type="button">Cancel</button><button id="decodeSave" class="btn btn-primary" type="button">${icon('save', 14)} ${replaceSpecId ? 'Apply' : 'Add Column'}</button></div>`;
  const modal = openModal(`${icon('sparkles', 18)} Manual DECODE Expression${prefill ? ` — ${prefill.table}.${prefill.column}` : ''}`, bodyHtml, { wide: true });
  const pairRowsEl = modal.element.querySelector<HTMLElement>('#pairRows')!;
  let pairs: { rawValue: string; label: string }[] = [{ rawValue: '', label: '' }];
  function renderPairs(): void { pairRowsEl.innerHTML = pairs.map((p, i) => `<div class="mini-row wrap" data-idx="${i}"><input type="text" class="pair-raw" placeholder="raw value" value="${p.rawValue.replace(/"/g, '&quot;')}"/><span>=</span><input type="text" class="pair-label" placeholder="label" value="${p.label.replace(/"/g, '&quot;')}"/><button type="button" class="icon-btn remove-pair">${icon('trash', 14)}</button></div>`).join(''); pairRowsEl.querySelectorAll<HTMLElement>('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.pair-raw')?.addEventListener('input', (e) => { pairs[idx].rawValue = (e.target as HTMLInputElement).value; }); row.querySelector('.pair-label')?.addEventListener('input', (e) => { pairs[idx].label = (e.target as HTMLInputElement).value; }); row.querySelector('.remove-pair')?.addEventListener('click', () => { pairs.splice(idx, 1); renderPairs(); }); }); }
  renderPairs();
  modal.element.querySelector('#addPairBtn')?.addEventListener('click', () => { pairs.push({ rawValue: '', label: '' }); renderPairs(); });
  modal.element.querySelector('#decodeCancel')?.addEventListener('click', () => modal.close());
  modal.element.querySelector('#decodeSave')?.addEventListener('click', () => {
    const source = (modal.element.querySelector<HTMLInputElement>('#decodeSource')?.value || '').trim();
    const alias = (modal.element.querySelector<HTMLInputElement>('#decodeAlias')?.value || '').trim();
    const elseVal = modal.element.querySelector<HTMLInputElement>('#decodeElse')?.value || '';
    const issuesMount = modal.element.querySelector<HTMLElement>('#decodeIssues')!;
    const issues: string[] = []; if (!source) issues.push('Source column/expression is required.'); if (!alias) issues.push('Alias is required.');
    const validPairs = pairs.filter((p) => p.rawValue.trim() && p.label.trim()); if (validPairs.length === 0) issues.push('Add at least one complete raw=label pair.');
    if (issues.length) { issuesMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${issues.map((i) => `<li>${i}</li>`).join('')}</ul></div>`; return; }
    const expr = buildManualDecodeExpression(source, validPairs, elseVal, alias, dialect);
    onAdd({ id: replaceSpecId || makeId('col'), table: replaceSpecId ? (prefill?.table || '') : '', column: replaceSpecId ? (prefill?.column || alias) : alias, alias, useDecode: false, aggregate: null, manualExpr: expr, displayMode: 'manual-decode' }); modal.close();
  });
}
