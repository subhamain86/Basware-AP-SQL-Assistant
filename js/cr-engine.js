(function (root) {
  'use strict';
  var FILTER = (typeof module === 'object' && module.exports) ? require('./filter-engine.js') : root.APSQL_FILTER;
  var VALIDATE = (typeof module === 'object' && module.exports) ? require('./validation-engine.js') : root.APSQL_VALIDATE;
  var SAFETY_BANNER = 'Generated SQL only \u2013 this application does not execute database changes.';

  function sqlLiteralForColumn(engine, table, columnName, rawValue) {
    var col = engine.getColumn(table, columnName);
    var isNumericType = col && /^(INT|NUMBER|NUMERIC|DECIMAL|FLOAT|DOUBLE|BIGINT|SMALLINT)/i.test(col.type || '');
    if (rawValue === null || rawValue === undefined) return 'NULL';
    if (isNumericType && /^-?\d+(\.\d+)?$/.test(String(rawValue).trim())) return String(rawValue).trim();
    return "'" + String(rawValue).replace(/'/g, "''") + "'";
  }
  function buildInsert(engine, request) {
    var check = VALIDATE.validateCrRequest(engine, { command: 'INSERT', table: request.table, columns: request.columns });
    if (!check.valid) return { status: 'rejected', message: check.errors.join(' ') };
    var colNames = request.columns.map(function (c) { return c.name; });
    var values = request.columns.map(function (c) { return sqlLiteralForColumn(engine, request.table, c.name, c.value); });
    var sql = 'INSERT INTO ' + request.table + '\n(\n    ' + colNames.join(',\n    ') + '\n)\nVALUES\n(\n    ' + values.join(',\n    ') + '\n);';
    return { status: 'ok', command: 'INSERT', sql: sql, table: request.table, warnings: check.warnings, tablesUsed: [request.table], columnsUsed: request.columns.map(function (c) { return { table: request.table, column: c.name }; }) };
  }
  function buildUpdate(engine, request, dialect) {
    var check = VALIDATE.validateCrRequest(engine, { command: 'UPDATE', table: request.table, updates: request.updates, filterGroup: request.filterGroup, allowNoWhere: request.allowNoWhere });
    if (!check.valid) return { status: 'rejected', message: check.errors.join(' '), requiresWhereConfirmation: /WHERE condition is required/.test(check.errors.join(' ')) };
    var setParts = request.updates.map(function (u) { return u.column + ' = ' + sqlLiteralForColumn(engine, request.table, u.column, u.value); });
    var lines = ['UPDATE ' + request.table, 'SET', '    ' + setParts.join(',\n    ')];
    var filtersApplied = [];
    if (request.filterGroup && request.filterGroup.conditions && request.filterGroup.conditions.length) {
      var built = FILTER.buildWhereSql(request.filterGroup, dialect);
      if (built.errors.length) return { status: 'rejected', message: built.errors.join(' ') };
      lines.push('WHERE\n    ' + built.sql.replace(/ AND /g, '\n    AND ').replace(/ OR /g, '\n    OR '));
      filtersApplied.push('WHERE: ' + built.plainEnglish);
    }
    return { status: 'ok', command: 'UPDATE', sql: lines.join('\n') + ';', table: request.table, warnings: check.warnings, tablesUsed: [request.table], filtersApplied: filtersApplied, columnsUsed: request.updates.map(function (u) { return { table: request.table, column: u.column }; }) };
  }
  function buildDelete(engine, request, dialect) {
    var check = VALIDATE.validateCrRequest(engine, { command: 'DELETE', table: request.table, filterGroup: request.filterGroup, allowNoWhere: request.allowNoWhere });
    if (!check.valid) return { status: 'rejected', message: check.errors.join(' '), requiresWhereConfirmation: /WHERE condition is required/.test(check.errors.join(' ')) };
    var lines = ['DELETE FROM ' + request.table];
    var filtersApplied = [];
    if (request.filterGroup && request.filterGroup.conditions && request.filterGroup.conditions.length) {
      var built = FILTER.buildWhereSql(request.filterGroup, dialect);
      if (built.errors.length) return { status: 'rejected', message: built.errors.join(' ') };
      lines.push('WHERE\n    ' + built.sql.replace(/ AND /g, '\n    AND ').replace(/ OR /g, '\n    OR '));
      filtersApplied.push('WHERE: ' + built.plainEnglish);
    }
    return { status: 'ok', command: 'DELETE', sql: lines.join('\n') + ';', table: request.table, warnings: check.warnings, tablesUsed: [request.table], filtersApplied: filtersApplied, columnsUsed: [] };
  }
  function buildSelectPreview(engine, request, dialect) {
    var check = VALIDATE.validateCrRequest(engine, { command: 'SELECT', table: request.table, filterGroup: request.filterGroup });
    if (!check.valid) return { status: 'rejected', message: check.errors.join(' ') };
    var lines = ['SELECT *', 'FROM ' + request.table];
    var filtersApplied = [];
    if (request.filterGroup && request.filterGroup.conditions && request.filterGroup.conditions.length) {
      var built = FILTER.buildWhereSql(request.filterGroup, dialect);
      if (built.errors.length) return { status: 'rejected', message: built.errors.join(' ') };
      if (built.sql) { lines.push('WHERE ' + built.sql); filtersApplied.push('WHERE: ' + built.plainEnglish); }
    }
    return { status: 'ok', command: 'SELECT', sql: lines.join('\n') + ';', table: request.table, warnings: [], tablesUsed: [request.table], filtersApplied: filtersApplied, columnsUsed: [], isPreview: true };
  }
  function buildCrQuery(engine, request, dialect) {
    dialect = dialect || 'Generic';
    switch (request.command) { case 'INSERT': return buildInsert(engine, request); case 'UPDATE': return buildUpdate(engine, request, dialect); case 'DELETE': return buildDelete(engine, request, dialect); case 'SELECT': return buildSelectPreview(engine, request, dialect); default: return { status: 'rejected', message: 'Please choose a query type (INSERT, UPDATE, or DELETE).' }; }
  }
  var API = { SAFETY_BANNER: SAFETY_BANNER, buildCrQuery: buildCrQuery, buildInsert: buildInsert, buildUpdate: buildUpdate, buildDelete: buildDelete, buildSelectPreview: buildSelectPreview };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_CR = API;
})(typeof window !== 'undefined' ? window : this);
