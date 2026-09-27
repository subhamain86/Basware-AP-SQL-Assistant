import { safeTrim, safeUpperTrim } from '../utils/validation.js';
export function validateDecodeEntries(entries) {
    const issues = [];
    const seen = new Set();
    entries.forEach((e) => {
        const raw = safeTrim(e?.rawValue);
        if (!raw) {
            issues.push('Every decode entry needs a raw value.');
            return;
        }
        const key = safeUpperTrim(raw);
        if (seen.has(key))
            issues.push(`Duplicate decode raw value "${raw}".`);
        seen.add(key);
    });
    return issues;
}
export function decodeLegend(column) {
    if (!column.decode || column.decode.length === 0)
        return '';
    return column.decode.map((d) => `${safeTrim(d.rawValue)}=${safeTrim(d.label)}`).join(', ');
}
function quoteLiteral(v) { return `'${v.replace(/'/g, "''")}'`; }
export function buildSchemaDecodeExpression(sourceExpr, column, alias, dialect) {
    const entries = column.decode || [];
    if (entries.length === 0)
        return sourceExpr;
    if (dialect === 'Oracle') {
        const pairs = entries.map((e) => `${quoteLiteral(safeTrim(e.rawValue))}, ${quoteLiteral(safeTrim(e.label))}`).join(', ');
        return `DECODE(${sourceExpr}, ${pairs}, ${sourceExpr}) AS ${alias}`;
    }
    const whens = entries.map((e) => `WHEN ${sourceExpr} = ${quoteLiteral(safeTrim(e.rawValue))} THEN ${quoteLiteral(safeTrim(e.label))}`).join(' ');
    return `CASE ${whens} ELSE ${sourceExpr} END AS ${alias}`;
}
export function buildManualCaseExpression(whens, elseValue, alias) {
    const clauses = whens.map((w) => `WHEN ${w.whenExpr} THEN ${quoteLiteral(w.thenValue)}`).join(' ');
    const elsePart = elseValue.trim() ? ` ELSE ${quoteLiteral(elseValue)}` : '';
    return `CASE ${clauses}${elsePart} END AS ${alias}`;
}
export function buildManualDecodeExpression(source, pairs, elseValue, alias, dialect) {
    if (dialect === 'Oracle') {
        const flat = pairs.map((p) => `${quoteLiteral(p.rawValue)}, ${quoteLiteral(p.label)}`).join(', ');
        const elsePart = elseValue.trim() ? `, ${quoteLiteral(elseValue)}` : '';
        return `DECODE(${source}, ${flat}${elsePart}) AS ${alias}`;
    }
    const whens = pairs.map((p) => `WHEN ${source} = ${quoteLiteral(p.rawValue)} THEN ${quoteLiteral(p.label)}`).join(' ');
    const elsePart = elseValue.trim() ? ` ELSE ${quoteLiteral(elseValue)}` : '';
    return `CASE ${whens}${elsePart} END AS ${alias}`;
}
