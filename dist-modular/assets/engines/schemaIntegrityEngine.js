import { VALID_DATA_TYPES } from '../types/index.js';
import { safeTrim, safeUpperTrim } from '../utils/validation.js';
export function validateSchemaIntegrity(tables) {
    const issues = [];
    const seenTableColumn = new Set();
    const tableNames = new Set(tables.map((t) => safeUpperTrim(t?.name)));
    tables.forEach((t) => {
        const tName = safeTrim(t?.name);
        if (!tName) {
            issues.push({ severity: 'error', message: 'A table is missing its Table Name.' });
            return;
        }
        if (!Array.isArray(t.columns) || t.columns.length === 0) {
            issues.push({ severity: 'warning', message: `Table "${tName}" has no columns defined.` });
        }
        let pkCount = 0;
        (t.columns || []).forEach((c) => {
            const cName = safeTrim(c?.name);
            if (!cName) {
                issues.push({ severity: 'error', message: `Table "${tName}" has a column with a missing Column Name.` });
                return;
            }
            const key = `${safeUpperTrim(tName)}::${safeUpperTrim(cName)}`;
            if (seenTableColumn.has(key))
                issues.push({ severity: 'error', message: `Duplicate column "${tName}.${cName}" — each table/column combination must be unique.` });
            seenTableColumn.add(key);
            if (!VALID_DATA_TYPES.includes(c.type))
                issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has an invalid data type "${c.type}".` });
            if (c.isPrimaryKey)
                pkCount += 1;
            if (c.isForeignKey) {
                const refTable = safeTrim(c.references?.table);
                const refColumn = safeTrim(c.references?.column);
                if (!refTable || !refColumn)
                    issues.push({ severity: 'error', message: `Column "${tName}.${cName}" is marked as a Foreign Key but has no reference table/column.` });
                else {
                    const refTableUpper = safeUpperTrim(refTable);
                    if (!tableNames.has(refTableUpper))
                        issues.push({ severity: 'error', message: `Column "${tName}.${cName}" references table "${refTable}", which does not exist in this schema.` });
                    else {
                        const refTableObj = tables.find((rt) => safeUpperTrim(rt?.name) === refTableUpper);
                        const refColExists = refTableObj?.columns?.some((rc) => safeUpperTrim(rc?.name) === safeUpperTrim(refColumn));
                        if (!refColExists)
                            issues.push({ severity: 'error', message: `Column "${tName}.${cName}" references "${refTable}.${refColumn}", which does not exist.` });
                    }
                }
            }
            if (c.decode) {
                const seenRaw = new Set();
                c.decode.forEach((d) => {
                    const rawValue = safeTrim(d?.rawValue);
                    if (!rawValue)
                        issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has a decode entry with an empty raw value.` });
                    const rk = safeUpperTrim(d?.rawValue);
                    if (rk && seenRaw.has(rk))
                        issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has duplicate decode raw value "${rawValue}".` });
                    seenRaw.add(rk);
                });
            }
            if (c.length !== undefined && c.length !== null && c.length < 0)
                issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has a negative Length.` });
            if (c.precision !== undefined && c.precision !== null && c.precision < 0)
                issues.push({ severity: 'error', message: `Column "${tName}.${cName}" has a negative Precision.` });
        });
        if (pkCount > 1)
            issues.push({ severity: 'warning', message: `Table "${tName}" has ${pkCount} primary-key columns (composite key) — confirm this is intentional.` });
        if (pkCount === 0 && (t.columns || []).length > 0 && t.objectType !== 'VIEW')
            issues.push({ severity: 'warning', message: `Table "${tName}" has no primary key defined.` });
    });
    return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
export function validateSingleRowAgainstSchema(schema, tableName, columnName, originalTableName, originalColumnName) {
    const issues = [];
    const tName = safeTrim(tableName);
    const cName = safeTrim(columnName);
    if (!tName)
        issues.push({ severity: 'error', message: 'Table Name is required.' });
    if (!cName)
        issues.push({ severity: 'error', message: 'Column Name is required.' });
    if (!tName || !cName)
        return issues;
    const isSameAsOriginal = safeUpperTrim(originalTableName) === safeUpperTrim(tName) && safeUpperTrim(originalColumnName) === safeUpperTrim(cName);
    if (isSameAsOriginal)
        return issues;
    const table = schema.tables.find((t) => safeUpperTrim(t?.name) === safeUpperTrim(tName));
    const clash = table?.columns?.some((c) => safeUpperTrim(c?.name) === safeUpperTrim(cName));
    if (clash)
        issues.push({ severity: 'error', message: `Column "${tName}.${cName}" already exists in this schema.` });
    return issues;
}
export function validateIncomingSchemaFile(candidate) {
    const issues = [];
    if (typeof candidate !== 'object' || candidate === null) {
        issues.push({ severity: 'error', message: 'File is not a valid JSON object.' });
        return { valid: false, issues };
    }
    const obj = candidate;
    if (!Array.isArray(obj.tables)) {
        issues.push({ severity: 'error', message: 'Missing required "tables" array.' });
        return { valid: false, issues };
    }
    if (!safeTrim(obj.name))
        issues.push({ severity: 'warning', message: 'Schema has no name — a default will be used.' });
    const structural = validateSchemaIntegrity(obj.tables);
    issues.push(...structural.issues);
    return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
export function validateIncomingRegistryFile(candidate) {
    const issues = [];
    if (typeof candidate !== 'object' || candidate === null) {
        issues.push({ severity: 'error', message: 'File is not a valid JSON object.' });
        return { valid: false, issues };
    }
    const obj = candidate;
    if (!Array.isArray(obj.schemas)) {
        issues.push({ severity: 'error', message: 'Missing required "schemas" array.' });
        return { valid: false, issues };
    }
    obj.schemas.forEach((s, idx) => {
        const result = validateIncomingSchemaFile(s);
        result.issues.forEach((i) => issues.push({ severity: i.severity, message: `Schema #${idx + 1}: ${i.message}` }));
    });
    return { valid: issues.filter((i) => i.severity === 'error').length === 0, issues };
}
