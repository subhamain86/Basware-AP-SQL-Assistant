import type { SchemaModel, TableDef, SchemaIntegrityResult, SchemaIntegrityIssue } from '../types';
import { VALID_DATA_TYPES } from '../types';
import { safeTrim, safeUpperTrim } from '../utils/validation';

// V14.7 FIX — root cause of "Remote schema file failed validation" on
// real-world (Oracle-sourced) schemas: VALID_DATA_TYPES only ever listed
// the 5 generic UI-editor buckets ('VARCHAR','NUMBER','DATE','FLAG',
// 'TIMESTAMP'). Any schema imported/synced from an actual database (e.g.
// exported via DESCRIBE / ALL_TAB_COLUMNS) carries native types like
// "NVARCHAR2(64)", "NUMBER(22,5)", "TIMESTAMP(6)", "BLOB", "RAW(16)" —
// none of which matched the 5-item list, so EVERY column in a real schema
// was flagged as an error and the ENTIRE remote file was rejected (this is
// exactly what produced the 1,600+ repeated "invalid data type" lines in
// the Sync Log). isRecognizedDataType() normalizes the type (strips any
// trailing "(length[,precision])" qualifier, upper-cases, trims) and
// accepts it if it matches either one of the 5 generic UI types OR a
// recognized native DB base type. The manual schema-editor dropdown
// (schemaEditorSection.ts) still only offers the 5 generic types — this
// only widens what remote/import data is allowed to contain, it does not
// change anything about how a user manually adds a row.
const NATIVE_DB_BASE_TYPES = new Set<string>([
  'VARCHAR', 'VARCHAR2', 'NVARCHAR', 'NVARCHAR2', 'CHAR', 'NCHAR', 'CHARACTER',
  'CLOB', 'NCLOB', 'BLOB', 'RAW', 'LONG', 'LONG RAW',
  'NUMBER', 'INTEGER', 'INT', 'SMALLINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL', 'BINARY_FLOAT', 'BINARY_DOUBLE',
  'DATE', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITH LOCAL TIME ZONE',
  'BOOLEAN', 'FLAG', 'BIT', 'ROWID', 'UROWID', 'XMLTYPE', 'JSON'
]);

function isRecognizedDataType(rawType: unknown): boolean {
  const t = safeTrim(rawType);
  if (!t) return false;
  if (VALID_DATA_TYPES.includes(t as (typeof VALID_DATA_TYPES)[number])) return true;
  const base = safeUpperTrim(t).replace(/\s*\(.*\)\s*$/, '');
  return NATIVE_DB_BASE_TYPES.has(base);
}

export function validateSchemaIntegrity(tables: TableDef[]): SchemaIntegrityResult {
  const issues: SchemaIntegrityIssue[] = [];
  const seenTableColumn = new Set<string>();
  // V14.6 FIX: was `t.name.trim().toUpperCase()` with NO guard — crashed
  // instantly if ANY table had an undefined/non-string `name`. Now safe
  // regardless of what malformed data is passed in.
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
      // V14.7 FIX: was `!VALID_DATA_TYPES.includes(c.type)` — see
      // isRecognizedDataType() note above for why this rejected every
      // real-world (Oracle-sourced) schema.
      if (!isRecognizedDataType(c.type)) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has an invalid data type "${c.type}".` });
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
            // V14.6 FIX: was `rc.name.trim().toUpperCase()` inside .some()
            // with NO guard — crashed if ANY column in the referenced
            // table had an undefined name.
            const refColExists = refTableObj?.columns?.some((rc) => safeUpperTrim(rc?.name) === safeUpperTrim(refColumn));
            if (!refColExists) issues.push({ severity: 'error', message: `Column "${tName}.${cName}" references "${refTable}.${refColumn}", which does not exist.` });
          }
        }
      }
      if (c.decode) {
        const seenRaw = new Set<string>();
        c.decode.forEach((d) => {
          // V14.6 FIX: was `!d.rawValue.trim()` with NO guard — crashed
          // if d.rawValue was undefined (malformed decode entry from
          // manual edit, JSON import, or a schema synced from another
          // device).
          const rawValue = safeTrim(d?.rawValue);
          // V14.7 FIX: was `severity: 'error'` — a blank raw value is a
          // legitimate way some databases decode a NULL/blank value (e.g.
          // "" -> "Not set"), and dozens of real FLAG/boolean columns
          // (IS_ACTIVE, ENABLED, GRANTED, etc.) use exactly this pattern.
          // This alone was blocking otherwise-valid schemas from ever
          // syncing. Downgraded to a warning — still surfaced to the user,
          // but no longer rejects the whole file.
          if (!rawValue) issues.push({ severity: 'warning', message: `Column "${tName}.${cName}" has a decode entry with an empty raw value.` });
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
