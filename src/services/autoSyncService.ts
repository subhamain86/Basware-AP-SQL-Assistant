import { schemaService } from './schemaService';
import { secretVaultService } from './secretVaultService';
import { syncService } from './syncService';
import { isInternalSyncInProgress } from './syncCoordination';

const PUSH_DEBOUNCE_MS = 1200;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

type ToastFn = (kind: 'success' | 'error' | 'info' | 'warning', text: string) => void;
let toastFn: ToastFn = () => {};

export function setAutoSyncToastHandler(fn: ToastFn): void { toastFn = fn; }

/** V14.6 — this is the schemaService.subscribe() callback. THE
 * infinite-loop fix hinges on the very first line: if the mutation that
 * just happened was caused by our own in-flight sync operation (pull,
 * push, or conflict resolution — all wrapped in beginInternalSync/
 * endInternalSync inside syncService.ts), we return immediately without
 * scheduling anything. Only a GENUINE local user edit (adding a table,
 * editing a row, importing a schema, renaming a schema, etc. — none of
 * which ever call beginInternalSync) reaches the scheduling logic below. */
function scheduleBackgroundPush(): void {
  if (isInternalSyncInProgress()) return;
  if (!secretVaultService.isUnlocked()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const result = await syncService.pushRegistryToGitHub('Automatic sync: schema catalogue updated');
    if (result.ok) toastFn('success', 'Schema changes synchronized automatically to the repository.');
    else if (result.requiresPullFirst) toastFn('warning', 'Automatic sync paused — a newer version exists remotely. Use "Sync Now" to resolve.');
  }, PUSH_DEBOUNCE_MS);
}

export async function performDiscovery(reason: string): Promise<void> {
  if (!secretVaultService.isUnlocked()) return;
  // Note: syncService.pullRegistryFromGitHub() itself now calls
  // beginInternalSync()/endInternalSync() internally, so no extra
  // suppression bookkeeping is needed here anymore (V14.5's
  // `suppressNextAutoPush = true` line before this call has been
  // removed — it's now handled correctly and completely inside
  // syncService.ts for every mutation the pull causes, not just the
  // first one).
  const result = await syncService.pullRegistryFromGitHub();
  if (result.ok) {
    if (result.newSchemasAdded.length) toastFn('success', `${result.newSchemasAdded.length} schema(s) synchronized from the repository: ${result.newSchemasAdded.join(', ')}.`);
    if (result.conflicts.length) toastFn('warning', `${result.conflicts.length} schema(s) have unresolved sync conflicts — review them in Schema or Settings.`);
  }
}

export const performBackgroundPull = performDiscovery;

export async function handleVaultUnlocked(): Promise<void> {
  await performDiscovery('vault-unlocked');
}

export function initAutoSync(): void {
  if (initialized) return;
  initialized = true;
  schemaService.subscribe(() => { scheduleBackgroundPush(); });
}
