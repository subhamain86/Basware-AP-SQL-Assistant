import { icon } from './icons.js';
import { openModal } from './modal.js';
import { buildManualCaseExpression, buildManualDecodeExpression } from '../engines/decodeEngine.js';
import { makeId } from '../utils/id.js';
export function openManualCaseBuilder(dialect, onAdd, prefill) {
    const seedExpr = prefill ? `${prefill.table}.${prefill.column} = 'X'` : '';
    const seedAlias = prefill ? `${prefill.column}_LABEL` : '';
    const bodyHtml = `<p class="hint">Build a CASE expression manually — useful when the column you need doesn't already have a schema-defined CASE/DECODE.</p><div id="whenRows"></div><button type="button" class="btn btn-outline btn-sm" id="addWhenBtn">${icon('plus', 14)} Add WHEN</button><div class="block-label"><span>ELSE value</span><input id="caseElse" type="text"/></div><div class="block-label"><span>Alias *</span><input id="caseAlias" type="text" value="${seedAlias}"/></div><div id="caseIssues"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="caseCancel">Cancel</button><button type="button" class="btn btn-primary" id="caseSave">${icon('save', 14)} Add Column</button></div>`;
    const modal = openModal(`${icon('code', 18)} Manual CASE Expression${prefill ? ` — ${prefill.table}.${prefill.column}` : ''}`, bodyHtml, { wide: true });
    const whenRowsEl = modal.element.querySelector('#whenRows');
    let whens = [{ whenExpr: seedExpr, thenValue: '' }];
    function renderWhens() {
        whenRowsEl.innerHTML = whens.map((w, i) => `<div class="mini-row wrap" data-idx="${i}"><input class="when-expr" placeholder="WHEN expression" value="${w.whenExpr}"/><span>THEN</span><input class="when-then" placeholder="value" value="${w.thenValue}"/><button type="button" class="icon-btn remove-when">${icon('trash', 14)}</button></div>`).join('');
        whenRowsEl.querySelectorAll('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.when-expr')?.addEventListener('input', (e) => { whens[idx].whenExpr = e.target.value; }); row.querySelector('.when-then')?.addEventListener('input', (e) => { whens[idx].thenValue = e.target.value; }); row.querySelector('.remove-when')?.addEventListener('click', () => { whens.splice(idx, 1); renderWhens(); }); });
    }
    renderWhens();
    modal.element.querySelector('#addWhenBtn')?.addEventListener('click', () => { whens.push({ whenExpr: '', thenValue: '' }); renderWhens(); });
    modal.element.querySelector('#caseCancel')?.addEventListener('click', () => modal.close());
    modal.element.querySelector('#caseSave')?.addEventListener('click', () => {
        const alias = (modal.element.querySelector('#caseAlias')?.value || '').trim();
        const elseVal = modal.element.querySelector('#caseElse')?.value || '';
        const issuesMount = modal.element.querySelector('#caseIssues');
        const issues = [];
        if (!alias)
            issues.push('Alias is required.');
        const validWhens = whens.filter((w) => w.whenExpr.trim() && w.thenValue.trim());
        if (validWhens.length === 0)
            issues.push('Add at least one complete WHEN / THEN pair.');
        if (issues.length) {
            issuesMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${issues.map((i) => `<li>${i}</li>`).join('')}</ul></div>`;
            return;
        }
        const expr = buildManualCaseExpression(validWhens, elseVal, alias);
        onAdd({ id: makeId('col'), table: '', column: alias, alias, useDecode: false, aggregate: null, manualExpr: expr });
        modal.close();
    });
}
export function openManualDecodeBuilder(dialect, onAdd, prefill, replaceSpecId, seedAliasOverride) {
    const seedSource = prefill ? `${prefill.table}.${prefill.column}` : '';
    const seedAlias = seedAliasOverride || (prefill ? `${prefill.column}_DESC` : '');
    const bodyHtml = `<p class="hint">Build a DECODE (Oracle) / CASE (other dialects) expression manually.</p><div class="block-label"><span>Source column/expression *</span><input id="decodeSource" type="text" value="${seedSource}"/></div><div id="pairRows"></div><button type="button" class="btn btn-outline btn-sm" id="addPairBtn">${icon('plus', 14)} Add raw=label pair</button><div class="block-label"><span>ELSE value</span><input id="decodeElse" type="text"/></div><div class="block-label"><span>Alias *</span><input id="decodeAlias" type="text" value="${seedAlias}"/></div><div id="decodeIssues"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="decodeCancel">Cancel</button><button type="button" class="btn btn-primary" id="decodeSave">${icon('save', 14)} ${replaceSpecId ? 'Apply' : 'Add Column'}</button></div>`;
    const modal = openModal(`${icon('sparkles', 18)} Manual DECODE Expression${prefill ? ` — ${prefill.table}.${prefill.column}` : ''}`, bodyHtml, { wide: true });
    const pairRowsEl = modal.element.querySelector('#pairRows');
    let pairs = [{ rawValue: '', label: '' }];
    function renderPairs() {
        pairRowsEl.innerHTML = pairs.map((p, i) => `<div class="mini-row wrap" data-idx="${i}"><input class="pair-raw" placeholder="raw value" value="${p.rawValue}"/><span>=</span><input class="pair-label" placeholder="label" value="${p.label}"/><button type="button" class="icon-btn remove-pair">${icon('trash', 14)}</button></div>`).join('');
        pairRowsEl.querySelectorAll('.mini-row').forEach((row) => { const idx = parseInt(row.dataset.idx || '0', 10); row.querySelector('.pair-raw')?.addEventListener('input', (e) => { pairs[idx].rawValue = e.target.value; }); row.querySelector('.pair-label')?.addEventListener('input', (e) => { pairs[idx].label = e.target.value; }); row.querySelector('.remove-pair')?.addEventListener('click', () => { pairs.splice(idx, 1); renderPairs(); }); });
    }
    renderPairs();
    modal.element.querySelector('#addPairBtn')?.addEventListener('click', () => { pairs.push({ rawValue: '', label: '' }); renderPairs(); });
    modal.element.querySelector('#decodeCancel')?.addEventListener('click', () => modal.close());
    modal.element.querySelector('#decodeSave')?.addEventListener('click', () => {
        const source = (modal.element.querySelector('#decodeSource')?.value || '').trim();
        const alias = (modal.element.querySelector('#decodeAlias')?.value || '').trim();
        const elseVal = modal.element.querySelector('#decodeElse')?.value || '';
        const issuesMount = modal.element.querySelector('#decodeIssues');
        const issues = [];
        if (!source)
            issues.push('Source column/expression is required.');
        if (!alias)
            issues.push('Alias is required.');
        const validPairs = pairs.filter((p) => p.rawValue.trim() && p.label.trim());
        if (validPairs.length === 0)
            issues.push('Add at least one complete raw=label pair.');
        if (issues.length) {
            issuesMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)}<ul>${issues.map((i) => `<li>${i}</li>`).join('')}</ul></div>`;
            return;
        }
        const expr = buildManualDecodeExpression(source, validPairs, elseVal, alias, dialect);
        onAdd({ id: replaceSpecId || makeId('col'), table: replaceSpecId ? (prefill?.table || '') : '', column: replaceSpecId ? (prefill?.column || alias) : alias, alias, useDecode: false, aggregate: null, manualExpr: expr, displayMode: 'manual-decode' });
        modal.close();
    });
}
