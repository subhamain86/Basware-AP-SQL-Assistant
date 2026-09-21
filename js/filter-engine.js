(function (root) {
  'use strict';
  var OPERATORS = [
    { id: 'eq', label: 'Equals', arity: 1 }, { id: 'neq', label: 'Does not equal', arity: 1 },
    { id: 'contains', label: 'Contains', arity: 1 }, { id: 'not_contains', label: 'Does not contain', arity: 1 },
    { id: 'starts_with', label: 'Starts with', arity: 1 }, { id: 'ends_with', label: 'Ends with', arity: 1 },
    { id: 'gt', label: 'Greater than', arity: 1 }, { id: 'lt', label: 'Less than', arity: 1 },
    { id: 'gte', label: 'Greater than or equal to', arity: 1 }, { id: 'lte', label: 'Less than or equal to', arity: 1 },
    { id: 'between', label: 'Between', arity: 2 },
    { id: 'in', label: 'Is one of', arity: 1, multi: true }, { id: 'not_in', label: 'Is not one of', arity: 1, multi: true },
    { id: 'is_null', label: 'Is NULL', arity: 0 }, { id: 'is_not_null', label: 'Is not NULL', arity: 0 },
    { id: 'is_empty', label: 'Is empty', arity: 0 }, { id: 'is_not_empty', label: 'Is not empty', arity: 0 }
  ];
  function getOperator(id) { for (var i = 0; i < OPERATORS.length; i++) if (OPERATORS[i].id === id) return OPERATORS[i]; return null; }
  function isNumericLiteral(v) { return /^-?\d+(\.\d+)?$/.test(String(v).trim()); }
  function sqlLiteral(value) { if (value === null || value === undefined || value === '') return "''"; if (isNumericLiteral(value)) return String(value).trim(); return "'" + String(value).replace(/'/g, "''") + "'"; }
  function qualify(condition) { return condition.table ? (condition.table + '.' + condition.column) : condition.column; }

  function splitMultiValues(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw.map(function (v) { return String(v).trim(); }).filter(function (v) { return v.length > 0; });
    return String(raw).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; }).map(function (s) {
      if ((s.charAt(0) === '"' && s.charAt(s.length - 1) === '"' && s.length >= 2) || (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'" && s.length >= 2)) return s.slice(1, -1);
      return s;
    });
  }

  function buildConditionSql(condition, dialect, errors) {
    var op = getOperator(condition.operator);
    if (!op) { if (errors) errors.push('Unknown filter condition "' + condition.operator + '".'); return null; }
    var col = qualify(condition);
    if (!condition.column) { if (errors) errors.push('A filter condition is missing a column.'); return null; }
    switch (op.id) {
      case 'eq': return col + ' = ' + sqlLiteral(condition.value);
      case 'neq': return col + ' <> ' + sqlLiteral(condition.value);
      case 'gt': return col + ' > ' + sqlLiteral(condition.value);
      case 'lt': return col + ' < ' + sqlLiteral(condition.value);
      case 'gte': return col + ' >= ' + sqlLiteral(condition.value);
      case 'lte': return col + ' <= ' + sqlLiteral(condition.value);
      case 'contains': return col + " LIKE '%" + String(condition.value || '').replace(/'/g, "''") + "%'";
      case 'not_contains': return col + " NOT LIKE '%" + String(condition.value || '').replace(/'/g, "''") + "%'";
      case 'starts_with': return col + " LIKE '" + String(condition.value || '').replace(/'/g, "''") + "%'";
      case 'ends_with': return col + " LIKE '%" + String(condition.value || '').replace(/'/g, "''") + "'";
      case 'between':
        if (condition.value === '' || condition.value == null || condition.value2 === '' || condition.value2 == null) { if (errors) errors.push('The "Between" condition on ' + col + ' needs both a from and a to value.'); return null; }
        return col + ' BETWEEN ' + sqlLiteral(condition.value) + ' AND ' + sqlLiteral(condition.value2);
      case 'in':
      case 'not_in': {
        var values = Array.isArray(condition.values) && condition.values.length ? splitMultiValues(condition.values) : splitMultiValues(condition.value);
        if (!values.length) { if (errors) errors.push('The "Is one of" / "Is not one of" condition on ' + col + ' needs at least one value.'); return null; }
        var literals = values.map(function (v) { return sqlLiteral(v); });
        return col + (op.id === 'in' ? ' IN (' : ' NOT IN (') + literals.join(', ') + ')';
      }
      case 'is_null': return col + ' IS NULL';
      case 'is_not_null': return col + ' IS NOT NULL';
      case 'is_empty': return "(" + col + " IS NULL OR " + col + " = '')";
      case 'is_not_empty': return "(" + col + " IS NOT NULL AND " + col + " <> '')";
      default: return null;
    }
  }
  function buildWhereSql(filterGroup, dialect) {
    var errors = [];
    if (!filterGroup || !Array.isArray(filterGroup.conditions) || filterGroup.conditions.length === 0) return { sql: '', plainEnglish: '', errors: errors, isEmpty: true };
    var parts = [], plainParts = [];
    filterGroup.conditions.forEach(function (cond, idx) {
      var fragment = buildConditionSql(cond, dialect, errors);
      if (fragment == null) return;
      var joiner = idx === 0 ? '' : (' ' + (cond.join === 'OR' ? 'OR' : 'AND') + ' ');
      parts.push(joiner + fragment);
      plainParts.push((idx === 0 ? '' : ((cond.join === 'OR' ? 'OR' : 'AND') + ' ')) + fragment);
    });
    return { sql: parts.join(''), plainEnglish: plainParts.join(' '), errors: errors, isEmpty: parts.length === 0 };
  }
  function newCondition(overrides) { return Object.assign({ id: 'f' + Math.random().toString(36).slice(2, 10), table: '', column: '', operator: 'eq', value: '', value2: '', join: 'AND' }, overrides || {}); }
  function duplicateCondition(condition) { var copy = newCondition(condition); copy.id = 'f' + Math.random().toString(36).slice(2, 10); return copy; }
  var API = { OPERATORS: OPERATORS, getOperator: getOperator, buildConditionSql: buildConditionSql, buildWhereSql: buildWhereSql, newCondition: newCondition, duplicateCondition: duplicateCondition, sqlLiteral: sqlLiteral, splitMultiValues: splitMultiValues };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_FILTER = API;
})(typeof window !== 'undefined' ? window : this);
