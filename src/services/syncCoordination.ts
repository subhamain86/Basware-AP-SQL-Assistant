// ============================================================================
// syncCoordination.ts — NEW in V14.6. THE fix for the infinite sync loop
// bug: previously, syncService.pushRegistryToGitHub() called
// schemaService.markAllSynced() after a successful push (to stamp
// "last synced" timestamps) — but markAllSynced() is itself a schema
// mutation that calls persist() -> notify(), and autoSyncService had
// unconditionally subscribed to EVERY schemaService notification to
// schedule an automatic push. This created a genuine, unbounded feedback
// loop: push -> markAllSynced -> notify -> schedule another push (after
// ~1.2s debounce) -> push -> markAllSynced -> notify -> ... forever,
// completely ignoring the "Sync Time" setting and firing continuously
// every 1-2 seconds regardless of whether the user made any changes.
//
// This tiny, dependency-free module (imported by BOTH syncService.ts and
// autoSyncService.ts, with neither importing the other, avoiding any
// circular-import risk) provides a simple "is a sync operation we
// ourselves initiated currently in flight" flag. Any schema mutation that
// happens WHILE a sync operation we started is running (markAllSynced,
// addSchemaFromRemote, replaceSchemaContent) is correctly recognized as
// "caused by our own sync code, not a new user edit" and does NOT
// trigger another automatic push — breaking the loop completely,
// regardless of how many mutations happen during a single sync pass.
//
// Deliberately a simple boolean flag rather than a "consume once" token:
// a single pull/push operation can trigger MANY schema mutations (e.g.
// pulling 5 new schemas = 5 calls to addSchemaFromRemote, each of which
// notifies). A "consume once" flag would only suppress the FIRST of
// those and let the remaining 4 through, still causing spurious
// auto-pushes. A boolean that stays true for the ENTIRE duration of the
// sync operation (set at the start, cleared in a finally block) correctly
// suppresses ALL of them.
// ============================================================================

let internalSyncDepth = 0;

/** Call at the START of any syncService operation (pull or push) that is
 * about to mutate schemaService on its own behalf. Supports nested calls
 * safely via a depth counter (e.g. if a future code path calls one sync
 * operation from within another). */
export function beginInternalSync(): void {
  internalSyncDepth += 1;
}

/** Call in a `finally` block matching every beginInternalSync() call. */
export function endInternalSync(): void {
  internalSyncDepth = Math.max(0, internalSyncDepth - 1);
}

/** Checked by autoSyncService's schemaService.subscribe() callback before
 * scheduling an automatic push. If true, the notification was caused by
 * our OWN sync code (not a genuine new user edit), so no new push should
 * be scheduled — this is what breaks the infinite loop. */
export function isInternalSyncInProgress(): boolean {
  return internalSyncDepth > 0;
}
