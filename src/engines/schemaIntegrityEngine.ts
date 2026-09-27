import type { SchemaModel, TableDef, ColumnDef, SchemaIntegrityResult, SchemaIntegrityIssue, SchemaRegistry, SyncErrorCode } from '../types';
import { VALID_DATA_TYPES } from '../types';
import { safeTrim, safeUpperTrim, safeArray, safeMap, sanitizeIncomingSchema } from '../utils/validation';

// ============================================================================
// V15.1 FIX #1 — "Remote schema file failed validation"
//
// ROOT CAUSE IDENTIFIED: the previous validator (a) ran on the RAW,
// un-sanitized payload BEFORE sanitizeIncomingSchema() had a chance to fill
// in safe defaults for missing/legacy optional fields, and (b) treated
// structural nitpicks that are common in real, legitimate schemas —
// mismatched FK targets, missing PK, duplicate DECODE raw values, negative
// length/precision — as hard `error` severity. A SINGLE such issue on a
// SINGLE schema anywhere in the registry caused the ENTIRE registry
// (i.e. every schema, from every device) to be rejected with the generic
// "Remote schema file failed validation" message.
//
// This is fixed by:
//  1. Sanitizing every incoming schema BEFORE structural validation runs,
//     so legacy/optional gaps are already patched with safe values.
//  2. Downgrading non-fatal structural mismatches to warnings that are
//     logged for diagnostics but never block loading.
//  3. Validating and loading each schema in a registry INDEPENDENTLY —
//     one malformed schema is skipped (and reported internally), while
//     every other valid schema in the same registry still loads normally.
//  4. Only rejecting a schema outright if it is genuinely unusable: not an
//     object, or missing a `tables` array entirely (even after
//     sanitization, which cannot invent an array from a non-array), or
//     having no resolvable name after sanitization.
// ============================================================================

/** Structural checks retained for the interactive Manual Schema Editor
 * (add/edit a single row) where a strict, immediate error is genuinely
 * useful feedback to a human actively typing — this behavior is UNCHANGED
 * from V15 and does not regress. It is intentionally NOT used for
 * remote/incoming file validation anymore (see validateAndSanitizeRegistry
 * below), because a strict per-field error there is exactly what caused
 * this bug. */
export function validateSchemaIntegrity(tables: TableDef[]): SchemaIntegrityResult {
  const issues: SchemaIntegrityIssue[] = [];
  const seenTableColumn = new Set<string>();
  const safeTables = safeArray<TableDef>(tables);
  const tableNames = new Set(safeTables.map((t) => safeUpperTrim(t?.name)));
  safeTables.forEach((t) => {
    const tName = safeTrim(t?.name);
    if (!tName) { issues.push({ severity: 'error', message: 'A table is missing its Table Name.' }); return; }
    const cols = safeArray<ColumnDef>(t?.columns);
    if (cols.length === 0) { issues.push({ severity: 'warning', message: `Table "${tName}" has no columns defined.` }); }
    let pkCount = 0;
    cols.forEach((c) => {
      const cName = safeTrim(c?.name);
      if (!cName) { issues.push({ severity: 'error', message: `Table "${tName}" has a column with a missing Column Name.` }); return; }
      const key = `${safeUpperTrim(tName)}::${safeUpperTrim(cName)}`;
      if (seenTableColumn.has(key)) issues.push({ severity: 'error', message: `Duplicate column "${tName}.${cName}" — each table/column combination must be unique.` });
      seenTableColumn.add(key);
      if (!VALID_DATA_TYPES.includes(c.type)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has an invalid data type "${c.type}".` });
      if (c.isPrimaryKey) pkCount += 1;
      if (c.isForeignKey) {
        const refTable = safeTrim(c.references?.table);
        const refColumn = safeTrim(c.references?.column);
        if (!refTable || !refColumn) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" is marked as a Foreign Key but has no reference table/column.` });
        else {
          const refTableUpper = safeUpperTrim(refTable);
          if (!tableNames.has(refTableUpper)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" references table "${refTable}", which does not exist in this schema.` });
          else {
            const refTableObj = safeTables.find((rt) => safeUpperTrim(rt?.name) === refTableUpper);
            const refColExists = safeArray(refTableObj?.columns).some((rc: any) => safeUpperTrim(rc?.name) === safeUpperTrim(refColumn));
            if (!refColExists) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" references "${refTable}.${refColumn}", which does not exist.` });
          }
        }
      }
      if (c.decode) {
        const seenRaw = new Set<string>();
        safeArray(c.decode).forEach((d: any) => {
          const rawValue = safeTrim(d?.rawValue);
          if (!rawValue) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has a decode entry with an empty raw value.` });
          const rk = safeUpperTrim(d?.rawValue);
          if (rk && seenRaw.has(rk)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has duplicate decode raw value "${rawValue}".` });
          seenRaw.add(rk);
        });
      }
      if (c.length !== undefined && c.length !== null && c.length < 0) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has a negative Length.` });
      if (c.precision !== undefined && c.precision !== null && c.precision < 0) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has a negative Precision.` });
    });
    if (pkCount > 1) issues.push({ severity: 'warning', message: `Table "${tName}" has ${pkCount} primary-key columns (composite key) — confirm this is intentional.` });
    if (pkCount === 0 && cols.length > 0 && t.objectType !== 'VIEW') issues.push({ severity: 'warning', message: `Table "${tName}" has no primary key defined.` });
  });
  return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
