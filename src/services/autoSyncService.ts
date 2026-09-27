import { schemaService } from './schemaService';
import { secretVaultService } from './secretVaultService';
import { syncService } from './syncService';

const PUSH_DEBOUNCE_MS = 1200;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let suppressNextAutoPush = false;

type ToastFn = (kind: 'success' | 'error' | 'info' | 'warning', text: string) => void;
let toastFn: ToastFn = () => {};

export function setAutoSyncToastHandler(fn: ToastFn): void { toastFn = fn; }

function scheduleBackgroundPush(): void {
  if (!secretVaultService.isUnlocked()) return;
  if (suppressNextAutoPush) { suppressNextAutoPush = false; return; }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const result = await syncService.pushRegistryToGitHub('Automatic sync: schema catalogue updated');
    if (result.ok) toastFn('success', 'Schema changes synchronized automatically to the repository.');
    else if (result.requiresPullFirst) toastFn('warning', 'Automatic sync paused — a newer version exists remotely. Use "Sync Now" to resolve.');
  }, PUSH_DEBOUNCE_MS);
}

export async function performDiscovery(reason: string): Promise<void> {
  if (!secretVaultService.isUnlocked()) return;
  suppressNextAutoPush = true;
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
