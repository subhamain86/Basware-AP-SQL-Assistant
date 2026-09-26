import { trapFocus } from '../utils/dom';
export interface ModalHandle { close: () => void; element: HTMLDivElement; }
export function openModal(titleHtml: string, bodyHtml: string, opts: { closeOnBackdrop?: boolean; wide?: boolean } = {}): ModalHandle {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card ${opts.wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-header"><div class="modal-title">${titleHtml}</div><button type="button" class="icon-btn modal-close-btn" aria-label="Close">×</button></div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  const card = backdrop.querySelector<HTMLDivElement>('.modal-card')!;
  const untrap = trapFocus(card);
  function close(): void { untrap(); document.body.style.overflow = ''; backdrop.remove(); document.removeEventListener('keydown', onKeyDown); }
  function onKeyDown(e: KeyboardEvent): void { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKeyDown);
  backdrop.querySelector('.modal-close-btn')?.addEventListener('click', close);
  if (opts.closeOnBackdrop !== false) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  requestAnimationFrame(() => { const first = card.querySelector<HTMLElement>('input, select, textarea, button'); first?.focus(); });
  return { close, element: backdrop };
}
