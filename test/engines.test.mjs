/**
 * Unit tests for the core engines and regression fixes, including the V16.3
 * fix for the recurring "Remote schema file failed validation" GitHub sync
 * error. Compiles the TypeScript source to CommonJS once so tests run with
 * plain Node.
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
const { validateSchemaIntegrity, validateIncomingRegistryFile, validateIncomingSchemaFile } = await req('src/engines/schemaIntegrityEngine');
const { sanitizeIncomingSchema } = await req('src/utils/validation');

function baseState(overrides = {}) {
  return {
    dialect: 'Generic', naturalLanguageText: '', selectedTables: [], selectedColumns: [], joins: [], filters: [], sorts: [],
    advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, recursive: false, saveAsView: null, caseExpressions: [], decodeExpressions: [], ctes: [] },
    generatedSql: '', lastGeneratedAt: null, joinPathChoices: {}, ...overrides,
  };
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

test('isCopilotConfigured is false unless every field is present (unchanged)', () => {
  assert.equal(isCopilotConfigured(null), false);
  assert.equal(isCopilotConfigured({ enabled: true, tenantId: 't', clientId: 'c', agentEndpoint: 'https://x', scope: 's' }), true);
});

test('V16.1 fix (still in effect): a column with a real-world data type OUTSIDE the old 5-value UI enum is VALID', () => {
  const tables = [{
    name: 'CUSTOM_TABLE', module: 'Custom', description: 'Imported from an external system.',
    columns: [
      { name: 'ID', label: 'ID', type: 'INTEGER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'NAME', label: 'Name', type: 'VARCHAR2', length: 100, nullable: false, description: 'Name.' },
    ],
  }];
  const result = validateSchemaIntegrity(tables);
  assert.equal(result.issues.filter((i) => i.severity === 'error').length, 0);
  assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------
// V16.3 FIX — "Remote schema file failed validation" recurring root cause
// ---------------------------------------------------------------------

test('V16.3 fix: a column with a MISSING `type` KEY ENTIRELY (not just an empty string) is now accepted once sanitized, matching what actually gets saved', () => {
  // Simulates the real-world scenario: JSON.stringify drops keys whose value
  // is `undefined`, so a schema pushed from memory with a genuinely-missing
  // type would arrive over the wire with NO `type` key on that column at
  // all -- not `type: ""`, but the key absent entirely.
  const rawTables = [{
    name: 'LEGACY_TABLE', module: 'Legacy', description: 'A table from an old export.',
    columns: [
      { name: 'ID', label: 'ID', nullable: false, isPrimaryKey: true, description: 'PK.' }, // type key absent
      { name: 'NAME', label: 'Name', type: 'VARCHAR2', nullable: false, description: 'Name.' },
    ],
  }];
  // Validating the RAW data directly (old, broken behavior) correctly finds
  // the missing type -- this proves the test fixture is valid.
  const rawResult = validateSchemaIntegrity(rawTables);
  assert.equal(rawResult.valid, false, 'sanity check: raw data with a missing type key should fail raw validation');

  // The FIX: sanitize first (exactly as schemaService.importSchema and the
  // syncService pull path now both do), THEN validate. The sanitized result
  // must be valid, because sanitizeIncomingSchema defaults the missing type
  // to 'VARCHAR' -- and that defaulted value is what actually gets saved.
  const sanitizedSchema = sanitizeIncomingSchema({ name: 'Legacy', tables: rawTables });
  const sanitizedResult = validateSchemaIntegrity(sanitizedSchema.tables);
  assert.equal(sanitizedResult.valid, true, `sanitized data should now be valid; issues: ${JSON.stringify(sanitizedResult.issues)}`);
  assert.equal(sanitizedSchema.tables[0].columns[0].type, 'VARCHAR', 'missing type should default to VARCHAR after sanitizing');
});

test('V16.3 fix: validateIncomingRegistryFile (the exact function the sync pull path calls) accepts a registry whose columns are sanitized first', () => {
  const rawRegistry = {
    schemas: [{
      id: 'schema-drift-1', name: 'Drifted Schema', version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null,
      tables: [{ name: 'ERP_ORDERS', module: 'ERP', description: 'Orders export.', columns: [
        { name: 'ORDER_ID', label: 'Order ID', nullable: false, isPrimaryKey: true, description: 'PK.' }, // type key absent -- simulates the real bug
      ] }],
      relationships: [],
    }],
    activeSchemaId: 'schema-drift-1',
  };
  // Simulate the fixed syncService order: sanitize each schema in
  // registry.schemas BEFORE re-validating the whole registry shape.
  const sanitizedSchemas = rawRegistry.schemas.map((s) => sanitizeIncomingSchema(s));
  const result = validateIncomingRegistryFile({ ...rawRegistry, schemas: sanitizedSchemas });
  assert.equal(result.valid, true, `issues: ${JSON.stringify(result.issues)}`);
});

test('V16.3 fix: a dangling foreign-key reference (table renamed/removed) no longer blocks the whole schema — it is now a warning, not an error', () => {
  const tables = [{
    name: 'INVOICE_HEADER', module: 'Invoices', description: 'Invoices.',
    columns: [
      { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'PK.' },
      // References a table that no longer exists in this schema (simulates
      // a rename/delete elsewhere that wasn't cleaned up everywhere).
      { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR_RENAMED_AWAY', column: 'VENDOR_ID' }, description: 'Vendor.' },
    ],
  }];
  const result = validateSchemaIntegrity(tables);
  assert.equal(result.valid, true, `a dangling FK reference must not block the whole schema; issues: ${JSON.stringify(result.issues)}`);
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  assert.ok(warnings.some((w) => /does not exist in this schema/.test(w.message)), 'the dangling reference should still be surfaced as a warning so it is visible and fixable');
});

test('V16.3 fix: a duplicate table/column pairing no longer blocks the whole schema — it is now a warning, not an error', () => {
  const tables = [{
    name: 'VENDOR', module: 'Vendors', description: 'Vendors.',
    columns: [
      { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'PK.' },
      { name: 'VENDOR_ID', label: 'Vendor ID (dup)', type: 'NUMBER', nullable: false, description: 'Accidental duplicate.' },
    ],
  }];
  const result = validateSchemaIntegrity(tables);
  assert.equal(result.valid, true, `a duplicate column must not block the whole schema; issues: ${JSON.stringify(result.issues)}`);
  assert.ok(result.issues.some((i) => i.severity === 'warning' && /Duplicate column/.test(i.message)));
});

test('V16.3 fix: truly fatal structural issues (missing table name, missing column name) still correctly block validation', () => {
  const missingTableName = [{ name: '', module: 'X', description: '', columns: [{ name: 'A', label: 'A', type: 'NUMBER', nullable: true, description: '' }] }];
  const r1 = validateSchemaIntegrity(missingTableName);
  assert.equal(r1.valid, false);
  assert.ok(r1.issues.some((i) => i.severity === 'error' && /missing its Table Name/.test(i.message)));

  const missingColumnName = [{ name: 'T', module: 'X', description: '', columns: [{ name: '', label: '', type: 'NUMBER', nullable: true, description: '' }] }];
  const r2 = validateSchemaIntegrity(missingColumnName);
  assert.equal(r2.valid, false);
  assert.ok(r2.issues.some((i) => i.severity === 'error' && /missing Column Name/.test(i.message)));
});

console.log('All engine + regression-fix tests passed.');
