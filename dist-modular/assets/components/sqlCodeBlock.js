import { escapeHtml } from '../utils/dom.js';
import { icon } from './icons.js';
export function renderSqlCodeBlock(container, sql, handlers, extraButtons = []) {
    container.innerHTML = `<pre class="sql-output">${escapeHtml(sql)}</pre><div class="row-actions wrap">${handlers.onCopy ? `<button class="btn btn-outline btn-sm" id="btnCopySql" type="button">${icon('copy', 14)} Copy SQL</button>` : ''}${handlers.onClear ? `<button class="btn btn-ghost btn-sm" id="btnClearSql" type="button">${icon('x', 14)} Clear</button>` : ''}${handlers.onValidate ? `<button class="btn btn-outline btn-sm" id="btnValidateSql" type="button">${icon('clipboard-check', 14)} Validate</button>` : ''}${handlers.onRegenerate ? `<button class="btn btn-outline btn-sm" id="btnRegenSql" type="button">${icon('refresh', 14)} Regenerate</button>` : ''}${handlers.onOptimize ? `<button class="btn btn-outline btn-sm" id="btnOptimizeSql" type="button">${icon('wand', 14)} Optimize</button>` : ''}${extraButtons.map((b) => `<button class="btn btn-outline btn-sm" id="${b.id}" type="button">${icon(b.iconName, 14)} ${b.label}</button>`).join('')}</div><div id="validationMount"></div><div id="optimizeMount"></div>`;
    if (handlers.onCopy)
        container.querySelector('#btnCopySql')?.addEventListener('click', handlers.onCopy);
    if (handlers.onClear)
        container.querySelector('#btnClearSql')?.addEventListener('click', handlers.onClear);
    if (handlers.onValidate)
        container.querySelector('#btnValidateSql')?.addEventListener('click', handlers.onValidate);
    if (handlers.onRegenerate)
        container.querySelector('#btnRegenSql')?.addEventListener('click', handlers.onRegenerate);
    if (handlers.onOptimize)
        container.querySelector('#btnOptimizeSql')?.addEventListener('click', handlers.onOptimize);
    extraButtons.forEach((b) => container.querySelector(`#${b.id}`)?.addEventListener('click', b.onClick));
}
export function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText)
        return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    fallbackCopy(text);
    return Promise.resolve();
}
function fallbackCopy(text) { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.focus(); ta.select(); try {
    document.execCommand('copy');
}
catch { } ta.remove(); }
