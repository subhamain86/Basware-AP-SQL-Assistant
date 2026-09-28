import type { SchemaModel, SchemaVersionMeta, SchemaConflict, TableDef, RelationshipDef } from '../types';
const DEVICE_ID_KEY = 'sqla.deviceTag.v155';
export function getDeviceTag(): string {
  let tag = localStorage.getItem(DEVICE_ID_KEY);
  if (!tag) { tag = 'device-' + Math.random().toString(36).slice(2, 8); try { localStorage.setItem(DEVICE_ID_KEY, tag); } catch { } }
  return tag;
}
function canonicalize(tables: TableDef[], relationships: RelationshipDef[]): string {
  const sortedTables = [...tables].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ ...t, columns: [...t.columns].sort((a, b) => a.name.localeCompare(b.name)) }));
  const sortedRels = [...relationships].sort((a, b) => (a.fromTable + a.fromColumn).localeCompare(b.fromTable + b.fromColumn));
  return JSON.stringify({ tables: sortedTables, relationships: sortedRels });
}
export async function computeChecksum(tables: TableDef[], relationships: RelationshipDef[]): Promise<string> {
  const canonical = canonicalize(tables, relationships);
  const enc = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', enc as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function bumpVersion(current: string | undefined): string {
  if (!current) return '1.0.0';
  const parts = current.split('.').map((p) => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.join('.');
}
export async function stampNewVersion(schema: SchemaModel, source: SchemaVersionMeta['source']): Promise<SchemaVersionMeta> {
  const checksum = await computeChecksum(schema.tables, schema.relationships);
  return { version: bumpVersion(schema.versionMeta?.version), schemaId: schema.versionMeta?.schemaId || schema.id, lastUpdated: new Date().toISOString(), updatedByDevice: getDeviceTag(), source, checksum };
}
export function detectConflict(local: SchemaModel, remote: SchemaModel): SchemaConflict {
  const localChecksum = local.versionMeta?.checksum ?? ''; const remoteChecksum = remote.versionMeta?.checksum ?? '';
  if (localChecksum && remoteChecksum && localChecksum === remoteChecksum) return { hasConflict: false, localVersion: local.versionMeta?.version ?? local.version, remoteVersion: remote.versionMeta?.version ?? remote.version, changedPaths: [] };
  const changedPaths: string[] = [];
  const localColsByPath = new Map<string, string>();
  local.tables.forEach((t) => t.columns.forEach((c) => localColsByPath.set(`${t.name}.${c.name}`, JSON.stringify(c))));
  remote.tables.forEach((t) => t.columns.forEach((c) => { const path = `${t.name}.${c.name}`; const localVal = localColsByPath.get(path); if (localVal === undefined) changedPaths.push(path + ' (new)'); else if (localVal !== JSON.stringify(c)) changedPaths.push(path); localColsByPath.delete(path); }));
  localColsByPath.forEach((_v, path) => changedPaths.push(path + ' (removed remotely)'));
  return { hasConflict: changedPaths.length > 0, localVersion: local.versionMeta?.version ?? local.version, remoteVersion: remote.versionMeta?.version ?? remote.version, changedPaths };
}
export function sameLogicalSchema(a: Pick<SchemaModel, 'name'>, b: Pick<SchemaModel, 'name'>): boolean {
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}
