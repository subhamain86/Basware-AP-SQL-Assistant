/* datatype-engine.js — dialect-aware type casting / literal formatting rules. */
(function (root) {
  'use strict';

  var TEXT_TYPES = ['VARCHAR', 'CHAR', 'TEXT', 'CLOB'];
  var NUMERIC_TYPES = ['INTEGER', 'NUMBER', 'DECIMAL', 'FLOAT'];
  var DATE_TYPES = ['DATE', 'DATETIME', 'TIMESTAMP'];

  function isText(type) { return TEXT_TYPES.indexOf(String(type || '').toUpperCase()) !== -1; }
  function isNumeric(type) { return NUMERIC_TYPES.indexOf(String(type || '').toUpperCase()) !== -1; }
  function isDate(type) { return DATE_TYPES.indexOf(String(type || '').toUpperCase()) !== -1; }

  function toChar(expr, dialect) {
    switch (dialect) {
      case 'Oracle': return 'TO_CHAR(' + expr + ')';
      case 'SQL Server': return 'CAST(' + expr + ' AS VARCHAR(4000))';
      case 'PostgreSQL': return 'CAST(' + expr + ' AS TEXT)';
      case 'MySQL': return 'CAST(' + expr + ' AS CHAR)';
      default: return 'CAST(' + expr + ' AS VARCHAR)';
    }
  }

  function currentDateExpr(dialect) {
    switch (dialect) {
      case 'Oracle': return 'SYSDATE';
      case 'SQL Server': return 'GETDATE()';
      case 'PostgreSQL': return 'CURRENT_DATE';
      case 'MySQL': return 'CURDATE()';
      default: return 'CURRENT_DATE';
    }
  }

  function dateAddDaysExpr(dateExpr, days, dialect) {
    switch (dialect) {
      case 'Oracle': return '(' + dateExpr + ' - ' + days + ')';
      case 'SQL Server': return 'DATEADD(day, -' + days + ', ' + dateExpr + ')';
      case 'PostgreSQL': return '(' + dateExpr + " - INTERVAL '" + days + " day')";
      case 'MySQL': return 'DATE_SUB(' + dateExpr + ', INTERVAL ' + days + ' DAY)';
      default: return '(' + dateExpr + ' - ' + days + ')';
    }
  }

  function limitClause(n, dialect) {
    switch (dialect) {
      case 'Oracle': return { type: 'fetch', clause: 'FETCH FIRST ' + n + ' ROWS ONLY' };
      case 'SQL Server': return { type: 'top', clause: 'TOP ' + n };
      default: return { type: 'limit', clause: 'LIMIT ' + n };
    }
  }

  function quoteLiteral(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  function formatLiteral(value, columnType) {
    if (value === null || value === undefined) return 'NULL';
    if (isNumeric(columnType) && !isNaN(Number(value)) && String(value).trim() !== '') return String(value);
    return quoteLiteral(value);
  }

  var API = {
    isText: isText, isNumeric: isNumeric, isDate: isDate,
    toChar: toChar, currentDateExpr: currentDateExpr, dateAddDaysExpr: dateAddDaysExpr,
    limitClause: limitClause, quoteLiteral: quoteLiteral, formatLiteral: formatLiteral,
    TEXT_TYPES: TEXT_TYPES, NUMERIC_TYPES: NUMERIC_TYPES, DATE_TYPES: DATE_TYPES
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_DATATYPE = API;
})(typeof window !== 'undefined' ? window : this);
