'use strict';
var path = require('path');
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
var SCHEMA_ENGINE = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
var CR = require(path.join(__dirname, '..', 'js', 'cr-engine.js'));
var FILTER = require(path.join(__dirname, '..', 'js', 'filter-engine.js'));
var engine = SCHEMA_ENGINE.createEngine(schema);
test('safety banner exact text', function () { assertEqual(CR.SAFETY_BANNER, 'Generated SQL only \u2013 this application does not execute database changes.'); });
test('INSERT succeeds with columns/values', function () { var r = CR.buildCrQuery(engine, { command: 'INSERT', table: 'IA_INVOICE', columns: [{ name: 'INVOICE_ID', value: '9001' }, { name: 'INVOICE_NUMBER', value: 'INV-9001' }] }, 'Generic'); assertEqual(r.status, 'ok'); assertIncludes(r.sql, "'INV-9001'"); });
test('UPDATE rejected without WHERE', function () { var r = CR.buildCrQuery(engine, { command: 'UPDATE', table: 'IA_INVOICE', updates: [{ column: 'STATUS', value: '40' }] }, 'Generic'); assertEqual(r.status, 'rejected'); assertTrue(r.requiresWhereConfirmation); });
test('UPDATE with WHERE succeeds', function () {
  var fg = { conditions: [FILTER.newCondition({ column: 'INVOICE_ID', operator: 'eq', value: '123' })] };
  var r = CR.buildCrQuery(engine, { command: 'UPDATE', table: 'IA_INVOICE', updates: [{ column: 'STATUS', value: '40' }], filterGroup: fg }, 'Generic');
  assertEqual(r.status, 'ok'); assertIncludes(r.sql, 'STATUS = 40'); assertIncludes(r.sql, 'INVOICE_ID = 123');
});
test('UPDATE allowed with allowNoWhere override', function () { assertEqual(CR.buildCrQuery(engine, { command: 'UPDATE', table: 'IA_INVOICE', updates: [{ column: 'STATUS', value: '0' }], allowNoWhere: true }, 'Generic').status, 'ok'); });
test('DELETE rejected without WHERE', function () { var r = CR.buildCrQuery(engine, { command: 'DELETE', table: 'IA_INVOICE' }, 'Generic'); assertEqual(r.status, 'rejected'); assertTrue(r.requiresWhereConfirmation); });
test('DELETE with WHERE succeeds', function () { var fg = { conditions: [FILTER.newCondition({ column: 'INVOICE_ID', operator: 'eq', value: '123' })] }; var r = CR.buildCrQuery(engine, { command: 'DELETE', table: 'IA_INVOICE', filterGroup: fg }, 'Generic'); assertEqual(r.status, 'ok'); assertIncludes(r.sql, 'DELETE FROM IA_INVOICE'); });
test('an "is one of" WHERE clause works in CR builder too', function () {
  var fg = { conditions: [FILTER.newCondition({ column: 'INVOICE_ID', operator: 'in', value: '100, 101, 102' })] };
  var r = CR.buildCrQuery(engine, { command: 'UPDATE', table: 'IA_INVOICE', updates: [{ column: 'STATUS', value: '90' }], filterGroup: fg }, 'Generic');
  assertEqual(r.status, 'ok'); assertIncludes(r.sql, 'INVOICE_ID IN (100, 101, 102)');
});
