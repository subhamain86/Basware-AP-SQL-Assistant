import type { ColumnDef, Dialect, DecodeEntry } from '../types';
import { safeTrim, safeUpperTrim } from '../utils/validation';
export function buildDecodeExpression(col: ColumnDef, tableName: string, dialect: Dialect, alias?: string): string {
  const fq = `${tableName}.${col.name}`;
  if (!col.decode || col.decode.length === 0) return fq;
  const finalAlias = alias || `${col.name}_DESC`;
  if (dialect === 'Oracle') { const args = col.decode.map((d) => `'${safeTrim(d.rawValue)}', '${safeTrim(d.label).replace(/'/g, "''")}'`).join(', '); return `DECODE(${fq}, ${args}, ${fq}) AS ${finalAlias}`; }
  const whens = col.decode.map((d) => `    WHEN ${fq} = '${safeTrim(d.rawValue)}' THEN '${safeTrim(d.label).replace(/'/g, "''")}'`).join('\n');
  return `CASE\n${whens}\n    ELSE ${fq}\n  END AS ${finalAlias}`;
}
export function decodeLegend(col: ColumnDef): string { if (!col.decode) return ''; return col.decode.map((d) => `${safeTrim(d.rawValue)} = ${safeTrim(d.label)}`).join(', '); }
/** V14.6 — hardened: previously called `.trim()` directly on `e.rawValue`/
 * `e.label` with no guard, which crashed on any malformed decode entry
 * (undefined rawValue/label) from manual editing, JSON import, or a
 * schema synced in from another device. Now every access goes through
 * safeTrim, so a malformed entry is reported as a validation issue
 * instead of throwing. */
export function validateDecodeEntries(entries: DecodeEntry[]): string[] {
  const issues: string[] = []; const seen = new Set<string>();
  entries.forEach((e, idx) => {
    const rawValue = safeTrim(e?.rawValue);
    const label = safeTrim(e?.label);
    if (!rawValue) issues.push(`Row ${idx + 1}: raw value cannot be empty.`);
    if (!label) issues.push(`Row ${idx + 1}: label cannot be empty.`);
    const key = safeUpperTrim(e?.rawValue);
    if (key && seen.has(key)) issues.push(`Duplicate raw value "${rawValue}" — each raw value must be unique.`);
    seen.add(key);
  });
  return issues;
}
export function buildManualCaseExpression(whens: { whenExpr: string; thenValue: string }[], elseValue: string, alias: string): string {
  const body = whens.map((w) => `    WHEN ${w.whenExpr} THEN ${quoteIfPlainValue(w.thenValue)}`).join('\n');
  return `CASE\n${body}\n    ELSE ${quoteIfPlainValue(elseValue)}\n  END AS ${alias}`;
}
export function buildManualDecodeExpression(sourceExpr: string, pairs: { rawValue: string; label: string }[], elseValue: string, alias: string, dialect: Dialect): string {
  if (dialect === 'Oracle') {
    const args = pairs.map((p) => `'${safeTrim(p.rawValue)}', ${quoteIfPlainValue(p.label)}`).join(', ');
    return `DECODE(${sourceExpr}, ${args}, ${quoteIfPlainValue(elseValue)}) AS ${alias}`;
  }
  const whens = pairs.map((p) => `    WHEN ${sourceExpr} = '${safeTrim(p.rawValue)}' THEN ${quoteIfPlainValue(p.label)}`).join('\n');
  return `CASE\n${whens}\n    ELSE ${quoteIfPlainValue(elseValue)}\n  END AS ${alias}`;
}
function quoteIfPlainValue(v: string): string {
  const t = safeTrim(v);
  if (t === '') return 'NULL';
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  if (t.startsWith("'") && t.endsWith("'")) return t;
  return `'${t.replace(/'/g, "''")}'`;
}
