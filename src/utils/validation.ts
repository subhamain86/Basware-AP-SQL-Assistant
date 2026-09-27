export function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  return fallback;
}
export function safeTrim(value: unknown, fallback = ''): string {
  return safeString(value, fallback).trim();
}
export function safeUpperTrim(value: unknown, fallback = ''): string {
  return safeTrim(value, fallback).toUpperCase();
}
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
/** NEW (V15.1) — safe wrappers for operations that previously could throw
 * "Cannot read properties of undefined (reading 'trim'/'split'/...)" when
 * called on a value that turned out not to be a string/array at runtime
 * (e.g. malformed sync payloads, corrupted local storage). These are used
 * throughout the sync and password/vault code paths so a single malformed
 * value can never crash a whole operation with a raw JS exception. */
export function safeSplit(value: unknown, separator: string, fallback: string[] = []): string[] {
  if (typeof value !== 'string') return fallback;
  try { return value.split(separator); } catch { return fallback; }
}
export function safeArray<T = unknown>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}
export function safeMap<T, R>(arr: unknown, fn: (item: T, index: number) => R): R[] {
  if (!Array.isArray(arr)) return [];
  const out: R[] = [];
  for (let i = 0; i < arr.length; i++) { try { out.push(fn(arr[i] as T, i)); } catch { /* skip malformed entry */ } }
  return out;
}
export function safeJsonParse<T = unknown>(text: unknown): { ok: true; value: T } | { ok: false; error: string } {
  if (typeof text !== 'string') return { ok: false, error: 'Content is not a string.' };
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Content is empty.' };
  try { return { ok: true, value: JSON.parse(trimmed) as T }; } catch (e) { return { ok: false, error: (e as Error)?.message || 'Invalid JSON.' }; }
}
export interface NameValidationResult { valid: boolean; message?: string; }
export function validateSchemaName(rawName: unknown, existingNames: string[], excludeName?: string | null): NameValidationResult {
  const name = safeTrim(rawName);
  if (!name) return { valid: false, message: 'Schema name is required.' };
  if (name.length > 80) return { valid: false, message: 'Schema name must be 80 characters or fewer.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _\-.]*$/.test(name)) return { valid: false, message: 'Schema name may only contain letters, digits, spaces, underscores, hyphens, and periods, and must start with a letter or digit.' };
  const normalizedExisting = safeArray<string>(existingNames).map((n) => safeTrim(n).toLowerCase());
  const excludeNormalized = excludeName ? safeTrim(excludeName).toLowerCase() : null;
  const clash = normalizedExisting.some((n) => n === name.toLowerCase() && n !== excludeNormalized);
  if (clash) return { valid: false, message: `A schema named "${name}" already exists — schema names must be unique.` };
  return { valid: true };
}
export interface SyncConfigCheckField { key: string; label: string; value: unknown; required: boolean; sensitive?: boolean; }
export interface SyncConfigCheckResult { ok: boolean; missingFields: string[]; message: string | null; }
export function assertSyncConfigOrError(fields: SyncConfigCheckField[]): SyncConfigCheckResult {
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    if (!isNonEmptyString(f.value)) missing.push(f.label);
  }
  if (missing.length === 0) return { ok: true, missingFields: [], message: null };
  const message = `Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: ${missing.join(', ')}.`;
  return { ok: false, missingFields: missing, message };
}
export function sanitizeIncomingSchema(raw: unknown): any {
  if (!raw || typeof raw !== 'object') return raw;
  const schema = raw as Record<string, unknown>;
  const tables = safeArray(schema.tables);
  const sanitizedTables = safeMap(tables, (rawTable: unknown) => {
    const t = (rawTable && typeof rawTable === 'object') ? (rawTable as Record<string, unknown>) : {};
    const columns = safeArray(t.columns);
    const sanitizedColumns = safeMap(columns, (rawCol: unknown) => {
      const c = (rawCol && typeof rawCol === 'object') ? (rawCol as Record<string, unknown>) : {};
      const decode = Array.isArray(c.decode) ? c.decode : undefined;
      const sanitizedDecode = decode ? safeMap(decode, (rawD: unknown) => {
        const d = (rawD && typeof rawD === 'object') ? (rawD as Record<string, unknown>) : {};
        return { rawValue: safeString(d.rawValue, ''), label: safeString(d.label, '') };
      }) : undefined;
      const rawRefs = (c.references && typeof c.references === 'object') ? (c.references as Record<string, unknown>) : null;
      return {
        ...c,
        name: safeString(c.name, ''),
        label: safeString(c.label, safeString(c.name, '')),
        description: safeString(c.description, ''),
        type: safeString(c.type, 'VARCHAR'),
        references: rawRefs ? { table: safeString(rawRefs.table, ''), column: safeString(rawRefs.column, '') } : c.references,
        decode: sanitizedDecode
      };
    });
    return {
      ...t,
      name: safeString(t.name, ''),
      module: safeString(t.module, 'General'),
      description: safeString(t.description, ''),
      columns: sanitizedColumns
    };
  });
  return { ...schema, tables: sanitizedTables };
}
export interface SafeSetItemResult { ok: boolean; recovered: boolean; attemptsUsed: number; error?: string; }
export function safeLocalStorageSet(key: string, value: string | (() => string), onQuotaExceeded?: (attempt: number) => void, maxAttempts = 4): SafeSetItemResult {
  const getValue = () => (typeof value === 'function' ? value() : value);
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      localStorage.setItem(key, getValue());
      return { ok: true, recovered: attempt > 0, attemptsUsed: attempt + 1 };
    } catch (e) {
      lastError = e;
      const isQuota = isQuotaExceededError(e);
      if (!isQuota || !onQuotaExceeded || attempt === maxAttempts) {
        return { ok: false, recovered: false, attemptsUsed: attempt + 1, error: describeStorageError(e) };
      }
      onQuotaExceeded(attempt);
    }
  }
  return { ok: false, recovered: false, attemptsUsed: maxAttempts + 1, error: describeStorageError(lastError) };
}
export function isQuotaExceededError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: string; code?: number };
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014;
}
export function describeStorageError(e: unknown): string {
  if (isQuotaExceededError(e)) return 'Browser storage quota exceeded — the local schema cache is too large for this browser to store.';
  return (e as Error)?.message || 'Unknown local storage error.';
}
export function estimateStringBytes(s: string): number {
  try { return new TextEncoder().encode(s).length; } catch { return s.length; }
}
