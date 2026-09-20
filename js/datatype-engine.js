(function (root) {
  'use strict';

  function baseType(typeStr) {
    var m = String(typeStr || '').trim().match(/^([A-Za-z0-9_]+)/);
    return m ? m[1].toUpperCase() : '';
  }
  var NUMERIC_TYPES = ['NUMBER', 'INTEGER', 'INT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'BIGINT', 'SMALLINT', 'NUMERIC', 'REAL'];
  var TEXT_TYPES = ['VARCHAR', 'VARCHAR2', 'CHAR', 'NVARCHAR', 'NCHAR', 'TEXT', 'CLOB', 'NTEXT', 'STRING'];
  var TIMESTAMP_TYPES = ['TIMESTAMP', 'DATETIME', 'DATETIME2', 'SMALLDATETIME'];
  var BOOLEAN_TYPES = ['BOOLEAN', 'BOOL', 'BIT'];

  function classify(typeStr) {
    if (!typeStr) return 'unknown';
    var bt = baseType(typeStr);
    if (!bt) return 'unknown';
    if (bt === 'DATE') return 'date';
    if (TIMESTAMP_TYPES.indexOf(bt) !== -1) return 'timestamp';
    if (BOOLEAN_TYPES.indexOf(bt) !== -1) return 'boolean';
    if (NUMERIC_TYPES.indexOf(bt) !== -1) return 'numeric';
    if (TEXT_TYPES.indexOf(bt) !== -1) return 'text';
    return 'unknown';
  }

  function needsConversion(typeStr) {
    var cat = classify(typeStr);
    return cat === 'numeric' || cat === 'date' || cat === 'timestamp' || cat === 'boolean';
  }

  function genericTextCast(expr) { return 'CAST(' + expr + ' AS VARCHAR(4000))'; }

  function numericElseExpr(expr, dialect) {
    switch (dialect) {
      case 'Oracle': return 'TO_CHAR(' + expr + ')';
      case 'SQL Server': return 'CONVERT(VARCHAR(4000), ' + expr + ')';
      case 'PostgreSQL': return expr + '::text';
      case 'MySQL': return 'CAST(' + expr + ' AS CHAR)';
      default: return genericTextCast(expr);
    }
  }
  function dateElseExpr(expr, dialect) {
    switch (dialect) {
      case 'Oracle': return 'TO_CHAR(' + expr + ')';
      case 'SQL Server': return 'CONVERT(VARCHAR(23), ' + expr + ', 120)';
      case 'PostgreSQL': return "TO_CHAR(" + expr + ", 'YYYY-MM-DD')";
      case 'MySQL': return "DATE_FORMAT(" + expr + ", '%Y-%m-%d')";
      default: return genericTextCast(expr);
    }
  }
  function timestampElseExpr(expr, dialect) {
    switch (dialect) {
      case 'Oracle': return 'TO_CHAR(' + expr + ')';
      case 'SQL Server': return 'CONVERT(VARCHAR(23), ' + expr + ', 120)';
      case 'PostgreSQL': return "TO_CHAR(" + expr + ", 'YYYY-MM-DD HH24:MI:SS')";
      case 'MySQL': return "DATE_FORMAT(" + expr + ", '%Y-%m-%d %H:%i:%s')";
      default: return genericTextCast(expr);
    }
  }
  function booleanElseExpr(expr, dialect) {
    switch (dialect) {
      case 'PostgreSQL': return expr + '::text';
      default: return numericElseExpr(expr, dialect);
    }
  }

  function getCompatibleElseExpression(expr, dataType, dialect) {
    if (!dataType) return expr;
    var cat = classify(dataType);
    switch (cat) {
      case 'numeric': return numericElseExpr(expr, dialect);
      case 'date': return dateElseExpr(expr, dialect);
      case 'timestamp': return timestampElseExpr(expr, dialect);
      case 'boolean': return booleanElseExpr(expr, dialect);
      default: return expr;
    }
  }

  function wrapDateLiteral(literal, dialect) {
    switch (dialect) {
      case 'Oracle': return "TO_DATE(" + literal + ", 'YYYY-MM-DD')";
      case 'SQL Server': return "CONVERT(DATE, " + literal + ", 120)";
      case 'PostgreSQL': return literal + '::date';
      case 'MySQL': return "STR_TO_DATE(" + literal + ", '%Y-%m-%d')";
      default: return "CAST(" + literal + " AS DATE)";
    }
  }

  var API = { classify: classify, needsConversion: needsConversion, getCompatibleElseExpression: getCompatibleElseExpression, wrapDateLiteral: wrapDateLiteral };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_DATATYPE = API;
})(typeof window !== 'undefined' ? window : this);
