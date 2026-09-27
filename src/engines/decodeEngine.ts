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
export function buildSchemaDecodeExpression(sourceExpr: string, column: ColumnDef, alias: string, dialect: Dialect): string {
  const entries = column.decode || [];
  if (entries.length === 0) return sourceExpr;
  if (dialect === 'Oracle') {
    const pairs = entries.map((e) => `${quoteLiteral(safeTrim(e.rawValue))}, ${quoteLiteral(safeTrim(e.label))}`).join(', ');
    return `DECODE(${sourceExpr}, ${pairs}, ${sourceExpr}) AS ${alias}`;
  }
  const whens = entries.map((e) => `WHEN ${sourceExpr} = ${quoteLiteral(safeTrim(e.rawValue))} THEN ${quoteLiteral(safeTrim(e.label))}`).join(' ');
  return `CASE ${whens} ELSE ${sourceExpr} END AS ${alias}`;
}
export function buildManualCaseExpression(whens: { whenExpr: string; thenValue: string }[], elseValue: string, alias: string): string {
  const clauses = whens.map((w) => `WHEN ${w.whenExpr} THEN ${quoteLiteral(w.thenValue)}`).join(' ');
  const elsePart = elseValue.trim() ? ` ELSE ${quoteLiteral(elseValue)}` : '';
  return `CASE ${clauses}${elsePart} END AS ${alias}`;
}
export function buildManualDecodeExpression(source: string, pairs: { rawValue: string; label: string }[], elseValue: string, alias: string, dialect: Dialect): string {
  if (dialect === 'Oracle') {
    const flat = pairs.map((p) => `${quoteLiteral(p.rawValue)}, ${quoteLiteral(p.label)}`).join(', ');
    const elsePart = elseValue.trim() ? `, ${quoteLiteral(elseValue)}` : '';
    return `DECODE(${source}, ${flat}${elsePart}) AS ${alias}`;
  }
  const whens = pairs.map((p) => `WHEN ${source} = ${quoteLiteral(p.rawValue)} THEN ${quoteLiteral(p.label)}`).join(' ');
  const elsePart = elseValue.trim() ? ` ELSE ${quoteLiteral(elseValue)}` : '';
  return `CASE ${whens}${elsePart} END AS ${alias}`;
}
