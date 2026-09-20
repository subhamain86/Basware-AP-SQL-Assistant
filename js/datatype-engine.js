(function (root) {
  'use strict';
  function baseType(typeStr) { return String(typeStr || '').toUpperCase().replace(/\(.*\)/, '').trim(); }
  function classify(typeStr) {
    if (!typeStr) return 'unknown';
    var b = baseType(typeStr);
    if (['NUMBER', 'INTEGER', 'INT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'BIGINT', 'SMALLINT', 'NUMERIC'].indexOf(b) !== -1) return 'numeric';
    if (['VARCHAR', 'VARCHAR2', 'CHAR', 'NVARCHAR', 'NCHAR', 'TEXT', 'CLOB'].indexOf(b) !== -1) return 'text';
    if (b === 'DATE') return 'date';
    if (['TIMESTAMP', 'DATETIME', 'DATETIME2', 'SMALLDATETIME'].indexOf(b) !== -1) return 'timestamp';
    if (['BOOLEAN', 'BOOL', 'BIT'].indexOf(b) !== -1) return 'boolean';
    return 'unknown';
  }
  function needsConversion(typeStr) { var c = classify(typeStr); return c === 'numeric' || c === 'date' || c === 'timestamp' || c === 'boolean'; }
  function getCompatibleElseExpression(colRef, typeStr, dialect) {
    if (!typeStr) return colRef;
    var category = classify(typeStr);
    if (category === 'unknown' || category === 'text') return colRef;
    var d = dialect || 'Generic';
    if (category === 'numeric') {
      switch (d) {
        case 'Oracle': return 'TO_CHAR(' + colRef + ')';
        case 'SQL Server': return 'CONVERT(VARCHAR(4000), ' + colRef + ')';
        case 'PostgreSQL': return colRef + '::text';
        case 'MySQL': return 'CAST(' + colRef + ' AS CHAR)';
        default: return 'CAST(' + colRef + ' AS VARCHAR(4000))';
      }
    }
    if (category === 'date') {
      switch (d) {
        case 'Oracle': return 'TO_CHAR(' + colRef + ')';
        case 'SQL Server': return 'CONVERT(VARCHAR(23), ' + colRef + ', 120)';
        case 'PostgreSQL': return 'TO_CHAR(' + colRef + ", 'YYYY-MM-DD')";
        case 'MySQL': return "DATE_FORMAT(" + colRef + ", '%Y-%m-%d')";
        default: return 'CAST(' + colRef + ' AS VARCHAR(23))';
      }
    }
    if (category === 'timestamp') {
      switch (d) {
        case 'Oracle': return 'TO_CHAR(' + colRef + ')';
        case 'SQL Server': return 'CONVERT(VARCHAR(23), ' + colRef + ', 120)';
        case 'PostgreSQL': return 'TO_CHAR(' + colRef + ", 'YYYY-MM-DD HH24:MI:SS')";
        case 'MySQL': return "DATE_FORMAT(" + colRef + ", '%Y-%m-%d %H:%i:%s')";
        default: return 'CAST(' + colRef + ' AS VARCHAR(23))';
      }
    }
    if (category === 'boolean') {
      switch (d) {
        case 'Oracle': return 'TO_CHAR(' + colRef + ')';
        case 'SQL Server': return 'CONVERT(VARCHAR(5), ' + colRef + ')';
        case 'PostgreSQL': return colRef + '::text';
        case 'MySQL': return 'CAST(' + colRef + ' AS CHAR)';
        default: return 'CAST(' + colRef + ' AS VARCHAR(5))';
      }
    }
    return colRef;
  }
  function wrapDateLiteral(quotedLiteral, dialect) {
    var raw = String(quotedLiteral || '').replace(/^'|'$/g, '');
    switch (dialect) {
      case 'Oracle': return "TO_DATE('" + raw + "', 'YYYY-MM-DD')";
      case 'SQL Server': return "CONVERT(DATE, '" + raw + "', 120)";
      case 'PostgreSQL': return "'" + raw + "'::date";
      case 'MySQL': return "STR_TO_DATE('" + raw + "', '%Y-%m-%d')";
      default: return "CAST('" + raw + "' AS DATE)";
    }
  }
  var API = { classify: classify, needsConversion: needsConversion, getCompatibleElseExpression: getCompatibleElseExpression, wrapDateLiteral: wrapDateLiteral };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_DATATYPE = API;
})(typeof window !== 'undefined' ? window : this);
