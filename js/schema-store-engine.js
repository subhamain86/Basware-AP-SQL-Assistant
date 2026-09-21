/* schema-store-engine.js — Multiple Schema Architecture (spec section 3/6/29):
   Stored / Active / Default / Inactive states, a merged view of every Active schema for
   SQL generation, and safeguards (can't directly deactivate the Default schema; changing
   the Default never removes anything from the Active set). This is the single application
   state every page must read from — Read/CR Query Builders, Error Rectifier, Used Schema,
   and Update Schema. */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'ap_sql_schema_store_v1';

  function uid() { return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  function createStore(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    var state = load();

    function load() {
      if (storageImpl) {
        try {
          var raw = storageImpl.getItem(STORAGE_KEY);
          if (raw) return JSON.parse(raw);
        } catch (e) {}
      }
      return { entries: [], defaultId: null, activeIds: [] };
    }
    function persist() {
      if (!storageImpl) return;
      try { storageImpl.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function getEntries() { return state.entries.slice(); }
    function getEntry(id) { return state.entries.filter(function (e) { return e.id === id; })[0] || null; }

    function addEntry(opts) {
      var entry = { id: uid(), name: opts.name || ('Schema ' + (state.entries.length + 1)), schema: opts.schema, addedAt: new Date().toISOString(), version: (opts.schema && opts.schema.schema_version) || '1.0' };
      state.entries.push(entry);
      if (state.entries.length === 1) {
        state.defaultId = entry.id;
        state.activeIds = [entry.id];
      }
      persist();
      return entry;
    }

    function updateEntrySchema(id, schema) {
      var e = getEntry(id);
      if (!e) return false;
      e.schema = schema;
      e.version = (schema && schema.schema_version) || e.version;
      e.updatedAt = new Date().toISOString();
      persist();
      return true;
    }

    function removeEntry(id) {
      if (id === state.defaultId) return false; // must reassign default first
      state.entries = state.entries.filter(function (e) { return e.id !== id; });
      state.activeIds = state.activeIds.filter(function (aid) { return aid !== id; });
      persist();
      return true;
    }

    function isDefault(id) { return state.defaultId === id; }
    function isActive(id) { return state.activeIds.indexOf(id) !== -1; }
    function getSchemaState(id) {
      if (isDefault(id)) return 'default';
      if (isActive(id)) return 'active';
      return 'inactive';
    }

    function setDefaultId(id) {
      if (!getEntry(id)) return false;
      state.defaultId = id;
      if (state.activeIds.indexOf(id) === -1) state.activeIds.push(id); // default is always active
      persist();
      return true;
    }

    function setEntryActive(id, active) {
      if (!getEntry(id)) return false;
      if (!active && id === state.defaultId) return false; // safeguard: can't deactivate Default directly
      var idx = state.activeIds.indexOf(id);
      if (active && idx === -1) state.activeIds.push(id);
      if (!active && idx !== -1) state.activeIds.splice(idx, 1);
      persist();
      return true;
    }

    function getDefaultId() { return state.defaultId; }
    function getActiveIds() { return state.activeIds.slice(); }

    // Merged view of every Active schema's tables — Default schema's tables win on name collisions.
    function getMergedActiveSchema() {
      var merged = { schema_name: 'Merged Active Schema', schema_version: 'merged', module_labels: {}, tables: [] };
      var byName = {};
      state.activeIds.forEach(function (id) {
        var e = getEntry(id);
        if (!e || !e.schema) return;
        Object.assign(merged.module_labels, e.schema.module_labels || {});
        (e.schema.tables || []).forEach(function (t) {
          var key = String(t.name).toUpperCase();
          if (!byName[key] || id === state.defaultId) byName[key] = t;
        });
      });
      merged.tables = Object.keys(byName).map(function (k) { return byName[k]; });
      return merged;
    }

    return {
      getEntries: getEntries, getEntry: getEntry, addEntry: addEntry, updateEntrySchema: updateEntrySchema, removeEntry: removeEntry,
      isDefault: isDefault, isActive: isActive, getSchemaState: getSchemaState,
      setDefaultId: setDefaultId, setEntryActive: setEntryActive,
      getDefaultId: getDefaultId, getActiveIds: getActiveIds, getMergedActiveSchema: getMergedActiveSchema
    };
  }

  var API = { STORAGE_KEY: STORAGE_KEY, createStore: createStore };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_STORE = API;
})(typeof window !== 'undefined' ? window : this);
