import type { ColumnDef, Dialect, DecodeEntry } from '../types';
export function buildDecodeExpression(col: ColumnDef, tableName: string, dialect: Dialect, alias?: string): string {
  const fq = `${tableName}.${col.name}`;
  if (!col.decode || col.decode.length === 0) return fq;
  const finalAlias = alias || `${col.name}_DESC`;
  if (dialect === 'Oracle') { const args = col.decode.map((d) => `'${d.rawValue}', '${d.label.replace(/'/g, "''")}'`).join(', '); return `DECODE(${fq}, ${args}, ${fq}) AS ${finalAlias}`; }
  const whens = col.decode.map((d) => `    WHEN ${fq} = '${d.rawValue}' THEN '${d.label.replace(/'/g, "''")}'`).join('\n');
  return `CASE\n${whens}\n    ELSE ${fq}\n  END AS ${finalAlias}`;
}
export function decodeLegend(col: ColumnDef): string { if (!col.decode) return ''; return col.decode.map((d) => `${d.rawValue} = ${d.label}`).join(', '); }
export function validateDecodeEntries(entries: DecodeEntry[]): string[] {
  const issues: string[] = []; const seen = new Set<string>();
  entries.forEach((e, idx) => {
    if (!e.rawValue.trim()) issues.push(`Row ${idx + 1}: raw value cannot be empty.`);
    if (!e.label.trim()) issues.push(`Row ${idx + 1}: label cannot be empty.`);
    const key = e.rawValue.trim().toUpperCase();
    if (key && seen.has(key)) issues.push(`Duplicate raw value "${e.rawValue}" — each raw value must be unique.`);
    seen.add(key);
  });
  return issues;
}
