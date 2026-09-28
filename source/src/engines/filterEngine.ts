import type { FilterOperator } from '../types';
export const FILTER_OPERATORS: FilterOperator[] = ['=', '<>', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL', 'IN', 'NOT IN', 'BETWEEN'];
export function requiresValue(op: FilterOperator): boolean { return op !== 'IS NULL' && op !== 'IS NOT NULL'; }
export function requiresSecondValue(op: FilterOperator): boolean { return op === 'BETWEEN'; }
/** V15.5 fix — previously only an EXACT match against a short fixed list of
 * bare date keywords (e.g. `current_date`) was left unquoted; any longer
 * SQL date expression produced by the NLP engine's relative-date filter
 * resolution (e.g. `DATE_TRUNC('YEAR', CURRENT_DATE)` or
 * `CURRENT_DATE - INTERVAL '1 DAY'`) fell through to the default branch
 * and was incorrectly wrapped in an extra pair of outer string quotes,
 * turning a real date expression into a broken string literal. Any value
 * that CONTAINS one of these SQL date building blocks — not just matches
 * one exactly — is now passed through as raw SQL unchanged. */
const SQL_EXPRESSION_MARKERS = /\b(CURRENT_DATE|CURRENT_TIMESTAMP|SYSDATE|GETDATE\(\)|NOW\(\)|INTERVAL|DATE_TRUNC)\b/i;
function quoteIfNeeded(v: string): string {
  const trimmed = v.trim();
  if (trimmed === '') return "''";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (SQL_EXPRESSION_MARKERS.test(trimmed)) return trimmed;
  return `'${trimmed.replace(/'/g, "''")}'`;
}
export function renderFilterClause(table: string, column: string, operator: FilterOperator, value: string, value2?: string): string {
  const ref = `${table}.${column}`;
  switch (operator) {
    case 'IS NULL': return `${ref} IS NULL`;
    case 'IS NOT NULL': return `${ref} IS NOT NULL`;
    case 'IN': return `${ref} IN (${value.split(',').map((v) => quoteIfNeeded(v)).join(', ')})`;
    case 'NOT IN': return `${ref} NOT IN (${value.split(',').map((v) => quoteIfNeeded(v)).join(', ')})`;
    case 'BETWEEN': return `${ref} BETWEEN ${quoteIfNeeded(value)} AND ${quoteIfNeeded(value2 || '')}`;
    case 'LIKE': return `${ref} LIKE ${quoteIfNeeded(value)}`;
    case 'NOT LIKE': return `${ref} NOT LIKE ${quoteIfNeeded(value)}`;
    default: return `${ref} ${operator} ${quoteIfNeeded(value)}`;
  }
}
