import type { SchemaModel, QueryRequirement, SelectedColumnSpec, FilterCondition, SortSpec, ColumnDef, TableDef, ClarificationQuestion } from '../types';
import { makeId } from '../utils/id';

interface ColumnRef { table: string; column: ColumnDef; }
function allColumns(schema: SchemaModel): ColumnRef[] { return schema.tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c }))); }
const TABLE_SYNONYMS: Record<string, string> = {
  INVOICE: 'INVOICE_HEADER', INVOICES: 'INVOICE_HEADER', BILL: 'INVOICE_HEADER', BILLS: 'INVOICE_HEADER',
  'PURCHASE ORDER': 'PO_HEADER', 'PURCHASE ORDERS': 'PO_HEADER', PO: 'PO_HEADER', POS: 'PO_HEADER',
  VENDOR: 'VENDOR', VENDORS: 'VENDOR', SUPPLIER: 'VENDOR', SUPPLIERS: 'VENDOR',
  ORGANIZATION: 'ORGANIZATION', ORGANIZATIONS: 'ORGANIZATION', ORG: 'ORGANIZATION',
  'GL ACCOUNT': 'GL_ACCOUNT', ACCOUNT: 'GL_ACCOUNT', ACCOUNTS: 'GL_ACCOUNT', LEDGER: 'GL_ACCOUNT',
  USER: 'APP_USER', USERS: 'APP_USER', EMPLOYEE: 'APP_USER', EMPLOYEES: 'APP_USER',
  APPROVAL: 'APPROVAL_HISTORY', APPROVALS: 'APPROVAL_HISTORY'
};
const STOPWORDS = new Set(['the', 'a', 'an', 'show', 'me', 'all', 'get', 'find', 'list', 'with', 'and', 'or', 'for', 'of', 'in', 'on', 'to', 'from', 'that', 'this', 'is', 'are', 'was', 'were', 'by', 'who', 'which', 'each']);
function tokenize(text: string): string[] { return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2 && !STOPWORDS.has(t)); }
function descriptionOverlapScore(phraseTokens: string[], candidateText: string): number {
  const candidateTokens = new Set(tokenize(candidateText));
  if (candidateTokens.size === 0) return 0;
  let hits = 0; phraseTokens.forEach((t) => { if (candidateTokens.has(t)) hits += 1; }); return hits;
}

function findTableMentions(text: string, schema: SchemaModel): TableDef[] {
  const upper = text.toUpperCase(); const found: TableDef[] = [];
  for (const t of schema.tables) {
    const spaced = t.name.replace(/_/g, ' '); const singularish = spaced.replace(/S$/, '');
    if (upper.includes(t.name) || upper.includes(spaced) || upper.includes(singularish)) found.push(t);
  }
  Object.entries(TABLE_SYNONYMS).forEach(([alias, tableName]) => {
    if (upper.includes(alias) && schema.tables.some((t) => t.name === tableName) && !found.some((f) => f.name === tableName)) found.push(schema.tables.find((t) => t.name === tableName)!);
  });
  const phraseTokens = tokenize(text);
  const minScore = found.length === 0 ? 1 : 2;
  const bestNew = schema.tables
    .filter((t) => !found.some((f) => f.name === t.name))
    .map((t) => ({ t, score: descriptionOverlapScore(phraseTokens, `${t.name} ${t.module} ${t.description}`) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)[0];
  if (bestNew) found.push(bestNew.t);
  return found;
}

function findColumnMentions(text: string, tables: TableDef[]): ColumnRef[] {
  const upper = text.toUpperCase(); const cols: ColumnRef[] = [];
  const pool = tables.length ? tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c }))) : [];
  const SYNONYMS: Record<string, string[]> = { NAME: ['SUPPLIER NAME', 'VENDOR NAME'], STATUS: ['STATE'], AMOUNT: ['VALUE', 'TOTAL'] };
  for (const ref of pool) {
    const nameSpaced = ref.column.name.replace(/_/g, ' '); const labelUpper = ref.column.label.toUpperCase();
    if (upper.includes(ref.column.name) || upper.includes(nameSpaced) || upper.includes(labelUpper)) { cols.push(ref); continue; }
    let synonymHit = false;
    for (const [canon, syns] of Object.entries(SYNONYMS)) { if (nameSpaced.includes(canon) && syns.some((s) => upper.includes(s))) { cols.push(ref); synonymHit = true; break; } }
    if (synonymHit) continue;
  }
  if (pool.length > 0) {
    const phraseTokens = tokenize(text);
    const alreadyMatched = new Set(cols.map((c) => `${c.table}::${c.column.name}`));
    const scored = pool
      .filter((ref) => !alreadyMatched.has(`${ref.table}::${ref.column.name}`))
      .map((ref) => ({ ref, score: descriptionOverlapScore(phraseTokens, `${ref.column.name} ${ref.column.label} ${ref.column.description}`) }))
      .filter((x) => x.score >= (cols.length === 0 ? 1 : 2))
      .sort((a, b) => b.score - a.score);
    scored.slice(0, 3).forEach((s) => cols.push(s.ref));
  }
  return cols;
}

