/* cr-engine.js — Change Request SQL text: INSERT / UPDATE / DELETE.
   Mandatory WHERE protection: UPDATE/DELETE are rejected unless a WHERE
   condition exists (options.filterGroup) or options.explicitOverride === true. */
(function (root) {
  'use strict';

  var FILTER = (typeof module === 'object' && module.exports) ? require('./filter-engine.js') : root.APSQL_FILTER;
  var DATATYPE = (typeof module === 'object' && module.exports) ? require('./datatype-engine.js') : root.APSQL_DATATYPE;

  function buildCrQuery(engine, req, dialect) {
    var t = engine.getTable(req.table);
    if (!t) return { status: 'error', errors: ['Unknown table: ' + req.table] };
    var command = String(req.command || '').toUpperCase();

    function resolveColExpr(table, column) { return column; } // CR statements target the bare table, unaliased

    if (command === 'INSERT') {
      if (!req.columns || !req.columns.length) return { status: 'error', errors: ['At least one column/value pair is required for INSERT.'] };
      var cols = [], vals = [];
      req.columns.forEach(function (c) {
        var colDef = engine.getColumn(req.table, c.name);
        cols.push(c.name);
        vals.push(DATATYPE.formatLiteral(c.value, colDef ? colDef.type : null));
      });
      var sql = 'INSERT INTO ' + req.table + ' (' + cols.join(', ') + ')\nVALUES (' + vals.join(', ') + ');';
      return { status: 'ok', sql: sql, warnings: [] };
    }

    if (command === 'UPDATE') {
      if (!req.updates || !req.updates.length) return { status: 'error', errors: ['At least one column to update is required.'] };
      var hasWhere = req.filterGroup && req.filterGroup.conditions && req.filterGroup.conditions.length;
      if (!hasWhere && !req.explicitOverride) {
        return { status: 'rejected', errors: ['UPDATE without a WHERE condition is blocked to protect against accidentally affecting every row. Add a filter, or explicitly override (with acknowledgement) if this is intentional.'] };
      }
      var setParts = req.updates.map(function (u) {
        var colDef = engine.getColumn(req.table, u.column);
        return u.column + ' = ' + DATATYPE.formatLiteral(u.value, colDef ? colDef.type : null);
      });
      var updSql = 'UPDATE ' + req.table + '\nSET ' + setParts.join(', ');
      if (hasWhere) updSql += '\nWHERE ' + FILTER.buildFilterGroup(req.filterGroup, resolveColExpr);
      updSql += ';';
      var updWarnings = [];
      if (!hasWhere) updWarnings.push('⚠ No WHERE condition — this will affect every row in ' + req.table + '. Confirm this is intentional.');
      return { status: 'ok', sql: updSql, warnings: updWarnings };
    }

    if (command === 'DELETE') {
      var hasWhereD = req.filterGroup && req.filterGroup.conditions && req.filterGroup.conditions.length;
      if (!hasWhereD && !req.explicitOverride) {
        return { status: 'rejected', errors: ['DELETE without a WHERE condition is blocked to protect against accidentally removing every row. Add a filter, or explicitly override (with acknowledgement) if this is intentional.'] };
      }
      var delSql = 'DELETE FROM ' + req.table;
      if (hasWhereD) delSql += '\nWHERE ' + FILTER.buildFilterGroup(req.filterGroup, resolveColExpr);
      delSql += ';';
      var delWarnings = [];
      if (!hasWhereD) delWarnings.push('⚠ No WHERE condition — this will remove every row in ' + req.table + '. Confirm this is intentional.');
      return { status: 'ok', sql: delSql, warnings: delWarnings };
    }

    return { status: 'error', errors: ['Unsupported CR command: ' + command + '. Use INSERT, UPDATE, or DELETE.'] };
  }

  var API = { buildCrQuery: buildCrQuery };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_CR = API;
})(typeof window !== 'undefined' ? window : this);
