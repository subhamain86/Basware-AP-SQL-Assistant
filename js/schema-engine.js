/* schema-engine.js — reads a single schema object and exposes lookups used everywhere else. */
(function (root) {
  'use strict';

  function up(s) { return String(s == null ? '' : s).toUpperCase(); }

  function createEngine(schema) {
    schema = schema || { tables: [] };
    var tables = schema.tables || [];
    var byName = {};
    tables.forEach(function (t) { byName[up(t.name)] = t; });

    function getAllTables() { return tables.slice(); }
    function getTable(name) { return byName[up(name)] || null; }
    function getColumn(tableName, columnName) {
      var t = getTable(tableName);
      if (!t) return null;
      return (t.columns || []).filter(function (c) { return up(c.name) === up(columnName); })[0] || null;
    }
    function getAlias(tableName) {
      var t = getTable(tableName);
      if (t && t.alias) return t.alias;
      // derive a short alias from initials if not provided
      var parts = up(tableName).split('_');
      if (parts.length > 1) return parts.map(function (p) { return p[0]; }).join('');
      return up(tableName).slice(0, 3);
    }
    function getPrimaryKey(tableName) {
      var t = getTable(tableName);
      if (!t) return null;
      return (t.columns || []).filter(function (c) { return c.primary_key; })[0] || null;
    }

    // Explicit relationship metadata (schema.relationships) takes precedence,
    // then FK metadata on columns, then nothing (caller may fall back to a
    // manual relationship-store or ask for clarification).
    function findRelationship(tableA, tableB) {
      var rels = schema.relationships || [];
      for (var i = 0; i < rels.length; i++) {
        var r = rels[i];
        if ((up(r.fromTable) === up(tableA) && up(r.toTable) === up(tableB)) ||
            (up(r.fromTable) === up(tableB) && up(r.toTable) === up(tableA))) {
          return { fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable, toColumn: r.toColumn, source: 'explicit' };
        }
      }
      var tA = getTable(tableA), tB = getTable(tableB);
      if (!tA || !tB) return null;
      var found = null;
      (tA.columns || []).forEach(function (c) {
        if (c.foreign_key && up(c.foreign_key.table) === up(tableB)) {
          found = { fromTable: tableA, fromColumn: c.name, toTable: tableB, toColumn: c.foreign_key.column, source: 'fk' };
        }
      });
      if (found) return found;
      (tB.columns || []).forEach(function (c) {
        if (c.foreign_key && up(c.foreign_key.table) === up(tableA)) {
          found = { fromTable: tableB, fromColumn: c.name, toTable: tableA, toColumn: c.foreign_key.column, source: 'fk' };
        }
      });
      return found;
    }

    function getModuleLabel(code) {
      return (schema.module_labels && schema.module_labels[code]) || code;
    }

    function searchTables(term) {
      term = up(term);
      return tables.filter(function (t) {
        return up(t.name).indexOf(term) !== -1 || up(t.notes || '').indexOf(term) !== -1;
      });
    }

    function searchColumns(term) {
      term = up(term);
      var out = [];
      tables.forEach(function (t) {
        (t.columns || []).forEach(function (c) {
          if (up(c.name).indexOf(term) !== -1 || up(c.description || '').indexOf(term) !== -1 || up(c.alias || '').indexOf(term) !== -1) {
            out.push({ table: t.name, column: c.name, description: c.description || '' });
          }
        });
      });
      return out;
    }

    return {
      schema: schema,
      getAllTables: getAllTables,
      getTable: getTable,
      getColumn: getColumn,
      getAlias: getAlias,
      getPrimaryKey: getPrimaryKey,
      findRelationship: findRelationship,
      getModuleLabel: getModuleLabel,
      searchTables: searchTables,
      searchColumns: searchColumns
    };
  }

  var API = { createEngine: createEngine };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_ENGINE = API;
})(typeof window !== 'undefined' ? window : this);
