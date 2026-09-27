export function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  return fallback;
}
export function safeTrim(value: unknown, fallback = ''): string {
  return safeString(value, fallback).trim();
}
/** Common composite used throughout schema validation: trim + uppercase,
 * safe against any non-string input (undefined, null, number, object). */
export function safeUpperTrim(value: unknown, fallback = ''): string {
  return safeTrim(value, fallback).toUpperCase();
}
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
export interface NameValidationResult { valid: boolean; message?: string; }
export function validateSchemaName(rawName: unknown, existingNames: string[], excludeName?: string | null): NameValidationResult {
  const name = safeTrim(rawName);
  if (!name) return { valid: false, message: 'Schema name is required.' };
  if (name.length > 80) return { valid: false, message: 'Schema name must be 80 characters or fewer.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _\-.]*$/.test(name)) return { valid: false, message: 'Schema name may only contain letters, digits, spaces, underscores, hyphens, and periods, and must start with a letter or digit.' };
  const normalizedExisting = existingNames.map((n) => safeTrim(n).toLowerCase());
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

// ============================================================================
// sanitizeIncomingSchema — V14.6 (the deep, "belt-and-suspenders" fix for
// the REAL undefined.trim() crash site: schema validation). Applied to
// EVERY schema the moment it enters the system from an untrusted/external
// source: user-uploaded JSON import, and every schema object pulled from
// the shared repository during synchronization. Guarantees every
// string field that validation/SQL-generation code touches with .trim()
// is ALWAYS a real string afterward — never undefined/null/number —
// regardless of what the raw JSON actually contained.
// ============================================================================
export function sanitizeIncomingSchema(raw: unknown): any {
  if (!raw || typeof raw !== 'object') return raw;
  const schema = raw as Record<string, unknown>;
  const tables = Array.isArray(schema.tables) ? schema.tables : [];
  const sanitizedTables = tables.map((rawTable: unknown) => {
    const t = (rawTable && typeof rawTable === 'object') ? (rawTable as Record<string, unknown>) : {};
    const columns = Array.isArray(t.columns) ? t.columns : [];
    const sanitizedColumns = columns.map((rawCol: unknown) => {
      const c = (rawCol && typeof rawCol === 'object') ? (rawCol as Record<string, unknown>) : {};
      const decode = Array.isArray(c.decode) ? c.decode : undefined;
      const sanitizedDecode = decode ? decode.map((rawD: unknown) => {
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
