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
/** V15.7 — this debounced BACKGROUND push remains as a general-purpose
 * safety-net/catch-all for any schema mutation (import, rename, activate,
 * etc.), exactly as in V15.6. It is intentionally NOT the primary
 * mechanism Manual Schema Update relies on anymore for its own
 * success/failure reporting — see schemaEditorSection.ts, which now
 * explicitly awaits its own dedicated `syncService.pushRegistryToGitHub()`
 * call as an integral part of the Save action itself. Keeping this
 * background debounce also active means that even if a future direct-push
 * attempt from another screen were skipped, the existing auto-sync
 * mechanism still retries/covers it — satisfying "allow the existing
 * synchronization mechanism to retry/recover according to the current
 * project design." */
function scheduleBackgroundPush(): void {
  if (isInternalSyncInProgress()) return;
  if (!secretVaultService.isUnlocked()) {
    const now = Date.now();
    if (now - lastLockedWarningAt > 15000) {
      lastLockedWarningAt = now;
      toastFn('warning', 'Schema saved locally, but NOT synchronized — unlock Settings (Admin Password) on this device to publish it to other devices.');
    }
    return;
  }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const result = await syncService.pushRegistryToGitHub('Automatic sync: schema catalogue updated');
    if (result.ok) toastFn('success', 'Schema changes synchronized automatically to the repository.');
    else if (result.requiresPullFirst) toastFn('warning', 'Automatic sync paused — a newer version exists remotely. Use "Sync Now" to resolve.');
    else toastFn('error', `Automatic sync failed: ${result.error || 'unknown error'}.`);
  }, PUSH_DEBOUNCE_MS);
}
function announceActiveSchemaOutcome(result: { activeSchemaOutcome?: string; appliedActiveSchemaName?: string }): void {
  if (result.activeSchemaOutcome === 'applied' && result.appliedActiveSchemaName) {
    toastFn('info', `Active Schema updated to match another device's selection: "${result.appliedActiveSchemaName}".`);
  } else if (result.activeSchemaOutcome === 'not-found') {
    toastFn('warning', 'The previously selected Active Schema is no longer available. Please select another schema.');
  }
}
export async function performDiscovery(reason: string): Promise<void> {
  if (!secretVaultService.isUnlocked()) return;
  const result = await syncService.pullRegistryFromGitHub();
  if (result.ok) {
    if (result.newSchemasAdded.length) toastFn('success', `${result.newSchemasAdded.length} schema(s) synchronized from the repository: ${result.newSchemasAdded.join(', ')}.`);
    if (result.updatedSchemas.length) toastFn('info', `${result.updatedSchemas.length} schema(s) updated from a newer copy on the repository: ${result.updatedSchemas.join(', ')}.`);
    if (result.conflicts.length) toastFn('warning', `${result.conflicts.length} schema(s) have unresolved sync conflicts — review them in Schema or Settings.`);
    announceActiveSchemaOutcome(result);
  } else if (result.error) {
    toastFn('error', result.error);
  }
}
export const performBackgroundPull = performDiscovery;
export async function performPublicDiscovery(reason: string): Promise<void> {
  const result = await syncService.discoverPublicRegistry(reason);
  if (result.ok) {
    if (result.newSchemasAdded.length) toastFn('success', `${result.newSchemasAdded.length} new schema(s) discovered and synchronized from the repository: ${result.newSchemasAdded.join(', ')}.`);
    if (result.updatedSchemas.length) toastFn('info', `${result.updatedSchemas.length} schema(s) refreshed from a newer copy on the repository: ${result.updatedSchemas.join(', ')}.`);
    announceActiveSchemaOutcome(result);
  }
}
export async function handleVaultUnlocked(): Promise<void> { await performDiscovery('vault-unlocked'); }
export function initAutoSync(): void { if (initialized) return; initialized = true; schemaService.subscribe(() => { scheduleBackgroundPush(); }); }
