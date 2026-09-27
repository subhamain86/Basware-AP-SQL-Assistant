import type { SchemaModel, SqlSchemaValidationResult } from '../types';
const SQL_KEYWORDS = new Set(['select','from','where','group','by','having','order','join','inner','left','right','outer','on','and','or','not','null','as','distinct','case','when','then','else','end','with']);
function extractFromJoinTables(sql: string): string[] {
  const cleaned = sql.replace(/--.*$/gm, ' ').replace(/'(?:[^']|'')*'/g, "''");
  const tables: string[] = [];
  (cleaned.match(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/gi) || []).forEach((m) => { const p = m.trim().split(/\s+/); if (p[1]) tables.push(p[1]); });
  (cleaned.match(/\bJOIN\s+([A-Za-z_][A-Za-z0-9_]*)/gi) || []).forEach((m) => { const p = m.trim().split(/\s+/); if (p[1]) tables.push(p[1]); });
  return Array.from(new Set(tables));
}
export function validateSqlAgainstSchema(sql: string, schema: SchemaModel): SqlSchemaValidationResult {
  const trimmed = sql.trim();
  if (!trimmed || trimmed.startsWith('--')) return { valid: true, unknownTables: [], unknownColumnRefs: [], warnings: [] };
  const knownTableNames = new Set(schema.tables.map((t) => t.name.toUpperCase()));
  const fromJoinTables = extractFromJoinTables(sql);
  const unknownTables = fromJoinTables.filter((t) => !knownTableNames.has(t.toUpperCase()) && !SQL_KEYWORDS.has(t.toLowerCase()));
  const warnings: string[] = [];
  if (unknownTables.length) warnings.push(`Table(s) not found in the Active Schema: ${unknownTables.join(', ')}.`);
  return { valid: unknownTables.length === 0, unknownTables, unknownColumnRefs: [], warnings };
}
