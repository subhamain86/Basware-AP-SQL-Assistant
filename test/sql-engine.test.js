'use strict';
var path = require('path');
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
var SCHEMA_ENGINE = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
var DECODE = require(path.join(__dirname, '..', 'js', 'decode-engine.js'));
var SQL_ENGINE = require(path.join(__dirname, '..', 'js', 'sql-engine.js'));
var FILTER = require(path.join(__dirname, '..', 'js', 'filter-engine.js'));
var engine = SCHEMA_ENGINE.createEngine(schema);
var store = DECODE.createDecodeStore();
test('no tables -> clarification', function () { assertEqual(SQL_ENGINE.generateSql('', { selectedTables: [] }, engine, store).status, 'clarification_needed'); });
test('basic SELECT', function () { var r = SQL_ENGINE.generateSql('', { selectedTables: ['IA_INVOICE'], selectedColumns: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER', alias: 'X' }] }, engine, store); assertEqual(r.status, 'ok'); assertIncludes(r.sql, 'SELECT IA_INVOICE.INVOICE_NUMBER AS X'); });
test('rejects unknown column', function () { assertEqual(SQL_ENGINE.generateSql('', { selectedTables: ['IA_INVOICE'], selectedColumns: [{ table: 'IA_INVOICE', column: 'NOPE' }] }, engine, store).status, 'rejected'); });
test('auto-joins related tables', function () { var r = SQL_ENGINE.generateSql('', { selectedTables: ['IA_INVOICE', 'IA_SUPPLIER'], selectedColumns: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }, { table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }] }, engine, store); assertIncludes(r.sql, 'INNER JOIN IA_SUPPLIER ON IA_INVOICE.SUPPLIER_ID = IA_SUPPLIER.SUPPLIER_ID'); });
test('rejects unrelated join', function () { assertEqual(SQL_ENGINE.generateSql('', { selectedTables: ['IA_INVOICE', 'ADM_USER_GROUP'], selectedColumns: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }] }, engine, store).status, 'rejected'); });
test('DISTINCT/limit per dialect', function () { var r1 = SQL_ENGINE.generateSql('', { dialect: 'SQL Server', selectedTables: ['IA_INVOICE'], distinct: true, limit: 10, selectedColumns: [{ table: 'IA_INVOICE', column: 'GROSS_SUM' }] }, engine, store); assertIncludes(r1.sql, 'SELECT TOP 10 DISTINCT'); var r2 = SQL_ENGINE.generateSql('', { dialect: 'Oracle', selectedTables: ['IA_INVOICE'], limit: 5, selectedColumns: [{ table: 'IA_INVOICE', column: 'GROSS_SUM' }] }, engine, store); assertIncludes(r2.sql, 'FETCH FIRST 5 ROWS ONLY'); });
test('decode CASE applied', function () { var r = SQL_ENGINE.generateSql('', { selectedTables: ['IA_INVOICE'], selectedColumns: [{ table: 'IA_INVOICE', column: 'STATUS', alias: 'S', decode: true }] }, engine, store); assertIncludes(r.sql, "WHEN IA_INVOICE.STATUS = 0 THEN 'Draft'"); });
test('recursive hierarchy', function () { assertIncludes(SQL_ENGINE.generateSql('', { selectedTables: ['ADM_USER_DATA'], recursiveHierarchy: { table: 'ADM_USER_DATA' } }, engine, store).sql, 'WITH RECURSIVE hierarchy AS'); });
test('an "is one of" filter produces a real IN (...) end-to-end', function () {
  var fg = { conditions: [FILTER.newCondition({ table: 'IA_INVOICE', column: 'STATUS', operator: 'in', value: '10, 40, 90' })] };
  var r = SQL_ENGINE.generateSql('', { selectedTables: ['IA_INVOICE'], selectedColumns: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }], filterGroup: fg }, engine, store);
  assertEqual(r.status, 'ok'); assertIncludes(r.sql, 'WHERE IA_INVOICE.STATUS IN (10, 40, 90)');
});
test('SUM aggregate + GROUP BY', function () {
  var r = SQL_ENGINE.generateSql('', { selectedTables: ['IA_INVOICE'], selectedColumns: [{ table: 'IA_INVOICE', column: 'SUPPLIER_ID' }, { table: 'IA_INVOICE', column: 'GROSS_SUM', aggregate: 'SUM', alias: 'total_amount' }], groupBy: ['IA_INVOICE.SUPPLIER_ID'] }, engine, store);
  assertEqual(r.status, 'ok'); assertIncludes(r.sql, 'SUM(IA_INVOICE.GROSS_SUM) AS total_amount'); assertIncludes(r.sql, 'GROUP BY IA_INVOICE.SUPPLIER_ID');
});
