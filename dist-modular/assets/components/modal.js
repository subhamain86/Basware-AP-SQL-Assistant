import { trapFocus } from '../utils/dom.js';
export function openModal(titleHtml, bodyHtml, opts = {}) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal-card${opts.wide ? ' modal-wide' : ''}"><div class="modal-header"><div class="modal-title">${titleHtml}</div><button class="modal-close-btn" type="button" aria-label="Close">&times;</button></div><div class="modal-body">${bodyHtml}</div></div>`;
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    const card = backdrop.querySelector('.modal-card');
    const untrap = trapFocus(card);
    function close() { untrap(); document.body.style.overflow = ''; backdrop.remove(); document.removeEventListener('keydown', onKeyDown); }
    function onKeyDown(e) { if (e.key === 'Escape')
        close(); }
    document.addEventListener('keydown', onKeyDown);
    backdrop.querySelector('.modal-close-btn')?.addEventListener('click', close);
    if (opts.closeOnBackdrop !== false)
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop)
            close(); });
    requestAnimationFrame(() => { const first = card.querySelector('input, select, textarea, button'); first?.focus(); });
    return { close, element: backdrop };
}