export function validateSingleRowAgainstSchema(schema: SchemaModel, tableName: unknown, columnName: unknown, originalTableName: unknown, originalColumnName: unknown): SchemaIntegrityIssue[] {
  const issues: SchemaIntegrityIssue[] = [];
  const tName = safeTrim(tableName);
  const cName = safeTrim(columnName);
  if (!tName) issues.push({ severity: 'error', message: 'Table Name is required.' });
  if (!cName) issues.push({ severity: 'error', message: 'Column Name is required.' });
  if (!tName || !cName) return issues;
  const isSameAsOriginal = safeUpperTrim(originalTableName) === safeUpperTrim(tName) && safeUpperTrim(originalColumnName) === safeUpperTrim(cName);
  if (isSameAsOriginal) return issues;
  const table = safeArray<TableDef>(schema?.tables).find((t) => safeUpperTrim(t?.name) === safeUpperTrim(tName));
  const clash = safeArray<ColumnDef>(table?.columns).some((c) => safeUpperTrim(c?.name) === safeUpperTrim(cName));
  if (clash) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" already exists in this schema.` });
  return issues;
}

/** V15.1 NEW — result of the lenient, per-schema-tolerant registry
 * validator used for all remote/incoming synchronization paths. */
export interface LenientRegistryResult {
  ok: boolean;
  code: SyncErrorCode;
  validSchemas: SchemaModel[];
  skippedCount: number;
  skippedReasons: string[];
  internalDiagnostics: string[];
}

function looksLikeGitHubMetadataResponse(obj: Record<string, unknown>): boolean {
  // Defensive check for spec item "Load a GitHub API response instead of
  // the actual schema content" / "Treat a repository metadata response as
  // the schema" — a raw GitHub Contents API object has these fields and
  // NEVER has a top-level `schemas` array.
  return !('schemas' in obj) && 'sha' in obj && 'encoding' in obj && ('content' in obj || 'download_url' in obj);
}

function sanitizeAndValidateSingleSchema(rawSchema: unknown): { schema: SchemaModel | null; reason?: string; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!rawSchema || typeof rawSchema !== 'object') return { schema: null, reason: 'entry is not an object', diagnostics };
  // Sanitize FIRST — this is the key ordering fix: legacy/optional gaps
  // (missing description, missing label, missing decode fields, missing
  // module) are patched with safe defaults BEFORE any structural check
  // runs, so they can never trigger a false rejection.
  const sanitized = sanitizeIncomingSchema(rawSchema) as SchemaModel;
  if (!sanitized || typeof sanitized !== 'object') return { schema: null, reason: 'sanitization produced an invalid result', diagnostics };
  if (!Array.isArray(sanitized.tables)) return { schema: null, reason: 'missing or invalid "tables" array (even after sanitization)', diagnostics };
  const name = safeTrim(sanitized.name);
  if (!name) return { schema: null, reason: 'missing required schema name', diagnostics };
  // Run the structural checker for DIAGNOSTIC purposes only — in the
  // remote-sync context these are collected as internal, non-blocking
  // warnings. A schema is never rejected here for FK mismatches, missing
  // PK, duplicate decode values, etc. — those are real-world variations
  // seen across legitimately-created schemas (imported, admin-edited,
  // synced from an older version) and must not block loading.
  const structural = validateSchemaIntegrity(sanitized.tables);
  structural.issues.forEach((i) => diagnostics.push(`[${i.severity}] ${name}: ${i.message}`));
  return { schema: sanitized, diagnostics };
}

