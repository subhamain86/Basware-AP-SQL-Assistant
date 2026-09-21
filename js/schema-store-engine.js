(function (root) {
  'use strict';
  var STORAGE_KEY = 'ap_sql_schema_store_v2';
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
      lastSyncStatus: opts.lastSyncStatus || 'idle',
      lastSyncError: opts.lastSyncError || null
    };
  }
  // Schema states (carried forward from V11.1):
  //   Stored  - present in state.entries (always true for any entry)
  //   Active  - entry.id is present in state.activeIds (used by SQL generation / both Query
  //             Builders / the Error Rectifier / CASE-DECODE schema lookups)
  //   Default - entry.id === state.defaultId (the "currently selected/current schema" that
  //             Live Shared Schema / linked-file / GitHub sync and manual CASE/DECODE
  //             approvals write into)
  //   Inactive - Stored but NOT in state.activeIds
  function createStore(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    var state = { entries: [], activeIds: [], defaultId: null };
    function persist() { if (!storageImpl) return; try { storageImpl.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} }
    function normalizeState() {
      var validIds = {}; state.entries.forEach(function (e) { validIds[e.id] = true; });
      state.activeIds = (state.activeIds || []).filter(function (id) { return validIds[id]; });
      if (!state.defaultId || !validIds[state.defaultId]) state.defaultId = state.entries.length ? state.entries[0].id : null;
      if (state.defaultId && state.activeIds.indexOf(state.defaultId) === -1) state.activeIds.unshift(state.defaultId);
      if (!state.activeIds.length && state.entries.length) { state.activeIds = [state.entries[0].id]; if (!state.defaultId) state.defaultId = state.entries[0].id; }
    }
    function load() {
      if (!storageImpl) return;
      var raw; try { raw = storageImpl.getItem(STORAGE_KEY); } catch (e) { raw = null; }
      if (!raw) return;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) {
          state.entries = parsed.entries;
          state.activeIds = Array.isArray(parsed.activeIds) ? parsed.activeIds : [];
          state.defaultId = parsed.defaultId || null;
          normalizeState();
        }
      } catch (e) {}
    }
    load();
    function count() { return state.entries.length; }
    function listEntries() { return state.entries.slice(); }
    function getEntry(id) { return state.entries.filter(function (e) { return e.id === id; })[0] || null; }
    function getDefaultId() { return state.defaultId; }
    function getDefaultEntry() { return state.defaultId ? getEntry(state.defaultId) : null; }
    function getActiveIds() { return state.activeIds.slice(); }
    function getActiveEntries() {
      var ordered = state.activeIds.slice();
      ordered.sort(function (a, b) { if (a === state.defaultId) return -1; if (b === state.defaultId) return 1; return 0; });
      return ordered.map(function (id) { return getEntry(id); }).filter(Boolean);
    }
    function isActive(id) { return state.activeIds.indexOf(id) !== -1; }
    function isDefault(id) { return state.defaultId === id; }
    function getSchemaState(id) { if (!getEntry(id)) return null; if (isDefault(id)) return 'default'; if (isActive(id)) return 'active'; return 'inactive'; }
    function setDefaultId(id) { if (!getEntry(id)) return false; state.defaultId = id; if (state.activeIds.indexOf(id) === -1) state.activeIds.unshift(id); persist(); return true; }
    function setActiveIds(ids) {
      var validIds = {}; state.entries.forEach(function (e) { validIds[e.id] = true; });
      var next = (ids || []).filter(function (id) { return validIds[id]; });
      if (state.defaultId && next.indexOf(state.defaultId) === -1) next.unshift(state.defaultId);
      if (!next.length && state.entries.length) next = [state.defaultId || state.entries[0].id];
      state.activeIds = next; persist(); return state.activeIds.slice();
    }
    function setEntryActive(id, on) {
      if (!getEntry(id)) return false;
      var next = state.activeIds.slice(); var idx = next.indexOf(id);
      if (on && idx === -1) next.push(id);
      if (!on && idx !== -1) { if (id === state.defaultId) return false; next.splice(idx, 1); }
      return setActiveIds(next);
    }
    function addEntry(opts) {
      var entry = createEntry(opts);
      state.entries.push(entry);
      if (!state.defaultId) { state.defaultId = entry.id; state.activeIds.push(entry.id); }
      persist(); return entry;
    }
    function updateEntry(id, patch) { var entry = getEntry(id); if (!entry) return null; Object.keys(patch || {}).forEach(function (k) { entry[k] = patch[k]; }); persist(); return entry; }
    function removeEntry(id) {
      var idx = -1; for (var i = 0; i < state.entries.length; i++) { if (state.entries[i].id === id) { idx = i; break; } }
      if (idx === -1) return false;
      state.entries.splice(idx, 1);
      state.activeIds = state.activeIds.filter(function (aid) { return aid !== id; });
      if (state.defaultId === id) state.defaultId = state.entries.length ? state.entries[0].id : null;
      if (state.defaultId && state.activeIds.indexOf(state.defaultId) === -1) state.activeIds.unshift(state.defaultId);
      persist(); return true;
    }
    // Merged "active schema" used everywhere in the app (SQL generation, both Query Builders,
    // Error Rectifier, and CASE/DECODE schema lookups): union of every ACTIVE schema's tables.
    // On table-name collisions, the Default schema's tables win.
    function getMergedActiveSchema() {
      var activeEntries = getActiveEntries();
      if (!activeEntries.length) return { schema_name: 'No Active Schema', schema_version: '0.0', module_labels: {}, tables: [] };
      if (activeEntries.length === 1) return activeEntries[0].schema;
      var tablesByName = {}; var order = []; var moduleLabels = {}; var sourceNames = [];
      activeEntries.forEach(function (e) {
        sourceNames.push(e.name);
        Object.assign(moduleLabels, e.schema.module_labels || {});
        (e.schema.tables || []).forEach(function (t) { var key = String(t.name).toUpperCase(); if (!tablesByName[key]) { tablesByName[key] = t; order.push(key); } });
      });
      var defaultEntry = getDefaultEntry();
      return {
        schema_name: (defaultEntry ? defaultEntry.name : sourceNames[0]) + (sourceNames.length > 1 ? ' (+' + (sourceNames.length - 1) + ' more active)' : ''),
        schema_version: defaultEntry ? defaultEntry.schema.schema_version : '',
        last_updated: defaultEntry ? defaultEntry.schema.last_updated : '',
        module_labels: moduleLabels,
        tables: order.map(function (k) { return tablesByName[k]; })
      };
    }
    function importLegacySingleSchema(legacySchema, name) {
      var entry = createEntry({ name: name || (legacySchema && legacySchema.schema_name) || 'Migrated Schema', schema: legacySchema, source: 'embedded' });
      state.entries = [entry]; state.defaultId = entry.id; state.activeIds = [entry.id]; persist(); return entry;
    }
    return {
      count: count, listEntries: listEntries, getEntry: getEntry,
      getDefaultId: getDefaultId, getDefaultEntry: getDefaultEntry,
      getActiveIds: getActiveIds, getActiveEntries: getActiveEntries,
      isActive: isActive, isDefault: isDefault, getSchemaState: getSchemaState,
      setDefaultId: setDefaultId, setActiveIds: setActiveIds, setEntryActive: setEntryActive,
      addEntry: addEntry, updateEntry: updateEntry, removeEntry: removeEntry,
      importLegacySingleSchema: importLegacySingleSchema,
      getMergedActiveSchema: getMergedActiveSchema,
      persist: persist
    };
  }
  var API = { STORAGE_KEY: STORAGE_KEY, createEntry: createEntry, createStore: createStore };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_STORE = API;
})(typeof window !== 'undefined' ? window : this);
