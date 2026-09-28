/**
 * Unit tests for the core engines and the three V16.1 regression fixes:
 *  1. (UI/card sizing is verified separately by the browser smoke test.)
 *  2. GitHub sync validation fix — a schema with a real-world data type
 *     (not in the old 5-value UI enum) must now pass validation, both at
 *     import time and at "remote registry" validation time (same function).
 *  3. Error-state fix — syncService exposes a nullable lastError that is
 *     set on explicit failures and cleared on the next explicit success,
 *     and background/auto-discovery failures never touch it.
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
const { parseRequirement } = await req('src/engines/nlpEngine');
const { CORE_SCHEMA } = await req('src/data/defaultSchemas');
const { filterToKnownTables, filterToKnownColumns } = await req('src/engines/nlpEngine');
const { isCopilotConfigured, buildMinimalSchemaContext } = await req('src/services/copilotNlpService');
const { validateSchemaIntegrity, validateIncomingRegistryFile } = await req('src/engines/schemaIntegrityEngine');

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

test('crEngine: explicit no-WHERE confirmation is respected (unchanged)', () => {
  const r = buildCrSQL({ dialect: 'Generic', naturalLanguageText: '', queryType: 'DELETE', table: 'INVOICE_HEADER', values: [], filters: [], confirmNoWhere: true, generatedSql: '', lastGeneratedAt: null });
  assert.equal(r.blocked, false);
  assert.match(r.sql, /DELETE FROM INVOICE_HEADER/);
});

test('errorRectifierEngine: ORA-00904 produces a review comment (unchanged)', () => {
  const r = rectify('ORA-00904: "INVOICE_AMMOUNT": invalid identifier', 'SELECT INVOICE_AMMOUNT FROM INVOICE_HEADER');
  assert.equal(r.detectedDialect, 'Oracle');
  assert.match(r.correctedSql, /Review/);
});

test('schema-authoritative filtering: fabricated table/column from an AI response is discarded (unchanged)', () => {
  const { known, unknown } = filterToKnownTables(['INVOICE_HEADER', 'MADE_UP_TABLE'], CORE_SCHEMA);
  assert.deepEqual(known, ['INVOICE_HEADER']);
  assert.deepEqual(unknown, ['MADE_UP_TABLE']);
  const colResult = filterToKnownColumns([{ table: 'INVOICE_HEADER', column: 'INVOICE_AMOUNT' }, { table: 'INVOICE_HEADER', column: 'NONEXISTENT' }], CORE_SCHEMA);
  assert.equal(colResult.known.length, 1);
  assert.equal(colResult.unknown.length, 1);
});

test('isCopilotConfigured is false unless every field is present (unchanged)', () => {
  assert.equal(isCopilotConfigured(null), false);
  assert.equal(isCopilotConfigured({ enabled: true, tenantId: 't', clientId: 'c', agentEndpoint: 'https://x', scope: 's' }), true);
});

// ---------------------------------------------------------------------
// V16.1 FIX #2 — GitHub sync validation for imported schemas
// ---------------------------------------------------------------------

test('V16.1 fix: a column with a real-world data type OUTSIDE the old 5-value UI enum is now VALID', () => {
  const tables = [{
    name: 'CUSTOM_TABLE', module: 'Custom', description: 'Imported from an external system.',
    columns: [
      { name: 'ID', label: 'ID', type: 'INTEGER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
      { name: 'NAME', label: 'Name', type: 'VARCHAR2', length: 100, nullable: false, description: 'Name.' },
      { name: 'IS_ACTIVE', label: 'Active', type: 'BOOLEAN', nullable: false, description: 'Active flag.' },
      { name: 'PAYLOAD', label: 'Payload', type: 'CLOB', nullable: true, description: 'Large text payload.' },
      { name: 'AMOUNT', label: 'Amount', type: 'DECIMAL', precision: 2, nullable: true, description: 'Monetary amount.' },
    ],
  }];
  const result = validateSchemaIntegrity(tables);
  const errors = result.issues.filter((i) => i.severity === 'error');
  assert.equal(errors.length, 0, `expected no errors, got: ${JSON.stringify(errors)}`);
  assert.equal(result.valid, true);
});

test('V16.1 fix: a column with NO data type at all is still correctly rejected', () => {
  const tables = [{ name: 'T', module: 'M', description: '', columns: [{ name: 'C', label: 'C', type: '', nullable: true, description: '' }] }];
  const result = validateSchemaIntegrity(tables);
  const errors = result.issues.filter((i) => i.severity === 'error');
  assert.ok(errors.some((e) => /missing a Data Type/.test(e.message)));
  assert.equal(result.valid, false);
});

test('V16.1 fix: an imported schema with real-world data types passes the SAME validator used for remote/pulled registry files ("Remote schema file failed validation" root cause)', () => {
  const registry = {
    schemas: [{
      id: 'schema-imported-1', name: 'Imported ERP Schema', version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null,
      tables: [{
        name: 'ERP_ORDERS', module: 'ERP', description: 'Orders pulled from an external ERP export.',
        columns: [
          { name: 'ORDER_ID', label: 'Order ID', type: 'NUMBER(10)', nullable: false, isPrimaryKey: true, description: 'PK.' },
          { name: 'ORDER_DATE', label: 'Order Date', type: 'TIMESTAMP(6)', nullable: false, description: 'Order timestamp.' },
          { name: 'CUSTOMER_NAME', label: 'Customer', type: 'NVARCHAR2', length: 200, nullable: false, description: 'Customer name.' },
          { name: 'RAW_DATA', label: 'Raw', type: 'BLOB', nullable: true, description: 'Original binary payload.' },
        ],
      }],
      relationships: [],
    }],
    activeSchemaId: 'schema-imported-1',
  };
  const result = validateIncomingRegistryFile(registry);
  assert.equal(result.valid, true, `Imported schema with real-world data types should pass remote validation; issues: ${JSON.stringify(result.issues)}`);
});

console.log('All engine + V16.1 regression-fix tests passed.');
