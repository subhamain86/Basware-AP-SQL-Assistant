(function (root) {
  'use strict';
  function validateTableRef(engine, tableName, errors) {
    if (!tableName) { errors.push('No table was specified.'); return false; }
    if (!engine.tableExists(tableName)) { errors.push('Table "' + tableName + '" does not exist in the active schema.'); return false; }
    return true;
  }
  function validateColumnRef(engine, tableName, columnName, errors) {
    if (!columnName) { errors.push('No column was specified for table "' + tableName + '".'); return false; }
    if (!engine.columnExists(tableName, columnName)) { errors.push('Column "' + columnName + '" does not exist on table "' + tableName + '" in the active schema.'); return false; }
    return true;
  }
  function validateRelationship(engine, tableA, tableB, errors) {
    if (tableA === tableB) return true;
    var rel = engine.findRelationship(tableA, tableB);
    if (!rel) { errors.push('No relationship was found between "' + tableA + '" and "' + tableB + '" in the active schema.'); return false; }
    return true;
  }
  function validateFilterGroup(engine, filterGroup, baseTables, errors) {
    if (!filterGroup || !Array.isArray(filterGroup.conditions)) return true;
    var ok = true;
    filterGroup.conditions.forEach(function (cond) {
      var t = cond.table || baseTables[0];
      if (!validateTableRef(engine, t, errors)) { ok = false; return; }
      if (!validateColumnRef(engine, t, cond.column, errors)) { ok = false; return; }
      if (baseTables.indexOf(t) === -1) { var relatedToAny = baseTables.some(function (bt) { return !!engine.findRelationship(bt, t); }); if (!relatedToAny) { errors.push('Filter column "' + cond.column + '" is on table "' + t + '", which is not related to the selected table(s).'); ok = false; } }
    });
    return ok;
  }
  function validateSelectRequest(engine, request) {
    var errors = []; var tables = request.tables || [];
    if (!tables.length) errors.push('At least one table must be selected (or determined from your description).');
    tables.forEach(function (t) { validateTableRef(engine, t, errors); });
    (request.columns || []).forEach(function (c) { if (!validateTableRef(engine, c.table, errors)) return; if (c.aggregate && c.column === '*') return; validateColumnRef(engine, c.table, c.column, errors); });
    validateFilterGroup(engine, request.filterGroup, tables, errors);
    return { valid: errors.length === 0, errors: errors };
  }
  function validateCrRequest(engine, request) {
    var errors = [], warnings = [];
    if (!validateTableRef(engine, request.table, errors)) return { valid: false, errors: errors, warnings: warnings };
    if (request.command === 'INSERT') {
      if (!Array.isArray(request.columns) || request.columns.length === 0) errors.push('At least one column must be selected for INSERT.');
      else request.columns.forEach(function (c) { validateColumnRef(engine, request.table, c.name, errors); if (c.value === '' || c.value == null) warnings.push('Column "' + c.name + '" has no value provided.'); });
    } else if (request.command === 'UPDATE') {
      if (!Array.isArray(request.updates) || request.updates.length === 0) errors.push('At least one column to update must be selected for UPDATE.');
      else request.updates.forEach(function (u) { validateColumnRef(engine, request.table, u.column, errors); });
      if (!request.allowNoWhere && (!request.filterGroup || !request.filterGroup.conditions || request.filterGroup.conditions.length === 0)) errors.push('A WHERE condition is required to identify which records should be updated or deleted.');
      validateFilterGroup(engine, request.filterGroup, [request.table], errors);
    } else if (request.command === 'DELETE') {
      if (!request.allowNoWhere && (!request.filterGroup || !request.filterGroup.conditions || request.filterGroup.conditions.length === 0)) errors.push('A WHERE condition is required to identify which records should be updated or deleted.');
      validateFilterGroup(engine, request.filterGroup, [request.table], errors);
    } else if (request.command === 'SELECT') { validateFilterGroup(engine, request.filterGroup, [request.table], errors); }
    else { errors.push('Unknown command type "' + request.command + '".'); }
    return { valid: errors.length === 0, errors: errors, warnings: warnings };
  }
  var API = { validateTableRef: validateTableRef, validateColumnRef: validateColumnRef, validateRelationship: validateRelationship, validateFilterGroup: validateFilterGroup, validateSelectRequest: validateSelectRequest, validateCrRequest: validateCrRequest };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_VALIDATE = API;
})(typeof window !== 'undefined' ? window : this);
