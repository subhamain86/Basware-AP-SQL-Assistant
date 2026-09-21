/**
 * schema-store-engine.js — AP-SQL Assistant
 * V10.7   — Manages MULTIPLE named, independently-stored schemas. Each entry
 *           tracks its own metadata (name, version, source, last/next sync
 *           time, sync status) so Used Schema / Update Schema can display
 *           and act on them independently; a sync failure on one schema
 *           never affects any other (each entry's status is isolated).
 * V11.1   — ADDITIVE multi-schema state model layered on top, without
 *           changing any V10.7/V10.7.1 method's existing behavior:
 *             Stored   — exists in the repository (every listed entry)
 *             Active   — included in SQL generation / both Query Builders /
 *                        Error Rectifier (a schema can be Active without
 *                        being Default; multiple schemas can be Active at
 *                        once — a merged view of every Active schema's
 *                        tables is used, with the Default schema's tables
 *                        winning on name collisions)
 *             Default  — the one schema that Live Shared Schema / linked-
 *                        file sync / GitHub sync automatically update; the
 *                        Default schema is always included in the Active
 *                        set and can't be deactivated directly (change the
 *                        Default first). getActiveId()/getActiveSchema()
 *                        (V10.7.1 single-schema API) now resolve to the
 *                        Default schema / the merged Active view
 *                        respectively, so every pre-V11.1 call site keeps
 *                        working unmodified.
 *             Inactive — stored but currently excluded from use — nothing
 *                        is ever deleted by deactivating a schema.
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

    (function load() {
      if (!storageImpl) return;
      var raw; try { raw = storageImpl.getItem(STORAGE_KEY); } catch (e) { raw = null; }
      if (!raw) return;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) {
          state.entries = parsed.entries;
          state.defaultId = parsed.defaultId || parsed.activeId || (parsed.entries[0] && parsed.entries[0].id) || null;
          state.activeIds = Array.isArray(parsed.activeIds) ? parsed.activeIds : (state.defaultId ? [state.defaultId] : []);
          if (state.defaultId && state.activeIds.indexOf(state.defaultId) === -1) state.activeIds.push(state.defaultId);
        }
      } catch (e) { /* tolerate corrupted storage: start with a clean, empty store */ }
    })();

    function persist() {
      if (!storageImpl) return;
      try { storageImpl.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function count() { return state.entries.length; }
    function listEntries() { return state.entries.slice(); }
    function getEntry(id) { return state.entries.filter(function (e) { return e.id === id; })[0] || null; }

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
      var e = getEntry(id);
      if (!e) return false;
      Object.keys(patch || {}).forEach(function (k) { e[k] = patch[k]; });
      persist();
      return true;
    }
    function renameEntry(id, name) { return updateEntry(id, { name: name }); }

    function removeEntry(id) {
      var idx = state.entries.findIndex(function (e) { return e.id === id; });
      if (idx === -1) return false;
      state.entries.splice(idx, 1);
      state.activeIds = state.activeIds.filter(function (a) { return a !== id; });
      if (state.defaultId === id) {
        state.defaultId = state.entries.length ? state.entries[0].id : null;
        if (state.defaultId && state.activeIds.indexOf(state.defaultId) === -1) state.activeIds.push(state.defaultId);
      }
      persist();
      return true;
    }

    // ---- V10.7.1 single-active-schema API (preserved exactly) ----
    function getActiveId() { return state.defaultId; }
    function getActiveEntry() { return state.defaultId ? getEntry(state.defaultId) : null; }
    function getActiveSchema() {
      // V11.1: resolves to the MERGED view of every Active schema (a strict
      // superset of the old single-schema behavior — every table that used
      // to be visible still is, plus any from other Active schemas).
      var merged = getMergedActiveSchema();
      return merged && merged.tables.length ? merged : (getActiveEntry() ? getActiveEntry().schema : null);
    }
    function setActiveId(id) {
      if (!getEntry(id)) return false;
      state.defaultId = id;
      if (state.activeIds.indexOf(id) === -1) state.activeIds.push(id);
      persist();
      return true;
    }

    function recordSyncResult(id, result) {
      var e = getEntry(id); if (!e) return false;
      if (result && result.ok) {
        e.lastSyncStatus = 'ok';
        e.lastSyncAt = nowIso();
        e.lastSyncError = null;
        if (result.nextSyncAt) e.nextSyncAt = result.nextSyncAt;
      } else {
        e.lastSyncStatus = 'error';
        e.lastSyncError = (result && result.error) || 'Unknown synchronization error.';
      }
      persist();
      return true;
    }

    function importLegacySingleSchema(legacySchema, name) {
      var entry = addEntry({ name: name || legacySchema.schema_name || 'Migrated Schema', schema: legacySchema, source: 'embedded' });
      return entry;
    }

    // ---- V11.1 multi-schema state model (additive) ----
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
      if (state.activeIds.indexOf(id) === -1) state.activeIds.push(id);
      persist();
      return true;
    }
    function setEntryActive(id, active) {
      if (!getEntry(id)) return false;
      if (!active && id === state.defaultId) return false; // Default is always Active; change Default first
      var idx = state.activeIds.indexOf(id);
      if (active && idx === -1) state.activeIds.push(id);
      if (!active && idx !== -1) state.activeIds.splice(idx, 1);
      persist();
      return true;
    }
    function getDefaultId() { return state.defaultId; }
    function getActiveIds() { return state.activeIds.slice(); }
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
      // V10.7 / V10.7.1 API (unchanged signatures/behavior)
      count: count, listEntries: listEntries, getEntry: getEntry,
      addEntry: addEntry, updateEntry: updateEntry, renameEntry: renameEntry, removeEntry: removeEntry,
      getActiveId: getActiveId, getActiveEntry: getActiveEntry, getActiveSchema: getActiveSchema, setActiveId: setActiveId,
      recordSyncResult: recordSyncResult, importLegacySingleSchema: importLegacySingleSchema,
      persist: persist,
      // V11.1 additive multi-schema API
      isDefault: isDefault, isActive: isActive, getSchemaState: getSchemaState,
      setDefaultId: setDefaultId, setEntryActive: setEntryActive,
      getDefaultId: getDefaultId, getActiveIds: getActiveIds, getMergedActiveSchema: getMergedActiveSchema
    };
  }
  var API = { STORAGE_KEY: STORAGE_KEY, createEntry: createEntry, createStore: createStore };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_STORE = API;
})(typeof window !== 'undefined' ? window : this);
