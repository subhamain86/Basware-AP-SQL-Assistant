(function (root) {
  'use strict';
  var STORAGE_KEY = 'ap_sql_schema_store_v1';
  function genId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowIso() { return new Date().toISOString(); }
  function createEntry(opts) {
    opts = opts || {};
    return { id: opts.id || genId(), name: opts.name || 'Untitled Schema', schema: opts.schema || { schema_name: opts.name || 'Untitled Schema', schema_version: '0.0', tables: [] }, source: opts.source || 'upload', createdAt: opts.createdAt || nowIso(), lastSyncAt: opts.lastSyncAt || null, nextSyncAt: opts.nextSyncAt || null, lastSyncStatus: opts.lastSyncStatus || 'idle', lastSyncError: opts.lastSyncError || null, githubConfig: opts.githubConfig || null };
  }
  function createStore(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    var state = { entries: [], activeId: null };
    function persist() { if (!storageImpl) return; try { storageImpl.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} }
    function load() {
      if (!storageImpl) return;
      var raw; try { raw = storageImpl.getItem(STORAGE_KEY); } catch (e) { raw = null; }
      if (!raw) return;
      try { var parsed = JSON.parse(raw); if (parsed && Array.isArray(parsed.entries)) { state.entries = parsed.entries; state.activeId = parsed.activeId || null; } }
      catch (e) { state.entries = []; state.activeId = null; }
    }
    load();
    function count() { return state.entries.length; }
    function listEntries() { return state.entries.slice(); }
    function getEntry(id) { return state.entries.filter(function (e) { return e.id === id; })[0] || null; }
    function getActiveId() { return state.activeId; }
    function getActiveEntry() { return state.activeId ? getEntry(state.activeId) : null; }
    function getActiveSchema() { var e = getActiveEntry(); return e ? e.schema : null; }
    function addEntry(opts) { var entry = createEntry(opts); state.entries.push(entry); if (!state.activeId) state.activeId = entry.id; persist(); return entry; }
    function setActiveId(id) { if (!getEntry(id)) return false; state.activeId = id; persist(); return true; }
    function updateEntry(id, patch) { var entry = getEntry(id); if (!entry) return null; Object.keys(patch || {}).forEach(function (k) { entry[k] = patch[k]; }); persist(); return entry; }
    function renameEntry(id, newName) { return updateEntry(id, { name: newName }); }
    function removeEntry(id) {
      var idx = -1; for (var i = 0; i < state.entries.length; i++) { if (state.entries[i].id === id) { idx = i; break; } }
      if (idx === -1) return false;
      state.entries.splice(idx, 1);
      if (state.activeId === id) state.activeId = state.entries.length ? state.entries[0].id : null;
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
      state.entries = [entry]; state.activeId = entry.id; persist(); return entry;
    }
    return { count: count, listEntries: listEntries, getEntry: getEntry, getActiveId: getActiveId, getActiveEntry: getActiveEntry, getActiveSchema: getActiveSchema, addEntry: addEntry, setActiveId: setActiveId, updateEntry: updateEntry, renameEntry: renameEntry, removeEntry: removeEntry, recordSyncResult: recordSyncResult, importLegacySingleSchema: importLegacySingleSchema, persist: persist };
  }
  var API = { STORAGE_KEY: STORAGE_KEY, createEntry: createEntry, createStore: createStore };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_STORE = API;
})(typeof window !== 'undefined' ? window : this);
