(function (root) {
  'use strict';
  var DATATYPE = (typeof module === 'object' && module.exports) ? require('./datatype-engine.js') : root.APSQL_DATATYPE;
  function createDecodeStore() {
    var manual = {};
    function key(table, column) { return String(table).toUpperCase() + '.' + String(column).toUpperCase(); }
    function setManualDecode(table, column, values) { manual[key(table, column)] = (values || []).map(function (v) { return { code: String(v.code), label: String(v.label) }; }); }
    function clearManualDecode(table, column) { delete manual[key(table, column)]; }
    function getManualDecode(table, column) { return manual[key(table, column)] || null; }
    function addValue(table, column, code, label) { var k = key(table, column); if (!manual[k]) manual[k] = []; manual[k].push({ code: String(code), label: String(label) }); return manual[k]; }
    function removeValue(table, column, index) { var k = key(table, column); if (manual[k]) manual[k].splice(index, 1); }
    function editValue(table, column, index, code, label) { var k = key(table, column); if (manual[k] && manual[k][index]) manual[k][index] = { code: String(code), label: String(label) }; }
    return { setManualDecode: setManualDecode, clearManualDecode: clearManualDecode, getManualDecode: getManualDecode, addValue: addValue, removeValue: removeValue, editValue: editValue };
  }
  function resolveDecode(engine, decodeStore, table, column) {
    var schemaValues = engine.getValueMap(table, column);
    if (schemaValues && schemaValues.length) return { source: 'schema', values: schemaValues };
    var manualValues = decodeStore ? decodeStore.getManualDecode(table, column) : null;
    if (manualValues && manualValues.length) return { source: 'user', values: manualValues };
    return { source: null, values: null };
  }
  function buildDecodeCaseSql(table, column, decodeValues, aliasName, opts) {
    opts = opts || {};
    var col = table ? (table + '.' + column) : column;
    var whens = (decodeValues || []).map(function (pair) {
      var codeLiteral = /^-?\d+(\.\d+)?$/.test(String(pair.code)) ? String(pair.code) : ("'" + String(pair.code).replace(/'/g, "''") + "'");
      return 'WHEN ' + col + ' = ' + codeLiteral + " THEN '" + String(pair.label).replace(/'/g, "''") + "'";
    });
    var elseExpr = col;
    if (opts.elseMode !== 'keep' && opts.dataType && DATATYPE) { elseExpr = DATATYPE.getCompatibleElseExpression(col, opts.dataType, opts.dialect); }
    return 'CASE\n    ' + whens.join('\n    ') + '\n    ELSE ' + elseExpr + '\nEND AS ' + aliasName;
  }
  var API = { createDecodeStore: createDecodeStore, resolveDecode: resolveDecode, buildDecodeCaseSql: buildDecodeCaseSql };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_DECODE = API;
})(typeof window !== 'undefined' ? window : this);
