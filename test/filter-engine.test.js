'use strict';
var path = require('path');
var F = require(path.join(__dirname, '..', 'js', 'filter-engine.js'));
test('OPERATORS includes "Is one of" and "Is not one of", each multi:true', function () {
  var inOp = F.getOperator('in'); var notInOp = F.getOperator('not_in');
  assertTrue(inOp !== null); assertEqual(inOp.label, 'Is one of'); assertTrue(inOp.multi === true);
  assertTrue(notInOp !== null); assertEqual(notInOp.label, 'Is not one of'); assertTrue(notInOp.multi === true);
});
test('splitMultiValues splits/trims a comma-separated list', function () { assertEqual(F.splitMultiValues('10, 20, 40'), ['10', '20', '40']); });
test('splitMultiValues strips quotes per item', function () { assertEqual(F.splitMultiValues('"Approved", \'Draft\', Pending'), ['Approved', 'Draft', 'Pending']); });
test('buildConditionSql: "in" with numeric values -> IN (...) unquoted', function () {
  var errors = [];
  var sql = F.buildConditionSql({ table: 'IA_INVOICE', column: 'STATUS', operator: 'in', value: '10, 20, 40' }, 'Generic', errors);
  assertEqual(sql, 'IA_INVOICE.STATUS IN (10, 20, 40)');
  assertEqual(errors.length, 0);
});
test('buildConditionSql: "not_in" produces NOT IN (...)', function () {
  var sql = F.buildConditionSql({ table: 'IA_INVOICE', column: 'STATUS', operator: 'not_in', value: '10, 20' }, 'Generic', []);
  assertEqual(sql, 'IA_INVOICE.STATUS NOT IN (10, 20)');
});
test('buildConditionSql: "in" with empty value produces a validation error', function () {
  var errors = [];
  var sql = F.buildConditionSql({ table: 'IA_INVOICE', column: 'STATUS', operator: 'in', value: '' }, 'Generic', errors);
  assertEqual(sql, null);
  assertIncludes(errors.join(' '), 'needs at least one value');
});
test('buildWhereSql combines multiple conditions with AND', function () {
  var fg = { conditions: [
    { table: 'IA_INVOICE', column: 'COMPANY_ID', operator: 'eq', value: '100', join: 'AND' },
    { table: 'IA_INVOICE', column: 'STATUS', operator: 'in', value: '10, 40', join: 'AND' }
  ] };
  var built = F.buildWhereSql(fg, 'Generic');
  assertEqual(built.sql, 'IA_INVOICE.COMPANY_ID = 100 AND IA_INVOICE.STATUS IN (10, 40)');
});
test('every core operator behaves correctly', function () {
  assertEqual(F.buildConditionSql({ table: 'T', column: 'C', operator: 'eq', value: '5' }, 'Generic', []), 'T.C = 5');
  assertEqual(F.buildConditionSql({ table: 'T', column: 'C', operator: 'between', value: '1', value2: '10' }, 'Generic', []), 'T.C BETWEEN 1 AND 10');
  assertEqual(F.buildConditionSql({ table: 'T', column: 'C', operator: 'is_null' }, 'Generic', []), 'T.C IS NULL');
});
