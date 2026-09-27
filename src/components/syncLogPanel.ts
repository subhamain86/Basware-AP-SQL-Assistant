import { icon } from './icons';
import { syncService } from '../services/syncService';
export function renderSyncLogPanel(container: HTMLElement): void {
  function draw(): void {
    const entries = syncService.getSyncLog();
    if (entries.length === 0) { container.innerHTML = `<div class="hint">No synchronization activity yet.</div>`; return; }
    container.innerHTML = `<div class="sync-log-list">${entries.map((e) => `<div class="sync-log-row sync-log-${e.kind}">${icon('folder-sync', 13)}<span class="sync-log-time">${new Date(e.timestamp).toLocaleTimeString()}</span><span class="sync-log-msg">${e.message}</span></div>`).join('')}</div>`;
  }
  const unsubscribe = syncService.subscribe(draw); draw();
  (container as any)._cleanup = () => unsubscribe();
}
