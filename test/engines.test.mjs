/**
 * Unit tests for the core engines and the new V16.0 M365 Copilot orchestration
 * logic. Compiles the TypeScript source to CommonJS once (separate from the
 * esbuild IIFE production bundle) so tests run with plain Node.
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

function baseState(overrides = {}) {
  return {
    dialect: 'Generic', naturalLanguageText: '', selectedTables: [], selectedColumns: [], joins: [], filters: [], sorts: [],
    advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, recursive: false, saveAsView: null, caseExpressions: [], decodeExpressions: [], ctes: [] },
    generatedSql: '', lastGeneratedAt: null, joinPathChoices: {}, ...overrides,
  };
}

test('sqlEngine: basic SELECT with join and filter (unchanged V15.7 behaviour)', () => {
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

test('sqlEngine: no table selected returns guidance placeholder, not an error', () => {
  const sql = buildSelectSQL(baseState(), CORE_SCHEMA);
  assert.match(sql, /Select at least one table/);
});

test('crEngine: UPDATE/DELETE without WHERE is blocked (mandatory safeguard, unchanged)', () => {
  const r1 = buildCrSQL({ dialect: 'Generic', naturalLanguageText: '', queryType: 'UPDATE', table: 'INVOICE_HEADER', values: [{ id: 'v1', column: 'STATUS', value: 'A' }], filters: [], confirmNoWhere: false, generatedSql: '', lastGeneratedAt: null });
  assert.equal(r1.blocked, true);
  assert.match(r1.sql, /WHERE condition is required/);

  const r2 = buildCrSQL({ dialect: 'Generic', naturalLanguageText: '', queryType: 'DELETE', table: 'INVOICE_HEADER', values: [], filters: [], confirmNoWhere: false, generatedSql: '', lastGeneratedAt: null });
  assert.equal(r2.blocked, true);
});

test('crEngine: UPDATE with a WHERE condition succeeds', () => {
  const r = buildCrSQL({ dialect: 'Generic', naturalLanguageText: '', queryType: 'UPDATE', table: 'INVOICE_HEADER', values: [{ id: 'v1', column: 'STATUS', value: 'A' }], filters: [{ id: 'f1', table: 'INVOICE_HEADER', column: 'INVOICE_ID', operator: '=', value: '123', combinator: 'AND' }], confirmNoWhere: false, generatedSql: '', lastGeneratedAt: null });
  assert.equal(r.blocked, false);
  assert.match(r.sql, /UPDATE INVOICE_HEADER/);
  assert.match(r.sql, /WHERE INVOICE_HEADER\.INVOICE_ID = 123/);
});

test('crEngine: explicit no-WHERE confirmation is respected', () => {
  const r = buildCrSQL({ dialect: 'Generic', naturalLanguageText: '', queryType: 'DELETE', table: 'INVOICE_HEADER', values: [], filters: [], confirmNoWhere: true, generatedSql: '', lastGeneratedAt: null });
  assert.equal(r.blocked, false);
  assert.match(r.sql, /DELETE FROM INVOICE_HEADER/);
});

test('errorRectifierEngine: ORA-00904 produces a review comment (unchanged)', () => {
  const r = rectify('ORA-00904: "INVOICE_AMMOUNT": invalid identifier', 'SELECT INVOICE_AMMOUNT FROM INVOICE_HEADER');
  assert.equal(r.detectedDialect, 'Oracle');
  assert.match(r.correctedSql, /Review/);
});

test('nlpEngine: offline parseRequirement still identifies tables/columns with no online engine involved', () => {
  const req = parseRequirement('Show invoice amount and status for invoices', CORE_SCHEMA);
  assert.ok(req.matchedTables.includes('INVOICE_HEADER'));
  assert.ok(req.confidence > 0);
});

test('V16.0 — schema-authoritative filtering: fabricated table/column from an "AI" response is discarded', () => {
  const fakeAiTables = ['INVOICE_HEADER', 'TOTALLY_MADE_UP_TABLE'];
  const { known, unknown } = filterToKnownTables(fakeAiTables, CORE_SCHEMA);
  assert.deepEqual(known, ['INVOICE_HEADER']);
  assert.deepEqual(unknown, ['TOTALLY_MADE_UP_TABLE']);

  const fakeAiColumns = [{ table: 'INVOICE_HEADER', column: 'INVOICE_AMOUNT' }, { table: 'INVOICE_HEADER', column: 'NONEXISTENT_COLUMN' }];
  const colResult = filterToKnownColumns(fakeAiColumns, CORE_SCHEMA);
  assert.equal(colResult.known.length, 1);
  assert.equal(colResult.unknown.length, 1);
  assert.equal(colResult.unknown[0].column, 'NONEXISTENT_COLUMN');
});

test('V16.0 — isCopilotConfigured is false by default (off unless an admin configures every field)', () => {
  assert.equal(isCopilotConfigured(null), false);
  assert.equal(isCopilotConfigured(undefined), false);
  assert.equal(isCopilotConfigured({ enabled: false, tenantId: 't', clientId: 'c', agentEndpoint: 'https://x', scope: 's' }), false, 'disabled flag must win even if other fields are present');
  assert.equal(isCopilotConfigured({ enabled: true, tenantId: '', clientId: 'c', agentEndpoint: 'https://x', scope: 's' }), false, 'missing tenantId must fail closed');
  assert.equal(isCopilotConfigured({ enabled: true, tenantId: 't', clientId: 'c', agentEndpoint: 'https://x', scope: 's' }), true);
});

test('V16.0 — buildMinimalSchemaContext sends only a relevant subset, never the full schema', () => {
  const ctx = buildMinimalSchemaContext('show invoices with vendor name', CORE_SCHEMA);
  assert.match(ctx, /INVOICE_HEADER/);
  const tableCount = (ctx.match(/^TABLE /gm) || []).length;
  assert.ok(tableCount <= 6, `expected a small relevant subset, got ${tableCount} tables in context`);
  assert.ok(!ctx.includes('sqla.secretvault'), 'must never leak vault storage keys or secrets into the Copilot payload');
});

console.log('All engine + V16.0 orchestration tests passed.');
