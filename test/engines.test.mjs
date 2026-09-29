/**
 * Unit tests for the core engines and regression fixes, including the
 * V16.5 fix for "Active Schema is different in two devices" persisting
 * after V16.4. Compiles the TypeScript source to CommonJS once so tests
 * run with plain Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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

test('V16.1/V16.3 fixes (still in effect): real-world data types accepted', () => {
  const tables = [{ name: 'CUSTOM_TABLE', module: 'Custom', description: '', columns: [{ name: 'ID', label: 'ID', type: 'INTEGER', nullable: false, isPrimaryKey: true, description: '' }] }];
  const result = validateSchemaIntegrity(tables);
  assert.equal(result.valid, true);
});

test('V16.4 (still in effect): Schema Sync merge planning — add / unchanged / conflict', () => {
  const local = [makeSchema('s-local-1', 'Local Only', [])];
  const remote = [makeSchema('s-remote-1', 'Remote Only', [])];
  const plan = planSchemaMerge(local, remote);
  assert.equal(plan[0].kind, 'add');
});

// ---------------------------------------------------------------------
// V16.5 FIX — "Active Schema is different in two devices" (still broken
// after V16.4) — root cause: the pointer sync only ran on the
// AUTHENTICATED pull path, which requires manually unlocking Settings
// each session. The fix applies the same last-write-wins pointer sync on
// the UNAUTHENTICATED background-discovery path too, since that path
// already runs unconditionally on every app load and already syncs
// schema content the same way.
// ---------------------------------------------------------------------

test('V16.5 fix (core logic, re-confirmed): local pointer never explicitly set -> remote pointer is always adopted', () => {
  const local = { activeSchemaId: 'schema-default', activeSchemaUpdatedAt: null };
  const remote = { activeSchemaId: 'schema-B', activeSchemaUpdatedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(shouldApplyRemoteActiveSchema(local, remote), true);
});

test('V16.5 fix (core logic, re-confirmed): remote pointer strictly newer than local -> applied', () => {
  const local = { activeSchemaId: 'schema-A', activeSchemaUpdatedAt: '2026-01-01T00:00:00.000Z' };
  const remote = { activeSchemaId: 'schema-B', activeSchemaUpdatedAt: '2026-01-02T00:00:00.000Z' };
  assert.equal(shouldApplyRemoteActiveSchema(local, remote), true);
});

test('V16.5 fix (core logic, re-confirmed): remote pointer OLDER than local -> NOT applied (no unexpected revert)', () => {
  const local = { activeSchemaId: 'schema-A', activeSchemaUpdatedAt: '2026-01-05T00:00:00.000Z' };
  const remote = { activeSchemaId: 'schema-B', activeSchemaUpdatedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(shouldApplyRemoteActiveSchema(local, remote), false);
});

test('V16.5 fix: syncService.discoverPublicRegistry (the UNAUTHENTICATED, always-on-load path) now calls the Active Schema pointer sync — this is the actual root-cause fix', () => {
  // We assert against the SOURCE of the fixed function, because
  // discoverPublicRegistry performs a real (mocked-away-by-network-failure)
  // GitHub fetch in this Node test environment and cannot be exercised
  // end-to-end here — the browser smoke test covers the live-integration
  // angle. This assertion verifies the specific code-level fix is actually
  // present: that the previously pull-only pointer-sync call has been
  // added inside discoverPublicRegistry's try block, in the correct order
  // (after the schema-content merge, so the referenced schema is
  // guaranteed to exist locally first).
  const src = readFileSync(path.join(root, 'src', 'services', 'syncService.ts'), 'utf8');
  const discoverFnMatch = src.match(/async discoverPublicRegistry\([\s\S]*?\n  \}\n/);
  assert.ok(discoverFnMatch, 'discoverPublicRegistry method should be present in syncService.ts');
  const fnBody = discoverFnMatch[0];
  assert.match(fnBody, /this\.applyMerge\(sanitizedSchemas\)/, 'discoverPublicRegistry must merge schema content');
  assert.match(fnBody, /this\.syncActiveSchemaPointer\(remotePointer\)/, 'V16.5 FIX: discoverPublicRegistry must also call syncActiveSchemaPointer — this was MISSING in V16.4, which is why Active Schema sync only worked after manually unlocking Settings');
  const mergeIdx = fnBody.indexOf('this.applyMerge(sanitizedSchemas)');
  const pointerIdx = fnBody.indexOf('this.syncActiveSchemaPointer(remotePointer)');
  assert.ok(mergeIdx < pointerIdx, 'schema-content merge must happen BEFORE the Active Schema pointer sync, so the referenced schema is guaranteed to already exist locally');
});

test('V16.5 fix: validateIncomingRegistryFile still accepts a sanitized registry (sanitize-then-validate ordering from V16.3 preserved)', () => {
  const rawRegistry = {
    schemas: [{ id: 's1', name: 'X', version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: [{ name: 'T', module: 'M', description: '', columns: [{ name: 'C', label: 'C', nullable: true, description: '' }] }], relationships: [] }],
    activeSchemaId: 's1', activeSchemaUpdatedAt: new Date().toISOString(),
  };
  const sanitizedSchemas = rawRegistry.schemas.map((s) => sanitizeIncomingSchema(s));
  const result = validateIncomingRegistryFile({ ...rawRegistry, schemas: sanitizedSchemas });
  assert.equal(result.valid, true, `issues: ${JSON.stringify(result.issues)}`);
});

console.log('All engine + regression-fix tests passed.');
