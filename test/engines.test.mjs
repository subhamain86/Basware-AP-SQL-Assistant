/**
 * Unit tests for the core engines and regression fixes. Compiles the
 * TypeScript source to CommonJS once so tests run with plain Node.
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

test('V16.1 fix: a column with a real-world data type OUTSIDE the old 5-value UI enum is still VALID', () => {
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

test('V16.1 fix: an imported schema with real-world data types passes the SAME validator used for remote/pulled registry files', () => {
  const registry = {
    schemas: [{
      id: 'schema-imported-1', name: 'Imported ERP Schema', version: '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null,
      tables: [{ name: 'ERP_ORDERS', module: 'ERP', description: 'Orders from an ERP export.', columns: [
        { name: 'ORDER_ID', label: 'Order ID', type: 'NUMBER(10)', nullable: false, isPrimaryKey: true, description: 'PK.' },
      ] }],
      relationships: [],
    }],
    activeSchemaId: 'schema-imported-1',
  };
  const result = validateIncomingRegistryFile(registry);
  assert.equal(result.valid, true, `issues: ${JSON.stringify(result.issues)}`);
});

test('V16.2 fix: settingsPage.ts no longer uses the hidden-attribute toggle pattern for #settingsPwError', () => {
  // Root cause of "password error shown with no error": the box relied on
  // the HTML `hidden` attribute, which lost a CSS specificity tie against
  // `.issue-box{display:flex}`. The permanent fix removes that dependency
  // entirely by never inserting the error markup into the DOM until a real
  // error exists. This test asserts the source no longer contains the old,
  // fragile pattern (a hard-coded `hidden` attribute alongside the error
  // markup on the same line) for this specific element.
  const src = readFileSync(path.join(root, 'src', 'pages', 'settingsPage.ts'), 'utf8');
  assert.doesNotMatch(src, /id="settingsPwError"[^>]*class="issue-box[^>]*hidden/, 'settingsPwError must not combine a hard-coded error class with the hidden attribute on initial render');
  assert.match(src, /id="settingsPwError"><\/div>/, 'settingsPwError must render as a completely empty container on initial paint');
});

test('V16.2 fix: schemaEditorSection.ts delete-confirmation error (#c3Error) uses the same empty-container pattern', () => {
  const src = readFileSync(path.join(root, 'src', 'pages', 'schemaEditorSection.ts'), 'utf8');
  assert.doesNotMatch(src, /id="c3Error"[^>]*hidden/, 'c3Error must not use the hidden-attribute toggle pattern');
});

test('V16.2 fix: schemaNameModal.ts error box uses the same empty-container pattern', () => {
  const src = readFileSync(path.join(root, 'src', 'components', 'schemaNameModal.ts'), 'utf8');
  assert.doesNotMatch(src, /id="schemaNameError"[^>]*hidden/, 'schemaNameError must not use the hidden-attribute toggle pattern');
});

console.log('All engine + regression-fix tests passed.');
