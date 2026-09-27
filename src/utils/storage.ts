// ============================================================================
// storage.ts — NEW in V14.7. Root cause of the recurring
// "Failed to execute 'setItem' on 'Storage': ... exceeded the quota" error:
// this app stores its ENTIRE schema registry (every table/column of a
// real, large, Oracle-sourced production schema) as one JSON blob in
// localStorage, rewritten on every single change (schemaService.persist()).
// For a schema with hundreds of tables and thousands of columns, that
// blob alone can approach or exceed a browser's per-origin storage quota
// (commonly 5-10MB). Once that happens, ANY subsequent localStorage.setItem
// call anywhere in the app — even a small, unrelated one like the sync
// log — can throw a raw QuotaExceededError, which previously propagated
// uncaught and surfaced as a confusing low-level browser error instead of
// a clear, actionable message.
//
// safeSetItem() is a single, shared wrapper used by EVERY localStorage
// write in the app (registry, sync log, pending conflicts, sync config).
// It never throws: on quota failure it returns a structured result so the
// caller can decide how to respond (e.g. keep working in-memory for this
// session and surface a clear, specific message to the user) instead of
// crashing the current operation.
// ============================================================================
export interface SafeStorageResult { ok: boolean; error?: string; quotaExceeded?: boolean; }

function isQuotaExceededError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false;
  // Covers both the modern standard name and the older WebKit/Firefox names.
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
}

export function safeSetItem(key: string, value: string): SafeStorageResult {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (e) {
    if (isQuotaExceededError(e)) {
      return { ok: false, quotaExceeded: true, error: `Browser storage is full — could not save "${key}" locally. This data is still available in memory for this session, but will not persist after a page reload until space is freed (e.g. remove unused/inactive schemas, or clear old synchronization history).` };
    }
    return { ok: false, error: (e as Error)?.message || `Unknown error while saving "${key}" to local storage.` };
  }
}

/** Best-effort estimate of a string's size in bytes (UTF-16 code units,
 * close enough for trimming decisions — we don't need byte-perfect here). */
export function approxByteLength(s: string): number {
  return s.length * 2;
}
