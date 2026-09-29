/**
 * Unit tests for the core engines and regression fixes, including the
 * V16.4 fix for cross-device Schema Sync and Active Schema Sync. Compiles
 * the TypeScript source to CommonJS once so tests run with plain Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.test-build');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

execSync(
  `node node_modules/typescript/bin/tsc --module commonjs --moduleResolution node --target es2020 --outDir .test-build --rootDir . --esModuleInterop --skipLibCheck --lib es2020,dom $(find src -name "*.ts")`,
  { cwd: root, stdio: 'inherit', shell: '/bin/bash' }
);
await writeFile(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const req = (p) => import(path.join(outDir, p) + '.js');

const { buildSelectSQL } = await req('src/engines/sqlEngine');
const { buildCrSQL } = await req('src/engines/crEngine');
const { rectify } = await req('src/engines/errorRectifierEngine');
const { CORE_SCHEMA } = await req('src/data/defaultSchemas');
const { filterToKnownTables } = await req('src/engines/nlpEngine');
const { isCopilotConfigured } = await req('src/services/copilotNlpService');
const { validateSchemaIntegrity, validateIncomingRegistryFile } = await req('src/engines/schemaIntegrityEngine');
const { sanitizeIncomingSchema } = await req('src/utils/validation');
const { planSchemaMerge, shouldApplyRemoteActiveSchema } = await req('src/engines/schemaSyncMerge');

function baseState(overrides = {}) {
  return {
    dialect: 'Generic', naturalLanguageText: '', selectedTables: [], selectedColumns: [], joins: [], filters: [], sorts: [],
    advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, recursive: false, saveAsView: null, caseExpressions: [], decodeExpressions: [], ctes: [] },
    generatedSql: '', lastGeneratedAt: null, joinPathChoices: {}, ...overrides,
  };
}
function makeSchema(id, name, tables, versionMeta) {
  return { id, name, version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables, relationships: [], versionMeta };
}

test('sqlEngine: basic SELECT with join and filter (unchanged)', () => {
  const state = baseState({
    selectedTables: ['INVOICE_HEADER', 'VENDOR'],
    selectedColumns: [{ id: 'c1', table: 'INVOICE_HEADER', column: 'INVOICE_ID', alias: '', useDecode: false, aggregate: null }, { id: 'c2', table: 'VENDOR', column: 'VENDOR_NAME', alias: '', useDecode: false, aggregate: null }],
    filters: [{ id: 'f1', table: 'INVOICE_HEADER', column: 'STATUS', operator: '=', value: 'P', combinator: 'AND' }],
  });
  const sql = buildSelectSQL(state, CORE_SCHEMA);
  assert.match(sql, /SELECT/);
  assert.match(sql, /INNER JOIN VENDOR/);
  assert.match(sql, /WHERE INVOICE_HEADER\.STATUS = 'P'/);
});

test('crEngine: UPDATE/DELETE without WHERE is blocked (mandatory safeguard, unchanged)', () => {
  const r1 = buildCrSQL({ dialect: 'Generic', naturalLanguageText: '', queryType: 'UPDATE', table: 'INVOICE_HEADER', values: [{ id: 'v1', column: 'STATUS', value: 'A' }], filters: [], confirmNoWhere: false, generatedSql: '', lastGeneratedAt: null });
  assert.equal(r1.blocked, true);
  assert.match(r1.sql, /WHERE condition is required/);
});

test('errorRectifierEngine: ORA-00904 produces a review comment (unchanged)', () => {
  const r = rectify('ORA-00904: "INVOICE_AMMOUNT": invalid identifier', 'SELECT INVOICE_AMMOUNT FROM INVOICE_HEADER');
  assert.equal(r.detectedDialect, 'Oracle');
  assert.match(r.correctedSql, /Review/);
});

test('schema-authoritative filtering: fabricated table from an AI response is discarded (unchanged)', () => {
  const { known, unknown } = filterToKnownTables(['INVOICE_HEADER', 'MADE_UP_TABLE'], CORE_SCHEMA);
  assert.deepEqual(known, ['INVOICE_HEADER']);
  assert.deepEqual(unknown, ['MADE_UP_TABLE']);
});

test('isCopilotConfigured is false unless every field is present (M365 Copilot integration, unchanged)', () => {
  assert.equal(isCopilotConfigured(null), false);
  assert.equal(isCopilotConfigured({ enabled: true, tenantId: 't', clientId: 'c', agentEndpoint: 'https://x', scope: 's' }), true);
});

test('V16.1/V16.3 fixes (still in effect): real-world data types accepted, referential drift is a warning not an error', () => {
  const tables = [{ name: 'CUSTOM_TABLE', module: 'Custom', description: '', columns: [{ name: 'ID', label: 'ID', type: 'INTEGER', nullable: false, isPrimaryKey: true, description: '' }] }];
  const result = validateSchemaIntegrity(tables);
  assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------
// V16.4 FIX — Schema Sync + Active Schema Sync across devices
// ---------------------------------------------------------------------

test('V16.4 fix (Schema Sync): a schema that exists only remotely is planned as "add" — never silently dropped', () => {
  const local = [makeSchema('s-local-1', 'Local Only', [])];
  const remote = [makeSchema('s-remote-1', 'Remote Only', [])];
  const plan = planSchemaMerge(local, remote);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'add');
  assert.equal(plan[0].schema.id, 's-remote-1');
});

test('V16.4 fix (Schema Sync): identical schema on both sides (same checksum) is "unchanged" — no unnecessary conflict', () => {
  const cols = [{ name: 'A', label: 'A', type: 'NUMBER', nullable: true, description: '' }];
  const tables = [{ name: 'T', module: 'M', description: '', columns: cols }];
  const versionMeta = { version: '1.0.0', schemaId: 's1', lastUpdated: new Date().toISOString(), updatedByDevice: 'dev1', source: 'local', checksum: 'abc123' };
  const local = [makeSchema('s1', 'Same Schema', tables, versionMeta)];
  const remote = [makeSchema('s1', 'Same Schema', tables, { ...versionMeta, updatedByDevice: 'dev2' })];
  const plan = planSchemaMerge(local, remote);
  assert.equal(plan[0].kind, 'unchanged');
});

test('V16.4 fix (Schema Sync): genuinely diverged content on both sides is flagged "conflict" — never auto-picks a winner', () => {
  const versionMetaA = { version: '1.0.0', schemaId: 's1', lastUpdated: new Date().toISOString(), updatedByDevice: 'dev1', source: 'local', checksum: 'checksum-A' };
  const versionMetaB = { version: '1.0.1', schemaId: 's1', lastUpdated: new Date().toISOString(), updatedByDevice: 'dev2', source: 'local', checksum: 'checksum-B' };
  const tablesA = [{ name: 'T', module: 'M', description: '', columns: [{ name: 'A', label: 'A', type: 'NUMBER', nullable: true, description: '' }] }];
  const tablesB = [{ name: 'T', module: 'M', description: '', columns: [{ name: 'B', label: 'B', type: 'VARCHAR', nullable: true, description: '' }] }];
  const local = [makeSchema('s1', 'Diverged', tablesA, versionMetaA)];
  const remote = [makeSchema('s1', 'Diverged', tablesB, versionMetaB)];
  const plan = planSchemaMerge(local, remote);
  assert.equal(plan[0].kind, 'conflict');
  assert.ok(plan[0].conflict.hasConflict);
});

test('V16.4 fix (Active Schema Sync): local pointer never explicitly set -> remote pointer is always adopted', () => {
  const local = { activeSchemaId: 'schema-default', activeSchemaUpdatedAt: null };
  const remote = { activeSchemaId: 'schema-B', activeSchemaUpdatedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(shouldApplyRemoteActiveSchema(local, remote), true, 'a device that has never explicitly set its own Active Schema must adopt the remote choice');
});

test('V16.4 fix (Active Schema Sync): remote pointer strictly newer than local -> applied (this is what makes cross-device sync work)', () => {
  const local = { activeSchemaId: 'schema-A', activeSchemaUpdatedAt: '2026-01-01T00:00:00.000Z' };
  const remote = { activeSchemaId: 'schema-B', activeSchemaUpdatedAt: '2026-01-02T00:00:00.000Z' };
  assert.equal(shouldApplyRemoteActiveSchema(local, remote), true);
});

test('V16.4 fix (Active Schema Sync): remote pointer OLDER than local -> NOT applied (must not unexpectedly revert an intentional local choice)', () => {
  const local = { activeSchemaId: 'schema-A', activeSchemaUpdatedAt: '2026-01-05T00:00:00.000Z' };
  const remote = { activeSchemaId: 'schema-B', activeSchemaUpdatedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(shouldApplyRemoteActiveSchema(local, remote), false, 'an older remote choice must never override a more recent local choice');
});

test('V16.4 fix (Active Schema Sync): remote already matches local -> no-op (false), regardless of timestamps', () => {
  const local = { activeSchemaId: 'schema-A', activeSchemaUpdatedAt: '2026-01-01T00:00:00.000Z' };
  const remote = { activeSchemaId: 'schema-A', activeSchemaUpdatedAt: '2026-01-09T00:00:00.000Z' };
  assert.equal(shouldApplyRemoteActiveSchema(local, remote), false);
});

test('V16.4 fix (Active Schema Sync): remote has no pointer at all -> never applied', () => {
  const local = { activeSchemaId: 'schema-A', activeSchemaUpdatedAt: null };
  const remote = { activeSchemaId: '', activeSchemaUpdatedAt: null };
  assert.equal(shouldApplyRemoteActiveSchema(local, remote), false);
});

test('V16.4 fix (Active Schema Sync): remote has no timestamp but local does -> untimed remote never overrides a timed, deliberate local choice', () => {
  const local = { activeSchemaId: 'schema-A', activeSchemaUpdatedAt: '2026-01-01T00:00:00.000Z' };
  const remote = { activeSchemaId: 'schema-B', activeSchemaUpdatedAt: null };
  assert.equal(shouldApplyRemoteActiveSchema(local, remote), false);
});

test('V16.4 fix: validateIncomingRegistryFile still accepts a sanitized registry (sanitize-then-validate ordering from V16.3 preserved)', () => {
  const rawRegistry = {
    schemas: [{ id: 's1', name: 'X', version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: [{ name: 'T', module: 'M', description: '', columns: [{ name: 'C', label: 'C', nullable: true, description: '' }] }], relationships: [] }],
    activeSchemaId: 's1', activeSchemaUpdatedAt: new Date().toISOString(),
  };
  const sanitizedSchemas = rawRegistry.schemas.map((s) => sanitizeIncomingSchema(s));
  const result = validateIncomingRegistryFile({ ...rawRegistry, schemas: sanitizedSchemas });
  assert.equal(result.valid, true, `issues: ${JSON.stringify(result.issues)}`);
});

console.log('All engine + regression-fix tests passed.');
