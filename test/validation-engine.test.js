'use strict';
var path = require('path');
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
var SCHEMA_ENGINE = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
var VALIDATE = require(path.join(__dirname, '..', 'js', 'validation-engine.js'));
var engine = SCHEMA_ENGINE.createEngine(schema);
test('rejects no tables', function () { assertFalse(VALIDATE.validateSelectRequest(engine, { tables: [], columns: [] }).valid); });
test('rejects unknown table', function () { assertFalse(VALIDATE.validateSelectRequest(engine, { tables: ['NOPE'], columns: [] }).valid); });
test('accepts valid request', function () { assertTrue(VALIDATE.validateSelectRequest(engine, { tables: ['IA_INVOICE'], columns: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }] }).valid); });
test('UPDATE requires WHERE', function () { var r = VALIDATE.validateCrRequest(engine, { command: 'UPDATE', table: 'IA_INVOICE', updates: [{ column: 'STATUS', value: '1' }] }); assertFalse(r.valid); assertIncludes(r.errors.join(' '), 'WHERE condition is required'); });
test('DELETE requires WHERE', function () { assertFalse(VALIDATE.validateCrRequest(engine, { command: 'DELETE', table: 'IA_INVOICE' }).valid); });
test('allowNoWhere bypasses', function () { assertTrue(VALIDATE.validateCrRequest(engine, { command: 'DELETE', table: 'IA_INVOICE', allowNoWhere: true }).valid); });
test('INSERT validates columns', function () { assertFalse(VALIDATE.validateCrRequest(engine, { command: 'INSERT', table: 'IA_INVOICE', columns: [{ name: 'NOPE', value: '1' }] }).valid); assertTrue(VALIDATE.validateCrRequest(engine, { command: 'INSERT', table: 'IA_INVOICE', columns: [{ name: 'INVOICE_NUMBER', value: 'X' }] }).valid); });
test('a SELECT column with .aggregate and column="*" (COUNT(*)) is accepted without requiring a real column named "*"', function () {
  var r = VALIDATE.validateSelectRequest(engine, { tables: ['IA_INVOICE'], columns: [{ table: 'IA_INVOICE', column: '*', aggregate: 'COUNT' }] });
  assertTrue(r.valid);
});
test('an aggregate column with a REAL column name is still validated against the schema normally', function () {
  var ok = VALIDATE.validateSelectRequest(engine, { tables: ['IA_INVOICE'], columns: [{ table: 'IA_INVOICE', column: 'GROSS_SUM', aggregate: 'SUM' }] });
  assertTrue(ok.valid);
  var bad = VALIDATE.validateSelectRequest(engine, { tables: ['IA_INVOICE'], columns: [{ table: 'IA_INVOICE', column: 'NOPE_COLUMN', aggregate: 'SUM' }] });
  assertFalse(bad.valid);
});
