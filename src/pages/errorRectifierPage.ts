import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
import { store } from '../state/store';
import { copyTextToClipboard } from '../components/sqlCodeBlock';
import type { Dialect } from '../types';
export function renderErrorRectifierPage(container: HTMLElement): void {
  let dialect: Dialect = 'Oracle';
  container.innerHTML = `<div class="page" data-tour="error-rectifier-form">
    <h2>${icon('bug')} Error Rectifier</h2>
    <p class="page-subtitle">SQL generated for review only. Never executes database changes.</p>
    <div class="builder-panel narrow">
      <h2>1. Paste SQL</h2>
      <textarea id="errSqlText" rows="6" placeholder="Paste the SQL that produced the error"></textarea>
      <h2>2. Paste the error</h2>
      <textarea id="errText" rows="4" placeholder="Paste the exact error message"></textarea>
      <button type="button" class="btn btn-primary" id="rectifyBtn">${icon('wand', 15)} Identify problem & suggest correction</button>
    </div>
    <div class="builder-panel narrow mt">
      <h2>3. Review the suggested correction</h2>
      <pre class="sql-output" id="rectifiedOutput">—</pre>
      <button type="button" class="btn btn-outline btn-sm" id="copySqlBtn">${icon('copy', 14)} Copy corrected SQL</button>
      <h2>Explanation</h2>
      <div class="explanation-box" id="explanationBox">—</div>
    </div>
  </div>`;
  const errText = container.querySelector<HTMLTextAreaElement>('#errText')!;
  const sqlText = container.querySelector<HTMLTextAreaElement>('#errSqlText')!;
  const rectifiedOutput = container.querySelector<HTMLElement>('#rectifiedOutput')!;
  const explanationBox = container.querySelector<HTMLElement>('#explanationBox')!;
  container.querySelector('#rectifyBtn')?.addEventListener('click', () => {
    const errorVal = errText.value.trim(); const sqlVal = sqlText.value.trim();
    if (!errorVal || !sqlVal) { rectifiedOutput.textContent = 'Please provide both fields.'; return; }
    const result = aiService.rectifySQL(errorVal, sqlVal);
    rectifiedOutput.textContent = result.correctedSql;
    explanationBox.textContent = result.explanation;
    store.pushToast('info', 'Error analyzed.');
  });
  container.querySelector('#copySqlBtn')?.addEventListener('click', () => { copyTextToClipboard(rectifiedOutput.textContent || ''); store.pushToast('success', 'Copied.'); });
}
