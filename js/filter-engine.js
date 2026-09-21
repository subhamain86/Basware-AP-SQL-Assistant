/* filter-engine.js — builds WHERE clause fragments from structured filter conditions.
   Supports: =, <>, >, >=, <, <=, IN, NOT IN, BETWEEN, LIKE, NOT LIKE, IS NULL, IS NOT NULL,
   nested AND/OR groups, data-type-aware operand formatting. */
(function (root) {
  'use strict';

  var DATATYPE = (typeof module === 'object' && module.exports) ? require('./datatype-engine.js') : root.APSQL_DATATYPE;

  function newCondition(opts) {
    return {
      table: opts.table, column: opts.column, operator: opts.operator || 'eq',
      value: opts.value, value2: opts.value2, columnType: opts.columnType || null
    };
  }

  function newGroup(logic, items) { return { logic: logic || 'AND', items: items || [] }; } // items: conditions or nested groups
  function isGroup(x) { return x && Array.isArray(x.items); }

  var OP_MAP = {
    eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=',
    like: 'LIKE', notlike: 'NOT LIKE'
  };

  function formatValue(val, columnType) {
    return DATATYPE.formatLiteral(val, columnType);
  }

  function buildCondition(c, resolveColumnExpr) {
    var expr = resolveColumnExpr ? resolveColumnExpr(c.table, c.column) : (c.table + '.' + c.column);
    var op = c.operator;
    if (op === 'isnull') return expr + ' IS NULL';
    if (op === 'isnotnull') return expr + ' IS NOT NULL';
    if (op === 'in' || op === 'notin') {
      var list = String(c.value || '').split(',').map(function (v) { return v.trim(); }).filter(function (v) { return v !== ''; });
      var formatted = list.map(function (v) { return formatValue(v, c.columnType); }).join(', ');
      return expr + (op === 'in' ? ' IN (' : ' NOT IN (') + formatted + ')';
    }
    if (op === 'between') {
      return expr + ' BETWEEN ' + formatValue(c.value, c.columnType) + ' AND ' + formatValue(c.value2, c.columnType);
    }
    if (op === 'like' || op === 'notlike') {
      var likeVal = String(c.value);
      if (likeVal.indexOf('%') === -1) likeVal = '%' + likeVal + '%';
      return expr + ' ' + OP_MAP[op] + ' ' + formatValue(likeVal, 'VARCHAR');
    }
    var sqlOp = OP_MAP[op] || '=';
    return expr + ' ' + sqlOp + ' ' + formatValue(c.value, c.columnType);
  }

  function buildGroup(group, resolveColumnExpr) {
    if (!group) return '';
    if (!isGroup(group)) return buildCondition(group, resolveColumnExpr);
    var parts = group.items.map(function (item) {
      var s = isGroup(item) ? buildGroup(item, resolveColumnExpr) : buildCondition(item, resolveColumnExpr);
      return isGroup(item) && item.items.length > 1 ? '(' + s + ')' : s;
    }).filter(function (s) { return s && s.length; });
    return parts.join(' ' + group.logic + ' ');
  }

  // Legacy-friendly helper: a flat filterGroup = { conditions: [...], logic: 'AND' }
  function buildFilterGroup(filterGroup, resolveColumnExpr) {
    if (!filterGroup || !filterGroup.conditions || !filterGroup.conditions.length) return '';
    var group = newGroup(filterGroup.logic || 'AND', filterGroup.conditions);
    return buildGroup(group, resolveColumnExpr);
  }

  var API = {
    newCondition: newCondition, newGroup: newGroup, isGroup: isGroup,
    buildCondition: buildCondition, buildGroup: buildGroup, buildFilterGroup: buildFilterGroup,
    OP_MAP: OP_MAP
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_FILTER = API;
})(typeof window !== 'undefined' ? window : this);
