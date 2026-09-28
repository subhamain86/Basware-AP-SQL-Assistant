import { icon } from './icons';
import { syncService } from '../services/syncService';
export function renderSyncLogPanel(container: HTMLElement): void {
  function draw(): void {
    const entries = syncService.getSyncLog();
    if (entries.length === 0) { container.innerHTML = `<p class="hint">No synchronization activity yet.</p>`; return; }
    container.innerHTML = `<div class="sync-log-list">${entries.map((e) => { const iconName = e.kind === 'error' ? 'alert-triangle' : e.kind === 'push' ? 'upload' : e.kind === 'pull' ? 'download' : e.kind === 'suppressed' ? 'shield' : 'folder-sync'; return `<div class="sync-log-row ${e.kind === 'error' ? 'sync-log-error' : ''}">${icon(iconName as any, 13)}<span class="sync-log-time">${new Date(e.timestamp).toLocaleTimeString()}</span><span class="sync-log-msg">${e.message}</span></div>`; }).join('')}</div>`;
  }
  const unsubscribe = syncService.subscribe(draw); draw();
  (container as any)._cleanup = () => unsubscribe();
}
