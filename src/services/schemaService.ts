import type { SchemaModel, SchemaRegistry, DecodeEntry, TableDef, ColumnDef, SchemaEditorRow } from '../types';
import { DEFAULT_SCHEMAS, DEFAULT_ACTIVE_SCHEMA_ID } from '../data/defaultSchemas';
import { validateDecodeEntries } from '../engines/decodeEngine';
import { validateSchemaIntegrity } from '../engines/schemaIntegrityEngine';
import { stampNewVersion } from '../engines/schemaVersionEngine';
import { makeId } from '../utils/id';
import { validateSchemaName, sanitizeIncomingSchema } from '../utils/validation';
import { safeSetItem } from '../utils/storage';

const STORAGE_KEY = 'sqla.registry.v146';
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

export class SchemaService {
  private registry: SchemaRegistry;
  private listeners = new Set<() => void>();
  // V14.7 — set whenever persist() could not fully save to localStorage
  // (almost always a quota problem given how large a real production
  // schema's JSON serialization can be). In-memory data and the running
  // app remain fully correct either way; this only tracks whether the
  // LAST persist() call actually made it to disk, so callers like
  // syncService can surface a clear, specific message instead of letting
  // a raw QuotaExceededError crash the operation or get misreported as a
  // validation failure.
  private lastPersistError: string | null = null;
  constructor() { this.registry = this.load(); }
  private load(): SchemaRegistry {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { const parsed = JSON.parse(raw) as SchemaRegistry; if (parsed.schemas?.length) return parsed; } } catch { }
    return { schemas: clone(DEFAULT_SCHEMAS), activeSchemaId: DEFAULT_ACTIVE_SCHEMA_ID };
  }
  private persist(): void {
    const result = safeSetItem(STORAGE_KEY, JSON.stringify(this.registry));
    this.lastPersistError = result.ok ? null : (result.error || 'Unknown storage error.');
    // Notify listeners regardless of persistence outcome — the in-memory
    // registry is always the source of truth for the running session, so
    // the UI must reflect it even if it couldn't be saved to disk.
    this.listeners.forEach((l) => l());
  }
  /** V14.7 — see lastPersistError note above. Returns null if the most
   * recent change was saved successfully. */
  getLastPersistError(): string | null { return this.lastPersistError; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  getRegistry(): SchemaRegistry { return this.registry; }
  getActiveSchema(): SchemaModel { const found = this.registry.schemas.find((s) => s.id === this.registry.activeSchemaId); return found || this.registry.schemas[0]; }
  getAllSchemas(): SchemaModel[] { return this.registry.schemas; }
  getSchemaById(id: string): SchemaModel | undefined { return this.registry.schemas.find((s) => s.id === id); }
  getModulesForSchema(schemaId: string): string[] { const s = this.getSchemaById(schemaId); if (!s) return []; return Array.from(new Set(s.tables.map((t) => t.module))).sort(); }
  getTablesForModule(schemaId: string, module: string | null): TableDef[] { const s = this.getSchemaById(schemaId); if (!s) return []; return module ? s.tables.filter((t) => t.module === module) : s.tables; }
  getAllSchemaNames(excludeId?: string): string[] { return this.registry.schemas.filter((s) => s.id !== excludeId).map((s) => s.name); }
  switchActiveSchema(schemaId: string): void {
    if (!this.registry.schemas.some((s) => s.id === schemaId)) return;
    this.registry.schemas.forEach((s) => { s.status = s.id === schemaId ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
    this.registry.activeSchemaId = schemaId;
    this.persist();
  }
  resetToDefaultSchema(): void { this.switchActiveSchema(DEFAULT_ACTIVE_SCHEMA_ID); }
  validateNewSchemaName(name: unknown, excludeId?: string): string | null {
    const result = validateSchemaName(name, this.getAllSchemaNames(excludeId));
    return result.valid ? null : (result.message || 'Invalid schema name.');
  }
  /** V14.6 — `schema` is sanitized via sanitizeIncomingSchema() BEFORE
   * being stored, guaranteeing every table/column name, description, and
   * decode value is a real string (never undefined) regardless of what
   * the uploaded JSON actually contained. */
  importSchema(schema: SchemaModel, customName: string, originalFileName?: string): { ok: boolean; error?: string; schemaId?: string } {
    const nameError = this.validateNewSchemaName(customName);
    if (nameError) return { ok: false, error: nameError };
    if (!schema || !Array.isArray(schema.tables)) return { ok: false, error: 'Invalid schema file: missing "tables" array.' };
    const sanitized = sanitizeIncomingSchema(schema) as SchemaModel;
    const id = makeId('schema');
    const withDefaults: SchemaModel = { id, name: customName.trim(), version: sanitized.version || '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: sanitized.tables, relationships: sanitized.relationships || [], originalFileName: originalFileName || undefined };
    this.registry.schemas.push(withDefaults);
    this.persist();
    return { ok: true, schemaId: id };
  }
  addNewSchema(name: string): { ok: boolean; error?: string; schema?: SchemaModel } {
    const nameError = this.validateNewSchemaName(name);
    if (nameError) return { ok: false, error: nameError };
    const fresh: SchemaModel = { id: makeId('schema'), name: name.trim(), version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: [], relationships: [] };
    this.registry.schemas.push(fresh);
    this.persist();
    return { ok: true, schema: fresh };
  }
  renameSchema(schemaId: string, newName: string): { ok: boolean; error?: string } {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return { ok: false, error: 'Schema not found.' };
    const nameError = this.validateNewSchemaName(newName, schemaId);
    if (nameError) return { ok: false, error: nameError };
    schema.name = newName.trim();
    schema.updatedAt = new Date().toISOString();
    this.persist();
    return { ok: true };
  }
  deleteSchema(schemaId: string): { ok: boolean; error?: string } {
    if (this.registry.schemas.length <= 1) return { ok: false, error: 'Cannot delete the only remaining schema.' };
    const wasActive = this.registry.activeSchemaId === schemaId;
    this.registry.schemas = this.registry.schemas.filter((s) => s.id !== schemaId);
    if (wasActive) { this.registry.activeSchemaId = this.registry.schemas[0].id; this.registry.schemas[0].status = 'active'; }
    this.persist();
    return { ok: true };
  }
  addTable(schemaId: string, table: TableDef): void {
    const schema = this.registry.schemas.find((s) => s.id === schemaId);
    if (!schema) return;
    schema.tables.push(table);
    schema.updatedAt = new Date().toISOString();
    this.persist();
  }
  saveDecodeDefinition(schemaId: string, tableName: string, columnName: string, entries: DecodeEntry[]): string[] {
    const issues = validateDecodeEntries(entries);
    if (issues.length) return issues;
    const schema = this.registry.schemas.find((s) => s.id === schemaId);
    const table = schema?.tables.find((t) => t.name === tableName);
    const column = table?.columns.find((c) => c.name === columnName);
    if (!column) return ['Column not found.'];
    column.decode = entries;
    if (schema) schema.updatedAt = new Date().toISOString();
    this.persist();
    return [];
  }
  exportSchemaJson(schemaId: string): string { const schema = this.registry.schemas.find((s) => s.id === schemaId); return JSON.stringify(schema, null, 2); }
  exportSchemaCsv(schemaId: string): string {
    const schema = this.registry.schemas.find((s) => s.id === schemaId);
    if (!schema) return '';
    const header = 'Module,Table Name,Object Type,Table Description,Column Name,Column Description,Data Type,Length,Precision,Nullable,Alias,Primary Key,Foreign Key,Decode';
    const rows = schema.tables.flatMap((t) => t.columns.map((c) => [t.module, t.name, t.objectType || 'TABLE', t.description, c.name, c.description, c.type, c.length ?? '', c.precision ?? '', c.nullable ? 'Y' : 'N', c.alias ?? '', c.isPrimaryKey ? 'Y' : 'N', c.references ? `${c.references.table}.${c.references.column}` : '', c.decode ? c.decode.map((d) => `${d.rawValue}=${d.label}`).join(';') : ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    return [header, ...rows].join('\n');
  }
  getFlattenedRows(schemaId: string, moduleFilter: string | null = null, tableFilter: string | null = null): SchemaEditorRow[] {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return [];
    const rows: SchemaEditorRow[] = [];
    schema.tables.forEach((t) => {
      if (moduleFilter && t.module !== moduleFilter) return;
      if (tableFilter && t.name !== tableFilter) return;
      t.columns.forEach((c) => {
        rows.push({ rowId: `${t.name}::${c.name}`, module: t.module, tableName: t.name, tableDescription: t.description, columnName: c.name, columnDescription: c.description, dataType: c.type, length: c.length ?? null, precision: c.precision ?? null, nullable: c.nullable, alias: c.alias ?? '', decodeText: c.decode ? c.decode.map((d) => `${d.rawValue}=${d.label}`).join('\n') : '', isPrimaryKey: !!c.isPrimaryKey, isForeignKey: !!c.isForeignKey, fkTable: c.references?.table ?? '', fkColumn: c.references?.column ?? '' });
      });
    });
    return rows;
  }
  async upsertRow(schemaId: string, row: SchemaEditorRow, originalRowId: string | null): Promise<string[]> {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return ['Schema not found.'];
    const candidateTables: TableDef[] = clone(schema.tables);
    const [origTableName, origColumnName] = originalRowId ? originalRowId.split('::') : [null, null];
    if (origTableName && origColumnName) {
      const origTableIdx = candidateTables.findIndex((t) => t.name === origTableName);
      if (origTableIdx !== -1) {
        candidateTables[origTableIdx].columns = candidateTables[origTableIdx].columns.filter((c) => c.name !== origColumnName);
        if (candidateTables[origTableIdx].columns.length === 0 && candidateTables[origTableIdx].name !== row.tableName) candidateTables.splice(origTableIdx, 1);
      }
    }
    const decodeEntries: DecodeEntry[] = row.decodeText.split(/[\n;]+/).map((l) => l.trim()).filter((l) => l.length > 0).map((line) => { const idx = line.indexOf('='); return idx === -1 ? { rawValue: line, label: line } : { rawValue: line.slice(0, idx).trim(), label: line.slice(idx + 1).trim() }; });
    const newColumn: ColumnDef = { name: row.columnName.trim(), label: row.columnName.trim(), description: row.columnDescription, type: row.dataType, length: row.length ?? undefined, precision: row.precision ?? undefined, nullable: row.nullable, alias: row.alias || undefined, isPrimaryKey: row.isPrimaryKey, isForeignKey: row.isForeignKey, references: row.isForeignKey && row.fkTable && row.fkColumn ? { table: row.fkTable.trim(), column: row.fkColumn.trim() } : undefined, decode: decodeEntries.length ? decodeEntries : undefined };
    let targetTable = candidateTables.find((t) => t.name.trim().toUpperCase() === row.tableName.trim().toUpperCase());
    if (targetTable) { targetTable.module = row.module || targetTable.module; targetTable.description = row.tableDescription || targetTable.description; targetTable.columns.push(newColumn); }
    else { targetTable = { name: row.tableName.trim(), module: row.module || 'General', description: row.tableDescription || '', columns: [newColumn] }; candidateTables.push(targetTable); }
    const integrity = validateSchemaIntegrity(candidateTables);
    const errors = integrity.issues.filter((i) => i.severity === 'error').map((i) => i.message);
    if (errors.length) return errors;
    schema.tables = candidateTables;
    schema.updatedAt = new Date().toISOString();
    schema.versionMeta = await stampNewVersion(schema, 'local');
    this.persist();
    return [];
  }
  async deleteRow(schemaId: string, rowId: string): Promise<{ ok: boolean; error?: string }> {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return { ok: false, error: 'Schema not found.' };
    const [tableName, columnName] = rowId.split('::');
    const table = schema.tables.find((t) => t.name === tableName);
    if (!table) return { ok: false, error: 'Table not found.' };
    table.columns = table.columns.filter((c) => c.name !== columnName);
    if (table.columns.length === 0) schema.tables = schema.tables.filter((t) => t.name !== tableName);
    schema.updatedAt = new Date().toISOString();
    schema.versionMeta = await stampNewVersion(schema, 'local');
    this.persist();
    return { ok: true };
  }
  deleteAllSchemaContents(schemaId: string): string {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return '';
    const backup = JSON.stringify(schema, null, 2);
    schema.tables = []; schema.relationships = []; schema.updatedAt = new Date().toISOString();
    this.persist();
    return backup;
  }
  async applySynchronizedSchema(schemaId: string, incoming: SchemaModel, source: 'location' | 'github'): Promise<void> {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return;
    const sanitized = sanitizeIncomingSchema(incoming) as SchemaModel;
    schema.tables = sanitized.tables;
    schema.relationships = sanitized.relationships;
    schema.lastSyncedAt = new Date().toISOString();
    schema.versionMeta = await stampNewVersion(schema, source);
    this.persist();
  }
  replaceSchemaContent(schemaId: string, incoming: SchemaModel): void {
    const idx = this.registry.schemas.findIndex((s) => s.id === schemaId);
    if (idx === -1) return;
    const sanitized = sanitizeIncomingSchema(incoming) as SchemaModel;
    const wasActive = this.registry.schemas[idx].status === 'active';
    this.registry.schemas[idx] = { ...sanitized, status: wasActive ? 'active' : sanitized.status };
    this.persist();
  }
  /** V14.6 — sanitized before storage: a schema arriving from the shared
   * repository during automatic sync is just as "external/untrusted" as
   * a manual JSON import, and must be defended against the same way. */
  addSchemaFromRemote(incoming: SchemaModel): void {
    if (this.registry.schemas.some((s) => s.id === incoming.id)) return;
    const sanitized = sanitizeIncomingSchema(incoming) as SchemaModel;
    this.registry.schemas.push({ ...sanitized, status: 'inactive' });
    this.persist();
  }
  markAllSynced(): void {
    const now = new Date().toISOString();
    this.registry.schemas.forEach((s) => { s.lastSyncedAt = now; });
    this.persist();
  }
}
export const schemaService = new SchemaService();
