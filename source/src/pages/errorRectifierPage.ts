import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
import { store } from '../state/store';
import { copyTextToClipboard } from '../components/sqlCodeBlock';
import type { Dialect } from '../types';
export function renderErrorRectifierPage(container: HTMLElement): void {
  let dialect: Dialect = 'Oracle';
  container.innerHTML = `<div class="page" data-tour="error-rectifier-form">
    <h2 class="page-title">${icon('bug')} Error Rectifier</h2>
    <p class="page-subtitle">SQL generated for review only. Never executes database changes. Always grounded in the current active schema.</p>
    <div class="rectifier-grid">
      <div class="builder-panel rectifier-col">
        <h2>${icon('code', 16)} 1. Original / Error</h2>
        <label class="block-label">Paste SQL<textarea id="errSqlText" rows="8" placeholder="SELECT ..."></textarea></label>
        <label class="block-label">Paste the database/schema validation error<textarea id="errText" rows="5" placeholder="ORA-00904: ..."></textarea></label>
        <label class="inline-label">SQL dialect (auto-detected where possible)<select id="errDialectSelect">${(['SQL Server', 'Oracle', 'PostgreSQL', 'MySQL', 'Generic'] as Dialect[]).map((d) => `<option value="${d}">${d}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-primary" id="rectifyBtn">${icon('wand', 15)} Identify problem &amp; suggest correction</button>
      </div>
      <div class="builder-panel rectifier-col">
        <h2>${icon('clipboard-check', 16)} 2. Rectified / Corrected SQL</h2>
        <pre class="sql-output" id="rectifiedOutput">— Paste a database error and the SQL that produced it, then click Rectify SQL. —</pre>
        <button type="button" class="btn btn-outline btn-sm" id="copySqlBtn">${icon('copy', 14)} Copy corrected SQL</button>
        <h3 class="mt">Explanation</h3>
        <div class="explanation-box" id="explanationBox">—</div>
        <h3 class="mt">What Changed</h3>
        <ul id="whatChangedList"><li>—</li></ul>
      </div>
    </div>
  </div>`;
  const errText = container.querySelector<HTMLTextAreaElement>('#errText')!;
  const sqlText = container.querySelector<HTMLTextAreaElement>('#errSqlText')!;
  const dialectSelect = container.querySelector<HTMLSelectElement>('#errDialectSelect')!;
  const rectifiedOutput = container.querySelector<HTMLElement>('#rectifiedOutput')!;
  const explanationBox = container.querySelector<HTMLElement>('#explanationBox')!;
  const whatChangedList = container.querySelector<HTMLElement>('#whatChangedList')!;
  dialectSelect.addEventListener('change', () => { dialect = dialectSelect.value as Dialect; });
  container.querySelector('#rectifyBtn')?.addEventListener('click', () => {
    const errorVal = errText.value.trim(); const sqlVal = sqlText.value.trim();
    if (!errorVal || !sqlVal) { rectifiedOutput.textContent = 'Please provide both the SQL query and the database error it produced.'; explanationBox.textContent = '—'; whatChangedList.innerHTML = '<li>—</li>'; return; }
    const result = aiService.rectifySQL(errorVal, sqlVal);
    if (result.detectedDialect) { dialect = result.detectedDialect; dialectSelect.value = dialect; }
    rectifiedOutput.textContent = result.correctedSql;
    explanationBox.textContent = result.explanation;
    whatChangedList.innerHTML = result.whatChanged.length ? result.whatChanged.map((c) => `<li>${escapeHtml(c)}</li>`).join('') : '<li>No changes were necessary.</li>';
    store.pushToast('info', 'Error analyzed — review the suggested correction before applying it.');
  });
  container.querySelector('#copySqlBtn')?.addEventListener('click', () => { copyTextToClipboard(rectifiedOutput.textContent || ''); store.pushToast('success', 'Corrected SQL copied to clipboard.'); });
  function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
}
