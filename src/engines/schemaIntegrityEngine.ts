import type { SchemaModel, TableDef, SchemaIntegrityResult, SchemaIntegrityIssue } from '../types';
import { safeTrim, safeUpperTrim } from '../utils/validation';

/**
 * V16.3 fix — "Remote schema file failed validation" recurring after V16.1.
 *
 * V16.1 widened the data-type check (any non-empty type string is accepted),
 * which fixed one cause of this error. But the error kept recurring because
 * of a SECOND, separate problem: this validator treated referential-
 * integrity issues — a foreign key pointing at a table/column that no
 * longer exists, or a duplicate table/column pairing — as hard BLOCKING
 * errors. Real schemas drift over time (a table gets renamed, a column
 * gets removed, someone hand-edits the registry file on GitHub) and these
 * are exactly the kind of minor metadata inconsistencies that should not
 * prevent an otherwise-usable schema from syncing at all. A single stale FK
 * reference anywhere in a large schema was enough to make the ENTIRE
 * registry fail validation and block sync for every device.
 *
 * Fix: only structural issues that make a row fundamentally unusable/
 * unidentifiable (missing table name, missing column name) remain
 * `error` (blocking). Referential-integrity and data-quality issues that
 * don't prevent SQL generation from working (dangling FK reference,
 * duplicate column, duplicate decode raw value, negative length/precision)
 * are now `warning` (non-blocking) — they are still surfaced to the user so
 * the drift is visible and fixable, but they no longer abort synchronization
 * of the whole file.
 *
 * See also syncService.ts for the second half of this fix: the remote/pull
 * path now sanitizes incoming schema data BEFORE validating it (matching
 * what the local import path already did), so a column whose `type` key was
 * literally absent from the JSON (e.g. dropped by JSON.stringify omitting an
 * undefined value, or from a hand-edited file) is defaulted to 'VARCHAR'
 * before the type-presence check runs, instead of being validated in its
 * raw, pre-default state.
 */
