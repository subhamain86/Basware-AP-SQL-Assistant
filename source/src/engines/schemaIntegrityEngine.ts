import type { SchemaModel, TableDef, SchemaIntegrityResult, SchemaIntegrityIssue, SyncErrorCode } from '../types';
import { VALID_DATA_TYPES } from '../types';
import { safeTrim, safeUpperTrim, safeArray, sanitizeIncomingSchema } from '../utils/validation';

export function validateSchemaIntegrity(tables: TableDef[]): SchemaIntegrityResult {
  const issues: SchemaIntegrityIssue[] = [];
  const seenTableColumn = new Set<string>();
  const safeTables = safeArray<TableDef>(tables);
  const tableNames = new Set(safeTables.map((t) => safeUpperTrim(t?.name)));
  safeTables.forEach((t) => {
    const tName = safeTrim(t?.name);
    if (!tName) { issues.push({ severity: 'error', message: 'A table is missing its Table Name.' }); return; }
    const cols = safeArray(t?.columns);
    if (cols.length === 0) issues.push({ severity: 'warning', message: `Table "${tName}" has no columns defined.` });
    let pkCount = 0;
    cols.forEach((c: any) => {
      const cName = safeTrim(c?.name);
      if (!cName) { issues.push({ severity: 'error', message: `Table "${tName}" has a column with a missing Column Name.` }); return; }
      const key = `${safeUpperTrim(tName)}::${safeUpperTrim(cName)}`;
      if (seenTableColumn.has(key)) issues.push({ severity: 'error', message: `Duplicate column "${tName}.${cName}" — each table/column combination must be unique.` });
      seenTableColumn.add(key);
      if (!VALID_DATA_TYPES.includes(c.type)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has an invalid data type "${c.type}".` });
      if (c.isPrimaryKey) pkCount += 1;
      if (c.isForeignKey) {
        const refTable = safeTrim(c.references?.table); const refColumn = safeTrim(c.references?.column);
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
  const tName = safeTrim(tableName); const cName = safeTrim(columnName);
  if (!tName) issues.push({ severity: 'error', message: 'Table Name is required.' });
  if (!cName) issues.push({ severity: 'error', message: 'Column Name is required.' });
  if (!tName || !cName) return issues;
  const isSameAsOriginal = safeUpperTrim(originalTableName) === safeUpperTrim(tName) && safeUpperTrim(originalColumnName) === safeUpperTrim(cName);
  if (!isSameAsOriginal) {
    const table = safeArray(schema?.tables).find((t: any) => safeUpperTrim(t?.name) === safeUpperTrim(tName));
    const clash = safeArray((table as any)?.columns).some((c: any) => safeUpperTrim(c?.name) === safeUpperTrim(cName));
    if (clash) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" already exists in this schema.` });
  }
  return issues;
}

export function validateCandidateRowFields(candidateColumn: { name: string; type: string; length?: number | null; precision?: number | null; isForeignKey?: boolean; references?: { table: string; column: string }; decode?: { rawValue: string; label: string }[] }, tableName: string, allTables: TableDef[]): string[] {
  const errors: string[] = [];
  const tName = safeTrim(tableName); const cName = safeTrim(candidateColumn.name);
  if (!VALID_DATA_TYPES.includes(candidateColumn.type as any)) errors.push(`Column "${tName}.${cName}" has an invalid data type "${candidateColumn.type}".`);
  if (candidateColumn.length !== undefined && candidateColumn.length !== null && candidateColumn.length < 0) errors.push(`Column "${tName}.${cName}" has a negative Length.`);
  if (candidateColumn.precision !== undefined && candidateColumn.precision !== null && candidateColumn.precision < 0) errors.push(`Column "${tName}.${cName}" has a negative Precision.`);
  if (candidateColumn.isForeignKey) {
    const refTable = safeTrim(candidateColumn.references?.table); const refColumn = safeTrim(candidateColumn.references?.column);
    if (!refTable || !refColumn) errors.push(`Column "${tName}.${cName}" is marked as a Foreign Key but has no reference table/column.`);
    else {
      const refTableUpper = safeUpperTrim(refTable);
      const refTableObj = allTables.find((rt) => safeUpperTrim(rt?.name) === refTableUpper);
      if (!refTableObj) errors.push(`Column "${tName}.${cName}" references table "${refTable}", which does not exist in this schema.`);
      else {
        const refColExists = safeArray(refTableObj.columns).some((rc: any) => safeUpperTrim(rc?.name) === safeUpperTrim(refColumn));
        if (!refColExists) errors.push(`Column "${tName}.${cName}" references "${refTable}.${refColumn}", which does not exist.`);
      }
    }
  }
  if (candidateColumn.decode) {
    const seenRaw = new Set<string>();
    safeArray(candidateColumn.decode).forEach((d: any) => {
      const rawValue = safeTrim(d?.rawValue);
      if (!rawValue) errors.push(`Column "${tName}.${cName}" has a decode entry with an empty raw value.`);
      const rk = safeUpperTrim(d?.rawValue);
      if (rk && seenRaw.has(rk)) errors.push(`Column "${tName}.${cName}" has duplicate decode raw value "${rawValue}".`);
      seenRaw.add(rk);
    });
  }
  return errors;
}

export interface LenientRegistryResult { ok: boolean; code: SyncErrorCode; validSchemas: SchemaModel[]; skippedCount: number; skippedReasons: string[]; internalDiagnostics: string[]; }
function looksLikeGitHubMetadataResponse(obj: Record<string, unknown>): boolean {
  return !('schemas' in obj) && 'sha' in obj && 'encoding' in obj && ('content' in obj || 'download_url' in obj);
}
function sanitizeAndValidateSingleSchema(rawSchema: unknown): { schema: SchemaModel | null; reason?: string; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!rawSchema || typeof rawSchema !== 'object') return { schema: null, reason: 'entry is not an object', diagnostics };
  const sanitized = sanitizeIncomingSchema(rawSchema) as SchemaModel;
  if (!sanitized || typeof sanitized !== 'object') return { schema: null, reason: 'sanitization produced an invalid result', diagnostics };
  if (!Array.isArray(sanitized.tables)) return { schema: null, reason: 'missing or invalid "tables" array (even after sanitization)', diagnostics };
  const name = safeTrim(sanitized.name);
  if (!name) return { schema: null, reason: 'missing required schema name', diagnostics };
  const structural = validateSchemaIntegrity(sanitized.tables);
  structural.issues.forEach((i) => diagnostics.push(`[${i.severity}] ${name}: ${i.message}`));
  return { schema: sanitized, diagnostics };
}
export function validateAndSanitizeRegistry(raw: unknown): LenientRegistryResult {
  const diagnostics: string[] = [];
  if (raw === null || raw === undefined) return { ok: false, code: 'empty-file', validSchemas: [], skippedCount: 0, skippedReasons: [], internalDiagnostics: ['remote content was null/undefined'] };
  if (typeof raw !== 'object') return { ok: false, code: 'invalid-root-structure', validSchemas: [], skippedCount: 0, skippedReasons: [], internalDiagnostics: [`remote content was of type ${typeof raw}, expected an object`] };
  const obj = raw as Record<string, unknown>;
  if (looksLikeGitHubMetadataResponse(obj)) return { ok: false, code: 'incorrect-file-selection', validSchemas: [], skippedCount: 0, skippedReasons: [], internalDiagnostics: ['parsed content looks like a raw GitHub Contents API response, not decoded schema JSON'] };
  if (!Array.isArray(obj.schemas)) return { ok: false, code: 'invalid-root-structure', validSchemas: [], skippedCount: 0, skippedReasons: [], internalDiagnostics: ['root object is missing a "schemas" array'] };
  const validSchemas: SchemaModel[] = []; const skippedReasons: string[] = []; let skipped = 0;
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
