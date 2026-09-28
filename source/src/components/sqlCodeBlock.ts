import { escapeHtml } from '../utils/dom';
import { icon } from './icons';
export interface SqlCodeBlockHandlers { onCopy?: () => void; onClear?: () => void; onValidate?: () => void; onRegenerate?: () => void; onOptimize?: () => void; onExplain?: () => void; }
export function renderSqlCodeBlock(container: HTMLElement, sql: string, handlers: SqlCodeBlockHandlers, extraButtons: { id: string; label: string; iconName: Parameters<typeof icon>[0]; onClick: () => void }[] = []): void {
  container.innerHTML = `<pre class="sql-output">${escapeHtml(sql)}</pre>
    <div class="row-actions wrap">
      ${handlers.onCopy ? `<button type="button" class="btn btn-outline btn-sm" id="btnCopySql">${icon('copy', 14)} Copy SQL</button>` : ''}
      ${handlers.onClear ? `<button type="button" class="btn btn-outline btn-sm" id="btnClearSql">${icon('x', 14)} Clear</button>` : ''}
      ${handlers.onValidate ? `<button type="button" class="btn btn-outline btn-sm" id="btnValidateSql">${icon('clipboard-check', 14)} Validate</button>` : ''}
      ${handlers.onRegenerate ? `<button type="button" class="btn btn-outline btn-sm" id="btnRegenSql">${icon('refresh', 14)} Regenerate</button>` : ''}
      ${handlers.onOptimize ? `<button type="button" class="btn btn-outline btn-sm" id="btnOptimizeSql">${icon('wand', 14)} Optimize</button>` : ''}
      ${handlers.onExplain ? `<button type="button" class="btn btn-outline btn-sm" id="btnExplainSql">${icon('brain', 14)} Explain Query</button>` : ''}
      ${extraButtons.map((b) => `<button type="button" class="btn btn-outline btn-sm" id="${b.id}">${icon(b.iconName, 14)} ${b.label}</button>`).join('')}
    </div>
    <div id="validationMount"></div>
    <div id="optimizeMount"></div>
    <div id="explainMount"></div>`;
  if (handlers.onCopy) container.querySelector('#btnCopySql')?.addEventListener('click', handlers.onCopy);
  if (handlers.onClear) container.querySelector('#btnClearSql')?.addEventListener('click', handlers.onClear);
  if (handlers.onValidate) container.querySelector('#btnValidateSql')?.addEventListener('click', handlers.onValidate);
  if (handlers.onRegenerate) container.querySelector('#btnRegenSql')?.addEventListener('click', handlers.onRegenerate);
  if (handlers.onOptimize) container.querySelector('#btnOptimizeSql')?.addEventListener('click', handlers.onOptimize);
  if (handlers.onExplain) container.querySelector('#btnExplainSql')?.addEventListener('click', handlers.onExplain);
  extraButtons.forEach((b) => container.querySelector(`#${b.id}`)?.addEventListener('click', b.onClick));
}
export function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  fallbackCopy(text); return Promise.resolve();
}
function fallbackCopy(text: string): void { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.focus(); ta.select(); try { document.execCommand('copy'); } catch { } ta.remove(); }
