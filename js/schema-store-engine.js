(function (root) {
  'use strict';
  var STORAGE_KEY = 'ap_sql_schema_store_v2';
  var LEGACY_V1_KEY = 'ap_sql_schema_store_v1';
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

  // Schema states:
  //   Stored   - present in state.entries (always true for any entry)
  //   Active   - entry.id is present in state.activeIds (available for use by SQL generation / Query Builder / Error Rectifier)
  //   Default  - entry.id === state.defaultId (primary schema for default operations; always included in activeIds)
  //   Inactive - Stored but NOT in state.activeIds
  function createStore(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    var state = { entries: [], activeIds: [], defaultId: null };

    function persist() { if (!storageImpl) return; try { storageImpl.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} }

    function migrateFromV1() {
      if (!storageImpl) return false;
      var raw; try { raw = storageImpl.getItem(LEGACY_V1_KEY); } catch (e) { raw = null; }
      if (!raw) return false;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries) && parsed.entries.length) {
          state.entries = parsed.entries;
          state.defaultId = parsed.activeId || parsed.entries[0].id;
          state.activeIds = [state.defaultId];
          return true;
        }
      } catch (e) {}
      return false;
    }

    function load() {
      if (!storageImpl) return;
      var raw; try { raw = storageImpl.getItem(STORAGE_KEY); } catch (e) { raw = null; }
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.entries)) {
            state.entries = parsed.entries;
            state.activeIds = Array.isArray(parsed.activeIds) ? parsed.activeIds : (parsed.activeId ? [parsed.activeId] : []);
            state.defaultId = parsed.defaultId || (state.activeIds.length ? state.activeIds[0] : (state.entries[0] ? state.entries[0].id : null));
            normalizeState();
            return;
          }
        } catch (e) { /* fall through to migration */ }
      }
      if (migrateFromV1()) { normalizeState(); persist(); return; }
    }

    function normalizeState() {
      var validIds = {}; state.entries.forEach(function (e) { validIds[e.id] = true; });
      state.activeIds = (state.activeIds || []).filter(function (id) { return validIds[id]; });
      if (!state.defaultId || !validIds[state.defaultId]) state.defaultId = state.entries.length ? state.entries[0].id : null;
      if (state.defaultId && state.activeIds.indexOf(state.defaultId) === -1) state.activeIds.unshift(state.defaultId);
      if (!state.activeIds.length && state.entries.length) { state.activeIds = [state.entries[0].id]; if (!state.defaultId) state.defaultId = state.entries[0].id; }
    }

    load();

    function count() { return state.entries.length; }
    function listEntries() { return state.entries.slice(); }
    function getEntry(id) { return state.entries.filter(function (e) { return e.id === id; })[0] || null; }

    function getActiveId() { return state.defaultId; }
    function getActiveEntry() { return state.defaultId ? getEntry(state.defaultId) : null; }
    function getActiveSchema() { var e = getActiveEntry(); return e ? e.schema : null; }

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
    function getSchemaState(id) {
      if (!getEntry(id)) return null;
      if (isDefault(id)) return 'default';
      if (isActive(id)) return 'active';
      return 'inactive';
    }

    function setDefaultId(id) {
      if (!getEntry(id)) return false;
      state.defaultId = id;
      if (state.activeIds.indexOf(id) === -1) state.activeIds.unshift(id);
      persist(); return true;
    }

    function setActiveIds(ids) {
      var validIds = {}; state.entries.forEach(function (e) { validIds[e.id] = true; });
      var next = (ids || []).filter(function (id) { return validIds[id]; });
      if (state.defaultId && next.indexOf(state.defaultId) === -1) next.unshift(state.defaultId);
      if (!next.length && state.entries.length) next = [state.defaultId || state.entries[0].id];
      state.activeIds = next;
      persist();
      return state.activeIds.slice();
    }
    function setEntryActive(id, on) {
      if (!getEntry(id)) return false;
      var next = state.activeIds.slice();
      var idx = next.indexOf(id);
      if (on && idx === -1) next.push(id);
      if (!on && idx !== -1) {
        if (id === state.defaultId) return false;
        next.splice(idx, 1);
      }
      return setActiveIds(next);
    }

    function addEntry(opts) {
      var entry = createEntry(opts);
      state.entries.push(entry);
      if (!state.defaultId) { state.defaultId = entry.id; state.activeIds.push(entry.id); }
      persist();
      return entry;
    }
    function setActiveId(id) { return setDefaultId(id); }
    function updateEntry(id, patch) { var entry = getEntry(id); if (!entry) return null; Object.keys(patch || {}).forEach(function (k) { entry[k] = patch[k]; }); persist(); return entry; }
    function renameEntry(id, newName) { return updateEntry(id, { name: newName }); }
    function removeEntry(id) {
      var idx = -1; for (var i = 0; i < state.entries.length; i++) { if (state.entries[i].id === id) { idx = i; break; } }
      if (idx === -1) return false;
      state.entries.splice(idx, 1);
      state.activeIds = state.activeIds.filter(function (aid) { return aid !== id; });
      if (state.defaultId === id) state.defaultId = state.entries.length ? state.entries[0].id : null;
      if (state.defaultId && state.activeIds.indexOf(state.defaultId) === -1) state.activeIds.unshift(state.defaultId);
      persist(); return true;
    }
    function recordSyncResult(id, result) {
      var entry = getEntry(id); if (!entry) return;
      if (result && result.ok) { entry.lastSyncStatus = 'ok'; entry.lastSyncAt = nowIso(); entry.lastSyncError = null; if (result.nextSyncAt) entry.nextSyncAt = result.nextSyncAt; }
      else { entry.lastSyncStatus = 'error'; entry.lastSyncError = (result && result.error) || 'Unknown error'; }
      persist();
    }
    function importLegacySingleSchema(legacySchema, name) {
      var entry = createEntry({ name: name || (legacySchema && legacySchema.schema_name) || 'Migrated Schema', schema: legacySchema, source: 'embedded' });
      state.entries = [entry]; state.defaultId = entry.id; state.activeIds = [entry.id]; persist(); return entry;
    }

    function getMergedActiveSchema() {
      var activeEntries = getActiveEntries();
      if (!activeEntries.length) return { schema_name: 'No Active Schema', schema_version: '0.0', module_labels: {}, tables: [] };
      if (activeEntries.length === 1) return activeEntries[0].schema;
      var tablesByName = {}; var order = []; var moduleLabels = {}; var sourceNames = [];
      activeEntries.forEach(function (e) {
        sourceNames.push(e.name);
        Object.assign(moduleLabels, e.schema.module_labels || {});
        (e.schema.tables || []).forEach(function (t) {
          var key = String(t.name).toUpperCase();
          if (!tablesByName[key]) { tablesByName[key] = t; order.push(key); }
        });
      });
      var defaultEntry = getDefaultEntry();
      return {
        schema_name: (defaultEntry ? defaultEntry.name : sourceNames[0]) + (sourceNames.length > 1 ? ' (+' + (sourceNames.length - 1) + ' more active)' : ''),
        schema_version: defaultEntry ? defaultEntry.schema.schema_version : '',
        last_updated: defaultEntry ? defaultEntry.schema.last_updated : '',
        module_labels: moduleLabels,
        tables: order.map(function (k) { return tablesByName[k]; }),
        _mergedFrom: sourceNames
      };
    }

    return {
      count: count, listEntries: listEntries, getEntry: getEntry,
      getActiveId: getActiveId, getActiveEntry: getActiveEntry, getActiveSchema: getActiveSchema,
      getDefaultId: getDefaultId, getDefaultEntry: getDefaultEntry,
      getActiveIds: getActiveIds, getActiveEntries: getActiveEntries,
      isActive: isActive, isDefault: isDefault, getSchemaState: getSchemaState,
      setDefaultId: setDefaultId, setActiveIds: setActiveIds, setEntryActive: setEntryActive,
      addEntry: addEntry, setActiveId: setActiveId, updateEntry: updateEntry, renameEntry: renameEntry, removeEntry: removeEntry,
      recordSyncResult: recordSyncResult, importLegacySingleSchema: importLegacySingleSchema,
      getMergedActiveSchema: getMergedActiveSchema,
      persist: persist
    };
  }
  var API = { STORAGE_KEY: STORAGE_KEY, createEntry: createEntry, createStore: createStore };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_STORE = API;
})(typeof window !== 'undefined' ? window : this);
