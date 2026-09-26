import type { SchemaModel, SchemaRegistry, DecodeEntry, TableDef, ColumnDef, SchemaEditorRow } from '../types';
import { DEFAULT_SCHEMAS, DEFAULT_ACTIVE_SCHEMA_ID } from '../data/defaultSchemas';
import { validateDecodeEntries } from '../engines/decodeEngine';
import { validateSchemaIntegrity } from '../engines/schemaIntegrityEngine';
import { stampNewVersion } from '../engines/schemaVersionEngine';
import { makeId } from '../utils/id';

const STORAGE_KEY = 'apsql.registry.v132';
export const DEMO_ADMIN_PASSWORD = 'apsql-admin';

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

export class SchemaService {
  private registry: SchemaRegistry;
  private listeners = new Set<() => void>();

  constructor() { this.registry = this.load(); }

  private load(): SchemaRegistry {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { const parsed = JSON.parse(raw) as SchemaRegistry; if (parsed.schemas?.length) return parsed; } } catch { }
    return { schemas: clone(DEFAULT_SCHEMAS), activeSchemaId: DEFAULT_ACTIVE_SCHEMA_ID };
  }

  private persist(): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.registry)); this.listeners.forEach((l) => l()); }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  getRegistry(): SchemaRegistry { return this.registry; }
  getActiveSchema(): SchemaModel { const found = this.registry.schemas.find((s) => s.id === this.registry.activeSchemaId); return found || this.registry.schemas[0]; }
  getAllSchemas(): SchemaModel[] { return this.registry.schemas; }
  getSchemaById(id: string): SchemaModel | undefined { return this.registry.schemas.find((s) => s.id === id); }

  switchActiveSchema(schemaId: string): void {
    if (!this.registry.schemas.some((s) => s.id === schemaId)) return;
    this.registry.schemas.forEach((s) => { s.status = s.id === schemaId ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
    this.registry.activeSchemaId = schemaId;
    this.persist();
  }
  resetToDefaultSchema(): void { this.switchActiveSchema(DEFAULT_ACTIVE_SCHEMA_ID); }

  async syncSchema(schemaId: string): Promise<SchemaModel> {
    await new Promise((r) => setTimeout(r, 650));
    const schema = this.registry.schemas.find((s) => s.id === schemaId);
    if (!schema) throw new Error('Schema not found.');
    schema.lastSyncedAt = new Date().toISOString();
    this.persist();
    return schema;
  }

  importSchema(schema: SchemaModel): { ok: boolean; error?: string } {
    if (!schema || !Array.isArray(schema.tables)) return { ok: false, error: 'Invalid schema file: missing "tables" array.' };
    const withDefaults: SchemaModel = { id: schema.id || makeId('schema'), name: schema.name || 'Imported Schema', version: schema.version || '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: schema.tables, relationships: schema.relationships || [] };
    this.registry.schemas.push(withDefaults);
    this.persist();
    return { ok: true };
  }

  addNewSchema(name: string): SchemaModel {
    const fresh: SchemaModel = { id: makeId('schema'), name: name || 'New Schema', version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: [], relationships: [] };
    this.registry.schemas.push(fresh);
    this.persist();
    return fresh;
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
    const header = 'Module,Table Name,Table Description,Column Name,Column Description,Data Type,Length,Precision,Nullable,Alias,Primary Key,Foreign Key,Decode';
    const rows = schema.tables.flatMap((t) => t.columns.map((c) => [t.module, t.name, t.description, c.name, c.description, c.type, c.length ?? '', c.precision ?? '', c.nullable ? 'Y' : 'N', c.alias ?? '', c.isPrimaryKey ? 'Y' : 'N', c.references ? `${c.references.table}.${c.references.column}` : '', c.decode ? c.decode.map((d) => `${d.rawValue}=${d.label}`).join(';') : ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    return [header, ...rows].join('\n');
  }

  getFlattenedRows(schemaId: string): SchemaEditorRow[] {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return [];
    const rows: SchemaEditorRow[] = [];
    schema.tables.forEach((t) => { t.columns.forEach((c) => {
      rows.push({ rowId: `${t.name}::${c.name}`, module: t.module, tableName: t.name, tableDescription: t.description, columnName: c.name, columnDescription: c.description, dataType: c.type, length: c.length ?? null, precision: c.precision ?? null, nullable: c.nullable, alias: c.alias ?? '', decodeText: c.decode ? c.decode.map((d) => `${d.rawValue}=${d.label}`).join('\n') : '', isPrimaryKey: !!c.isPrimaryKey, isForeignKey: !!c.isForeignKey, fkTable: c.references?.table ?? '', fkColumn: c.references?.column ?? '' });
    }); });
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
    schema.tables = incoming.tables;
    schema.relationships = incoming.relationships;
    schema.lastSyncedAt = new Date().toISOString();
    schema.versionMeta = await stampNewVersion(schema, source);
    this.persist();
  }
}

export const schemaService = new SchemaService();
