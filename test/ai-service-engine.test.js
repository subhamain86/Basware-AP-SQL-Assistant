'use strict';
var path = require('path');
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
var SCHEMA_ENGINE = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
var DECODE = require(path.join(__dirname, '..', 'js', 'decode-engine.js'));
global.APSQL_NLQUERY = require(path.join(__dirname, '..', 'js', 'nl-query-engine.js'));
global.APSQL_VALIDATE = require(path.join(__dirname, '..', 'js', 'validation-engine.js'));
global.APSQL_ENGINE = require(path.join(__dirname, '..', 'js', 'sql-engine.js'));
global.APSQL_OPTIMIZE = require(path.join(__dirname, '..', 'js', 'optimize-engine.js'));
global.APSQL_DATATYPE = require(path.join(__dirname, '..', 'js', 'datatype-engine.js'));
global.APSQL_ERROR_RECTIFIER = require(path.join(__dirname, '..', 'js', 'error-rectifier-engine.js'));
global.APSQL_DECODE = DECODE;
global.APSQL_SCHEMA_ASSISTANT = require(path.join(__dirname, '..', 'js', 'schema-assistant-engine.js'));
var AI = require(path.join(__dirname, '..', 'js', 'ai-service-engine.js'));
var engine = SCHEMA_ENGINE.createEngine(schema);
var decodeStore = DECODE.createDecodeStore();
function makeService() { return AI.createAIService({ engine: engine, decodeStore: decodeStore }); }
test('service defaults to the local provider when no remote is configured', function () {
  var svc = makeService();
  assertFalse(svc.isRemoteConfigured());
  assertEqual(svc.getStatus().localAvailable, true);
});
test('analyzeIntent grounds its interpretation in the active schema (never invents a table)', function () {
  var svc = makeService();
  return svc.analyzeIntent('Show all invoices from supplier ABC').then(function (res) {
    assertEqual(res.meta.providerUsed, 'local-heuristic');
    assertTrue(res.grounded);
    assertTrue(res.interpretation.tables.indexOf('IA_INVOICE') !== -1);
    res.interpretation.tables.forEach(function (t) { assertTrue(engine.tableExists(t)); });
  });
});
test('analyzeIntent honestly reports low confidence for an unrecognizable request rather than guessing', function () {
  var svc = makeService();
  return svc.analyzeIntent('Tell me a joke about weather').then(function (res) {
    assertEqual(res.intent, 'unclear');
    assertEqual(res.interpretation.tables.length, 0);
  });
});
test('reviewSql flags a table that does not exist in the active schema (schema-grounded self-review)', function () {
  var svc = makeService();
  return svc.reviewSql('SELECT * FROM NOPE_TABLE', { tablesUsed: ['NOPE_TABLE'], columnsUsed: [] }).then(function (res) {
    assertFalse(res.passed);
    assertTrue(res.errors.some(function (e) { return /NOPE_TABLE/.test(e); }));
  });
});
test('reviewSql passes when every table/column referenced genuinely exists', function () {
  var svc = makeService();
  return svc.reviewSql('SELECT IA_INVOICE.INVOICE_NUMBER FROM IA_INVOICE', { tablesUsed: ['IA_INVOICE'], columnsUsed: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }] }).then(function (res) {
    assertTrue(res.passed);
    assertTrue(res.schemaCorrect);
  });
});
test('reviewSql flags a logic mismatch: filters were implied but no WHERE clause exists', function () {
  var svc = makeService();
  var interp = { filterConditions: [{ table: 'IA_INVOICE', column: 'STATUS', operator: 'eq', value: '40' }], aggregates: [], orderBy: [] };
  return svc.reviewSql('SELECT IA_INVOICE.INVOICE_NUMBER FROM IA_INVOICE', { tablesUsed: ['IA_INVOICE'], columnsUsed: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }], interpretation: interp }).then(function (res) {
    assertTrue(res.logicFindings.length > 0);
  });
});
test('rectifyError delegates to the schema-aware error-rectifier engine and returns an analysis narrative', function () {
  var svc = makeService();
  var sql = "SELECT CASE WHEN LOGIN_TYPE = 0 THEN 'Forms' ELSE LOGIN_TYPE END FROM ADM_USER_DATA";
  return svc.rectifyError(sql, 'ORA-00932: inconsistent datatypes', 'Oracle').then(function (res) {
    assertTrue(res.changed);
    assertIncludes(res.correctedSql, 'TO_CHAR(LOGIN_TYPE)');
    assertTrue(!!res.analysis);
  });
});
test('optimizeSql delegates to the optimize-engine and never changes query behavior, only structure', function () {
  var svc = makeService();
  var genResult = { sql: 'SELECT DISTINCT IA_INVOICE.INVOICE_ID\nFROM IA_INVOICE', tablesUsed: ['IA_INVOICE'], columnsUsed: [{ table: 'IA_INVOICE', column: 'INVOICE_ID' }], filtersApplied: [], assumptions: [] };
  return svc.optimizeSql(genResult).then(function (res) {
    assertTrue(res.hasChanges);
    assertFalse(/DISTINCT/.test(res.optimizedSql));
  });
});
test('explainSchemaObject routes through to the schema assistant and is grounded in schema metadata', function () {
  var svc = makeService();
  return svc.explainSchemaObject('What is IA_SUPPLIER used for?').then(function (res) {
    assertTrue(res.found);
    assertEqual(res.subjectType, 'table');
  });
});
test('recommendEntities returns only tables that genuinely exist in the active schema', function () {
  var svc = makeService();
  return svc.recommendEntities('supplier invoices').then(function (res) {
    assertTrue(res.tables.length > 0);
    res.tables.forEach(function (t) { assertTrue(engine.tableExists(t.table)); });
  });
});
test('parseFilterFromText converts a natural-language filter into a structured condition', function () {
  var svc = makeService();
  return svc.parseFilterFromText('gross sum greater than 500', ['IA_INVOICE']).then(function (res) {
    assertTrue(res.conditions.some(function (c) { return c.column === 'GROSS_SUM' && c.operator === 'gt' && c.value === '500'; }));
  });
});
test('proposeCaseDecode reuses an EXISTING schema definition rather than duplicating it', function () {
  var svc = makeService();
  return svc.proposeCaseDecode('IA_INVOICE', 'STATUS', 'anything').then(function (res) {
    assertTrue(res.reused);
    assertEqual(res.source, 'schema');
  });
});
test('proposeCaseDecode parses code=label pairs from a plain-language hint when no definition exists', function () {
  var svc = makeService();
  return svc.proposeCaseDecode('IA_SUPPLIER', 'SUPPLIER_CODE', '10 means Gold, 20 means Silver').then(function (res) {
    assertFalse(res.reused);
    assertTrue(res.values.length >= 2);
  });
});
test('caching: a repeated analyzeIntent call for the identical text is served from cache', function () {
  var svc = makeService();
  return svc.analyzeIntent('Show all invoices from supplier ABC').then(function () {
    return svc.analyzeIntent('Show all invoices from supplier ABC');
  }).then(function (res2) {
    assertTrue(res2.meta.cached);
  });
});
test('AI failures never break non-AI functionality: reviewSql still returns a usable result when meta is minimal', function () {
  var svc = makeService();
  return svc.reviewSql('SELECT 1', {}).then(function (res) {
    assertTrue(res.passed);
  });
});
test('configureRemoteProvider + an unreachable endpoint transparently falls back to the local provider', function () {
  var svc = makeService();
  svc.configureRemoteProvider({ endpoint: 'https://does-not-exist.invalid/ai' }, function () { return Promise.reject(new Error('network down')); });
  assertTrue(svc.isRemoteConfigured());
  return svc.analyzeIntent('Show all active suppliers').then(function (res) {
    assertEqual(res.meta.providerUsed, 'local-heuristic');
    assertTrue(res.meta.fallenBack);
  });
});
