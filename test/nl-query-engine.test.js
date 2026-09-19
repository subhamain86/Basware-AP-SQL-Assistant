'use strict';
var path = require('path');
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
var SCHEMA_ENGINE = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
global.APSQL_DATATYPE = require(path.join(__dirname, '..', 'js', 'datatype-engine.js'));
var NLQ = require(path.join(__dirname, '..', 'js', 'nl-query-engine.js'));
var engine = SCHEMA_ENGINE.createEngine(schema);
var FIXED_NOW = new Date('2026-09-08T00:00:00Z');

test('matches a table by its bare (module-stripped) name', function () {
  var r = NLQ.interpretDescription('show all invoices', engine, {});
  assertTrue(r.tables.indexOf('IA_INVOICE') !== -1);
});
test('matches columns by name and by alias', function () {
  var r = NLQ.interpretDescription('show invoice number and gross amount for invoices', engine, {});
  var cols = r.columns.map(function (c) { return c.column; });
  assertTrue(cols.indexOf('INVOICE_NUMBER') !== -1);
  assertTrue(cols.indexOf('GROSS_SUM') !== -1, 'GROSS_SUM should be matched via its alias "Amount"');
});
test('exact reproduction of the app\u2019s own placeholder example sentence', function () {
  var r = NLQ.interpretDescription('overdue invoices for a supplier in the last 30 days, show invoice number, gross amount and due date', engine, { now: FIXED_NOW });
  assertTrue(r.tables.indexOf('IA_INVOICE') !== -1);
  var cols = r.columns.map(function (c) { return c.column; });
  assertTrue(cols.indexOf('INVOICE_NUMBER') !== -1);
  assertTrue(cols.indexOf('GROSS_SUM') !== -1);
  assertTrue(cols.indexOf('DUE_DATE') !== -1);
  assertEqual(r.filterConditions.length, 1);
  assertEqual(r.filterConditions[0].column, 'DUE_DATE');
  assertEqual(r.filterConditions[0].operator, 'gte');
  assertEqual(r.filterConditions[0].value, '2026-08-09');
});
test('returns a warning and no tables when nothing schema-related is mentioned', function () {
  var r = NLQ.interpretDescription('show me something interesting please', engine, {});
  assertEqual(r.tables.length, 0);
  assertTrue(r.warnings.length > 0);
});
test('empty description text returns a fully empty interpretation with no warnings', function () {
  var r = NLQ.interpretDescription('', engine, {});
  assertEqual(r.tables.length, 0);
  assertEqual(r.warnings.length, 0);
});
test('greater than / less than operators', function () {
  var r = NLQ.interpretDescription('invoices with gross amount greater than 500', engine, {});
  var f = r.filterConditions.filter(function (c) { return c.column === 'GROSS_SUM'; })[0];
  assertTrue(f !== undefined);
  assertEqual(f.operator, 'gt');
  assertEqual(f.value, '500');
});
test('between operator captures both values', function () {
  var r = NLQ.interpretDescription('invoices with gross amount between 100 and 500', engine, {});
  var f = r.filterConditions.filter(function (c) { return c.column === 'GROSS_SUM'; })[0];
  assertEqual(f.operator, 'between');
  assertEqual(f.value, '100');
  assertEqual(f.value2, '500');
});
test('decode label matching resolves a plain-language status word to its schema code', function () {
  var r = NLQ.interpretDescription('show approved invoices', engine, {});
  var f = r.filterConditions.filter(function (c) { return c.column === 'STATUS'; })[0];
  assertTrue(f !== undefined);
  assertEqual(f.operator, 'eq');
  assertEqual(f.value, '40');
});
test('"is one of" phrasing produces an "in" operator with the raw comma-separated value list', function () {
  var r = NLQ.interpretDescription('show invoices where status is one of 10, 40', engine, {});
  var f = r.filterConditions.filter(function (c) { return c.column === 'STATUS'; })[0];
  assertTrue(f !== undefined);
  assertEqual(f.operator, 'in');
  assertEqual(f.value, '10, 40');
});
test('sort with explicit direction word', function () {
  var r = NLQ.interpretDescription('invoices sorted by due date descending', engine, {});
  assertEqual(r.orderBy.length, 1);
  assertEqual(r.orderBy[0].column, 'DUE_DATE');
  assertEqual(r.orderBy[0].direction, 'DESC');
});
test('limit via "top N"', function () {
  var r = NLQ.interpretDescription('top 10 invoices', engine, {});
  assertEqual(r.limit, 10);
});
test('distinct via "unique"/"no duplicates"', function () {
  assertTrue(NLQ.interpretDescription('unique suppliers with invoices', engine, {}).distinct);
});
test('hierarchy word-overlap disambiguation picks the table matching "suppliers"', function () {
  var r = NLQ.interpretDescription('show the reporting chain for suppliers', engine, {});
  assertEqual(r.hierarchyTable, 'IA_SUPPLIER');
});