export function validateSchemaIntegrity(tables: TableDef[]): SchemaIntegrityResult {
  const issues: SchemaIntegrityIssue[] = [];
  const seenTableColumn = new Set<string>();
  const tableNames = new Set(tables.map((t) => safeUpperTrim(t?.name)));
  tables.forEach((t) => {
    const tName = safeTrim(t?.name);
    if (!tName) { issues.push({ severity: 'error', message: 'A table is missing its Table Name.' }); return; }
    if (!Array.isArray(t.columns) || t.columns.length === 0) { issues.push({ severity: 'warning', message: `Table "${tName}" has no columns defined.` }); }
    let pkCount = 0;
    (t.columns || []).forEach((c) => {
      const cName = safeTrim(c?.name);
      if (!cName) { issues.push({ severity: 'error', message: `Table "${tName}" has a column with a missing Column Name.` }); return; }
      const key = `${safeUpperTrim(tName)}::${safeUpperTrim(cName)}`;
      // V16.3: duplicate column is a data-quality issue, not fatal — downgraded to warning.
      if (seenTableColumn.has(key)) issues.push({ severity: 'warning', message: `Duplicate column "${tName}.${cName}" — each table/column combination is expected to be unique.` });
      seenTableColumn.add(key);
      if (!safeTrim(c?.type)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" is missing a Data Type.` });
      if (c.isPrimaryKey) pkCount += 1;
      if (c.isForeignKey) {
        const refTable = safeTrim(c.references?.table);
        const refColumn = safeTrim(c.references?.column);
        // V16.3: an incomplete or dangling FK reference is referential drift,
        // not a fatal structural problem — downgraded to warning in all three
        // cases below. The column itself remains fully usable in SQL
        // generation; only the "this is a documented relationship" metadata
        // is unreliable.
        if (!refTable || !refColumn) issues.push({ severity: 'warning', message: `Column "${tName}.${cName}" is marked as a Foreign Key but has no reference table/column.` });
        else {
          const refTableUpper = safeUpperTrim(refTable);
          if (!tableNames.has(refTableUpper)) issues.push({ severity: 'warning', message: `Column "${tName}.${cName}" references table "${refTable}", which does not exist in this schema.` });
          else {
            const refTableObj = tables.find((rt) => safeUpperTrim(rt?.name) === refTableUpper);
            const refColExists = refTableObj?.columns?.some((rc) => safeUpperTrim(rc?.name) === safeUpperTrim(refColumn));
            if (!refColExists) issues.push({ severity: 'warning', message: `Column "${tName}.${cName}" references "${refTable}.${refColumn}", which does not exist.` });
          }
        }
      }
      if (c.decode) {
        const seenRaw = new Set<string>();
        c.decode.forEach((d) => {
          const rawValue = safeTrim(d?.rawValue);
          if (!rawValue) issues.push({ severity: 'warning', message: `Column "${tName}.${cName}" has a decode entry with an empty raw value.` });
          const rk = safeUpperTrim(d?.rawValue);
          if (rk && seenRaw.has(rk)) issues.push({ severity: 'warning', message: `Column "${tName}.${cName}" has duplicate decode raw value "${rawValue}".` });
          seenRaw.add(rk);
        });
      }
      if (c.length !== undefined && c.length !== null && c.length < 0) issues.push({ severity: 'warning', message: `Column "${tName}.${cName}" has a negative Length.` });
      if (c.precision !== undefined && c.precision !== null && c.precision < 0) issues.push({ severity: 'warning', message: `Column "${tName}.${cName}" has a negative Precision.` });
    });
    if (pkCount > 1) issues.push({ severity: 'warning', message: `Table "${tName}" has ${pkCount} primary-key columns (composite key) — confirm this is intentional.` });
    if (pkCount === 0 && (t.columns || []).length > 0 && t.objectType !== 'VIEW') issues.push({ severity: 'warning', message: `Table "${tName}" has no primary key defined.` });
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
  const table = schema.tables.find((t) => safeUpperTrim(t?.name) === safeUpperTrim(tName));
  const clash = table?.columns?.some((c) => safeUpperTrim(c?.name) === safeUpperTrim(cName));
  if (clash) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" already exists in this schema.` });
  return issues;
}
export function validateIncomingSchemaFile(candidate: unknown): SchemaIntegrityResult {
  const issues: SchemaIntegrityIssue[] = [];
  if (typeof candidate !== 'object' || candidate === null) { issues.push({ severity: 'error', message: 'File is not a valid JSON object.' }); return { valid: false, issues }; }
  const obj = candidate as Record<string, unknown>;
  if (!Array.isArray(obj.tables)) { issues.push({ severity: 'error', message: 'Missing required "tables" array.' }); return { valid: false, issues }; }
  if (!safeTrim(obj.name)) issues.push({ severity: 'warning', message: 'Schema has no name — a default will be used.' });
  const structural = validateSchemaIntegrity(obj.tables as TableDef[]);
  issues.push(...structural.issues);
  return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
export function validateIncomingRegistryFile(candidate: unknown): SchemaIntegrityResult {
  const issues: SchemaIntegrityIssue[] = [];
  if (typeof candidate !== 'object' || candidate === null) { issues.push({ severity: 'error', message: 'File is not a valid JSON object.' }); return { valid: false, issues }; }
  const obj = candidate as Record<string, unknown>;
  if (!Array.isArray(obj.schemas)) { issues.push({ severity: 'error', message: 'Missing required "schemas" array.' }); return { valid: false, issues }; }
  (obj.schemas as unknown[]).forEach((s, idx) => {
    const result = validateIncomingSchemaFile(s);
    result.issues.forEach((i) => issues.push({ severity: i.severity, message: `Schema #${idx + 1}: ${i.message}` }));
  });
  return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
