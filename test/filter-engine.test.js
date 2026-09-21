'use strict';
var path = require('path');
var F = require(path.join(__dirname, '..', 'js', 'filter-engine.js'));
test('OPERATORS includes the "Is one of" and "Is not one of" entries, each marked multi:true', function () {
  var inOp = F.getOperator('in'); var notInOp = F.getOperator('not_in');
  assertTrue(inOp !== null); assertEqual(inOp.label, 'Is one of'); assertTrue(inOp.multi === true); assertEqual(inOp.arity, 1);
  assertTrue(notInOp !== null); assertEqual(notInOp.label, 'Is not one of'); assertTrue(notInOp.multi === true); assertEqual(notInOp.arity, 1);
});
test('getOperator returns null for an unknown id', function () { assertEqual(F.getOperator('nope'), null); });
test('splitMultiValues splits a comma-separated numeric list, trimming whitespace', function () {
  assertEqual(F.splitMultiValues('10, 20, 40'), ['10', '20', '40']);
});
test('splitMultiValues strips a single layer of surrounding quotes per item', function () {
  assertEqual(F.splitMultiValues('"Approved", \'Draft\', Pending'), ['Approved', 'Draft', 'Pending']);
});
test('splitMultiValues drops empty segments (e.g. trailing commas)', function () {
  assertEqual(F.splitMultiValues('10, 20, , '), ['10', '20']);
});
test('splitMultiValues passes through an already-split array, trimming each item', function () {
  assertEqual(F.splitMultiValues([' 10 ', '20']), ['10', '20']);
});
test('splitMultiValues returns an empty array for null/undefined/empty input', function () {
  assertEqual(F.splitMultiValues(null), []); assertEqual(F.splitMultiValues(undefined), []); assertEqual(F.splitMultiValues(''), []);
});
test('buildConditionSql: "in" with a numeric comma-separated value produces IN (...) with unquoted numeric literals', function () {
  var errors = [];
  var sql = F.buildConditionSql({ table: 'IA_INVOICE', column: 'STATUS', operator: 'in', value: '10, 20, 40' }, 'Generic', errors);
  assertEqual(sql, 'IA_INVOICE.STATUS IN (10, 20, 40)');
  assertEqual(errors.length, 0);
});
test('buildConditionSql: "not_in" produces NOT IN (...)', function () {
  var sql = F.buildConditionSql({ table: 'IA_INVOICE', column: 'STATUS', operator: 'not_in', value: '10, 20' }, 'Generic', []);
  assertEqual(sql, 'IA_INVOICE.STATUS NOT IN (10, 20)');
});
test('buildConditionSql: "in" with string values correctly quotes each literal and escapes an embedded apostrophe', function () {
  var sql = F.buildConditionSql({ table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME', operator: 'in', value: 'Acme, "Globex Corp", O\'Brien Ltd' }, 'Generic', []);
  assertEqual(sql, "IA_SUPPLIER.SUPPLIER_NAME IN ('Acme', 'Globex Corp', 'O''Brien Ltd')");
});
test('buildConditionSql: "in" with no usable values produces a clear validation error and returns null', function () {
  var errors = [];
  var sql = F.buildConditionSql({ table: 'IA_INVOICE', column: 'STATUS', operator: 'in', value: '' }, 'Generic', errors);
  assertEqual(sql, null);
  assertIncludes(errors.join(' '), 'needs at least one value');
});
test('buildWhereSql: an "in" condition combined with a normal eq condition via AND', function () {
  var fg = { conditions: [
    { table: 'IA_INVOICE', column: 'COMPANY_ID', operator: 'eq', value: '100', join: 'AND' },
    { table: 'IA_INVOICE', column: 'STATUS', operator: 'in', value: '10, 40', join: 'AND' }
  ] };
  var built = F.buildWhereSql(fg, 'Generic');
  assertEqual(built.sql, 'IA_INVOICE.COMPANY_ID = 100 AND IA_INVOICE.STATUS IN (10, 40)');
  assertEqual(built.errors.length, 0);
});
test('every pre-existing operator behaves correctly', function () {
  assertEqual(F.buildConditionSql({ table: 'T', column: 'C', operator: 'eq', value: '5' }, 'Generic', []), 'T.C = 5');
  assertEqual(F.buildConditionSql({ table: 'T', column: 'C', operator: 'between', value: '1', value2: '10' }, 'Generic', []), 'T.C BETWEEN 1 AND 10');
  assertEqual(F.buildConditionSql({ table: 'T', column: 'C', operator: 'is_null' }, 'Generic', []), 'T.C IS NULL');
  assertEqual(F.buildConditionSql({ table: 'T', column: 'C', operator: 'contains', value: "O'Brien" }, 'Generic', []), "T.C LIKE '%O''Brien%'");
});
test('newCondition defaults to the "eq" operator and duplicateCondition assigns a fresh id', function () {
  var c1 = F.newCondition({ table: 'T', column: 'C' });
  assertEqual(c1.operator, 'eq');
  var c2 = F.duplicateCondition(c1);
  assertTrue(c2.id !== c1.id);
  assertEqual(c2.table, 'T'); assertEqual(c2.column, 'C');
});