test('UPDATE with SET and WHERE clauses, correctly segmented', function () {
  var r = NLQ.interpretCrDescription('update the invoice status to 40 where invoice id is 123', engine, {});
  assertEqual(r.command, 'UPDATE');
  assertEqual(r.table, 'IA_INVOICE');
  assertEqual(r.updateColumns.length, 1);
  assertEqual(r.updateColumns[0].column, 'STATUS');
  assertEqual(r.updateColumns[0].value, '40');
  assertEqual(r.filterConditions.length, 1);
  assertEqual(r.filterConditions[0].column, 'INVOICE_ID');
});
test('DELETE with an "is one of" WHERE clause', function () {
  var r = NLQ.interpretCrDescription('delete the invoice where status is one of 0, 90', engine, {});
  assertEqual(r.command, 'DELETE');
  assertEqual(r.filterConditions[0].operator, 'in');
  assertEqual(r.filterConditions[0].value, '0, 90');
});
test('command detection prefers whichever keyword appears earliest in the text', function () {
  assertEqual(NLQ.detectCrCommand('please delete this, do not update it'), 'DELETE');
  assertEqual(NLQ.detectCrCommand('please update this record'), 'UPDATE');
  assertEqual(NLQ.detectCrCommand('insert a brand new record'), 'INSERT');
});

test('mergeTableLists unions and de-duplicates, case-insensitively, manual-first', function () {
  assertEqual(NLQ.mergeTableLists(['IA_INVOICE'], ['IA_INVOICE', 'IA_SUPPLIER']), ['IA_INVOICE', 'IA_SUPPLIER']);
});
test('mergeColumnLists adds NL columns only for tables with zero manual columns', function () {
  var manual = [{ table: 'IA_INVOICE', column: 'STATUS' }];
  var nl = [{ table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }];
  var merged = NLQ.mergeColumnLists(manual, nl);
  assertEqual(merged.length, 2);
});
test('mergeFilterConditions appends non-duplicate NL filters and skips exact duplicates', function () {
  var manual = [{ table: 'IA_INVOICE', column: 'STATUS', operator: 'eq', value: '40' }];
  var nl = [
    { table: 'IA_INVOICE', column: 'STATUS', operator: 'eq', value: '40' },
    { table: 'IA_INVOICE', column: 'COMPANY_ID', operator: 'eq', value: '100' }
  ];
  var merged = NLQ.mergeFilterConditions(manual, nl);
  assertEqual(merged.length, 2);
});

/* ---------------------------------------------------------------------
   "intelligent" section — core success-criteria scenarios.
   --------------------------------------------------------------------- */
