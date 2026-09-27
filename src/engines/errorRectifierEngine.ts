import type { Dialect, RectifyResult } from '../types';
interface Rule { test: RegExp; dialect: Dialect | null; explain: string; fix: (sql: string, match: RegExpMatchArray) => { sql: string; changes: string[] }; }
const RULES: Rule[] = [
  { test: /ORA-00904:\s*"?(?:invalid identifier\s*)?"?([A-Z0-9_."]+)"?/i, dialect: 'Oracle', explain: 'ORA-00904 means the column or alias referenced does not exist.', fix: (sql, m) => ({ sql: `-- Review: "${(m[1]||'').replace(/"/g,'')}" was not found.\n${sql}`, changes: ['Flagged the column for a typo/scope check.'] }) },
  { test: /ORA-00942:\s*table or view does not exist/i, dialect: 'Oracle', explain: 'ORA-00942 means the table/view name is misspelled or missing.', fix: (sql) => ({ sql: `-- Review: confirm the table/view name.\n${sql}`, changes: ['Flagged FROM/JOIN target for a name check.'] }) },
  { test: /Unknown column\s+'([^']+)'/i, dialect: 'MySQL', explain: 'MySQL could not find this column in scope.', fix: (sql, m) => ({ sql: `-- Review: unknown column '${m[1]}'.\n${sql}`, changes: [`Flagged unknown column '${m[1]}'.`] }) }
];
function detectUnbalancedParens(sql: string): string[] { let depth = 0; for (const ch of sql) { if (ch === '(') depth++; if (ch === ')') depth--; } if (depth !== 0) return [`Detected unbalanced parentheses (depth=${depth}).`]; return []; }
export function rectify(errorText: string, sql: string): RectifyResult {
  const structural = detectUnbalancedParens(sql);
  for (const rule of RULES) { const match = errorText.match(rule.test); if (match) { const { sql: fixedSql, changes } = rule.fix(sql, match); return { correctedSql: fixedSql, explanation: rule.explain, whatChanged: [...changes, ...structural], detectedDialect: rule.dialect }; } }
  return { correctedSql: sql, explanation: 'This error did not match a known pattern. Verify object names, GROUP BY, and aliasing.', whatChanged: structural.length ? structural : ['No auto-fix applied.'], detectedDialect: null };
}
