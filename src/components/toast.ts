import { store } from '../state/store';
import { icon } from './icons';
export function mountToastContainer(root: HTMLElement): void {
  const container = document.createElement('div'); container.className = 'toast-container'; root.appendChild(container);
  function render(): void {
    container.innerHTML = store.toasts.map((t) => {
      const iconName = t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert-triangle' : t.kind === 'warning' ? 'alert-triangle' : 'info';
      return `<div class="toast toast-${t.kind}">${icon(iconName as any, 16)}<span>${t.text}</span></div>`;
    }).join('');
  }
  store.subscribe(render); render();
}
