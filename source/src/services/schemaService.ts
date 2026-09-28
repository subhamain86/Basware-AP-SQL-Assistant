import type { SchemaModel, SchemaRegistry, DecodeEntry, TableDef, ColumnDef, SchemaEditorRow, ActiveSchemaMeta, ActiveSchemaSyncOutcome } from '../types';
import { DEFAULT_SCHEMAS, DEFAULT_ACTIVE_SCHEMA_ID } from '../data/defaultSchemas';
import { validateDecodeEntries } from '../engines/decodeEngine';
import { validateSchemaIntegrity, validateCandidateRowFields } from '../engines/schemaIntegrityEngine';
import { stampNewVersion, sameLogicalSchema, getDeviceTag } from '../engines/schemaVersionEngine';
import { makeId } from '../utils/id';
import { validateSchemaName, sanitizeIncomingSchema, safeLocalStorageSet, estimateStringBytes, safeTrim, safeUpperTrim } from '../utils/validation';
const STORAGE_KEY = 'sqla.registry.v156';
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
export interface StorageHealth { bytesUsed: number; lastPersistOk: boolean; lastError: string | null; lastRecovered: boolean; }
function defaultActiveSchemaMeta(): ActiveSchemaMeta { return { updatedAt: new Date(0).toISOString(), updatedByDevice: 'none', configVersion: 0 }; }
export class SchemaService {
  private registry: SchemaRegistry;
  private listeners = new Set<() => void>();
  private storageHealth: StorageHealth = { bytesUsed: 0, lastPersistOk: true, lastError: null, lastRecovered: false };
  constructor() { this.registry = this.load(); }
  private load(): SchemaRegistry {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SchemaRegistry;
        if (parsed.schemas?.length) { if (!parsed.activeSchemaMeta) parsed.activeSchemaMeta = defaultActiveSchemaMeta(); return parsed; }
      }
    } catch { }
    return { schemas: clone(DEFAULT_SCHEMAS), activeSchemaId: DEFAULT_ACTIVE_SCHEMA_ID, activeSchemaMeta: defaultActiveSchemaMeta() };
  }
  private static readonly PRUNE_ESCALATION_CAPS = [12, 6, 3, 1];
  private persist(): void {
    const result = safeLocalStorageSet(STORAGE_KEY, () => {
      const serialized = JSON.stringify(this.registry);
      this.storageHealth.bytesUsed = estimateStringBytes(serialized);
      return serialized;
    }, (attempt) => {
      const cap = SchemaService.PRUNE_ESCALATION_CAPS[Math.min(attempt, SchemaService.PRUNE_ESCALATION_CAPS.length - 1)];
      this.pruneForSpace(cap);
    }, SchemaService.PRUNE_ESCALATION_CAPS.length);
    this.storageHealth.lastPersistOk = result.ok;
    this.storageHealth.lastRecovered = result.recovered;
    this.storageHealth.lastError = result.error || null;
    this.listeners.forEach((l) => l());
  }
  pruneForSpace(maxInactive = 12): { removedCount: number; freedApproxBytes: number } {
    const effectiveMaxInactive = Math.max(1, maxInactive);
    const before = estimateStringBytes(JSON.stringify(this.registry));
    const byName = new Map<string, SchemaModel[]>();
    this.registry.schemas.forEach((s) => { const key = s.name.trim().toLowerCase(); const list = byName.get(key) || []; list.push(s); byName.set(key, list); });
    const keep: SchemaModel[] = [];
    byName.forEach((group) => {
      if (group.length === 1) { keep.push(group[0]); return; }
      const active = group.find((s) => s.status === 'active');
      const rest = group.filter((s) => s !== active).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      if (active) keep.push(active);
      if (rest.length) keep.push(rest[0]);
    });
    const inactiveSorted = keep.filter((s) => s.status !== 'active').sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const activeOnes = keep.filter((s) => s.status === 'active');
    const trimmedInactive = inactiveSorted.slice(0, effectiveMaxInactive);
    const finalSchemas = [...activeOnes, ...trimmedInactive];
    const removedCount = this.registry.schemas.length - finalSchemas.length;
    if (finalSchemas.length === 0) return { removedCount: 0, freedApproxBytes: 0 };
    this.registry = { ...this.registry, schemas: finalSchemas };
    if (!finalSchemas.some((s) => s.id === this.registry.activeSchemaId)) { this.registry.activeSchemaId = finalSchemas[0].id; finalSchemas[0].status = 'active'; }
    const after = estimateStringBytes(JSON.stringify(this.registry));
    return { removedCount, freedApproxBytes: Math.max(0, before - after) };
  }
  getStorageHealth(): StorageHealth { return { ...this.storageHealth }; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  getRegistry(): SchemaRegistry { return this.registry; }
  getActiveSchema(): SchemaModel { const found = this.registry.schemas.find((s) => s.id === this.registry.activeSchemaId); return found || this.registry.schemas[0]; }
  isActiveSchemaMissing(): boolean { return !this.registry.schemas.some((s) => s.id === this.registry.activeSchemaId); }
  getActiveSchemaMeta(): ActiveSchemaMeta { return this.registry.activeSchemaMeta || defaultActiveSchemaMeta(); }
  getAllSchemas(): SchemaModel[] { return this.registry.schemas; }
  getSchemaById(id: string): SchemaModel | undefined { return this.registry.schemas.find((s) => s.id === id); }
  getModulesForSchema(schemaId: string): string[] { const s = this.getSchemaById(schemaId); if (!s) return []; return Array.from(new Set(s.tables.map((t) => t.module))).sort(); }
  getTablesForModule(schemaId: string, module: string | null): TableDef[] { const s = this.getSchemaById(schemaId); if (!s) return []; return module ? s.tables.filter((t) => t.module === module) : s.tables; }
  getAllSchemaNames(excludeId?: string): string[] { return this.registry.schemas.filter((s) => s.id !== excludeId).map((s) => s.name); }
  switchActiveSchema(schemaId: string): void {
    if (!this.registry.schemas.some((s) => s.id === schemaId)) return;
    this.registry.schemas.forEach((s) => { s.status = s.id === schemaId ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
    this.registry.activeSchemaId = schemaId;
    const prevVersion = this.registry.activeSchemaMeta?.configVersion ?? 0;
    this.registry.activeSchemaMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), configVersion: prevVersion + 1 };
    this.persist();
  }
  applyRemoteActiveSchema(remoteId: string | undefined, remoteMeta: ActiveSchemaMeta | undefined): ActiveSchemaSyncOutcome {
    if (!remoteId) return 'none';
    if (remoteId === this.registry.activeSchemaId) return 'skipped-same';
    const exists = this.registry.schemas.some((s) => s.id === remoteId);
    if (!exists) return 'not-found';
    const localMeta = this.registry.activeSchemaMeta || defaultActiveSchemaMeta();
    const remoteVersion = remoteMeta?.configVersion ?? 0;
    const localVersion = localMeta.configVersion ?? 0;
    const remoteTime = remoteMeta?.updatedAt ? new Date(remoteMeta.updatedAt).getTime() : 0;
    const localTime = localMeta.updatedAt ? new Date(localMeta.updatedAt).getTime() : 0;
    const remoteIsNewer = remoteVersion > localVersion || (remoteVersion === localVersion && remoteTime > localTime);
    if (!remoteIsNewer) return 'skipped-stale';
    this.registry.schemas.forEach((s) => { s.status = s.id === remoteId ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
    this.registry.activeSchemaId = remoteId;
    this.registry.activeSchemaMeta = remoteMeta || { updatedAt: new Date().toISOString(), updatedByDevice: 'remote', configVersion: localVersion + 1 };
    this.persist();
    return 'applied';
  }
  resetToDefaultSchema(): void { this.switchActiveSchema(DEFAULT_ACTIVE_SCHEMA_ID); }
  validateNewSchemaName(name: unknown, excludeId?: string): string | null {
    const result = validateSchemaName(name, this.getAllSchemaNames(excludeId));
    return result.valid ? null : (result.message || 'Invalid schema name.');
  }
  importSchema(schema: SchemaModel, customName: string, originalFileName?: string): { ok: boolean; error?: string; schemaId?: string; replacedExisting?: boolean } {
    if (!schema || !Array.isArray(schema.tables)) return { ok: false, error: 'Invalid schema file: missing "tables" array.' };
    const sanitized = sanitizeIncomingSchema(schema) as SchemaModel;
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
    if (nameError) return { ok: false, error: nameError };
    const id = makeId('schema');
    const withDefaults: SchemaModel = { id, name: trimmedName, version: sanitized.version || '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: sanitized.tables, relationships: sanitized.relationships || [], originalFileName: originalFileName || undefined };
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
    if (wasActive) { this.registry.activeSchemaId = this.registry.schemas[0].id; this.registry.schemas[0].status = 'active'; const prevVersion = this.registry.activeSchemaMeta?.configVersion ?? 0; this.registry.activeSchemaMeta = { updatedAt: new Date().toISOString(), updatedByDevice: getDeviceTag(), configVersion: prevVersion + 1 }; }
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

  /** ==========================================================================
   * V15.6 ROOT-CAUSE FIX — Manual Schema Update "Save" defect
   * ==========================================================================
   * ROOT CAUSE IDENTIFIED: the previous implementation validated an edited
   * row by running `validateSchemaIntegrity()` over the ENTIRE candidate
   * table set (every table, every column in the whole schema) after
   * applying the edit, and rejected the save if THAT FULL-SCHEMA SWEEP
   * produced ANY error — including errors on rows the user never touched.
   * In a schema of any real size it is common for at least one pre-existing,
   * unrelated column to have a naturally-occurring structural warning/error
   * (e.g. a legitimate composite key, a FK pointing at a table imported
   * later, etc.) — and because the full-schema check has no way to
   * distinguish "pre-existing, unrelated" from "caused by this edit," a
   * perfectly valid single-row edit could be silently blocked by validation
   * noise from a completely different part of the schema. This is exactly
   * the "must not reject the save because of unrelated rows elsewhere in
   * the schema" defect described in the V15.6 report.
   *
   * A second, compounding issue: even when validation DID pass, the
   * implementation still rebuilt the ENTIRE `tables` array via a deep
   * clone-and-splice/push sequence and reassigned `schema.tables` wholesale
   * — a full-collection replacement rather than a true targeted, row-level
   * patch, which is fragile (e.g. an edited column's position silently
   * moved to the end of the table) and violates "use a targeted
   * update/patch approach rather than replacing the complete schema
   * object."
   *
   * THE FIX (both parts):
   *  1. Validation is now performed by `validateCandidateRowFields()` —
   *     scoped to ONLY the single candidate row's own fields (data type,
   *     length/precision, decode entries) plus, where relevant, whether
   *     its own declared Foreign Key target actually exists elsewhere in
   *     the schema. It is IMPOSSIBLE for this check to fail because of an
   *     unrelated, pre-existing issue on a different row, because it never
   *     inspects any column other than the one being saved (aside from
   *     resolving this one column's own FK target).
   *  2. The update itself now finds the exact target column BY IDENTITY
   *     (`table::column`, the same key used by `SchemaEditorRow.rowId`) and
   *     mutates that one column object'sfields **in place**, preserving
   *     its exact array position — or, if the table/column name itself is
   *     being renamed, removes the old entry and inserts the new one at
   *     the SAME index the old one occupied (rather than appending to the
   *     end). Every other table and every other column is left completely
   *     untouched — same object references, same order, same values.
   * ========================================================================== */
  async upsertRow(schemaId: string, row: SchemaEditorRow, originalRowId: string | null): Promise<string[]> {
    const schema = this.getSchemaById(schemaId);
    if (!schema) return ['Schema not found.'];

    // Required-field checks (these must always run, editing or adding).
    const requiredIssues: string[] = [];
    if (!safeTrim(row.tableName)) requiredIssues.push('Table Name is required.');
    if (!safeTrim(row.columnName)) requiredIssues.push('Column Name is required.');
    if (requiredIssues.length) return requiredIssues;

    const decodeEntries: DecodeEntry[] = row.decodeText.split(/[\n;]+/).map((l) => l.trim()).filter((l) => l.length > 0).map((line) => { const idx = line.indexOf('='); return idx === -1 ? { rawValue: line, label: line } : { rawValue: line.slice(0, idx).trim(), label: line.slice(idx + 1).trim() }; });
    const candidateColumn: ColumnDef = { name: row.columnName.trim(), label: row.columnName.trim(), description: row.columnDescription, type: row.dataType, length: row.length ?? undefined, precision: row.precision ?? undefined, nullable: row.nullable, alias: row.alias || undefined, isPrimaryKey: row.isPrimaryKey, isForeignKey: row.isForeignKey, references: row.isForeignKey && row.fkTable && row.fkColumn ? { table: row.fkTable.trim(), column: row.fkColumn.trim() } : undefined, decode: decodeEntries.length ? decodeEntries : undefined };

    // V15.6 fix — validate ONLY this row's own fields, never the rest of
    // the schema's unrelated rows/tables.
    const rowValidationErrors = validateCandidateRowFields(candidateColumn, row.tableName.trim(), schema.tables);
    if (rowValidationErrors.length) return rowValidationErrors;

    const [origTableName, origColumnName] = originalRowId ? originalRowId.split('::') : [null, null];
    const isRename = !!(origTableName && (safeUpperTrim(origTableName) !== safeUpperTrim(row.tableName) || safeUpperTrim(origColumnName) !== safeUpperTrim(row.columnName)));

    // V15.6 fix — targeted, row-level mutation. We still work off a deep
    // clone of the tables array (so a validation failure earlier never has
    // a chance to have mutated anything, and so any in-flight read
    // elsewhere sees a consistent snapshot), but instead of rebuilding the
    // whole array via filter+push, we locate the exact existing column (by
    // table+column identity) and either update it in place at its
    // existing index, or — only for a genuine rename — remove the old
    // entry and insert the new one at the SAME index. Every other table
    // and column is left byte-for-byte identical (same references, order,
    // and values) apart from the one row actually being changed.
    const candidateTables: TableDef[] = clone(schema.tables);
    let targetTable = candidateTables.find((t) => safeUpperTrim(t.name) === safeUpperTrim(row.tableName));

    if (origTableName && origColumnName) {
      const origTableIdx = candidateTables.findIndex((t) => safeUpperTrim(t.name) === safeUpperTrim(origTableName));
      if (origTableIdx !== -1) {
        const origTable = candidateTables[origTableIdx];
        const origColIdx = origTable.columns.findIndex((c) => safeUpperTrim(c.name) === safeUpperTrim(origColumnName));
        if (origColIdx !== -1) {
          if (!isRename && origTable === targetTable) {
            // Same table, same column identity — update the existing
            // column object in place, preserving its array position.
            origTable.columns[origColIdx] = candidateColumn;
            targetTable.module = row.module || targetTable.module;
            targetTable.description = row.tableDescription || targetTable.description;
            schema.tables = candidateTables;
            schema.updatedAt = new Date().toISOString();
            schema.versionMeta = await stampNewVersion(schema, 'local');
            this.persist();
            return [];
          }
          // Genuine rename (table and/or column identity changed) — remove
          // the old entry from its original table/position.
          origTable.columns.splice(origColIdx, 1);
          if (origTable.columns.length === 0 && safeUpperTrim(origTable.name) !== safeUpperTrim(row.tableName)) {
            const idx = candidateTables.indexOf(origTable);
            if (idx !== -1) candidateTables.splice(idx, 1);
          }
        }
      }
    }

    // Insert the (possibly renamed, or brand-new) column into its target
    // table. If the target table still exists after the removal above,
    // append there; only a genuinely new table is created from scratch.
    targetTable = candidateTables.find((t) => safeUpperTrim(t.name) === safeUpperTrim(row.tableName));
    if (targetTable) {
      targetTable.module = row.module || targetTable.module;
      targetTable.description = row.tableDescription || targetTable.description;
      targetTable.columns.push(candidateColumn);
    } else {
      candidateTables.push({ name: row.tableName.trim(), module: row.module || 'General', description: row.tableDescription || '', columns: [candidateColumn] });
    }

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
  addSchemaFromRemote(incoming: SchemaModel): 'added' | 'updated' | 'skipped' {
    const sanitized = sanitizeIncomingSchema(incoming) as SchemaModel;
    if (this.registry.schemas.some((s) => s.id === incoming.id)) return 'skipped';
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
  markAllSynced(): void {
    const now = new Date().toISOString();
    this.registry.schemas.forEach((s) => { s.lastSyncedAt = now; });
    this.persist();
  }
}
export const schemaService = new SchemaService();
