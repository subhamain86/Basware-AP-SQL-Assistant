import type { SchemaModel, QueryRequirement, SelectedColumnSpec, FilterCondition, SortSpec, ColumnDef, TableDef, ClarificationQuestion, MatchedAggregate, MatchedHaving, MatchedRelatedCondition } from '../types';
import { makeId } from '../utils/id';
import { relatableTables } from './relatedEngine';

/* ============================================================================
 * V15.5 — QUERY GENERATION PIPELINE (offline / self-sustained engine)
 * ----------------------------------------------------------------------------
 * This module implements the structured pipeline described in the V15.5
 * requirements as an ACTUAL sequence of resolution stages — not a single
 * regex blob — so it can be reasoned about, extended, and unit-tested stage
 * by stage:
 *
 *   1. Table & Column Resolution      (findTableMentions / findColumnMentions)
 *   2. Aggregation Resolution         (extractAggregates)
 *   3. Filter Resolution              (extractNumericFilters / extractDateFilterCandidates / extractDecodeFilters)
 *   4. Grouping Resolution            (extractGroupBy — implied by aggregate + plain column mix, or explicit "by X")
 *   5. HAVING Resolution              (extractHaving — a comparison phrase applied to an aggregate)
 *   6. Related/EXISTS Resolution      (extractRelatedConditions — "that have", "with", "that are missing" + a related table)
 *   7. Sort / Limit Resolution        (extractSorts / extractLimit — "top N", "sort ... descending")
 *
 * Table/JOIN resolution itself (turning matchedTables into an actual JOIN
 * plan) is intentionally NOT done here — that remains the job of
 * joinAutoEngine.computeAutoJoinPlan(), called later by sqlEngine.ts, which
 * already understands the Active Schema's real PK/FK relationships. This
 * keeps "Active Schema is the source of truth for what JOINs are valid"
 * entirely in one place, and this module never invents a relationship.
 * ============================================================================ */

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
/** Column-level synonyms so common business phrasing ("supplier name",
 * "total amount", "invoice total") resolves to the correct schema column
 * even when the phrase doesn't literally contain the column name. */
const COLUMN_SYNONYMS: Record<string, string[]> = {
  NAME: ['SUPPLIER NAME', 'VENDOR NAME', 'ORGANIZATION NAME', 'ACCOUNT NAME'],
  STATUS: ['STATE'],
  AMOUNT: ['VALUE', 'TOTAL', 'TOTAL AMOUNT', 'INVOICE TOTAL', 'INVOICE AMOUNT'],
  DATE: ['CREATED', 'RAISED']
};
const STOPWORDS = new Set(['the', 'a', 'an', 'show', 'me', 'all', 'get', 'find', 'list', 'with', 'and', 'or', 'for', 'of', 'in', 'on', 'to', 'from', 'that', 'this', 'is', 'are', 'was', 'were', 'by', 'who', 'which', 'each', 'only', 'include', 'including', 'their']);
function tokenize(text: string): string[] { return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2 && !STOPWORDS.has(t)); }
function descriptionOverlapScore(phraseTokens: string[], candidateText: string): number {
  const candidateTokens = new Set(tokenize(candidateText));
  if (candidateTokens.size === 0) return 0;
  let hits = 0; phraseTokens.forEach((t) => { if (candidateTokens.has(t)) hits += 1; }); return hits;
}

