'use strict';
var path = require('path');
var DT = require(path.join(__dirname, '..', 'js', 'datatype-engine.js'));
test('classify: numeric types', function () {
  ['NUMBER', 'NUMBER(5)', 'NUMBER(19,2)', 'INTEGER', 'INT', 'DECIMAL', 'DECIMAL(10,2)', 'FLOAT', 'DOUBLE', 'BIGINT', 'SMALLINT'].forEach(function (t) { assertEqual(DT.classify(t), 'numeric', t); });
});
test('classify: text types', function () {
  ['VARCHAR', 'VARCHAR(50)', 'VARCHAR2(250)', 'CHAR', 'CHAR(3)', 'NVARCHAR(100)', 'NCHAR', 'TEXT', 'CLOB'].forEach(function (t) { assertEqual(DT.classify(t), 'text', t); });
});
test('classify: date type', function () { assertEqual(DT.classify('DATE'), 'date'); });
test('classify: timestamp types', function () { ['TIMESTAMP', 'DATETIME', 'DATETIME2', 'SMALLDATETIME'].forEach(function (t) { assertEqual(DT.classify(t), 'timestamp', t); }); });
test('classify: boolean types', function () { ['BOOLEAN', 'BOOL', 'BIT'].forEach(function (t) { assertEqual(DT.classify(t), 'boolean', t); }); });
test('classify: unknown/unrecognized type is "unknown", not invented', function () { assertEqual(DT.classify('MY_CUSTOM_TYPE'), 'unknown'); });
test('classify: empty/missing type is "unknown"', function () { assertEqual(DT.classify(''), 'unknown'); assertEqual(DT.classify(null), 'unknown'); assertEqual(DT.classify(undefined), 'unknown'); });
test('classify is case-insensitive and tolerant of parameters', function () { assertEqual(DT.classify('varchar2(50)'), 'text'); assertEqual(DT.classify('number(5)'), 'numeric'); });
test('numeric column: Oracle uses TO_CHAR', function () { assertEqual(DT.getCompatibleElseExpression('LOGIN_TYPE', 'NUMBER(5)', 'Oracle'), 'TO_CHAR(LOGIN_TYPE)'); });
test('numeric column: SQL Server uses CONVERT(VARCHAR...)', function () { assertEqual(DT.getCompatibleElseExpression('LOGIN_TYPE', 'NUMBER(5)', 'SQL Server'), 'CONVERT(VARCHAR(4000), LOGIN_TYPE)'); });
test('numeric column: PostgreSQL uses ::text', function () { assertEqual(DT.getCompatibleElseExpression('LOGIN_TYPE', 'NUMBER(5)', 'PostgreSQL'), 'LOGIN_TYPE::text'); });
test('numeric column: MySQL uses CAST(...AS CHAR)', function () { assertEqual(DT.getCompatibleElseExpression('LOGIN_TYPE', 'NUMBER(5)', 'MySQL'), 'CAST(LOGIN_TYPE AS CHAR)'); });
test('numeric column: Generic uses CAST(...AS VARCHAR)', function () { assertEqual(DT.getCompatibleElseExpression('LOGIN_TYPE', 'NUMBER(5)', 'Generic'), 'CAST(LOGIN_TYPE AS VARCHAR(4000))'); });
test('unrecognized dialect string falls back to Generic converter', function () { assertEqual(DT.getCompatibleElseExpression('X', 'NUMBER', 'NotARealDialect'), 'CAST(X AS VARCHAR(4000))'); });
test('date column produces a dialect-appropriate text conversion, not TO_CHAR everywhere', function () {
  assertEqual(DT.getCompatibleElseExpression('DUE_DATE', 'DATE', 'Oracle'), 'TO_CHAR(DUE_DATE)');
  assertEqual(DT.getCompatibleElseExpression('DUE_DATE', 'DATE', 'SQL Server'), "CONVERT(VARCHAR(23), DUE_DATE, 120)");
  assertIncludes(DT.getCompatibleElseExpression('DUE_DATE', 'DATE', 'PostgreSQL'), 'TO_CHAR(DUE_DATE');
  assertIncludes(DT.getCompatibleElseExpression('DUE_DATE', 'DATE', 'MySQL'), 'DATE_FORMAT(DUE_DATE');
});
test('timestamp column produces a dialect-appropriate conversion', function () {
  assertIncludes(DT.getCompatibleElseExpression('CREATED_AT', 'TIMESTAMP', 'MySQL'), 'DATE_FORMAT(CREATED_AT');
});
test('boolean column produces a dialect-appropriate conversion', function () {
  assertEqual(DT.getCompatibleElseExpression('IS_ACTIVE', 'BOOLEAN', 'PostgreSQL'), 'IS_ACTIVE::text');
});
test('text column: expression returned completely unchanged (no wrapping at all)', function () { assertEqual(DT.getCompatibleElseExpression('SUPPLIER_NAME', 'VARCHAR2(250)', 'Oracle'), 'SUPPLIER_NAME'); });
test('unavailable data type: expression returned completely unchanged, regardless of dialect', function () {
  assertEqual(DT.getCompatibleElseExpression('X', null, 'Oracle'), 'X');
  assertEqual(DT.getCompatibleElseExpression('X', '', 'SQL Server'), 'X');
  assertEqual(DT.getCompatibleElseExpression('X', undefined, 'MySQL'), 'X');
});
test('unrecognized-but-present data type: expression returned unchanged (does not invent a conversion)', function () { assertEqual(DT.getCompatibleElseExpression('X', 'MY_CUSTOM_TYPE', 'Oracle'), 'X'); });
test('needsConversion is true for numeric/date/timestamp/boolean, false for text/unknown/missing', function () {
  assertTrue(DT.needsConversion('NUMBER'));
  assertTrue(DT.needsConversion('DATE'));
  assertFalse(DT.needsConversion('VARCHAR(50)'));
  assertFalse(DT.needsConversion('MY_CUSTOM_TYPE'));
  assertFalse(DT.needsConversion(null));
});
test('wrapDateLiteral produces dialect-correct date parsing syntax', function () {
  assertEqual(DT.wrapDateLiteral("'2024-01-01'", 'Oracle'), "TO_DATE('2024-01-01', 'YYYY-MM-DD')");
  assertEqual(DT.wrapDateLiteral("'2024-01-01'", 'SQL Server'), "CONVERT(DATE, '2024-01-01', 120)");
  assertEqual(DT.wrapDateLiteral("'2024-01-01'", 'PostgreSQL'), "'2024-01-01'::date");
  assertEqual(DT.wrapDateLiteral("'2024-01-01'", 'MySQL'), "STR_TO_DATE('2024-01-01', '%Y-%m-%d')");
  assertEqual(DT.wrapDateLiteral("'2024-01-01'", 'Generic'), "CAST('2024-01-01' AS DATE)");
});
