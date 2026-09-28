import { icon } from './icons';
import { syncService } from '../services/syncService';
import { store } from '../state/store';
import type { PendingConflict } from '../types';
export function renderConflictBanner(container: HTMLElement, onResolved?: () => void): void {
  function draw(): void {
    const conflicts = syncService.getPendingConflicts();
    if (conflicts.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = `<div class="conflict-banner-wrap"><div class="conflict-banner-head">${icon('shield-alert', 16)} ${conflicts.length} unresolved synchronization conflict${conflicts.length > 1 ? 's' : ''}</div>${conflicts.map((c: PendingConflict) => `<div class="conflict-card"><div class="conflict-card-head">${icon('shield-alert', 15)} ${c.schemaName}</div><div class="hint">Local version: ${c.localVersion} · Remote version: ${c.remoteVersion} · Detected: ${new Date(c.detectedAt).toLocaleString()}</div><div class="hint">Changed: ${c.changedPaths.slice(0, 6).join(', ')}${c.changedPaths.length > 6 ? ` and ${c.changedPaths.length - 6} more…` : ''}</div><div class="row-actions"><button type="button" class="btn btn-outline btn-sm conflict-use-local" data-conflict-id="${c.id}">Use Local (keep my changes)</button><button type="button" class="btn btn-primary btn-sm conflict-use-remote" data-conflict-id="${c.id}">Use Remote (apply theirs)</button></div></div>`).join('')}</div>`;
    container.querySelectorAll<HTMLButtonElement>('.conflict-use-local').forEach((btn) => { btn.addEventListener('click', () => { syncService.resolvePendingConflict(btn.dataset.conflictId!, 'local'); store.pushToast('info', 'Kept the local version — the repository will be updated on the next sync.'); draw(); onResolved?.(); }); });
    container.querySelectorAll<HTMLButtonElement>('.conflict-use-remote').forEach((btn) => { btn.addEventListener('click', () => { syncService.resolvePendingConflict(btn.dataset.conflictId!, 'remote'); store.pushToast('success', 'Applied the remote version.'); draw(); onResolved?.(); }); });
  }
  const unsubscribe = syncService.subscribe(draw); draw();
  (container as any)._cleanup = () => unsubscribe();
}