interface ComparisonPhrase { pattern: RegExp; operator: FilterCondition['operator']; }
const COMPARISON_PHRASES: ComparisonPhrase[] = [
  { pattern: /greater than or equal to|at least|no less than|>=/, operator: '>=' }, { pattern: /less than or equal to|at most|no more than|<=/, operator: '<=' },
  { pattern: /greater than|more than|above|over|exceed(?:s|ing)?/, operator: '>' }, { pattern: /less than|below|under/, operator: '<' },
  { pattern: /not equal to|different from|<>/, operator: '<>' }, { pattern: /equal to|equals|is exactly|=/, operator: '=' }
];
function extractNumericFilters(text: string, columns: ColumnRef[], combinator: 'AND' | 'OR'): FilterCondition[] {
  const filters: FilterCondition[] = []; const numericCols = columns.filter((c) => c.column.type === 'NUMBER'); const lower = text.toLowerCase();
  numericCols.forEach((ref) => {
    const labelVariants = [ref.column.name.toLowerCase(), ref.column.label.toLowerCase(), ref.column.name.replace(/_/g, ' ').toLowerCase()];
    for (const variant of labelVariants) { const idx = lower.indexOf(variant); if (idx === -1) continue; const windowText = lower.slice(idx, idx + 90); for (const cmp of COMPARISON_PHRASES) { const cmpMatch = windowText.match(cmp.pattern); if (cmpMatch) { const afterCmp = windowText.slice(cmpMatch.index || 0); const numMatch = afterCmp.match(/-?\d[\d,]*(\.\d+)?/); if (numMatch) { filters.push({ id: makeId('filt'), table: ref.table, column: ref.column.name, operator: cmp.operator, combinator, value: numMatch[0].replace(/,/g, '') }); break; } } } break; }
  });
  return filters;
}
function extractDateFilterCandidates(text: string, tables: TableDef[]): { filter: FilterCondition; alternativeColumns: ColumnRef[] } | null {
  const lower = text.toLowerCase();
  const dateCols: ColumnRef[] = tables.flatMap((t) => t.columns.filter((c) => c.type === 'DATE').map((c) => ({ table: t.name, column: c })));
  if (dateCols.length === 0) return null;
  let clause: { op: FilterCondition['operator']; value: string } | null = null;
  const lastNMatch = lower.match(/last\s+(\d+)\s*(day|days|week|weeks|month|months|year|years)/);
  if (lastNMatch) { const amount = parseInt(lastNMatch[1], 10); const unit = lastNMatch[2].startsWith('day') ? 'DAY' : lastNMatch[2].startsWith('week') ? 'WEEK' : lastNMatch[2].startsWith('month') ? 'MONTH' : 'YEAR'; clause = { op: '>=', value: `CURRENT_DATE - INTERVAL '${amount} ${unit}'` }; }
  else if (/\btoday\b/.test(lower)) clause = { op: '=', value: 'CURRENT_DATE' };
  else if (/\byesterday\b/.test(lower)) clause = { op: '=', value: "CURRENT_DATE - INTERVAL '1 DAY'" };
  else if (/\bthis\s+week\b/.test(lower)) clause = { op: '>=', value: "DATE_TRUNC('WEEK', CURRENT_DATE)" };
  else if (/\bthis\s+month\b/.test(lower)) clause = { op: '>=', value: "DATE_TRUNC('MONTH', CURRENT_DATE)" };
  else if (/\bthis\s+year\b/.test(lower)) clause = { op: '>=', value: "DATE_TRUNC('YEAR', CURRENT_DATE)" };
  else if (/\blast\s+week\b/.test(lower)) clause = { op: '>=', value: "DATE_TRUNC('WEEK', CURRENT_DATE) - INTERVAL '1 WEEK'" };
  else if (/\blast\s+month\b/.test(lower)) clause = { op: '>=', value: "DATE_TRUNC('MONTH', CURRENT_DATE) - INTERVAL '1 MONTH'" };
  else if (/\blast\s+year\b/.test(lower)) clause = { op: '>=', value: "DATE_TRUNC('YEAR', CURRENT_DATE) - INTERVAL '1 YEAR'" };
  if (!clause) return null;
  const preferred = dateCols.find((d) => /invoice_date|created/i.test(d.column.name)) || dateCols[0];
  const alternatives = dateCols.filter((d) => d !== preferred);
  return { filter: { id: makeId('filt'), table: preferred.table, column: preferred.column.name, operator: clause.op, combinator: 'AND', value: clause.value }, alternativeColumns: alternatives };
}
function extractDecodeFilters(text: string, tables: TableDef[]): FilterCondition[] {
  const upper = text.toUpperCase(); const filters: FilterCondition[] = [];
  const decodeCols = tables.flatMap((t) => t.columns.filter((c) => c.decode && c.decode.length > 0).map((c) => ({ table: t.name, column: c })));
  decodeCols.forEach((ref) => { ref.column.decode!.forEach((d) => { if (upper.includes(d.label.toUpperCase())) filters.push({ id: makeId('filt'), table: ref.table, column: ref.column.name, operator: '=', combinator: 'AND', value: d.rawValue }); }); });
  return filters;
}
function detectCombinator(text: string): 'AND' | 'OR' { return /\bor\b/i.test(text) && !/\band\b/i.test(text) ? 'OR' : 'AND'; }
function extractLimit(text: string): number | null { const m = text.match(/\b(?:top|first|limit)\s+(\d+)/i); return m ? parseInt(m[1], 10) : null; }
function extractDistinct(text: string): boolean { return /\bdistinct\b|\bunique\b/i.test(text); }
function extractSorts(text: string, tables: TableDef[]): SortSpec[] {
  const m = text.match(/sort(?:ed)?\s+by\s+([a-z0-9_ ]+?)(?:\s+(ascending|asc|descending|desc))?(?:[.,]|$)/i); if (!m) return [];
  const phrase = m[1].trim().toLowerCase(); const direction: SortSpec['direction'] = /desc/i.test(m[2] || '') ? 'DESC' : 'ASC';
  for (const t of tables) for (const c of t.columns) if (phrase.includes(c.name.toLowerCase()) || phrase.includes(c.label.toLowerCase())) return [{ id: makeId('sort'), table: t.name, column: c.name, direction }];
  return [];
}
function findUnresolvedTerms(text: string, schema: SchemaModel): string[] {
  const unresolved: string[] = [];
  const candidateTerms = text.match(/\b[a-z][a-z0-9]*(?:[_ ][a-z0-9]+){1,3}\b/gi) || [];
  const knownColumnTokens = new Set(allColumns(schema).map((c) => c.column.name.toLowerCase().replace(/_/g, ' ')));
  const knownTableTokens = new Set(schema.tables.map((t) => t.name.toLowerCase().replace(/_/g, ' ')));
  candidateTerms.forEach((term) => { const norm = term.toLowerCase().trim(); if (norm.length < 6) return; const looksLikeFieldRef = /_/.test(term) || norm.split(' ').length >= 2; if (!looksLikeFieldRef) return; const known = knownColumnTokens.has(norm) || knownTableTokens.has(norm) || Array.from(knownColumnTokens).some((k) => k.includes(norm) || norm.includes(k)); if (!known && /status|date|amount|name|code|flag|id/i.test(norm)) unresolved.push(term); });
  return Array.from(new Set(unresolved)).slice(0, 3);
}

