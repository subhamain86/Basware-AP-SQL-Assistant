/**
 * schema-store-engine.js — AP-SQL Assistant
 * Manages MULTIPLE named, independently-stored schemas. Each entry has its
 * own Active/Inactive state; exactly one entry is always the Default
 * (which is always Active and cannot be deactivated directly). The
 * merged Active schema (Default + any other Active entries) is what the
 * rest of the app consumes as "the active schema".
 */
(function (root) {
  'use strict';
  var STORAGE_KEY = 'ap_sql_schema_store_v1';
  function genId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowIso() { return new Date().toISOString(); }

  function createEntry(opts) {
    opts = opts || {};
    return {
      id: opts.id || genId(),
      name: opts.name || 'Untitled Schema',
      schema: opts.schema || { schema_name: opts.name || 'Untitled Schema', schema_version: '0.0', tables: [] },
      source: opts.source || 'upload',
      createdAt: opts.createdAt || nowIso(),
      lastSyncAt: opts.lastSyncAt || null,
      nextSyncAt: opts.nextSyncAt || null,
      lastSyncStatus: opts.lastSyncStatus || 'idle',
      lastSyncError: opts.lastSyncError || null,
      githubConfig: opts.githubConfig || null
    };
  }

  function createStore(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    var state = { entries: [], defaultId: null, activeIds: [] };

    function persist() {
      if (!storageImpl) return;
      try { storageImpl.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    }
    function load() {
      if (!storageImpl) return;
      var raw = null;
      try { raw = storageImpl.getItem(STORAGE_KEY); } catch (e) { raw = null; }
      if (!raw) return;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) state = parsed;
      } catch (e) {}
    }
    load();

    function count() { return state.entries.length; }
    function listEntries() { return state.entries.slice(); }
    function getEntry(id) { return state.entries.filter(function (e) { return e.id === id; })[0] || null; }
    function getActiveId() { return state.activeIds.length ? state.activeIds[0] : state.defaultId; }
    function getDefaultId() { return state.defaultId; }
    function isDefault(id) { return state.defaultId === id; }
    function isActive(id) { return state.activeIds.indexOf(id) !== -1 || state.defaultId === id; }
    function getSchemaState(id) {
      if (isDefault(id)) return 'default';
      if (isActive(id)) return 'active';
      return 'inactive';
    }

    function addEntry(opts) {
      var entry = createEntry(opts);
      state.entries.push(entry);
      if (state.entries.length === 1) {
        state.defaultId = entry.id;
        state.activeIds = [entry.id];
      }
      persist();
      return entry;
    }

    function updateEntry(id, patch) {
      var entry = getEntry(id);
      if (!entry) return null;
      Object.keys(patch || {}).forEach(function (k) { entry[k] = patch[k]; });
      persist();
      return entry;
    }

    function removeEntry(id) {
      if (state.entries.length <= 1) return false;
      state.entries = state.entries.filter(function (e) { return e.id !== id; });
      state.activeIds = state.activeIds.filter(function (aid) { return aid !== id; });
      if (state.defaultId === id) state.defaultId = state.entries.length ? state.entries[0].id : null;
      if (!state.activeIds.length && state.defaultId) state.activeIds = [state.defaultId];
      persist();
      return true;
    }

    function setEntryActive(id, active) {
      if (isDefault(id) && !active) return false; // cannot deactivate the Default schema directly
      var idx = state.activeIds.indexOf(id);
      if (active && idx === -1) state.activeIds.push(id);
      if (!active && idx !== -1) state.activeIds.splice(idx, 1);
      persist();
      return true;
    }

    function setDefaultId(id) {
      if (!getEntry(id)) return false;
      state.defaultId = id;
      if (state.activeIds.indexOf(id) === -1) state.activeIds.push(id);
      persist();
      return true;
    }

    function setActiveId(id) {
      // Convenience: make this the sole "primary" active entry (used when a single-schema view is required)
      if (!getEntry(id)) return false;
      if (state.activeIds.indexOf(id) === -1) state.activeIds.unshift(id); else {
        state.activeIds = [id].concat(state.activeIds.filter(function (a) { return a !== id; }));
      }
      persist();
      return true;
    }

    function getActiveEntry() {
      var id = getActiveId();
      return id ? getEntry(id) : null;
    }

    function getMergedActiveSchema() {
      var activeEntries = state.entries.filter(function (e) { return isActive(e.id); });
      if (!activeEntries.length) return { tables: [] };
      var defaultEntry = getEntry(state.defaultId);
      var ordered = defaultEntry ? [defaultEntry].concat(activeEntries.filter(function (e) { return e.id !== defaultEntry.id; })) : activeEntries;
      var byName = {};
      var order = [];
      ordered.forEach(function (entry) {
        (entry.schema.tables || []).forEach(function (t) {
          var key = String(t.name).toUpperCase();
          if (!byName[key]) { byName[key] = t; order.push(key); }
        });
      });
      var moduleLabels = {};
      ordered.forEach(function (entry) { Object.assign(moduleLabels, entry.schema.module_labels || {}); });
      return {
        schema_name: defaultEntry ? defaultEntry.schema.schema_name : (ordered[0] && ordered[0].schema.schema_name),
        schema_version: defaultEntry ? defaultEntry.schema.schema_version : (ordered[0] && ordered[0].schema.schema_version),
        module_labels: moduleLabels,
        tables: order.map(function (k) { return byName[k]; })
      };
    }

    function getActiveSchema() { return getMergedActiveSchema(); }

    function recordSyncResult(id, result) {
      var entry = getEntry(id);
      if (!entry) return;
      entry.lastSyncAt = nowIso();
      entry.lastSyncStatus = result && result.ok ? 'ok' : 'error';
      entry.lastSyncError = result && result.error ? result.error : null;
      persist();
    }

    function importLegacySingleSchema(schemaObj, name) {
      return addEntry({ name: name || (schemaObj && schemaObj.schema_name) || 'Migrated Schema', schema: schemaObj, source: 'migrated' });
    }

    return {
      count: count, listEntries: listEntries, getEntry: getEntry, addEntry: addEntry, updateEntry: updateEntry,
      removeEntry: removeEntry, setEntryActive: setEntryActive, setDefaultId: setDefaultId, setActiveId: setActiveId,
      isDefault: isDefault, isActive: isActive, getSchemaState: getSchemaState,
      getActiveId: getActiveId, getDefaultId: getDefaultId, getActiveEntry: getActiveEntry,
      getMergedActiveSchema: getMergedActiveSchema, getActiveSchema: getActiveSchema,
      recordSyncResult: recordSyncResult, importLegacySingleSchema: importLegacySingleSchema,
      persist: persist
    };
  }

  var API = { STORAGE_KEY: STORAGE_KEY, createEntry: createEntry, createStore: createStore };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_STORE = API;
})(typeof window !== 'undefined' ? window : this);
