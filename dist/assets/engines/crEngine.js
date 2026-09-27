function buildWhereClause(filters) {
    if (filters.length === 0)
        return '';
    return filters.map((f, idx) => {
        const clause = f.operator === 'IS NULL' ? `${f.table}.${f.column} IS NULL`
            : f.operator === 'IS NOT NULL' ? `${f.table}.${f.column} IS NOT NULL`
                : `${f.table}.${f.column} ${f.operator} ${formatValue(f.value)}`;
        return idx === 0 ? clause : `${f.combinator} ${clause}`;
    }).join('\n  ');
}
function formatValue(raw) {
    const trimmed = raw.trim();
    if (trimmed === '')
        return 'NULL';
    if (/^-?\d+(\.\d+)?$/.test(trimmed))
        return trimmed;
    if (/^(sysdate|getdate\(\)|now\(\)|current_date|current_timestamp)$/i.test(trimmed))
        return trimmed.toUpperCase();
    if (trimmed.startsWith("'") && trimmed.endsWith("'"))
        return trimmed;
    return `'${trimmed.replace(/'/g, "''")}'`;
}
export function buildCrSQL(state) {
    if (!state.table)
        return { sql: '-- Choose a table for this Change Request.', blocked: true, reason: 'No table selected.' };
    const whereClause = buildWhereClause(state.filters);
    const needsWhere = state.queryType === 'UPDATE' || state.queryType === 'DELETE';
    if (needsWhere && !whereClause && !state.confirmNoWhere)
        return { sql: '-- A WHERE condition is required to identify which records should be updated or deleted.\n-- Add at least one filter, or explicitly confirm this query should have no WHERE condition.', blocked: true, reason: 'Missing mandatory WHERE clause.' };
    if (state.queryType === 'INSERT') {
        if (state.values.length === 0)
            return { sql: '-- Add at least one column/value pair to build an INSERT statement.', blocked: true };
        const cols = state.values.map((v) => v.column).join(', ');
        const vals = state.values.map((v) => formatValue(v.value)).join(', ');
        return { sql: `INSERT INTO ${state.table} (${cols})\nVALUES (${vals});`, blocked: false };
    }
    if (state.queryType === 'UPDATE') {
        if (state.values.length === 0)
            return { sql: '-- Add at least one column/value pair to build an UPDATE statement.', blocked: true };
        const setClause = state.values.map((v) => `${v.column} = ${formatValue(v.value)}`).join(',\n  ');
        let sql = `UPDATE ${state.table}\nSET ${setClause}`;
        sql += whereClause ? `\nWHERE ${whereClause};` : '\n-- No WHERE condition (explicitly confirmed) — this will affect ALL rows.;';
        return { sql, blocked: false };
    }
    let sql = `DELETE FROM ${state.table}`;
    sql += whereClause ? `\nWHERE ${whereClause};` : '\n-- No WHERE condition (explicitly confirmed) — this will affect ALL rows.;';
    return { sql, blocked: false };
}