export function parseRequirement(rawText: string, schema: SchemaModel): QueryRequirement {
  const notes: string[] = []; const queryPlan: string[] = []; const clarifications: ClarificationQuestion[] = [];
  const text = rawText.trim();
  if (!text) return { rawText, matchedTables: [], matchedColumns: [], matchedFilters: [], matchedSorts: [], limit: null, distinct: false, confidence: 0, notes: ['No requirement text was provided.'], queryPlan: [], clarifications: [], unresolvedTerms: [] };
  queryPlan.push('1. Read the Active Schema (tables, columns, descriptions, relationships, decode definitions).');
  queryPlan.push('2. Parse natural-language requirement.');
  const tables = findTableMentions(text, schema);
  if (tables.length === 0) { notes.push('No table names were recognized in the active schema — try mentioning a business object like "invoice", "purchase order", or "vendor", or describe it in your own words (e.g. "who approved this").'); return { rawText, matchedTables: [], matchedColumns: [], matchedFilters: [], matchedSorts: [], limit: null, distinct: false, confidence: 0.1, notes, queryPlan, clarifications: [], unresolvedTerms: findUnresolvedTerms(text, schema) }; }
  queryPlan.push(`3. Identify target table(s) from the active schema: ${tables.map((t) => t.name).join(', ')}.`);
  notes.push(`Recognized table(s): ${tables.map((t) => t.name).join(', ')}.`);
  // V14.2 — when more than one table is matched, note that joins between
  // them will be resolved automatically from schema relationships (spec
  // section 3) — the actual join computation happens in sqlEngine via
  // joinAutoEngine, this is purely a transparency note for the user.
  if (tables.length > 1) { queryPlan.push(`4. Determine required JOIN path(s) between ${tables.map((t) => t.name).join(' and ')} using schema primary/foreign key relationships.`); notes.push('Multiple tables were identified — the required JOIN(s) will be generated automatically from schema relationships (including via an intermediate table where needed).'); }
  const combinator = detectCombinator(text);
  const mentionedColumns = findColumnMentions(text, tables);
  queryPlan.push(mentionedColumns.length ? `${tables.length > 1 ? '5' : '4'}. Identify requested columns: ${mentionedColumns.map((c) => c.column.name).join(', ')}.` : `${tables.length > 1 ? '5' : '4'}. No specific columns mentioned — will default to key identifying columns.`);
  const numericFilters = extractNumericFilters(text, mentionedColumns.length ? mentionedColumns : allColumns(schema).filter((c) => tables.some((t) => t.name === c.table)), combinator);
  const dateCandidate = extractDateFilterCandidates(text, tables);
  const decodeFilters = extractDecodeFilters(text, tables);
  const allFilters = [...numericFilters, ...decodeFilters];
  if (dateCandidate) { allFilters.push(dateCandidate.filter); if (dateCandidate.alternativeColumns.length > 0) clarifications.push({ question: `I found ${dateCandidate.alternativeColumns.length + 1} possible date fields for this requirement. Which one should be used?`, options: [dateCandidate.filter.column, ...dateCandidate.alternativeColumns.map((c) => c.column.name)] }); }
  queryPlan.push(allFilters.length ? `Apply ${allFilters.length} filter condition(s) (combined with ${combinator}).` : 'No filter conditions detected.');
  if (allFilters.length) notes.push(`Inferred ${allFilters.length} filter condition(s) from the text.`); else notes.push('No explicit filter conditions were recognized — showing all rows for the matched table(s).');
  const limit = extractLimit(text); const distinct = extractDistinct(text); const sorts = extractSorts(text, tables);
  queryPlan.push(sorts.length ? `Sort by ${sorts[0].table}.${sorts[0].column} ${sorts[0].direction}.` : 'No sorting requested.');
  if (limit) { queryPlan.push(`Limit results to ${limit} rows.`); notes.push(`Result limit of ${limit} detected.`); }
  if (distinct) notes.push('DISTINCT requested.');
  let selectedColumns: SelectedColumnSpec[] = mentionedColumns.map((c) => ({ id: makeId('col'), table: c.table, column: c.column.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }));
  if (selectedColumns.length === 0) {
    tables.forEach((t) => { const defaultCols = t.columns.filter((c) => c.isPrimaryKey || /date|amount|name|status/i.test(c.name)).slice(0, 5); defaultCols.forEach((c) => selectedColumns.push({ id: makeId('col'), table: t.name, column: c.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' })); });
    notes.push('No specific columns mentioned — defaulted to key identifying columns for the matched table(s).');
  }
  queryPlan.push('Validate all table/column names against the active schema (never invent objects not present).');
  queryPlan.push('Generate SQL.');
  const unresolvedTerms = findUnresolvedTerms(text, schema);
  if (unresolvedTerms.length) notes.push(`Could not resolve: ${unresolvedTerms.join(', ')} — not present in the active schema.`);
  const confidence = Math.min(1, 0.35 + tables.length * 0.15 + allFilters.length * 0.15 + (selectedColumns.length ? 0.15 : 0) - (clarifications.length ? 0.1 : 0));
  return { rawText, matchedTables: tables.map((t) => t.name), matchedColumns: selectedColumns, matchedFilters: allFilters, matchedSorts: sorts, limit, distinct, confidence, notes, queryPlan, clarifications, unresolvedTerms };
}
