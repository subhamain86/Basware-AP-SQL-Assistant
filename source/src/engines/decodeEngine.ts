import type { ColumnDef, DecodeEntry, Dialect } from '../types';
import { safeTrim, safeUpperTrim } from '../utils/validation';
export function validateDecodeEntries(entries: DecodeEntry[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  entries.forEach((e) => {
    const raw = safeTrim(e?.rawValue);
    if (!raw) { issues.push('Every decode entry needs a raw value.'); return; }
    const key = safeUpperTrim(raw);
    if (seen.has(key)) issues.push(`Duplicate decode raw value "${raw}".`);
    seen.add(key);
  });
  return issues;
}
export function decodeLegend(column: ColumnDef): string {
  if (!column.decode || column.decode.length === 0) return '';
  return column.decode.map((d) => `${safeTrim(d.rawValue)}=${safeTrim(d.label)}`).join(', ');
}
function quoteLiteral(v: string): string { return `'${v.replace(/'/g, "''")}'`; }
/** V15.5 — a raw DECODE value is rendered UNQUOTED in the generated CASE
 * expression only when it is purely numeric (matching the spec's own
 * examples, e.g. `WHEN status = 1`), since numeric status codes are
 * typically stored/compared without quotes. Any non-numeric raw value
 * (e.g. 'A', 'O', 'APP') is still quoted, since it is a string literal. */
function formatRawValueForCase(raw: string): string {
  const trimmed = safeTrim(raw);
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return quoteLiteral(trimmed);
}
/** V15.5 core requirement — "DECODE must be treated as CASE-based
 * query-generation functionality": regardless of SQL dialect (including
 * Oracle), a schema-defined DECODE mapping now ALWAYS generates a
 * standard, portable `CASE WHEN ... THEN ... ELSE ... END` expression —
 * the application never emits a database-specific `DECODE(...)` function
 * call anymore. The `dialect` parameter is intentionally still accepted
 * (kept for call-site/API compatibility and because other, unrelated
 * parts of the engine remain dialect-aware) but no longer branches the
 * output shape here. */
export function buildSchemaDecodeExpression(sourceExpr: string, column: ColumnDef, alias: string, _dialect: Dialect): string {
  const entries = column.decode || [];
  if (entries.length === 0) return sourceExpr;
  const whens = entries.map((e) => `WHEN ${sourceExpr} = ${formatRawValueForCase(e.rawValue)} THEN ${quoteLiteral(safeTrim(e.label))}`).join('\n    ');
  return `CASE\n    ${whens}\n    ELSE 'Unknown'\nEND AS ${alias}`;
}
export function buildManualCaseExpression(whens: { whenExpr: string; thenValue: string }[], elseValue: string, alias: string): string {
  const clauses = whens.map((w) => `WHEN ${w.whenExpr} THEN ${quoteLiteral(w.thenValue)}`).join('\n    ');
  const elsePart = elseValue.trim() ? `\n    ELSE ${quoteLiteral(elseValue)}` : '';
  return `CASE\n    ${clauses}${elsePart}\nEND AS ${alias}`;
}
/** V15.5 — manual DECODE configuration (from the Manual CASE/DECODE
 * builder) is likewise ALWAYS converted into a CASE expression, never a
 * dialect-specific DECODE() call, for the same reason as
 * buildSchemaDecodeExpression above. */
export function buildManualDecodeExpression(source: string, pairs: { rawValue: string; label: string }[], elseValue: string, alias: string, _dialect: Dialect): string {
  const whens = pairs.map((p) => `WHEN ${source} = ${formatRawValueForCase(p.rawValue)} THEN ${quoteLiteral(p.label)}`).join('\n    ');
  const elsePart = elseValue.trim() ? `\n    ELSE ${quoteLiteral(elseValue)}` : "\n    ELSE 'Unknown'";
  return `CASE\n    ${whens}${elsePart}\nEND AS ${alias}`;
}