/** V15.1 NEW — replaces the old all-or-nothing `validateIncomingRegistryFile`
 * for every remote/sync code path (GitHub pull, public discovery). Loads
 * every schema that is individually well-formed, skips (and reports
 * internally) only the ones that are not, and never rejects the whole
 * registry over a single bad entry. */
export function validateAndSanitizeRegistry(raw: unknown): LenientRegistryResult {
  const diagnostics: string[] = [];
  if (raw === null || raw === undefined) return { ok: false, code: 'empty-file', validSchemas: [], skippedCount: 0, skippedReasons: [], internalDiagnostics: ['remote content was null/undefined'] };
  if (typeof raw !== 'object') return { ok: false, code: 'invalid-root-structure', validSchemas: [], skippedCount: 0, skippedReasons: [], internalDiagnostics: [`remote content was of type ${typeof raw}, expected an object`] };
  const obj = raw as Record<string, unknown>;
  if (looksLikeGitHubMetadataResponse(obj)) return { ok: false, code: 'incorrect-file-selection', validSchemas: [], skippedCount: 0, skippedReasons: [], internalDiagnostics: ['parsed content looks like a raw GitHub Contents API response, not decoded schema JSON'] };
  if (!Array.isArray(obj.schemas)) return { ok: false, code: 'invalid-root-structure', validSchemas: [], skippedCount: 0, skippedReasons: [], internalDiagnostics: ['root object is missing a "schemas" array'] };
  const validSchemas: SchemaModel[] = [];
  const skippedReasons: string[] = [];
  let skipped = 0;
  for (const rawSchema of obj.schemas) {
    const result = sanitizeAndValidateSingleSchema(rawSchema);
    diagnostics.push(...result.diagnostics);
    if (result.schema) validSchemas.push(result.schema);
    else { skipped += 1; if (result.reason) skippedReasons.push(result.reason); }
  }
  if (validSchemas.length === 0) {
    const code: SyncErrorCode = skipped > 0 ? 'invalid-table-structure' : 'invalid-root-structure';
    return { ok: false, code, validSchemas: [], skippedCount: skipped, skippedReasons, internalDiagnostics: diagnostics };
  }
  return { ok: true, code: 'none', validSchemas, skippedCount: skipped, skippedReasons, internalDiagnostics: diagnostics };
}

/** Maps an internal SyncErrorCode to a clean, non-technical, user-facing
 * message. Never includes raw JS exception text, stack traces, or
 * internal diagnostics — those are only ever logged via console.debug for
 * developers, never surfaced in the UI. (V15.1 requirement #2.) */
export function describeSyncErrorForUser(code: SyncErrorCode): string {
  switch (code) {
    case 'none': return '';
    case 'not-found': return 'No schema file was found yet at the configured repository path.';
    case 'network-error': return 'Could not reach the repository. Check your internet connection and try again.';
    case 'github-sync-issue': return 'Remote schema synchronization failed due to a repository access issue. Please verify the repository configuration in Secret Vault.';
    case 'incorrect-file-path': return 'Remote schema synchronization failed. The configured repository path does not point to a valid schema file.';
    case 'incorrect-file-selection': return 'Remote schema synchronization failed. The retrieved file does not appear to be schema content — please verify the repository path.';
    default: return 'Remote schema synchronization failed. The schema file could not be validated. Please check the schema format or synchronization status.';
  }
}
