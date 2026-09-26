import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
import { store } from '../state/store';
import { copyTextToClipboard } from '../components/sqlCodeBlock';
import type { Dialect } from '../types';
export function renderErrorRectifierPage(container: HTMLElement): void {
  let dialect: Dialect = 'Oracle';
  container.innerHTML = `
    <section class="page page-error">
      <h1 class="page-title">${icon('bug')} Error Rectifier</h1>
      <p class="page-subtitle">SQL generated for review only. Never executes database changes, never silently overwrites your SQL. Always grounded in the current active schema.</p>
      <div class="builder-grid-top" data-tour="error-rectifier-form">
        <div class="builder-panel">
          <h2>1. Receive SQL</h2>
          <textarea id="errSqlText" rows="8" placeholder="Paste the SQL statement that produced the error"></textarea>
          <h2 class="mt">2. Receive database/schema validation error</h2>
          <textarea id="errText" rows="4" placeholder="Paste the exact error message, e.g. ORA-00904: &quot;VENDR_ID&quot;: invalid identifier"></textarea>
          <label class="inline-label">SQL dialect <span class="hint">auto-detected where possible</span><select id="errDialectSelect">${(['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'] as Dialect[]).map((d) => `<option value="${d}" ${d === dialect ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <button id="rectifyBtn" class="btn btn-primary">${icon('wand', 15)} 3. Identify problem &amp; suggest correction</button>
        </div>
        <div class="builder-panel">
          <h2>4. Review the suggested correction</h2>
          <pre class="sql-output" id="rectifiedOutput">Paste SQL and the error above, then select the button to run the Error Rectifier.</pre>
          <div class="row-actions"><button id="copySqlBtn" class="btn btn-outline btn-sm">${icon('copy', 14)} Copy corrected SQL</button></div>
          <h2 class="mt">Explanation</h2><div class="explanation-box" id="explanationBox">—</div>
          <h2 class="mt">What Changed</h2><ul class="mini-list" id="whatChangedList"><li class="hint">—</li></ul>
        </div>
      </div>
    </section>`;
  const errText = container.querySelector<HTMLTextAreaElement>('#errText')!;
  const sqlText = container.querySelector<HTMLTextAreaElement>('#errSqlText')!;
  const dialectSelect = container.querySelector<HTMLSelectElement>('#errDialectSelect')!;
  const rectifiedOutput = container.querySelector<HTMLElement>('#rectifiedOutput')!;
  const explanationBox = container.querySelector<HTMLElement>('#explanationBox')!;
  const whatChangedList = container.querySelector<HTMLElement>('#whatChangedList')!;
  dialectSelect.addEventListener('change', () => { dialect = dialectSelect.value as Dialect; });
  container.querySelector('#rectifyBtn')?.addEventListener('click', () => {
    const errorVal = errText.value.trim(); const sqlVal = sqlText.value.trim();
    if (!errorVal || !sqlVal) { rectifiedOutput.textContent = 'Please provide both the SQL query and the database error it produced.'; explanationBox.textContent = '—'; whatChangedList.innerHTML = '<li class="hint">—</li>'; return; }
    const result = aiService.rectifySQL(errorVal, sqlVal);
    if (result.detectedDialect) { dialect = result.detectedDialect; dialectSelect.value = dialect; }
    rectifiedOutput.textContent = result.correctedSql; explanationBox.textContent = result.explanation;
    whatChangedList.innerHTML = result.whatChanged.length ? result.whatChanged.map((c) => `<li>${escapeHtml(c)}</li>`).join('') : '<li class="hint">No changes were necessary.</li>';
    store.pushToast('info', 'Error analyzed — review the suggested correction before applying it.');
  });
  container.querySelector('#copySqlBtn')?.addEventListener('click', () => { copyTextToClipboard(rectifiedOutput.textContent || ''); store.pushToast('success', 'Corrected SQL copied to clipboard.'); });
  function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
}
