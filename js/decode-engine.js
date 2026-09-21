(function (root) {
  'use strict';
  var DATATYPE = (typeof module === 'object' && module.exports) ? require('./datatype-engine.js') : root.APSQL_DATATYPE;

  // ---- V11.4: session-scoped store for decode definitions not yet approved/saved to schema ----
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

  // ---- V11.4: Schema-aware CASE/DECODE resolution ----
  // Always checks the ACTIVE/CURRENT schema first (via engine, which is built from the merged
  // active schema set). Only falls back to a session-only manual decode (not yet approved/saved)
  // if nothing is documented in the schema. This ensures SQL generation prefers the governed,
  // schema-defined mapping over any ad-hoc value, and never silently invents a different mapping.
  function resolveDecode(engine, decodeStore, table, column) {
    var schemaValues = engine ? engine.getValueMap(table, column) : null;
    if (schemaValues && schemaValues.length) return { source: 'schema', values: schemaValues, existsInSchema: true };
    var manualValues = decodeStore ? decodeStore.getManualDecode(table, column) : null;
    if (manualValues && manualValues.length) return { source: 'session', values: manualValues, existsInSchema: false };
    return { source: null, values: null, existsInSchema: false };
  }

  // Returns true only when a *schema-defined* (governed) CASE/DECODE definition is available —
  // used to decide whether the app should offer the "Manual CASE/DECODE Addition" workflow.
  function hasSchemaDecode(engine, table, column) {
    var v = engine ? engine.getValueMap(table, column) : null;
    return !!(v && v.length);
  }

  function buildDecodeCaseSql(table, column, decodeValues, aliasName, opts) {
    opts = opts || {};
    var col = table ? (table + '.' + column) : column;
    var lines = ['CASE'];
    (decodeValues || []).forEach(function (pair) {
      var isNumeric = /^-?\d+(\.\d+)?$/.test(String(pair.code).trim());
      var literal = isNumeric ? String(pair.code).trim() : ("'" + String(pair.code).replace(/'/g, "''") + "'");
      lines.push('    WHEN ' + col + ' = ' + literal + " THEN '" + String(pair.label).replace(/'/g, "''") + "'");
    });
    var elseExpr = col;
    if (opts.elseMode !== 'keep' && opts.dataType && DATATYPE) elseExpr = DATATYPE.getCompatibleElseExpression(col, opts.dataType, opts.dialect || 'Generic');
    lines.push('    ELSE ' + elseExpr);
    lines.push('END AS ' + (aliasName || column));
    return lines.join('\n');
  }

  var API = {
    createDecodeStore: createDecodeStore,
    resolveDecode: resolveDecode,
    hasSchemaDecode: hasSchemaDecode,
    buildDecodeCaseSql: buildDecodeCaseSql
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_DECODE = API;
})(typeof window !== 'undefined' ? window : this);
