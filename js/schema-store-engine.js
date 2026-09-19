/**
 * schema-store-engine.js — AP-SQL Assistant V10.7
 * ---------------------------------------------------------------------------
 * Manages MULTIPLE named, independently-stored schemas (requirement: "add
 * support for storing multiple database schemas... users should be able to
 * add, manage, select, and use different schemas"). Each entry tracks its
 * own metadata (name, version, source, last/next sync time, sync status)
 * so the Used Schema and Update Schema sections can display and act on
 * them independently, and so a sync failure on one schema never affects
 * any other (each entry's status is tracked in complete isolation).
 *
 * Persistence: a single localStorage key holds the whole collection (an
 * array of entries) plus the currently active entry id. This keeps the
 * store fully synchronous and simple to reason about; entries themselves
 * can still be synced individually to/from GitHub via each entry's own
 * `githubConfig` (which may be empty, meaning "manual only").
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'ap_sql_schema_store_v1';

  function genId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowIso() { return new Date().toISOString(); }

  /**
   * createEntry(opts) — builds a new, well-formed store entry. `source`
   * should be one of: 'embedded' | 'upload' | 'github' | 'shared'.
   */
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
      lastSyncStatus: opts.lastSyncStatus || 'idle', // 'idle' | 'ok' | 'error' | 'pending'
      lastSyncError: opts.lastSyncError || null,
      githubConfig: opts.githubConfig || null // { owner, repo, branch, path } — token resolved separately via the vault
    };
  }

  /**
   * createStore(storageImpl) — a small, synchronous, in-memory-plus-
   * localStorage-backed collection manager. All mutating methods persist
   * immediately; all read methods operate on the in-memory copy for speed
   * (important for "efficiently search... without loading unnecessary
   * schema information into every query-generation operation" — the SQL
   * engine only ever touches the single active entry's schema object, not
   * the whole store).
   */
  function createStore(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    var state = { entries: [], activeId: null };

    function persist() {
      if (!storageImpl) return;
      try { storageImpl.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* quota or unavailable — silently skip, in-memory state still correct */ }
    }
    function load() {
      if (!storageImpl) return false;
      var raw;
      try { raw = storageImpl.getItem(STORAGE_KEY); } catch (e) { return false; }
      if (!raw) return false;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) { state = parsed; return true; }
      } catch (e) { /* corrupted — fall through to false */ }
      return false;
    }

    function listEntries() { return state.entries.slice(); }
    function getEntry(id) { return state.entries.filter(function (e) { return e.id === id; })[0] || null; }
    function getActiveId() { return state.activeId; }
    function getActiveEntry() { return state.activeId ? getEntry(state.activeId) : null; }
    function getActiveSchema() { var e = getActiveEntry(); return e ? e.schema : null; }
    function count() { return state.entries.length; }

    function addEntry(opts) {
      var entry = createEntry(opts);
      state.entries.push(entry);
      if (!state.activeId) state.activeId = entry.id;
      persist();
      return entry;
    }
    function updateEntry(id, patch) {
      var entry = getEntry(id); if (!entry) return null;
      Object.keys(patch || {}).forEach(function (k) { entry[k] = patch[k]; });
      persist();
      return entry;
    }
    function removeEntry(id) {
      var idx = state.entries.findIndex(function (e) { return e.id === id; });
      if (idx === -1) return false;
      state.entries.splice(idx, 1);
      if (state.activeId === id) state.activeId = state.entries.length ? state.entries[0].id : null;
      persist();
      return true;
    }
    function setActiveId(id) {
      if (!getEntry(id)) return false;
      state.activeId = id;
      persist();
      return true;
    }
    function renameEntry(id, newName) { return updateEntry(id, { name: newName }); }

    /**
     * recordSyncResult(id, result) — updates ONLY the given entry's own
     * sync bookkeeping fields. Because every entry's status lives in its
     * own object, a failure recorded here for one schema can never leak
     * into or block another entry's independent status.
     */
    function recordSyncResult(id, result) {
      return updateEntry(id, {
        lastSyncAt: result.ok ? nowIso() : (getEntry(id) || {}).lastSyncAt || null,
        lastSyncStatus: result.ok ? 'ok' : 'error',
        lastSyncError: result.ok ? null : (result.error || 'Unknown synchronization error'),
        nextSyncAt: result.nextSyncAt || null
      });
    }

    function importLegacySingleSchema(schemaObj, name) {
      if (!schemaObj) return null;
      return addEntry({ name: name || (schemaObj.schema_name || 'Default Schema'), schema: schemaObj, source: 'embedded' });
    }

    load();
    return {
      listEntries: listEntries, getEntry: getEntry, getActiveId: getActiveId, getActiveEntry: getActiveEntry,
      getActiveSchema: getActiveSchema, count: count, addEntry: addEntry, updateEntry: updateEntry,
      removeEntry: removeEntry, setActiveId: setActiveId, renameEntry: renameEntry,
      recordSyncResult: recordSyncResult, importLegacySingleSchema: importLegacySingleSchema,
      persist: persist, load: load
    };
  }

  var API = { STORAGE_KEY: STORAGE_KEY, createEntry: createEntry, createStore: createStore };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_STORE = API;
})(typeof window !== 'undefined' ? window : this);
