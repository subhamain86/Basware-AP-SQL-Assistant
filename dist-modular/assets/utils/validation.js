export function safeString(value, fallback = '') {
    if (typeof value === 'string')
        return value;
    return fallback;
}
export function safeTrim(value, fallback = '') {
    return safeString(value, fallback).trim();
}
/** Common composite used throughout schema validation: trim + uppercase,
 * safe against any non-string input (undefined, null, number, object). */
export function safeUpperTrim(value, fallback = '') {
    return safeTrim(value, fallback).toUpperCase();
}
export function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
export function validateSchemaName(rawName, existingNames, excludeName) {
    const name = safeTrim(rawName);
    if (!name)
        return { valid: false, message: 'Schema name is required.' };
    if (name.length > 80)
        return { valid: false, message: 'Schema name must be 80 characters or fewer.' };
    if (!/^[A-Za-z0-9][A-Za-z0-9 _\-.]*$/.test(name))
        return { valid: false, message: 'Schema name may only contain letters, digits, spaces, underscores, hyphens, and periods, and must start with a letter or digit.' };
    const normalizedExisting = existingNames.map((n) => safeTrim(n).toLowerCase());
    const excludeNormalized = excludeName ? safeTrim(excludeName).toLowerCase() : null;
    const clash = normalizedExisting.some((n) => n === name.toLowerCase() && n !== excludeNormalized);
    if (clash)
        return { valid: false, message: `A schema named "${name}" already exists — schema names must be unique.` };
    return { valid: true };
}
export function assertSyncConfigOrError(fields) {
    const missing = [];
    for (const f of fields) {
        if (!f.required)
            continue;
        if (!isNonEmptyString(f.value))
            missing.push(f.label);
    }
    if (missing.length === 0)
        return { ok: true, missingFields: [], message: null };
    const message = `Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: ${missing.join(', ')}.`;
    return { ok: false, missingFields: missing, message };
}
// ============================================================================
// sanitizeIncomingSchema — the "belt-and-suspenders" fix for the
// undefined.trim() crash site: schema validation. Applied to EVERY schema
// the moment it enters the system from an untrusted/external source:
// user-uploaded JSON import, and every schema object pulled from the shared
// repository during synchronization. Guarantees every string field that
// validation/SQL-generation code touches with .trim() is ALWAYS a real
// string afterward — never undefined/null/number — regardless of what the
// raw JSON actually contained.
// ============================================================================
export function sanitizeIncomingSchema(raw) {
    if (!raw || typeof raw !== 'object')
        return raw;
    const schema = raw;
    const tables = Array.isArray(schema.tables) ? schema.tables : [];
    const sanitizedTables = tables.map((rawTable) => {
        const t = (rawTable && typeof rawTable === 'object') ? rawTable : {};
        const columns = Array.isArray(t.columns) ? t.columns : [];
        const sanitizedColumns = columns.map((rawCol) => {
            const c = (rawCol && typeof rawCol === 'object') ? rawCol : {};
            const decode = Array.isArray(c.decode) ? c.decode : undefined;
            const sanitizedDecode = decode ? decode.map((rawD) => {
                const d = (rawD && typeof rawD === 'object') ? rawD : {};
                return { rawValue: safeString(d.rawValue, ''), label: safeString(d.label, '') };
            }) : undefined;
            const rawRefs = (c.references && typeof c.references === 'object') ? c.references : null;
            return {
                ...c,
                name: safeString(c.name, ''),
                label: safeString(c.label, safeString(c.name, '')),
                description: safeString(c.description, ''),
                type: safeString(c.type, 'VARCHAR'),
                references: rawRefs ? { table: safeString(rawRefs.table, ''), column: safeString(rawRefs.column, '') } : c.references,
                decode: sanitizedDecode
            };
        });
        return {
            ...t,
            name: safeString(t.name, ''),
            module: safeString(t.module, 'General'),
            description: safeString(t.description, ''),
            columns: sanitizedColumns
        };
    });
    return { ...schema, tables: sanitizedTables };
}
export function safeLocalStorageSet(key, value, onQuotaExceeded) {
    try {
        localStorage.setItem(key, value);
        return { ok: true, recovered: false };
    }
    catch (e) {
        const isQuota = isQuotaExceededError(e);
        if (isQuota && onQuotaExceeded) {
            try {
                onQuotaExceeded();
                localStorage.setItem(key, value);
                return { ok: true, recovered: true };
            }
            catch (e2) {
                return { ok: false, recovered: false, error: describeStorageError(e2) };
            }
        }
        return { ok: false, recovered: false, error: describeStorageError(e) };
    }
}
export function isQuotaExceededError(e) {
    if (!e || typeof e !== 'object')
        return false;
    const err = e;
    return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014;
}
export function describeStorageError(e) {
    if (isQuotaExceededError(e))
        return 'Browser storage quota exceeded — the local schema cache is too large for this browser to store.';
    return e?.message || 'Unknown local storage error.';
}
export function estimateStringBytes(s) {
    // Fast approximation: 1 byte per UTF-16 code unit undercounts multi-byte
    // characters, so use TextEncoder for an accurate byte count.
    try {
        return new TextEncoder().encode(s).length;
    }
    catch {
        return s.length;
    }
}
