import { schemaService } from './schemaService';
import { secretVaultService } from './secretVaultService';
import { syncService } from './syncService';
import { isInternalSyncInProgress } from './syncCoordination';
const PUSH_DEBOUNCE_MS = 1200;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let lastLockedWarningAt = 0;
type ToastFn = (kind: 'success' | 'error' | 'info' | 'warning', text: string) => void;
let toastFn: ToastFn = () => {};
export function setAutoSyncToastHandler(fn: ToastFn): void { toastFn = fn; }
function scheduleBackgroundPush(): void {
  if (isInternalSyncInProgress()) return;
  if (!secretVaultService.isUnlocked()) { const now = Date.now(); if (now - lastLockedWarningAt > 15000) { lastLockedWarningAt = now; toastFn('warning', 'Schema saved locally, but NOT synchronized — unlock Settings to publish it to other devices.'); } return; }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const result = await syncService.pushRegistryToGitHub('Automatic sync: schema catalogue updated');
    if (result.ok) toastFn('success', 'Schema changes synchronized automatically to the repository.');
    else if (result.requiresPullFirst) toastFn('warning', 'Automatic sync paused — use "Sync Now" to resolve.');
    else toastFn('error', `Automatic sync failed: ${result.error || 'unknown error'}.`);
  }, PUSH_DEBOUNCE_MS);
}
export async function performDiscovery(reason: string): Promise<void> {
  if (!secretVaultService.isUnlocked()) return;
  const result = await syncService.pullRegistryFromGitHub();
  if (result.ok) {
    if (result.newSchemasAdded.length) toastFn('success', `${result.newSchemasAdded.length} schema(s) synchronized: ${result.newSchemasAdded.join(', ')}.`);
    if (result.conflicts.length) toastFn('warning', `${result.conflicts.length} schema(s) have unresolved sync conflicts.`);
  }
}
export const performBackgroundPull = performDiscovery;
export async function performPublicDiscovery(reason: string): Promise<void> {
  const result = await syncService.discoverPublicRegistry(reason);
  if (result.ok) { if (result.newSchemasAdded.length) toastFn('success', `${result.newSchemasAdded.length} new schema(s) discovered: ${result.newSchemasAdded.join(', ')}.`); if (result.updatedSchemas.length) toastFn('info', `${result.updatedSchemas.length} schema(s) refreshed.`); }
}
export async function handleVaultUnlocked(): Promise<void> { await performDiscovery('vault-unlocked'); }
export function initAutoSync(): void { if (initialized) return; initialized = true; schemaService.subscribe(() => { scheduleBackgroundPush(); }); }
