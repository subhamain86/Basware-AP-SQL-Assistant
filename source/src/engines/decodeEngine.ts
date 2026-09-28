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
function formatRawValueForCase(raw: string): string {
  const trimmed = safeTrim(raw);
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return quoteLiteral(trimmed);
}
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
export function buildManualDecodeExpression(source: string, pairs: { rawValue: string; label: string }[], elseValue: string, alias: string, _dialect: Dialect): string {
  const whens = pairs.map((p) => `WHEN ${source} = ${formatRawValueForCase(p.rawValue)} THEN ${quoteLiteral(p.label)}`).join('\n    ');
  const elsePart = elseValue.trim() ? `\n    ELSE ${quoteLiteral(elseValue)}` : "\n    ELSE 'Unknown'";
  return `CASE\n    ${whens}${elsePart}\nEND AS ${alias}`;
}
