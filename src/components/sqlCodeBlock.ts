import { escapeHtml } from '../utils/dom';
import { icon } from './icons';
export interface SqlCodeBlockHandlers { onCopy?: () => void; onClear?: () => void; onValidate?: () => void; onRegenerate?: () => void; onOptimize?: () => void; }
export function renderSqlCodeBlock(container: HTMLElement, sql: string, handlers: SqlCodeBlockHandlers, extraButtons: { id: string; label: string; iconName: Parameters<typeof icon>[0]; onClick: () => void }[] = []): void {
  container.innerHTML = `<pre class="sql-output">${escapeHtml(sql)}</pre><div class="row-actions wrap">${handlers.onCopy ? `<button id="btnCopySql" class="btn btn-outline btn-sm" type="button">${icon('copy', 14)} Copy SQL</button>` : ''}${handlers.onClear ? `<button id="btnClearSql" class="btn btn-ghost btn-sm" type="button">${icon('x', 14)} Clear</button>` : ''}${handlers.onValidate ? `<button id="btnValidateSql" class="btn btn-ghost btn-sm" type="button">${icon('clipboard-check', 14)} Validate</button>` : ''}${handlers.onRegenerate ? `<button id="btnRegenSql" class="btn btn-ghost btn-sm" type="button">${icon('refresh', 14)} Regenerate</button>` : ''}${handlers.onOptimize ? `<button id="btnOptimizeSql" class="btn btn-ghost btn-sm" type="button">${icon('wand', 14)} Optimize</button>` : ''}${extraButtons.map((b) => `<button id="${b.id}" class="btn btn-ghost btn-sm" type="button">${icon(b.iconName, 14)} ${b.label}</button>`).join('')}</div><div id="validationMount"></div><div id="optimizeMount"></div>`;
  if (handlers.onCopy) container.querySelector('#btnCopySql')?.addEventListener('click', handlers.onCopy);
  if (handlers.onClear) container.querySelector('#btnClearSql')?.addEventListener('click', handlers.onClear);
  if (handlers.onValidate) container.querySelector('#btnValidateSql')?.addEventListener('click', handlers.onValidate);
  if (handlers.onRegenerate) container.querySelector('#btnRegenSql')?.addEventListener('click', handlers.onRegenerate);
  if (handlers.onOptimize) container.querySelector('#btnOptimizeSql')?.addEventListener('click', handlers.onOptimize);
  extraButtons.forEach((b) => container.querySelector(`#${b.id}`)?.addEventListener('click', b.onClick));
}
export function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  fallbackCopy(text); return Promise.resolve();
}
function fallbackCopy(text: string): void { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.focus(); ta.select(); try { document.execCommand('copy'); } catch { } ta.remove(); }
