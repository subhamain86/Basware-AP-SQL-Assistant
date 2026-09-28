import type { SchemaModel, TableDef, SchemaIntegrityResult, SchemaIntegrityIssue } from '../types';
import { safeTrim, safeUpperTrim } from '../utils/validation';

/**
 * V16.1 fix — root cause of "Remote schema file failed validation".
 *
 * V16.0 rejected any column whose `type` string was not one of the five
 * internal UI dropdown values (VARCHAR, NUMBER, DATE, FLAG, TIMESTAMP). Real
 * imported/exported schemas commonly use richer, real-world data type names
 * (e.g. VARCHAR2, INTEGER, CHAR, TEXT, BOOLEAN, CLOB, DECIMAL, BIGINT). Such a
 * schema imported successfully, was auto-pushed to GitHub, and then failed
 * this same strict check on the very next pull/discovery (same device reload,
 * or another device) — producing exactly the reported workflow:
 *   Imported Schema -> Saved -> GitHub Synchronization -> "Remote schema file
 *   failed validation".
 *
 * The fix widens the structural rule to what is actually required for a
 * column to be usable (a non-empty type string) instead of an arbitrary UI
 * whitelist. Nothing about the imported data itself is changed, stripped, or
 * normalized — the exact type string the user provided is preserved and used
 * as-is (see utils/validation.ts sanitizeIncomingSchema, unchanged). The
 * five-value dropdown in Manual Schema Update's "Add/Edit Row" form is
 * unaffected — that UI still only offers those five values for NEW manual
 * rows, but importing/validating an EXISTING schema with other real-world
 * type names is now accepted.
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
      if (seenTableColumn.has(key)) issues.push({ severity: 'error', message: `Duplicate column "${tName}.${cName}" — each table/column combination must be unique.` });
      seenTableColumn.add(key);
      // V16.1: only the PRESENCE of a data type is required, not membership in
      // the internal 5-value UI enum. See file header for full rationale.
      if (!safeTrim(c?.type)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" is missing a Data Type.` });
      if (c.isPrimaryKey) pkCount += 1;
      if (c.isForeignKey) {
        const refTable = safeTrim(c.references?.table);
        const refColumn = safeTrim(c.references?.column);
        if (!refTable || !refColumn) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" is marked as a Foreign Key but has no reference table/column.` });
        else {
          const refTableUpper = safeUpperTrim(refTable);
          if (!tableNames.has(refTableUpper)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" references table "${refTable}", which does not exist in this schema.` });
          else {
            const refTableObj = tables.find((rt) => safeUpperTrim(rt?.name) === refTableUpper);
            const refColExists = refTableObj?.columns?.some((rc) => safeUpperTrim(rc?.name) === safeUpperTrim(refColumn));
            if (!refColExists) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" references "${refTable}.${refColumn}", which does not exist.` });
          }
        }
      }
      if (c.decode) {
        const seenRaw = new Set<string>();
        c.decode.forEach((d) => {
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
