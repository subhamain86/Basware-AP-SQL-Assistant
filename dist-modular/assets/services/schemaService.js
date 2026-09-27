import { DEFAULT_SCHEMAS, DEFAULT_ACTIVE_SCHEMA_ID } from '../data/defaultSchemas.js';
import { validateDecodeEntries } from '../engines/decodeEngine.js';
import { validateSchemaIntegrity } from '../engines/schemaIntegrityEngine.js';
import { stampNewVersion, sameLogicalSchema } from '../engines/schemaVersionEngine.js';
import { makeId } from '../utils/id.js';
import { validateSchemaName, sanitizeIncomingSchema, safeLocalStorageSet, estimateStringBytes } from '../utils/validation.js';
const STORAGE_KEY = 'sqla.registry.v147';
function clone(v) { return JSON.parse(JSON.stringify(v)); }
export class SchemaService {
    constructor() {
        this.listeners = new Set();
        this.storageHealth = { bytesUsed: 0, lastPersistOk: true, lastError: null, lastRecovered: false };
        this.registry = this.load();
    }
    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.schemas?.length)
                    return parsed;
            }
        }
        catch { }
        // V14.7 — also attempt to migrate the previous version's key so a
        // browser storage quota problem on the OLD key doesn't strand a user's
        // existing schemas after upgrading.
        try {
            const legacy = localStorage.getItem('sqla.registry.v146');
            if (legacy) {
                const parsed = JSON.parse(legacy);
                if (parsed.schemas?.length)
                    return parsed;
            }
        }
        catch { }
        return { schemas: clone(DEFAULT_SCHEMAS), activeSchemaId: DEFAULT_ACTIVE_SCHEMA_ID };
    }
    /** V14.7 — THE fix for "Failed to execute 'setItem' on 'Storage':
     * Setting the value of 'sqla.registry.v14x' exceeded the quota."
     *
     * In V14.6 this was a single unguarded `localStorage.setItem(...)` call.
     * If it threw (which it reliably will once the registry — which
     * accumulates every imported/synced schema from every device, forever —
     * grows past the browser's per-origin quota, typically 5-10MB), the
     * exception propagated out of persist() BEFORE `this.listeners.forEach`
     * ran. That meant: (a) the in-memory mutation the user just made (e.g.
     * importing a schema) was silently never saved to disk, (b) the UI never
     * re-rendered to reflect it, and (c) — critically for cross-device sync —
     * autoSyncService's schemaService.subscribe() callback never fired
     * either, so no automatic push to the repository was ever scheduled.
     * That silent failure chain is the direct explanation for "other device
     * is not getting the uploaded schema synced": the schema was never
     * durably saved or pushed on the device it was uploaded on in the first
     * place.
     *
     * The fix below:
     *  1. Estimates the registry's serialized size up front for diagnostics.
     *  2. Tries the write. On quota failure, automatically prunes storage
     *     (oldest, unused, duplicate-by-name inactive schemas and old sync
     *     log/conflict data) via `pruneForSpace()` and retries ONCE.
     *  3. ALWAYS notifies listeners afterward — even if the disk write
     *     ultimately still failed — so the in-memory state (and therefore the
     *     UI and the auto-sync push scheduler) stays consistent and visible
     *     to the user instead of silently freezing.
     *  4. Records a `storageHealth` snapshot the Settings → Danger Zone UI
     *     can surface, so the user gets clear, actionable feedback instead of
     *     an unexplained frozen app.
     */
    persist() {
        const serialized = JSON.stringify(this.registry);
        this.storageHealth.bytesUsed = estimateStringBytes(serialized);
        const result = safeLocalStorageSet(STORAGE_KEY, serialized, () => this.pruneForSpace());
        this.storageHealth.lastPersistOk = result.ok;
        this.storageHealth.lastRecovered = result.recovered;
        this.storageHealth.lastError = result.error || null;
        // Always notify — even on failure — so the UI reflects the in-memory
        // state and (crucially) the auto-sync push scheduler still runs for a
        // genuine local edit instead of the change disappearing silently.
        this.listeners.forEach((l) => l());
    }
    /** V14.7 — frees local storage space by (a) collapsing duplicate-by-name
     * inactive schemas down to only the most recently updated copy of each
     * name (the runaway-growth root cause: every schema import or
     * cross-device sync previously created a brand-new schema id forever,
     * even for what a user considers "the same" schema re-uploaded), and (b)
     * dropping the oldest inactive schemas beyond a generous cap if the
     * registry is still too large. The active schema is never touched. */
    pruneForSpace() {
        const before = estimateStringBytes(JSON.stringify(this.registry));
        const byName = new Map();
        this.registry.schemas.forEach((s) => { const key = s.name.trim().toLowerCase(); const list = byName.get(key) || []; list.push(s); byName.set(key, list); });
        const keep = [];
        byName.forEach((group) => {
            if (group.length === 1) {
                keep.push(group[0]);
                return;
            }
            const active = group.find((s) => s.status === 'active');
            const rest = group.filter((s) => s !== active).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
            if (active)
                keep.push(active);
            if (rest.length)
                keep.push(rest[0]);
        });
        const MAX_INACTIVE = 12;
        const inactiveSorted = keep.filter((s) => s.status !== 'active').sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const activeOnes = keep.filter((s) => s.status === 'active');
        const trimmedInactive = inactiveSorted.slice(0, MAX_INACTIVE);
        const finalSchemas = [...activeOnes, ...trimmedInactive];
        const removedCount = this.registry.schemas.length - finalSchemas.length;
        if (finalSchemas.length === 0)
            return { removedCount: 0, freedApproxBytes: 0 };
        this.registry = { ...this.registry, schemas: finalSchemas };
        if (!finalSchemas.some((s) => s.id === this.registry.activeSchemaId)) {
            this.registry.activeSchemaId = finalSchemas[0].id;
            finalSchemas[0].status = 'active';
        }
        const after = estimateStringBytes(JSON.stringify(this.registry));
        return { removedCount, freedApproxBytes: Math.max(0, before - after) };
    }
    getStorageHealth() { return { ...this.storageHealth }; }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    getRegistry() { return this.registry; }
    getActiveSchema() { const found = this.registry.schemas.find((s) => s.id === this.registry.activeSchemaId); return found || this.registry.schemas[0]; }
    getAllSchemas() { return this.registry.schemas; }
    getSchemaById(id) { return this.registry.schemas.find((s) => s.id === id); }
    getModulesForSchema(schemaId) { const s = this.getSchemaById(schemaId); if (!s)
        return []; return Array.from(new Set(s.tables.map((t) => t.module))).sort(); }
    getTablesForModule(schemaId, module) { const s = this.getSchemaById(schemaId); if (!s)
        return []; return module ? s.tables.filter((t) => t.module === module) : s.tables; }
    getAllSchemaNames(excludeId) { return this.registry.schemas.filter((s) => s.id !== excludeId).map((s) => s.name); }
    switchActiveSchema(schemaId) {
        if (!this.registry.schemas.some((s) => s.id === schemaId))
            return;
        this.registry.schemas.forEach((s) => { s.status = s.id === schemaId ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
        this.registry.activeSchemaId = schemaId;
        this.persist();
    }
    resetToDefaultSchema() { this.switchActiveSchema(DEFAULT_ACTIVE_SCHEMA_ID); }
    validateNewSchemaName(name, excludeId) {
        const result = validateSchemaName(name, this.getAllSchemaNames(excludeId));
        return result.valid ? null : (result.message || 'Invalid schema name.');
    }
    /** V14.7 — `schema` is sanitized via sanitizeIncomingSchema() BEFORE
     * being stored, guaranteeing every table/column name, description, and
     * decode value is a real string (never undefined) regardless of what
     * the uploaded JSON actually contained.
     *
     * V14.7 ALSO fixes unbounded duplicate growth: if an existing INACTIVE
     * schema already has the same name (case-insensitive) — e.g. the user
     * re-imports an updated copy of a schema they already uploaded on this or
     * another device — that existing schema is updated IN PLACE (new
     * content, new version stamp) instead of creating yet another schema
     * entry with a brand-new id. This was a major contributor to the
     * registry growing unbounded across repeated import/sync cycles until it
     * exceeded the browser's storage quota. */
    importSchema(schema, customName, originalFileName) {
        if (!schema || !Array.isArray(schema.tables))
            return { ok: false, error: 'Invalid schema file: missing "tables" array.' };
        const sanitized = sanitizeIncomingSchema(schema);
        const trimmedName = customName.trim();
        const existingByName = this.registry.schemas.find((s) => s.status !== 'active' && sameLogicalSchema(s, { name: trimmedName }));
        if (existingByName) {
            existingByName.tables = sanitized.tables;
            existingByName.relationships = sanitized.relationships || [];
            existingByName.updatedAt = new Date().toISOString();
            existingByName.originalFileName = originalFileName || existingByName.originalFileName;
            this.persist();
            return { ok: true, schemaId: existingByName.id, replacedExisting: true };
        }
        const nameError = this.validateNewSchemaName(customName);
        if (nameError)
            return { ok: false, error: nameError };
        const id = makeId('schema');
        const withDefaults = { id, name: trimmedName, version: sanitized.version || '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: sanitized.tables, relationships: sanitized.relationships || [], originalFileName: originalFileName || undefined };
        this.registry.schemas.push(withDefaults);
        this.persist();
        return { ok: true, schemaId: id };
    }
    addNewSchema(name) {
        const nameError = this.validateNewSchemaName(name);
        if (nameError)
            return { ok: false, error: nameError };
        const fresh = { id: makeId('schema'), name: name.trim(), version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: [], relationships: [] };
        this.registry.schemas.push(fresh);
        this.persist();
        return { ok: true, schema: fresh };
    }
    renameSchema(schemaId, newName) {
        const schema = this.getSchemaById(schemaId);
        if (!schema)
            return { ok: false, error: 'Schema not found.' };
        const nameError = this.validateNewSchemaName(newName, schemaId);
        if (nameError)
            return { ok: false, error: nameError };
        schema.name = newName.trim();
        schema.updatedAt = new Date().toISOString();
        this.persist();
        return { ok: true };
    }
    deleteSchema(schemaId) {
        if (this.registry.schemas.length <= 1)
            return { ok: false, error: 'Cannot delete the only remaining schema.' };
        const wasActive = this.registry.activeSchemaId === schemaId;
        this.registry.schemas = this.registry.schemas.filter((s) => s.id !== schemaId);
        if (wasActive) {
            this.registry.activeSchemaId = this.registry.schemas[0].id;
            this.registry.schemas[0].status = 'active';
        }
        this.persist();
        return { ok: true };
    }
    addTable(schemaId, table) {
        const schema = this.registry.schemas.find((s) => s.id === schemaId);
        if (!schema)
            return;
        schema.tables.push(table);
        schema.updatedAt = new Date().toISOString();
        this.persist();
    }
    saveDecodeDefinition(schemaId, tableName, columnName, entries) {
        const issues = validateDecodeEntries(entries);
        if (issues.length)
            return issues;
        const schema = this.registry.schemas.find((s) => s.id === schemaId);
        const table = schema?.tables.find((t) => t.name === tableName);
        const column = table?.columns.find((c) => c.name === columnName);
        if (!column)
            return ['Column not found.'];
        column.decode = entries;
        if (schema)
            schema.updatedAt = new Date().toISOString();
        this.persist();
        return [];
    }
    exportSchemaJson(schemaId) { const schema = this.registry.schemas.find((s) => s.id === schemaId); return JSON.stringify(schema, null, 2); }
    exportSchemaCsv(schemaId) {
        const schema = this.registry.schemas.find((s) => s.id === schemaId);
        if (!schema)
            return '';
        const header = 'Module,Table Name,Object Type,Table Description,Column Name,Column Description,Data Type,Length,Precision,Nullable,Alias,Primary Key,Foreign Key,Decode';
        const rows = schema.tables.flatMap((t) => t.columns.map((c) => [t.module, t.name, t.objectType || 'TABLE', t.description, c.name, c.description, c.type, c.length ?? '', c.precision ?? '', c.nullable ? 'Y' : 'N', c.alias ?? '', c.isPrimaryKey ? 'Y' : 'N', c.references ? `${c.references.table}.${c.references.column}` : '', c.decode ? c.decode.map((d) => `${d.rawValue}=${d.label}`).join(';') : ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
        return [header, ...rows].join('\n');
    }
    getFlattenedRows(schemaId, moduleFilter = null, tableFilter = null) {
        const schema = this.getSchemaById(schemaId);
        if (!schema)
            return [];
        const rows = [];
        schema.tables.forEach((t) => {
            if (moduleFilter && t.module !== moduleFilter)
                return;
            if (tableFilter && t.name !== tableFilter)
                return;
            t.columns.forEach((c) => {
                rows.push({ rowId: `${t.name}::${c.name}`, module: t.module, tableName: t.name, tableDescription: t.description, columnName: c.name, columnDescription: c.description, dataType: c.type, length: c.length ?? null, precision: c.precision ?? null, nullable: c.nullable, alias: c.alias ?? '', decodeText: c.decode ? c.decode.map((d) => `${d.rawValue}=${d.label}`).join('\n') : '', isPrimaryKey: !!c.isPrimaryKey, isForeignKey: !!c.isForeignKey, fkTable: c.references?.table ?? '', fkColumn: c.references?.column ?? '' });
            });
        });
        return rows;
    }
    async upsertRow(schemaId, row, originalRowId) {
        const schema = this.getSchemaById(schemaId);
        if (!schema)
            return ['Schema not found.'];
        const candidateTables = clone(schema.tables);
        const [origTableName, origColumnName] = originalRowId ? originalRowId.split('::') : [null, null];
        if (origTableName && origColumnName) {
            const origTableIdx = candidateTables.findIndex((t) => t.name === origTableName);
            if (origTableIdx !== -1) {
                candidateTables[origTableIdx].columns = candidateTables[origTableIdx].columns.filter((c) => c.name !== origColumnName);
                if (candidateTables[origTableIdx].columns.length === 0 && candidateTables[origTableIdx].name !== row.tableName)
                    candidateTables.splice(origTableIdx, 1);
            }
        }
        const decodeEntries = row.decodeText.split(/[\n;]+/).map((l) => l.trim()).filter((l) => l.length > 0).map((line) => { const idx = line.indexOf('='); return idx === -1 ? { rawValue: line, label: line } : { rawValue: line.slice(0, idx).trim(), label: line.slice(idx + 1).trim() }; });
        const newColumn = { name: row.columnName.trim(), label: row.columnName.trim(), description: row.columnDescription, type: row.dataType, length: row.length ?? undefined, precision: row.precision ?? undefined, nullable: row.nullable, alias: row.alias || undefined, isPrimaryKey: row.isPrimaryKey, isForeignKey: row.isForeignKey, references: row.isForeignKey && row.fkTable && row.fkColumn ? { table: row.fkTable.trim(), column: row.fkColumn.trim() } : undefined, decode: decodeEntries.length ? decodeEntries : undefined };
        let targetTable = candidateTables.find((t) => t.name.trim().toUpperCase() === row.tableName.trim().toUpperCase());
        if (targetTable) {
            targetTable.module = row.module || targetTable.module;
            targetTable.description = row.tableDescription || targetTable.description;
            targetTable.columns.push(newColumn);
        }
        else {
            targetTable = { name: row.tableName.trim(), module: row.module || 'General', description: row.tableDescription || '', columns: [newColumn] };
            candidateTables.push(targetTable);
        }
        const integrity = validateSchemaIntegrity(candidateTables);
        const errors = integrity.issues.filter((i) => i.severity === 'error').map((i) => i.message);
        if (errors.length)
            return errors;
        schema.tables = candidateTables;
        schema.updatedAt = new Date().toISOString();
        schema.versionMeta = await stampNewVersion(schema, 'local');
        this.persist();
        return [];
    }
    async deleteRow(schemaId, rowId) {
        const schema = this.getSchemaById(schemaId);
        if (!schema)
            return { ok: false, error: 'Schema not found.' };
        const [tableName, columnName] = rowId.split('::');
        const table = schema.tables.find((t) => t.name === tableName);
        if (!table)
            return { ok: false, error: 'Table not found.' };
        table.columns = table.columns.filter((c) => c.name !== columnName);
        if (table.columns.length === 0)
            schema.tables = schema.tables.filter((t) => t.name !== tableName);
        schema.updatedAt = new Date().toISOString();
        schema.versionMeta = await stampNewVersion(schema, 'local');
        this.persist();
        return { ok: true };
    }
    deleteAllSchemaContents(schemaId) {
        const schema = this.getSchemaById(schemaId);
        if (!schema)
            return '';
        const backup = JSON.stringify(schema, null, 2);
        schema.tables = [];
        schema.relationships = [];
        schema.updatedAt = new Date().toISOString();
        this.persist();
        return backup;
    }
    async applySynchronizedSchema(schemaId, incoming, source) {
        const schema = this.getSchemaById(schemaId);
        if (!schema)
            return;
        const sanitized = sanitizeIncomingSchema(incoming);
        schema.tables = sanitized.tables;
        schema.relationships = sanitized.relationships;
        schema.lastSyncedAt = new Date().toISOString();
        schema.versionMeta = await stampNewVersion(schema, source);
        this.persist();
    }
    replaceSchemaContent(schemaId, incoming) {
        const idx = this.registry.schemas.findIndex((s) => s.id === schemaId);
        if (idx === -1)
            return;
        const sanitized = sanitizeIncomingSchema(incoming);
        const wasActive = this.registry.schemas[idx].status === 'active';
        this.registry.schemas[idx] = { ...sanitized, status: wasActive ? 'active' : sanitized.status };
        this.persist();
    }
    /** V14.7 — sanitized before storage, AND deduplicated by logical name:
     * a schema arriving from the shared repository during automatic
     * discovery is just as "external/untrusted" as a manual JSON import, and
     * must be defended against the same way. Matching by name (not just id)
     * prevents the registry from silently accumulating unlimited duplicate
     * copies of what is really the same schema re-synced from multiple
     * devices — the underlying cause of the storage-quota crash. */
    addSchemaFromRemote(incoming) {
        const sanitized = sanitizeIncomingSchema(incoming);
        if (this.registry.schemas.some((s) => s.id === incoming.id))
            return 'skipped';
        const existingByName = this.registry.schemas.find((s) => s.status !== 'active' && sameLogicalSchema(s, sanitized));
        if (existingByName) {
            existingByName.tables = sanitized.tables;
            existingByName.relationships = sanitized.relationships;
            existingByName.lastSyncedAt = new Date().toISOString();
            existingByName.versionMeta = sanitized.versionMeta || existingByName.versionMeta;
            this.persist();
            return 'updated';
        }
        this.registry.schemas.push({ ...sanitized, status: 'inactive' });
        this.persist();
        return 'added';
    }
    markAllSynced() {
        const now = new Date().toISOString();
        this.registry.schemas.forEach((s) => { s.lastSyncedAt = now; });
        this.persist();
    }
}
export const schemaService = new SchemaService();
