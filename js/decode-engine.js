/* decode-engine.js — CASE/DECODE resolution.
   Priority order (per V11.5 spec, section 15):
     1. Look up an existing definition documented on the active schema column (column.decode).
     2. If none exists, allow a manual session-level definition (createDecodeStore), which
        requires admin approval (password) before being persisted back into the schema by app.js.
   Never silently invents a mapping that conflicts with a schema-documented one. */
(function (root) {
  'use strict';

  function createDecodeStore() {
    var manual = {}; // key "TABLE.COLUMN" -> { cases:[{when,then}], else_value, description }
    function key(table, column) { return String(table).toUpperCase() + '.' + String(column).toUpperCase(); }
    function setManual(table, column, def) { manual[key(table, column)] = def; }
    function getManual(table, column) { return manual[key(table, column)] || null; }
    function clearManual(table, column) { delete manual[key(table, column)]; }
    function listManual() { return Object.keys(manual).map(function (k) { return { key: k, def: manual[k] }; }); }
    return { setManual: setManual, getManual: getManual, clearManual: clearManual, listManual: listManual };
  }

  function defsEqual(a, b) {
    if (!a || !b) return false;
    return JSON.stringify(a.cases || []) === JSON.stringify(b.cases || []) && String(a.else_value) === String(b.else_value);
  }

  // Resolve the decode definition to use for a table.column, schema-first.
  function resolveDecode(engine, decodeStore, table, column) {
    var col = engine.getColumn(table, column);
    if (col && col.decode) return { def: col.decode, source: 'schema' };
    var manualDef = decodeStore ? decodeStore.getManual(table, column) : null;
    if (manualDef) return { def: manualDef, source: 'manual' };
    return null;
  }

  // Build a CASE expression string for a resolved decode definition.
  function buildCaseExpression(columnExpr, def, dialect) {
    if (!def || !def.cases || !def.cases.length) return columnExpr;
    var parts = ['CASE'];
    def.cases.forEach(function (c) {
      var whenVal = /^-?\d+(\.\d+)?$/.test(String(c.when)) ? c.when : "'" + String(c.when).replace(/'/g, "''") + "'";
      var thenVal = "'" + String(c.then).replace(/'/g, "''") + "'";
      parts.push('WHEN ' + columnExpr + ' = ' + whenVal + ' THEN ' + thenVal);
    });
    if (def.else_value !== undefined && def.else_value !== null && def.else_value !== '') {
      parts.push("ELSE '" + String(def.else_value).replace(/'/g, "''") + "'");
    } else {
      parts.push('ELSE ' + columnExpr);
    }
    parts.push('END');
    return parts.join(' ');
  }

  // Validate a *new* manual definition against duplicates/conflicts before it can be
  // submitted for admin approval.
  function validateNewDefinition(engine, decodeStore, table, column, def) {
    var errors = [];
    if (!def || !def.cases || !def.cases.length) errors.push('At least one condition/result pair is required.');
    var seen = {};
    (def.cases || []).forEach(function (c) {
      if (c.when === undefined || c.when === '') errors.push('Every condition must have a value.');
      if (c.then === undefined || c.then === '') errors.push('Every condition must have a result.');
      var k = String(c.when);
      if (seen[k]) errors.push('Duplicate condition value "' + c.when + '" in this definition.');
      seen[k] = true;
    });
    var existing = resolveDecode(engine, decodeStore, table, column);
    if (existing) {
      if (defsEqual(existing.def, def)) {
        errors.push('An identical CASE/DECODE definition already exists for ' + table + '.' + column + '.');
      } else {
        errors.push('A different CASE/DECODE definition already exists for ' + table + '.' + column + '. Remove or edit the existing one first instead of creating a conflicting definition.');
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  var API = {
    createDecodeStore: createDecodeStore, resolveDecode: resolveDecode,
    buildCaseExpression: buildCaseExpression, validateNewDefinition: validateNewDefinition, defsEqual: defsEqual
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_DECODE = API;
})(typeof window !== 'undefined' ? window : this);
