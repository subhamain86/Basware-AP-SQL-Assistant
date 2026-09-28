let internalSyncDepth = 0;
export function beginInternalSync(): void { internalSyncDepth += 1; }
export function endInternalSync(): void { internalSyncDepth = Math.max(0, internalSyncDepth - 1); }
export function isInternalSyncInProgress(): boolean { return internalSyncDepth > 0; }