// ---------------------------------------------------------------------------
// STAGE 1a — Table resolution
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// STAGE 1b — Column resolution
// ---------------------------------------------------------------------------
function findColumnMentions(text: string, tables: TableDef[]): ColumnRef[] {
  const upper = text.toUpperCase(); const cols: ColumnRef[] = [];
  const pool = tables.length ? tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c }))) : [];
  for (const ref of pool) {
    const nameSpaced = ref.column.name.replace(/_/g, ' '); const labelUpper = ref.column.label.toUpperCase();
    if (upper.includes(ref.column.name) || upper.includes(nameSpaced) || upper.includes(labelUpper)) { cols.push(ref); continue; }
    let synonymHit = false;
    for (const [canon, syns] of Object.entries(COLUMN_SYNONYMS)) { if (nameSpaced.includes(canon) && syns.some((s) => upper.includes(s))) { cols.push(ref); synonymHit = true; break; } }
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

// ---------------------------------------------------------------------------
// STAGE 2 — Aggregation resolution
// "total invoice amount", "average invoice amount", "invoice count",
// "number of invoices", "minimum/maximum amount" all resolve to an
// aggregate function applied to a specific NUMBER (or matched) column.
// ---------------------------------------------------------------------------
interface AggregatePhrase { pattern: RegExp; func: MatchedAggregate['func']; }
const AGGREGATE_PHRASES: AggregatePhrase[] = [
  { pattern: /\btotal\b|\bsum of\b|\bsum\b/i, func: 'SUM' },
  { pattern: /\baverage\b|\bavg\b|\bmean\b/i, func: 'AVG' },
  { pattern: /\bcount\b|\bnumber of\b|\bhow many\b/i, func: 'COUNT' },
  { pattern: /\bminimum\b|\bmin\b|\blowest\b|\bsmallest\b/i, func: 'MIN' },
  { pattern: /\bmaximum\b|\bmax\b|\bhighest\b|\blargest\b/i, func: 'MAX' }
];
/** V15.5 — resolves aggregate phrases against numeric schema columns. Two
 * subtleties, both found via targeted testing on real complex requirements
 * and fixed here:
 *
 * 1. A single physical column can legitimately be aggregated MORE THAN
 *    ONCE with different functions in the same requirement (e.g. "total
 *    invoice amount ... average invoice amount"). We therefore scan EVERY
 *    occurrence of a column's name/label in the text (not just the first)
 *    so both the SUM and the AVG get resolved to the same column.
 *
 * 2. A short, generic column name (e.g. a bare `AMOUNT` column on one
 *    table) is a literal substring of a more specific compound phrase
 *    belonging to a DIFFERENT column (e.g. "invoice amount" for
 *    `INVOICE_AMOUNT`), so scanning columns in an arbitrary order can
 *    make the generic column wrongly "steal" a match that was really
 *    about the specific one. Columns are processed longest-name-first,
 *    and once a concept (the column's final `_`-separated suffix, e.g.
 *    "AMOUNT") has been resolved by a compound/specific column, a
 *    different, more generic column sharing that same bare suffix is
 *    skipped entirely for the rest of this parse. */
function extractAggregates(text: string, tables: TableDef[]): MatchedAggregate[] {
  const lower = text.toLowerCase();
  const numericCols = tables.flatMap((t) => t.columns.filter((c) => c.type === 'NUMBER').map((c) => ({ table: t.name, column: c })));
  const results: MatchedAggregate[] = [];
  const seen = new Set<string>();
  const resolvedSuffixes = new Set<string>();

  const withMeta = numericCols.map((ref) => {
    const variants = Array.from(new Set([ref.column.name.toLowerCase(), ref.column.label.toLowerCase(), ref.column.name.replace(/_/g, ' ').toLowerCase()]));
    const maxLen = Math.max(...variants.map((v) => v.length));
    const nameParts = ref.column.name.split('_');
    const suffix = nameParts[nameParts.length - 1].toLowerCase();
    const isGeneric = nameParts.length === 1;
    return { ref, variants, maxLen, suffix, isGeneric };
  }).sort((a, b) => b.maxLen - a.maxLen);

  for (const { ref, variants, suffix, isGeneric } of withMeta) {
    if (isGeneric && resolvedSuffixes.has(suffix)) continue; // a more specific column already covered this concept
    let matchedThisColumn = false;
    for (const variant of variants) {
      let searchFrom = 0;
      while (true) {
        const idx = lower.indexOf(variant, searchFrom);
        if (idx === -1) break;
        searchFrom = idx + variant.length;
        const before = lower.slice(Math.max(0, idx - 40), idx);
        for (const agg of AGGREGATE_PHRASES) {
          if (agg.pattern.test(before)) {
            const key = `${agg.func}:${ref.table}.${ref.column.name}`;
            if (!seen.has(key)) { seen.add(key); results.push({ table: ref.table, column: ref.column.name, func: agg.func, alias: `${agg.func.toLowerCase()}_${ref.column.name.toLowerCase()}` }); }
            matchedThisColumn = true;
            break;
          }
        }
      }
    }
    if (matchedThisColumn && !isGeneric) resolvedSuffixes.add(suffix);
  }
  // Bare "invoice count" / "number of invoices" / "how many invoices" with
  // no explicit numeric column named — falls back to COUNT(*) on the
  // primary/first mentioned table, using its primary key for a stable,
  // schema-grounded COUNT target rather than inventing COUNT(*) blindly.
  if (results.every((r) => r.func !== 'COUNT') && /\bcount\b|\bnumber of\b|\bhow many\b/i.test(lower) && tables.length > 0) {
    const t = tables[0];
    const pk = t.columns.find((c) => c.isPrimaryKey) || t.columns[0];
    if (pk) { const key = `COUNT:${t.name}.${pk.name}`; if (!seen.has(key)) { seen.add(key); results.push({ table: t.name, column: pk.name, func: 'COUNT', alias: `${t.name.toLowerCase()}_count` }); } }
  }
  return results;
}

// ---------------------------------------------------------------------------
// STAGE 3 — Filter resolution (numeric comparisons, decode-label filters,
// relative date filters). Unchanged in spirit from V15.4, retained here.
// ---------------------------------------------------------------------------
interface ComparisonPhrase { pattern: RegExp; operator: FilterCondition['operator']; }
const COMPARISON_PHRASES: ComparisonPhrase[] = [
  { pattern: /greater than or equal to|at least|no less than|>=/, operator: '>=' }, { pattern: /less than or equal to|at most|no more than|<=/, operator: '<=' },
  { pattern: /greater than|more than|above|over|exceed(?:s|ing)?/, operator: '>' }, { pattern: /less than|below|under/, operator: '<' },
  { pattern: /not equal to|different from|<>/, operator: '<>' }, { pattern: /equal to|equals|is exactly|=/, operator: '=' }
];
function extractNumericFilters(text: string, columns: ColumnRef[], combinator: 'AND' | 'OR', excludeAggregateColumns: Set<string>): FilterCondition[] {
  const filters: FilterCondition[] = []; const numericCols = columns.filter((c) => c.column.type === 'NUMBER' && !excludeAggregateColumns.has(`${c.table}.${c.column.name}`)); const lower = text.toLowerCase();
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
  else if (/\bthis\s+year\b|\bcurrent\s+year\b/.test(lower)) clause = { op: '>=', value: "DATE_TRUNC('YEAR', CURRENT_DATE)" };
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

// ---------------------------------------------------------------------------
// STAGE 4 — GROUP BY resolution.
// Explicit "by X" phrasing (e.g. "totals BY supplier") resolves directly.
// Otherwise, GROUP BY is IMPLIED whenever the requirement mixes at least
// one aggregate with at least one plain (non-aggregate) column — exactly
// the SQL rule that any non-aggregated SELECT column must be grouped.
// ---------------------------------------------------------------------------
function extractExplicitGroupByPhrase(text: string, tables: TableDef[]): ColumnRef[] {
  const m = text.match(/\bby\s+([a-z0-9_ ]+?)(?:[.,]|\bfor\b|\bonly\b|\bwith\b|\bwhere\b|$)/i);
  if (!m) return [];
  const phrase = m[1].trim().toLowerCase();
  const hits: ColumnRef[] = [];
  for (const t of tables) for (const c of t.columns) { if (phrase.includes(c.name.toLowerCase()) || phrase.includes(c.label.toLowerCase())) hits.push({ table: t.name, column: c }); }
  return hits;
}

// ---------------------------------------------------------------------------
// STAGE 5 — HAVING resolution: a comparison phrase whose subject is an
// aggregate column that was ALSO resolved in stage 2 (e.g. "total invoice
// amount is greater than 100000") becomes a HAVING condition on that
// aggregate expression, instead of a plain WHERE filter (which would be
// invalid SQL against an aggregate).
// ---------------------------------------------------------------------------
/** V15.5 fix — a column can appear multiple times in a complex requirement
 * (e.g. "total invoice amount by supplier ... total invoice amount is
 * greater than 100000") for different purposes; only checking the FIRST
 * occurrence of a variant meant the aggregate's own mention (e.g. inside
 * "show the total invoice amount by supplier") was found instead of the
 * later occurrence that actually carries the comparison. Every occurrence
 * of every aggregate's column/alias is now checked, and the first one
 * genuinely followed by a comparison + number wins. */
function extractHaving(text: string, aggregates: MatchedAggregate[]): MatchedHaving | null {
  if (aggregates.length === 0) return null;
  const lower = text.toLowerCase();
  for (const agg of aggregates) {
    const variants = [agg.column.toLowerCase(), agg.column.replace(/_/g, ' ').toLowerCase(), agg.alias.toLowerCase()];
    for (const variant of variants) {
      let searchFrom = 0;
      while (true) {
        const idx = lower.indexOf(variant, searchFrom);
        if (idx === -1) break;
        searchFrom = idx + variant.length;
        const windowText = lower.slice(idx, idx + 100);
        for (const cmp of COMPARISON_PHRASES) {
          const cmpMatch = windowText.match(cmp.pattern);
          if (cmpMatch) {
            const afterCmp = windowText.slice(cmpMatch.index || 0);
            const numMatch = afterCmp.match(/-?\d[\d,]*(\.\d+)?/);
            if (numMatch) return { aggregateExpr: `${agg.func}(${agg.table}.${agg.column})`, operator: cmp.operator, value: numMatch[0].replace(/,/g, '') };
          }
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// STAGE 6 — Related/EXISTS resolution: conservative heuristic that only
// fires on an explicit relationship phrase ("that have", "that has",
// "with related", "with at least one") followed by a table name that the
// Active Schema's relationships actually connect to one of the matched
// tables — via relatedEngine.relatableTables(), so this can never invent a
// relationship that doesn't exist in the schema.
// ---------------------------------------------------------------------------
function extractRelatedConditions(text: string, schema: SchemaModel, matchedTables: string[]): MatchedRelatedCondition[] {
  if (matchedTables.length === 0) return [];
  const lower = text.toLowerCase();
  const relatable = relatableTables(schema, matchedTables);
  if (relatable.length === 0) return [];
  const results: MatchedRelatedCondition[] = [];
  const positivePatterns = [/that have\s+([a-z0-9_ ]+)/i, /that has\s+([a-z0-9_ ]+)/i, /with (?:at least one|related)\s+([a-z0-9_ ]+)/i, /with\s+([a-z0-9_ ]+)\s+on file/i];
  const negativePatterns = [/that (?:do not|don't) have\s+([a-z0-9_ ]+)/i, /without (?:any\s+)?([a-z0-9_ ]+)/i, /that have no\s+([a-z0-9_ ]+)/i];
  for (const r of relatable) {
    const spaced = r.table.replace(/_/g, ' ').toLowerCase();
    const singular = spaced.replace(/s$/, '');
    for (const p of negativePatterns) { const m = lower.match(p); if (m && (m[1].includes(spaced) || m[1].includes(singular))) { results.push({ relatedTable: r.table, mode: 'NOT EXISTS' }); } }
    for (const p of positivePatterns) { const m = lower.match(p); if (m && (m[1].includes(spaced) || m[1].includes(singular)) && !results.some((x) => x.relatedTable === r.table)) { results.push({ relatedTable: r.table, mode: 'EXISTS' }); } }
  }
  return results;
}

function detectCombinator(text: string): 'AND' | 'OR' { return /\bor\b/i.test(text) && !/\band\b/i.test(text) ? 'OR' : 'AND'; }

// ---------------------------------------------------------------------------
// STAGE 7 — Sort / Limit resolution.
// "top N <tables>" / "top N" -> LIMIT N.
// "sort/order by X [ascending|descending]" -> ORDER BY, aggregate-aware:
// if X matches an aggregate's column/alias, sort by that aggregate
// expression (with its alias) rather than the bare column.
// ---------------------------------------------------------------------------
function extractLimit(text: string): number | null {
  const m = text.match(/\btop\s+(\d+)\b/i) || text.match(/\b(?:first|limit)\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}
function extractDistinct(text: string): boolean { return /\bdistinct\b|\bunique\b/i.test(text); }
/** V15.5 fix — the previous regex required the direction word (if any) to
 * be IMMEDIATELY followed by a sentence terminator (period/comma/end), so
 * a perfectly natural phrasing like "...descending and show the top 20..."
 * (direction word followed by more sentence, not a comma) caused the
 * WHOLE remainder of the sentence to be swallowed into the "column
 * phrase" capture instead of being recognized as the direction — silently
 * defaulting to ASC. The direction word is now matched with only a
 * trailing word-boundary, so whatever follows it (comma, "and", end of
 * sentence, anything) no longer affects whether it's recognized. */
function extractSorts(text: string, tables: TableDef[], aggregates: MatchedAggregate[]): SortSpec[] {
  const withDirection = text.match(/(?:sort|order)(?:ed)?\s+by\s+([a-z0-9_ ]+?)\s*(ascending|asc|descending|desc)\b/i);
  let phrase: string; let direction: SortSpec['direction'];
  if (withDirection) { phrase = withDirection[1].trim().toLowerCase(); direction = /desc/i.test(withDirection[2]) ? 'DESC' : 'ASC'; }
  else {
    const withoutDirection = text.match(/(?:sort|order)(?:ed)?\s+by\s+([a-z0-9_ ]+?)(?:[.,]|$)/i);
    if (!withoutDirection) return [];
    phrase = withoutDirection[1].trim().toLowerCase(); direction = 'ASC';
  }
  // Aggregate-aware: "sort by total amount descending" should sort by the
  // SUM(...) expression (via its alias), not by the bare, non-aggregated
  // column — which would be invalid alongside a GROUP BY.
  for (const agg of aggregates) {
    const variants = [agg.column.toLowerCase(), agg.column.replace(/_/g, ' ').toLowerCase(), agg.alias.toLowerCase(), 'total', 'average', 'count'];
    if (variants.some((v) => phrase.includes(v))) return [{ id: makeId('sort'), table: agg.table, column: agg.column, direction, alias: agg.alias }];
  }
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

/** Main pipeline entry point — runs every resolution stage in sequence and
 * assembles a single QueryRequirement. Every stage is schema-grounded
 * (only ever references tables/columns/relationships that genuinely exist
 * in the Active Schema passed in) — per the "no invented schema objects"
 * requirement, an object is either resolved from real schema metadata or
 * left unresolved (surfaced via unresolvedTerms/notes), never fabricated. */
export function parseRequirement(rawText: string, schema: SchemaModel): QueryRequirement {
  const notes: string[] = []; const queryPlan: string[] = []; const clarifications: ClarificationQuestion[] = [];
  const text = rawText.trim();
  const empty = (): QueryRequirement => ({ rawText, matchedTables: [], matchedColumns: [], matchedFilters: [], matchedSorts: [], limit: null, distinct: false, confidence: 0, notes, queryPlan, clarifications, unresolvedTerms: [], matchedAggregates: [], matchedGroupBy: [], matchedHaving: null, matchedRelatedConditions: [] });
  if (!text) { notes.push('No requirement text was provided — using manual selections only.'); return empty(); }

  // Stage 1
  const tables = findTableMentions(text, schema);
  if (tables.length === 0) { notes.push('Could not confidently identify any table from the active schema — try mentioning a table or business term explicitly.'); const r = empty(); r.confidence = 0.1; r.unresolvedTerms = findUnresolvedTerms(text, schema); return r; }
  queryPlan.push(`Identified table(s): ${tables.map((t) => t.name).join(', ')}.`);
  const columnRefs = findColumnMentions(text, tables);

  // Stage 2 — aggregates (resolved before plain-column filtering so we can
  // exclude aggregate-target columns from being ALSO treated as a plain
  // WHERE filter target further down).
  const aggregates = extractAggregates(text, tables);
  const aggregateColKeys = new Set(aggregates.map((a) => `${a.table}.${a.column}`));
  // V15.5 fix — a bare, generic column name (e.g. a lone `AMOUNT` column on
  // an unrelated table) can independently match via the plain-column
  // synonym scan (findColumnMentions) even though the SAME underlying
  // business concept was already correctly resolved as a specific
  // aggregate elsewhere (e.g. SUM(INVOICE_HEADER.INVOICE_AMOUNT)) — this
  // produced a spurious, unrequested column in the SELECT/GROUP BY list.
  // Any generic (single-word-named) column sharing an aggregate's
  // resolved suffix, that ISN'T itself the exact column being aggregated,
  // is filtered out here.
  const aggregatedSuffixes = new Set(aggregates.map((a) => { const parts = a.column.split('_'); return parts[parts.length - 1].toLowerCase(); }));
  const matchedColumns: SelectedColumnSpec[] = columnRefs
    .filter((ref) => !aggregateColKeys.has(`${ref.table}.${ref.column.name}`))
    .filter((ref) => { const parts = ref.column.name.split('_'); const isGeneric = parts.length === 1; const suffix = parts[parts.length - 1].toLowerCase(); return !(isGeneric && aggregatedSuffixes.has(suffix)); })
    .map((ref) => ({ id: makeId('col'), table: ref.table, column: ref.column.name, alias: '', useDecode: false, aggregate: null, displayMode: 'raw' }));
  if (matchedColumns.length) queryPlan.push(`Identified column(s): ${matchedColumns.map((c) => `${c.table}.${c.column}`).join(', ')}.`);
  if (aggregates.length) queryPlan.push(`Identified aggregation(s): ${aggregates.map((a) => `${a.func}(${a.table}.${a.column})`).join(', ')}.`);

  // Stage 3 — filters
  const combinator = detectCombinator(text);
  const decodeFilters = extractDecodeFilters(text, tables);
  const numericFilters = extractNumericFilters(text, columnRefs, combinator, aggregateColKeys);
  const dateResult = extractDateFilterCandidates(text, tables);
  const matchedFilters: FilterCondition[] = [...decodeFilters, ...numericFilters];
  if (dateResult) { matchedFilters.push(dateResult.filter); queryPlan.push(`Applied a relative date filter on ${dateResult.filter.table}.${dateResult.filter.column}.`); if (dateResult.alternativeColumns.length) clarifications.push({ question: `Multiple date columns exist on ${tables[0].name} — did you mean a different one?`, options: dateResult.alternativeColumns.map((c) => `${c.table}.${c.column.name}`) }); }
  if (matchedFilters.length) queryPlan.push(`Built ${matchedFilters.length} filter(s).`);

  // Stage 4 — GROUP BY (explicit "by X", else implied by aggregate+column mix)
  const explicitGroupBy = extractExplicitGroupByPhrase(text, tables);
  let matchedGroupBy: string[] = explicitGroupBy.map((r) => `${r.table}.${r.column.name}`);
  if (matchedGroupBy.length === 0 && aggregates.length > 0 && matchedColumns.length > 0) {
    matchedGroupBy = matchedColumns.map((c) => `${c.table}.${c.column}`);
    queryPlan.push(`Inferred GROUP BY from the non-aggregated column(s) alongside the aggregation: ${matchedGroupBy.join(', ')}.`);
  } else if (matchedGroupBy.length) {
    queryPlan.push(`Identified explicit GROUP BY: ${matchedGroupBy.join(', ')}.`);
  }

  // Stage 5 — HAVING (must be resolved AFTER aggregates, and should not
  // also leak into matchedFilters — extractNumericFilters already excludes
  // aggregate-target columns via aggregateColKeys, so no double-application).
  const matchedHaving = extractHaving(text, aggregates);
  if (matchedHaving) queryPlan.push(`Applied HAVING ${matchedHaving.aggregateExpr} ${matchedHaving.operator} ${matchedHaving.value}.`);

  // Stage 6 — related/EXISTS conditions
  const matchedRelatedConditions = extractRelatedConditions(text, schema, tables.map((t) => t.name));
  if (matchedRelatedConditions.length) queryPlan.push(`Applied related-table condition(s): ${matchedRelatedConditions.map((c) => `${c.mode} ${c.relatedTable}`).join(', ')}.`);

  // Stage 7 — sort / limit / distinct
  const matchedSorts = extractSorts(text, tables, aggregates);
  if (matchedSorts.length) queryPlan.push(`Applied ORDER BY ${matchedSorts.map((s) => `${s.alias || `${s.table}.${s.column}`} ${s.direction}`).join(', ')}.`);
  const limit = extractLimit(text);
  if (limit) queryPlan.push(`Applied a result limit of ${limit}.`);
  const distinct = extractDistinct(text);
  const unresolvedTerms = findUnresolvedTerms(text, schema);
  const confidence = Math.min(1, 0.3 + (matchedColumns.length ? 0.15 : 0) + (matchedFilters.length ? 0.15 : 0) + (tables.length ? 0.2 : 0) + (aggregates.length ? 0.1 : 0) + (matchedGroupBy.length ? 0.1 : 0));
  return { rawText, matchedTables: tables.map((t) => t.name), matchedColumns, matchedFilters, matchedSorts, limit, distinct, confidence, notes, queryPlan, clarifications, unresolvedTerms, matchedAggregates: aggregates, matchedGroupBy, matchedHaving, matchedRelatedConditions };
}
export function filterToKnownTables(names: string[], schema: SchemaModel): { known: string[]; unknown: string[] } {
  const knownSet = new Set(schema.tables.map((t) => t.name));
  const known = names.filter((n) => knownSet.has(n));
  const unknown = names.filter((n) => !knownSet.has(n));
  return { known, unknown };
}
export function filterToKnownColumns(pairs: { table: string; column: string }[], schema: SchemaModel): { known: { table: string; column: string }[]; unknown: { table: string; column: string }[] } {
  const known: { table: string; column: string }[] = []; const unknown: { table: string; column: string }[] = [];
  pairs.forEach((p) => { const table = schema.tables.find((t) => t.name === p.table); const exists = table?.columns.some((c) => c.name === p.column); if (exists) known.push(p); else unknown.push(p); });
  return { known, unknown };
}
