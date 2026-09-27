import { icon } from './icons.js';
import { syncService } from '../services/syncService.js';
import { store } from '../state/store.js';
export function renderConflictBanner(container, onResolved) {
    function draw() {
        const conflicts = syncService.getPendingConflicts();
        if (conflicts.length === 0) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = `<div class="conflict-banner-wrap"><div class="conflict-banner-head">${icon('shield-alert', 16)} ${conflicts.length} unresolved synchronization conflict${conflicts.length > 1 ? 's' : ''}</div>${conflicts.map((c) => `<div class="conflict-card" data-id="${c.id}"><div class="conflict-card-head">${icon('shield-alert', 15)} <strong>${c.schemaName}</strong></div><div class="hint">Local version: ${c.localVersion} · Remote version: ${c.remoteVersion} · Detected: ${new Date(c.detectedAt).toLocaleString()}</div><div class="hint">Changed: ${c.changedPaths.slice(0, 6).join(', ')}${c.changedPaths.length > 6 ? ` and ${c.changedPaths.length - 6} more…` : ''}</div><div class="row-actions"><button type="button" class="btn btn-outline btn-sm conflict-use-local" data-conflict-id="${c.id}">Use Local (keep my changes)</button><button type="button" class="btn btn-primary btn-sm conflict-use-remote" data-conflict-id="${c.id}">Use Remote (apply theirs)</button></div></div>`).join('')}</div>`;
        container.querySelectorAll('.conflict-use-local').forEach((btn) => { btn.addEventListener('click', () => { syncService.resolvePendingConflict(btn.dataset.conflictId, 'local'); store.pushToast('info', 'Kept the local version — the repository will be updated on the next sync.'); draw(); onResolved?.(); }); });
        container.querySelectorAll('.conflict-use-remote').forEach((btn) => { btn.addEventListener('click', () => { syncService.resolvePendingConflict(btn.dataset.conflictId, 'remote'); store.pushToast('success', 'Applied the remote version.'); draw(); onResolved?.(); }); });
    }
    const unsubscribe = syncService.subscribe(draw);
    draw();
    container._cleanup = () => unsubscribe();
}
