import { icon } from './icons.js';
import { syncService } from '../services/syncService.js';
export function renderSyncLogPanel(container) {
    function draw() {
        const entries = syncService.getSyncLog();
        if (entries.length === 0) {
            container.innerHTML = `<div class="hint">No synchronization activity yet.</div>`;
            return;
        }
        container.innerHTML = `<div class="sync-log-list">${entries.map((e) => { const iconName = e.kind === 'error' ? 'alert-triangle' : e.kind === 'push' ? 'upload' : e.kind === 'pull' ? 'download' : e.kind === 'suppressed' ? 'shield' : 'folder-sync'; return `<div class="sync-log-row sync-log-${e.kind}">${icon(iconName, 13)}<span class="sync-log-time">${new Date(e.timestamp).toLocaleTimeString()}</span><span class="sync-log-msg">${e.message}</span></div>`; }).join('')}</div>`;
    }
    const unsubscribe = syncService.subscribe(draw);
    draw();
    container._cleanup = () => unsubscribe();
}
