const DEVICE_ID_KEY = 'sqla.deviceTag.v147';
export function getDeviceTag() {
    let tag = localStorage.getItem(DEVICE_ID_KEY);
    if (!tag) {
        tag = 'device-' + Math.random().toString(36).slice(2, 8);
        try {
            localStorage.setItem(DEVICE_ID_KEY, tag);
        }
        catch { /* non-fatal */ }
    }
    return tag;
}
function canonicalize(tables, relationships) {
    const sortedTables = [...tables].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ ...t, columns: [...t.columns].sort((a, b) => a.name.localeCompare(b.name)) }));
    const sortedRels = [...relationships].sort((a, b) => (a.fromTable + a.fromColumn).localeCompare(b.fromTable + b.fromColumn));
    return JSON.stringify({ tables: sortedTables, relationships: sortedRels });
}
export async function computeChecksum(tables, relationships) {
    const canonical = canonicalize(tables, relationships);
    const enc = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function bumpVersion(current) {
    if (!current)
        return '1.0.0';
    const parts = current.split('.').map((p) => parseInt(p, 10) || 0);
    while (parts.length < 3)
        parts.push(0);
    parts[2] += 1;
    return parts.join('.');
}
export async function stampNewVersion(schema, source) {
    const checksum = await computeChecksum(schema.tables, schema.relationships);
    return { version: bumpVersion(schema.versionMeta?.version), schemaId: schema.versionMeta?.schemaId || schema.id, lastUpdated: new Date().toISOString(), updatedByDevice: getDeviceTag(), source, checksum };
}
export function detectConflict(local, remote) {
    const localChecksum = local.versionMeta?.checksum ?? '';
    const remoteChecksum = remote.versionMeta?.checksum ?? '';
    if (localChecksum && remoteChecksum && localChecksum === remoteChecksum)
        return { hasConflict: false, localVersion: local.versionMeta?.version ?? local.version, remoteVersion: remote.versionMeta?.version ?? remote.version, changedPaths: [] };
    const changedPaths = [];
    const localColsByPath = new Map();
    local.tables.forEach((t) => t.columns.forEach((c) => localColsByPath.set(`${t.name}.${c.name}`, JSON.stringify(c))));
    remote.tables.forEach((t) => t.columns.forEach((c) => { const path = `${t.name}.${c.name}`; const localVal = localColsByPath.get(path); if (localVal === undefined)
        changedPaths.push(path + ' (new)');
    else if (localVal !== JSON.stringify(c))
        changedPaths.push(path); localColsByPath.delete(path); }));
    localColsByPath.forEach((_v, path) => changedPaths.push(path + ' (removed remotely)'));
    return { hasConflict: changedPaths.length > 0, localVersion: local.versionMeta?.version ?? local.version, remoteVersion: remote.versionMeta?.version ?? remote.version, changedPaths };
}
/** V14.7 — used by schemaService to decide whether two schemas represent
 * the "same" logical schema uploaded from different devices/sessions
 * (matched by case-insensitive name), so that repeated imports of what a
 * user considers "the same schema" update it in place instead of piling up
 * unlimited duplicate copies in the registry (a major contributor to the
 * localStorage quota-exceeded failures reported in V14.6). */
export function sameLogicalSchema(a, b) {
    return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}
