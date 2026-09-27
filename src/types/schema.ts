export type ColumnDataType = 'VARCHAR' | 'NUMBER' | 'DATE' | 'FLAG' | 'TIMESTAMP';
export const VALID_DATA_TYPES: ColumnDataType[] = ['VARCHAR', 'NUMBER', 'DATE', 'FLAG', 'TIMESTAMP'];
export interface DecodeEntry { rawValue: string; label: string; }
export interface ColumnDef {
  name: string; label: string; type: ColumnDataType; length?: number; precision?: number; nullable: boolean;
  alias?: string; isPrimaryKey?: boolean; isForeignKey?: boolean; references?: { table: string; column: string };
  decode?: DecodeEntry[]; description: string;
}
// V14.2 — objectType distinguishes real Tables from database Views (spec
// section 22). Optional + defaults to 'TABLE' everywhere it's read, so
// every V14.1 schema (which has no objectType at all) continues to work
// unchanged — this is a pure additive field, not a breaking change.
export type SchemaObjectType = 'TABLE' | 'VIEW';
export interface TableDef { name: string; module: string; description: string; columns: ColumnDef[]; objectType?: SchemaObjectType; }
export interface RelationshipDef { id: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string; kind: 'one-to-many' | 'many-to-one' | 'one-to-one'; }
export type SchemaStatus = 'active' | 'default' | 'inactive';
export interface SchemaVersionMeta { version: string; schemaId: string; lastUpdated: string; updatedByDevice: string; source: 'local' | 'location' | 'github' | 'vault' | 'import'; checksum: string; }
export interface SchemaModel { id: string; name: string; version: string; status: SchemaStatus; updatedAt: string; lastSyncedAt: string | null; tables: TableDef[]; relationships: RelationshipDef[]; versionMeta?: SchemaVersionMeta; }
export interface SchemaRegistry { schemas: SchemaModel[]; activeSchemaId: string; }
export interface SchemaEditorRow { rowId: string; module: string; tableName: string; tableDescription: string; columnName: string; columnDescription: string; dataType: ColumnDataType; length: number | null; precision: number | null; nullable: boolean; alias: string; decodeText: string; isPrimaryKey: boolean; isForeignKey: boolean; fkTable: string; fkColumn: string; }
export interface SchemaIntegrityIssue { severity: 'error' | 'warning'; message: string; }
export interface SchemaIntegrityResult { valid: boolean; issues: SchemaIntegrityIssue[]; }
export interface SchemaConflict { hasConflict: boolean; localVersion: string; remoteVersion: string; changedPaths: string[]; }
