// ============================================================================
// syncCoordination.ts — THE fix (carried forward from V14.6) for the
// infinite sync loop bug: previously, syncService.pushRegistryToGitHub()
// called schemaService.markAllSynced() after a successful push (to stamp
// "last synced" timestamps) — but markAllSynced() is itself a schema
// mutation that calls persist() -> notify(), and autoSyncService had
// unconditionally subscribed to EVERY schemaService notification to
// schedule an automatic push. This created a genuine, unbounded feedback
// loop. This tiny, dependency-free module provides a simple "is a sync
// operation we ourselves initiated currently in flight" flag.
// ============================================================================
let internalSyncDepth = 0;
export function beginInternalSync(): void {
  internalSyncDepth += 1;
}
export function endInternalSync(): void {
  internalSyncDepth = Math.max(0, internalSyncDepth - 1);
}
export function isInternalSyncInProgress(): boolean {
  return internalSyncDepth > 0;
}
