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

/** V14.7 — this is the schemaService.subscribe() callback. THE
 * infinite-loop fix hinges on the very first line: if the mutation that
 * just happened was caused by our own in-flight sync operation (pull,
 * push, or conflict resolution — all wrapped in beginInternalSync/
 * endInternalSync inside syncService.ts), we return immediately without
 * scheduling anything. Only a GENUINE local user edit (adding a table,
 * editing a row, importing a schema, renaming a schema, etc. — none of
 * which ever call beginInternalSync) reaches the scheduling logic below.
 *
 * V14.7 ALSO fixes silent, unexplained sync failures: previously, if the
 * Secret Vault was locked, this function just silently returned with NO
 * user feedback at all — a user could import/edit a schema, see it work
 * locally, and have no idea it was never actually synchronized anywhere,
 * until (much later) they discovered another device didn't have it. Now
 * we surface a clear, rate-limited toast explaining exactly why automatic
 * sync did not happen and what to do about it. */
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

export async function performDiscovery(reason: string): Promise<void> {
  if (!secretVaultService.isUnlocked()) return;
  const result = await syncService.pullRegistryFromGitHub();
  if (result.ok) {
    if (result.newSchemasAdded.length) toastFn('success', `${result.newSchemasAdded.length} schema(s) synchronized from the repository: ${result.newSchemasAdded.join(', ')}.`);
    if (result.updatedSchemas.length) toastFn('info', `${result.updatedSchemas.length} schema(s) updated from a newer copy on the repository: ${result.updatedSchemas.join(', ')}.`);
    if (result.conflicts.length) toastFn('warning', `${result.conflicts.length} schema(s) have unresolved sync conflicts — review them in Schema or Settings.`);
  }
}
export const performBackgroundPull = performDiscovery;

/** V14.7 — NEW. Performs a read-only, unauthenticated discovery pull
 * against the public repository regardless of whether the Secret Vault is
 * unlocked on this device. This is what makes a schema uploaded on Device A
 * actually show up on Device B without anyone needing to unlock Settings
 * there first — closing the gap that caused "other device is not getting
 * the uploaded schema synced". Safe to call frequently: it only ever ADDS
 * or updates schemas that are missing/stale locally; it never pushes
 * anything and never requires credentials. */
export async function performPublicDiscovery(reason: string): Promise<void> {
  const result = await syncService.discoverPublicRegistry(reason);
  if (result.ok) {
    if (result.newSchemasAdded.length) toastFn('success', `${result.newSchemasAdded.length} new schema(s) discovered and synchronized from the repository: ${result.newSchemasAdded.join(', ')}.`);
    if (result.updatedSchemas.length) toastFn('info', `${result.updatedSchemas.length} schema(s) refreshed from a newer copy on the repository: ${result.updatedSchemas.join(', ')}.`);
  }
}

export async function handleVaultUnlocked(): Promise<void> {
  await performDiscovery('vault-unlocked');
}

export function initAutoSync(): void {
  if (initialized) return;
  initialized = true;
  schemaService.subscribe(() => { scheduleBackgroundPush(); });
}
