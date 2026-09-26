import type { FilterCondition, FilterOperator } from '../types';
const NO_VALUE_OPERATORS: FilterOperator[] = ['IS NULL', 'IS NOT NULL'];
const LIST_OPERATORS: FilterOperator[] = ['IN', 'NOT IN'];
const SQL_EXPRESSION_PATTERN = /\b(CURRENT_DATE|CURRENT_TIMESTAMP|SYSDATE|GETDATE\s*\(|NOW\s*\(|DATE_TRUNC\s*\(|INTERVAL)\b/i;
function quoteIfNeeded(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return "''";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed;
  if (SQL_EXPRESSION_PATTERN.test(trimmed)) return trimmed;
  return `'${trimmed.replace(/'/g, "''")}'`;
}
function buildListLiteral(raw: string): string { const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0).map(quoteIfNeeded); return `(${parts.join(', ')})`; }
export function requiresValue(op: FilterOperator): boolean { return !NO_VALUE_OPERATORS.includes(op); }
export function requiresSecondValue(op: FilterOperator): boolean { return op === 'BETWEEN'; }
export function renderCondition(f: FilterCondition): string {
  const col = `${f.table}.${f.column}`;
  if (NO_VALUE_OPERATORS.includes(f.operator)) return `${col} ${f.operator}`;
  if (LIST_OPERATORS.includes(f.operator)) return `${col} ${f.operator} ${buildListLiteral(f.value)}`;
  if (f.operator === 'BETWEEN') return `${col} BETWEEN ${quoteIfNeeded(f.value)} AND ${quoteIfNeeded(f.value2 || '')}`;
  if (f.operator === 'LIKE' || f.operator === 'NOT LIKE') { const val = f.value.includes('%') ? f.value : `%${f.value}%`; return `${col} ${f.operator} ${quoteIfNeeded(val)}`; }
  return `${col} ${f.operator} ${quoteIfNeeded(f.value)}`;
}
export function buildWhereClause(filters: FilterCondition[]): string { if (filters.length === 0) return ''; return filters.map((f, idx) => (idx === 0 ? renderCondition(f) : `${f.combinator} ${renderCondition(f)}`)).join('\n  '); }
export const FILTER_OPERATORS: FilterOperator[] = ['=', '<>', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL', 'IN', 'NOT IN', 'BETWEEN'];