test('Requirement scenario: "Show all users whose login is allowed" identifies table+column+filter with zero manual selection', function () {
  var r = NLQ.interpretRequirement('Show all users whose login is allowed.', engine, {});
  assertEqual(r.tables, ['ADM_USER_DATA']);
  assertTrue(r.filterConditions.some(function (f) { return f.table === 'ADM_USER_DATA' && f.column === 'LOGIN_ALLOWED' && f.operator === 'eq' && f.value === '1'; }));
});
test('Success-criteria sentence: the full complex sentence resolves tables, joins, filters, exclusion, and sort with zero manual selection', function () {
  var text = 'Show all active users with their email address and user group, exclude Basware users, and sort by login account.';
  var r = NLQ.interpretRequirement(text, engine, {});
  assertEqual(r.tables.slice().sort(), ['ADM_USER_DATA', 'ADM_USER_GROUP', 'ADM_USER_GROUP_MEMBER'].sort());
  assertTrue(r.filterConditions.some(function (f) { return f.table === 'ADM_USER_DATA' && f.column === 'IS_ACTIVE' && f.value === '1'; }));
  assertTrue(r.filterConditions.some(function (f) { return f.table === 'ADM_USER_DATA' && f.column === 'EMAIL' && f.operator === 'not_contains' && f.value === 'basware'; }));
  assertEqual(r.orderBy.length, 1);
  assertEqual(r.orderBy[0].column, 'LOGIN_ACCOUNT');
  assertEqual(r.unresolvedJoins.length, 0);
  assertEqual(r.ambiguities.length, 0);
});
test('Aggregation + GROUP BY: "total gross amount grouped by supplier" resolves the join, the aggregate target, and the group-by column', function () {
  var r = NLQ.interpretRequirement('Show the total gross amount grouped by supplier.', engine, {});
  assertTrue(r.tables.indexOf('IA_INVOICE') !== -1 && r.tables.indexOf('IA_SUPPLIER') !== -1);
  assertEqual(r.aggregates.length, 1);
  assertEqual(r.aggregates[0].aggregate, 'SUM');
  assertEqual(r.aggregates[0].column, 'GROSS_SUM');
  assertEqual(r.groupBy.length, 1);
  assertEqual(r.groupBy[0].table, 'IA_SUPPLIER');
});
test('never invents a table: an unrecognizable request returns no tables and a clear warning rather than guessing', function () {
  var r = NLQ.interpretRequirement('Show me something interesting about the weather forecast.', engine, {});
  assertEqual(r.tables.length, 0);
  assertTrue(r.warnings.length > 0);
});
test('every table and column in a rich interpretation genuinely exists in the active schema', function () {
  var r = NLQ.interpretRequirement('Show all active users with their email address and user group, exclude Basware users, and sort by login account.', engine, {});
  r.tables.forEach(function (t) { assertTrue(engine.tableExists(t)); });
  r.columns.forEach(function (c) { assertTrue(engine.columnExists(c.table, c.column)); });
});
test('resolveJoinClosure automatically adds the ADM_USER_GROUP_MEMBER bridge table when only ADM_USER_DATA and ADM_USER_GROUP were required', function () {
  var closure = NLQ.resolveJoinClosure(engine, ['ADM_USER_DATA', 'ADM_USER_GROUP']);
  assertTrue(closure.tables.indexOf('ADM_USER_GROUP_MEMBER') !== -1);
  assertEqual(closure.unresolved.length, 0);
});
test('matchBooleanFlagFilters reports a genuine ambiguity (rather than guessing) when two DIFFERENT columns tie on the same qualifier with no disambiguating concept word present', function () {
  var tinySchema = {
    schema_name: 'Ambiguity Test Schema', schema_version: '1.0', module_labels: { T: 'Test' },
    tables: [{ name: 'T_RECORD', module: 'T', notes: '', columns: [
      { name: 'STATUS_ACTIVE', type: 'NUMBER(1)', primary_key: false, foreign_key: null, alias: '', description: 'Whether the record status is active', decode: [{ code: '0', label: 'No' }, { code: '1', label: 'Yes' }] },
      { name: 'FLAG_ACTIVE', type: 'NUMBER(1)', primary_key: false, foreign_key: null, alias: '', description: 'A separate, unrelated active flag', decode: [{ code: '0', label: 'No' }, { code: '1', label: 'Yes' }] },
      { name: 'RECORD_ID', type: 'INTEGER', primary_key: true, foreign_key: null, alias: '', description: 'Unique id', decode: null }
    ] }]
  };
  var tinyEngine = SCHEMA_ENGINE.createEngine(tinySchema);
  var result = NLQ.matchBooleanFlagFilters('show active records', tinyEngine, ['T_RECORD']);
  assertEqual(result.filters.length, 0);
  assertEqual(result.ambiguities.length, 1);
});
test('explainInterpretation produces plain-English lines for filters, joins, and sorting', function () {
  var interp = NLQ.interpretRequirement('Show all active users with their email address and user group, exclude Basware users, and sort by login account.', engine, {});
  var lines = NLQ.explainInterpretation(interp);
  assertTrue(lines.some(function (l) { return /joined with/.test(l); }));
  assertTrue(lines.some(function (l) { return /Filters where/.test(l); }));
  assertTrue(lines.some(function (l) { return /Sorts the results/.test(l); }));
});
test('performance: interpretRequirement completes quickly even against a synthetic ~300-table schema', function () {
  var bigTables = [];
  for (var i = 0; i < 300; i++) {
    bigTables.push({ name: 'BIG_TABLE_' + i, module: 'BIG', notes: 'Synthetic table ' + i, columns: [
      { name: 'ID', type: 'INTEGER', primary_key: true, foreign_key: null, alias: '', description: 'id' },
      { name: 'PARENT_ID', type: 'INTEGER', primary_key: false, foreign_key: i > 0 ? { table: 'BIG_TABLE_' + (i - 1), column: 'ID' } : null, alias: '', description: 'parent link' }
    ] });
  }
  var bigSchema = { schema_name: 'Big', schema_version: '1.0', module_labels: { BIG: 'Big Module' }, tables: bigTables };
  var bigEngine = SCHEMA_ENGINE.createEngine(bigSchema);
  var start = Date.now();
  NLQ.interpretRequirement('Show all records from big table 5 joined with big table 250', bigEngine, {});
  var elapsed = Date.now() - start;
  assertTrue(elapsed < 2000, 'expected interpretRequirement to complete in under 2 seconds, took ' + elapsed + 'ms');
});
