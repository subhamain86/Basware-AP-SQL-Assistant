import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
import { store } from '../state/store';
import { copyTextToClipboard } from '../components/sqlCodeBlock';
import type { Dialect } from '../types';
export function renderErrorRectifierPage(container: HTMLElement): void {
  let dialect: Dialect = 'Oracle';
  container.innerHTML = `<div class="page" data-tour="error-rectifier-form"><h1 class="page-title">${icon('bug')} Error Rectifier</h1><p class="page-subtitle">SQL generated for review only. Never executes database changes. Always grounded in the current active schema.</p><div class="builder-panel"><h2>1. Paste SQL</h2><textarea id="errSqlText" rows="6" placeholder="Paste the SQL that produced the error"></textarea><h2>2. Paste the database/schema validation error</h2><textarea id="errText" rows="3" placeholder="Paste the exact error message"></textarea><label class="inline-label">SQL dialect (auto-detected where possible)<select id="errDialectSelect">${(['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'] as Dialect[]).map((d) => `<option value="${d}" ${d === dialect ? 'selected' : ''}>${d}</option>`).join('')}</select></label><div class="row-actions"><button id="rectifyBtn" class="btn btn-primary" type="button">${icon('wand', 15)} Identify problem & suggest correction</button></div></div><div class="builder-panel"><h2>3. Review the suggested correction</h2><pre id="rectifiedOutput" class="sql-output">—</pre><button id="copySqlBtn" class="btn btn-outline btn-sm" type="button">${icon('copy', 14)} Copy corrected SQL</button><h2 class="mt">Explanation</h2><div id="explanationBox" class="explanation-box">—</div><h2 class="mt">What Changed</h2><ul id="whatChangedList"><li>—</li></ul></div></div>`;
  const errText = container.querySelector<HTMLTextAreaElement>('#errText')!; const sqlText = container.querySelector<HTMLTextAreaElement>('#errSqlText')!; const dialectSelect = container.querySelector<HTMLSelectElement>('#errDialectSelect')!;
  const rectifiedOutput = container.querySelector<HTMLElement>('#rectifiedOutput')!; const explanationBox = container.querySelector<HTMLElement>('#explanationBox')!; const whatChangedList = container.querySelector<HTMLElement>('#whatChangedList')!;
  dialectSelect.addEventListener('change', () => { dialect = dialectSelect.value as Dialect; });
  container.querySelector('#rectifyBtn')?.addEventListener('click', () => {
    const errorVal = errText.value.trim(); const sqlVal = sqlText.value.trim();
    if (!errorVal || !sqlVal) { rectifiedOutput.textContent = 'Please provide both the SQL query and the database error it produced.'; explanationBox.textContent = '—'; whatChangedList.innerHTML = '<li>—</li>'; return; }
    const result = aiService.rectifySQL(errorVal, sqlVal);
    if (result.detectedDialect) { dialect = result.detectedDialect; dialectSelect.value = dialect; }
    rectifiedOutput.textContent = result.correctedSql; explanationBox.textContent = result.explanation;
    whatChangedList.innerHTML = result.whatChanged.length ? result.whatChanged.map((c) => `<li>${escapeHtml(c)}</li>`).join('') : '<li>No changes were necessary.</li>';
    store.pushToast('info', 'Error analyzed — review the suggested correction before applying it.');
  });
  container.querySelector('#copySqlBtn')?.addEventListener('click', () => { copyTextToClipboard(rectifiedOutput.textContent || ''); store.pushToast('success', 'Corrected SQL copied to clipboard.'); });
  function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
}
