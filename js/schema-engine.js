(function (root) {
  'use strict';
  function createEngine(schema) {
    schema = schema || { tables: [] };
    var tablesByName = {};
    (schema.tables || []).forEach(function (t) { tablesByName[String(t.name).toUpperCase()] = t; });

    function getTable(name) { return tablesByName[String(name || '').toUpperCase()] || null; }
    function getAllTables() { return (schema.tables || []).slice(); }
    function getModuleLabels() { return schema.module_labels || {}; }
    function tableExists(name) { return !!getTable(name); }
    function getColumn(tableName, columnName) {
      var t = getTable(tableName); if (!t) return null;
      var upper = String(columnName || '').toUpperCase();
      for (var i = 0; i < t.columns.length; i++) { if (String(t.columns[i].name).toUpperCase() === upper) return t.columns[i]; }
      return null;
    }
    function columnExists(tableName, columnName) { return !!getColumn(tableName, columnName); }
    function getValueMap(tableName, columnName) {
      var c = getColumn(tableName, columnName);
      return (c && Array.isArray(c.decode) && c.decode.length) ? c.decode : null;
    }
    function findRelationship(tableA, tableB) {
      var ta = getTable(tableA), tb = getTable(tableB);
      if (!ta || !tb) return null;
      for (var i = 0; i < ta.columns.length; i++) {
        var c = ta.columns[i];
        if (c.foreign_key && String(c.foreign_key.table).toUpperCase() === String(tb.name).toUpperCase()) {
          return { fromTable: ta.name, fromColumn: c.name, toTable: tb.name, toColumn: c.foreign_key.column };
        }
      }
      for (var j = 0; j < tb.columns.length; j++) {
        var c2 = tb.columns[j];
        if (c2.foreign_key && String(c2.foreign_key.table).toUpperCase() === String(ta.name).toUpperCase()) {
          return { fromTable: tb.name, fromColumn: c2.name, toTable: ta.name, toColumn: c2.foreign_key.column };
        }
      }
      return null;
    }
    function getSelfReferencingEdges(tableName) {
      var t = getTable(tableName); if (!t) return [];
      var edges = [];
      t.columns.forEach(function (c) {
        if (c.foreign_key && String(c.foreign_key.table).toUpperCase() === String(t.name).toUpperCase()) edges.push({ fromColumn: c.name, toColumn: c.foreign_key.column });
      });
      return edges;
    }
    function getStatus() {
      var tables = schema.tables || []; var moduleSet = {}; var colCount = 0;
      tables.forEach(function (t) { moduleSet[t.module] = true; colCount += (t.columns || []).length; });
      return { schemaName: schema.schema_name || '', schemaVersion: schema.schema_version || '', moduleCount: Object.keys(moduleSet).length, tableCount: tables.length, columnCount: colCount, lastUpdated: schema.last_updated || '' };
    }
    return {
      getTable: getTable, getAllTables: getAllTables, getModuleLabels: getModuleLabels, tableExists: tableExists,
      getColumn: getColumn, columnExists: columnExists, getValueMap: getValueMap, findRelationship: findRelationship,
      getSelfReferencingEdges: getSelfReferencingEdges, getStatus: getStatus
    };
  }
  var API = { createEngine: createEngine };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL = API;
})(typeof window !== 'undefined' ? window : this);
