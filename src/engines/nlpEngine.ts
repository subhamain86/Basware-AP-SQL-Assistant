import type { SchemaModel, QueryRequirement, SelectedColumnSpec, FilterCondition, SortSpec, TableDef, ClarificationQuestion } from '../types';
function findTableMentions(text: string, schema: SchemaModel): TableDef[] {
  const upper = text.toUpperCase(); const found: TableDef[] = [];
  for (const t of schema.tables) { const spaced = t.name.replace(/_/g, ' '); if (upper.includes(t.name) || upper.includes(spaced)) found.push(t); }
  return found;
}
export function parseRequirement(rawText: string, schema: SchemaModel): QueryRequirement {
  const notes: string[] = []; const queryPlan: string[] = []; const clarifications: ClarificationQuestion[] = [];
  const text = rawText.trim();
  if (!text) return { rawText, matchedTables: [], matchedColumns: [], matchedFilters: [], matchedSorts: [], limit: null, distinct: false, confidence: 0, notes: ['No requirement text was provided — using manual selections only.'], queryPlan: [], clarifications: [], unresolvedTerms: [] };
  const tables = findTableMentions(text, schema);
  if (tables.length === 0) { notes.push('Could not confidently identify any table.'); return { rawText, matchedTables: [], matchedColumns: [], matchedFilters: [], matchedSorts: [], limit: null, distinct: false, confidence: 0.1, notes, queryPlan, clarifications, unresolvedTerms: [] }; }
  queryPlan.push(`Identified table(s): ${tables.map((t) => t.name).join(', ')}.`);
  const matchedColumns: SelectedColumnSpec[] = [];
  const matchedFilters: FilterCondition[] = [];
  const matchedSorts: SortSpec[] = [];
  return { rawText, matchedTables: tables.map((t) => t.name), matchedColumns, matchedFilters, matchedSorts, limit: null, distinct: false, confidence: 0.5, notes, queryPlan, clarifications, unresolvedTerms: [] };
}
export function filterToKnownTables(names: string[], schema: SchemaModel): { known: string[]; unknown: string[] } {
  const knownSet = new Set(schema.tables.map((t) => t.name));
  return { known: names.filter((n) => knownSet.has(n)), unknown: names.filter((n) => !knownSet.has(n)) };
}
export function filterToKnownColumns(pairs: { table: string; column: string }[], schema: SchemaModel): { known: { table: string; column: string }[]; unknown: { table: string; column: string }[] } {
  const known: { table: string; column: string }[] = []; const unknown: { table: string; column: string }[] = [];
  pairs.forEach((p) => { const table = schema.tables.find((t) => t.name === p.table); const exists = table?.columns.some((c) => c.name === p.column); if (exists) known.push(p); else unknown.push(p); });
  return { known, unknown };
}
