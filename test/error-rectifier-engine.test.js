'use strict';
var path = require('path');
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
var SCHEMA_ENGINE = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
global.APSQL_DATATYPE = require(path.join(__dirname, '..', 'js', 'datatype-engine.js'));
var ERR = require(path.join(__dirname, '..', 'js', 'error-rectifier-engine.js'));
var engine = SCHEMA_ENGINE.createEngine(schema);
test('exact spec scenario: ORA-00932 on LOGIN_TYPE CASE/ELSE, Oracle dialect', function () {
  var sql = "SELECT\n    LOGIN_TYPE,\n    CASE\n        WHEN LOGIN_TYPE = 0 THEN 'Forms'\n        WHEN LOGIN_TYPE = 1 THEN 'Windows Domain'\n        ELSE LOGIN_TYPE\n    END AS LOGIN_TYPE\nFROM ADM_USER_DATA;";
  var error = 'ORA-00932: inconsistent datatypes: expected CHAR got NUMBER';
  var r = ERR.rectify(sql, error, engine, 'Oracle');
  assertTrue(r.changed);
  assertEqual(r.ruleId, 'case-else-datatype');
  assertIncludes(r.correctedSql, 'ELSE TO_CHAR(LOGIN_TYPE)');
});
test('same scenario, SQL Server dialect produces CONVERT(...) not TO_CHAR', function () {
  var sql = "SELECT CASE WHEN LOGIN_TYPE = 0 THEN 'Forms' ELSE LOGIN_TYPE END AS LT FROM ADM_USER_DATA;";
  var r = ERR.rectify(sql, 'Conversion failed when converting the varchar value', engine, 'SQL Server');
  assertIncludes(r.correctedSql, 'CONVERT(VARCHAR(4000), LOGIN_TYPE)');
});
test('numeric column compared to quoted string literal in WHERE gets unquoted', function () {
  var sql = "SELECT INVOICE_NUMBER FROM IA_INVOICE WHERE COMPANY_ID = '100'";
  var r = ERR.rectify(sql, 'ORA-00932: inconsistent datatypes', engine, 'Oracle');
  assertIncludes(r.correctedSql, 'COMPANY_ID = 100');
});
test('invalid identifier error with a misspelled column suggests the closest schema match', function () {
  var sql = 'SELECT INVOICE_NUMBR FROM IA_INVOICE';
  var r = ERR.rectify(sql, 'ORA-00904: "INVOICE_NUMBR": invalid identifier', engine, 'Oracle');
  assertIncludes(r.correctedSql, 'INVOICE_NUMBER');
});
test('invalid table name error suggests the closest schema table match', function () {
  var sql = 'SELECT INVOICE_NUMBER FROM IA_INVOICEE';
  var r = ERR.rectify(sql, 'ORA-00942: table or view does not exist', engine, 'Oracle');
  assertIncludes(r.correctedSql, 'FROM IA_INVOICE');
});
test('missing GROUP BY column is added automatically', function () {
  var sql2 = 'SELECT SUPPLIER_ID, STATUS, COUNT(*) FROM IA_INVOICE GROUP BY SUPPLIER_ID';
  var r = ERR.rectify(sql2, 'ORA-00979: not a GROUP BY expression', engine, 'Oracle');
  assertIncludes(r.correctedSql, 'GROUP BY SUPPLIER_ID, STATUS');
});
test('"= NULL" is rewritten to "IS NULL"', function () {
  var sql = 'SELECT INVOICE_NUMBER FROM IA_INVOICE WHERE DUE_DATE = NULL';
  var r = ERR.rectify(sql, 'unexpected NULL comparison behavior', engine, 'Oracle');
  assertIncludes(r.correctedSql, 'DUE_DATE IS NULL');
});
test('trailing comma before FROM is removed', function () {
  var sql = 'SELECT INVOICE_NUMBER, GROSS_SUM, FROM IA_INVOICE';
  var r = ERR.rectify(sql, 'ORA-00936: missing expression', engine, 'Oracle');
  assertFalse(/,\s*FROM/.test(r.correctedSql));
});
test('NVL used with a SQL Server dialect is remapped to ISNULL', function () {
  var sql = 'SELECT NVL(GROSS_SUM, 0) FROM IA_INVOICE';
  var r = ERR.rectify(sql, 'invalid identifier NVL', engine, 'SQL Server');
  assertIncludes(r.correctedSql, 'ISNULL(GROSS_SUM, 0)');
});
test('join ON clause referencing a non-existent column pairing is corrected using the schema relationship', function () {
  var sql = 'SELECT INVOICE_NUMBER FROM IA_INVOICE JOIN IA_SUPPLIER ON IA_INVOICE.WRONG_COL = IA_SUPPLIER.ALSO_WRONG';
  var r = ERR.rectify(sql, 'invalid join condition', engine, 'Oracle');
  assertIncludes(r.correctedSql, 'IA_INVOICE.SUPPLIER_ID = IA_SUPPLIER.SUPPLIER_ID');
});
test('completely unrecognized error + SQL with nothing to fix reports no change, honestly', function () {
  var sql = 'SELECT INVOICE_NUMBER FROM IA_INVOICE WHERE COMPANY_ID = 100';
  var r = ERR.rectify(sql, 'Some brand new database error nobody has ever seen before', engine, 'Oracle');
  assertFalse(r.changed);
  assertIncludes(r.errorIdentified, 'No specific');
});
test('empty SQL input is handled gracefully with a clear message', function () {
  var r = ERR.rectify('', 'ORA-00932', engine, 'Oracle');
  assertFalse(r.changed);
  assertIncludes(r.errorIdentified, 'No SQL was supplied');
});
test('detectDialectFromError recognizes Oracle, SQL Server, PostgreSQL, MySQL error signatures', function () {
  assertEqual(ERR.detectDialectFromError('ORA-00932: inconsistent datatypes'), 'Oracle');
  assertEqual(ERR.detectDialectFromError('Msg 245, Level 16, State 1: Conversion failed'), 'SQL Server');
  assertEqual(ERR.detectDialectFromError('ERROR:  relation "foo" does not exist'), 'PostgreSQL');
  assertEqual(ERR.detectDialectFromError('You have an error in your SQL syntax; check the manual'), 'MySQL');
});
test('rectify() never touches the schema object it is given', function () {
  var before = JSON.stringify(schema);
  ERR.rectify("SELECT CASE WHEN LOGIN_TYPE=0 THEN 'A' ELSE LOGIN_TYPE END FROM ADM_USER_DATA", 'ORA-00932', engine, 'Oracle');
  assertEqual(JSON.stringify(schema), before);
});
