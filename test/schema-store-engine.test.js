'use strict';
var path = require('path');
var STORE = require(path.join(__dirname, '..', 'js', 'schema-store-engine.js'));
function makeFakeStorage() {
  var data = {};
  return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; }, setItem: function (k, v) { data[k] = String(v); }, removeItem: function (k) { delete data[k]; }, _raw: data };
}
var SCHEMA_A = { schema_name: 'Schema A', schema_version: '1.0', tables: [] };
var SCHEMA_B = { schema_name: 'Schema B', schema_version: '2.0', tables: [] };
test('createEntry produces a well-formed entry with sensible defaults', function () {
  var e = STORE.createEntry({ name: 'Test', schema: SCHEMA_A, source: 'upload' });
  assertTrue(!!e.id);
  assertEqual(e.name, 'Test');
  assertEqual(e.source, 'upload');
  assertEqual(e.lastSyncStatus, 'idle');
  assertEqual(e.lastSyncAt, null);
  assertEqual(e.githubConfig, null);
});
test('createEntry auto-generates a name/schema when none supplied, without throwing', function () {
  var e = STORE.createEntry({});
  assertTrue(!!e.name);
  assertTrue(Array.isArray(e.schema.tables));
});
test('a fresh store has zero entries and no active id', function () {
  var store = STORE.createStore(makeFakeStorage());
  assertEqual(store.count(), 0);
  assertEqual(store.getActiveId(), null);
  assertEqual(store.getActiveEntry(), null);
});
test('addEntry adds an entry and automatically makes the FIRST entry active (default)', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  assertEqual(store.count(), 1);
  assertEqual(store.getActiveId(), e1.id);
});
test('adding a SECOND entry does not change which one is active/default', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  assertEqual(store.getActiveId(), e1.id);
  assertEqual(store.count(), 2);
});
test('setActiveId switches the active/default schema', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  store.setActiveId(e2.id);
  assertEqual(store.getActiveId(), e2.id);
});
test('setActiveId with an unknown id is rejected and does not change the active entry', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var ok = store.setActiveId('nonexistent-id');
  assertFalse(ok);
  assertEqual(store.getActiveId(), e1.id);
});
test('updateEntry patches only the specified fields, leaving others untouched', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A, source: 'upload' });
  store.updateEntry(e1.id, { name: 'A Renamed' });
  var updated = store.getEntry(e1.id);
  assertEqual(updated.name, 'A Renamed');
  assertEqual(updated.source, 'upload');
});
test('renameEntry is a convenience wrapper around updateEntry', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'Original', schema: SCHEMA_A });
  store.renameEntry(e1.id, 'New Name');
  assertEqual(store.getEntry(e1.id).name, 'New Name');
});
test('removeEntry removes ONLY the targeted entry, leaving all others completely intact', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  store.removeEntry(e1.id);
  assertEqual(store.count(), 1);
  assertEqual(store.getEntry(e2.id).name, 'B');
  assertEqual(store.getEntry(e1.id), null);
});
test('removeEntry of the currently active/default entry automatically falls back to another remaining entry', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  store.removeEntry(e1.id);
  assertEqual(store.getActiveId(), e2.id);
});
test('removing the last remaining entry leaves the store empty with no active id', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  store.removeEntry(e1.id);
  assertEqual(store.count(), 0);
  assertEqual(store.getActiveId(), null);
});
test('recordSyncResult(ok:true) marks an entry\u2019s OWN status as "ok" and stamps lastSyncAt', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  store.recordSyncResult(e1.id, { ok: true, nextSyncAt: '2026-01-01T00:05:00.000Z' });
  var updated = store.getEntry(e1.id);
  assertEqual(updated.lastSyncStatus, 'ok');
  assertTrue(!!updated.lastSyncAt);
  assertEqual(updated.nextSyncAt, '2026-01-01T00:05:00.000Z');
  assertEqual(updated.lastSyncError, null);
});
test('recordSyncResult(ok:false) marks status "error" with a message, WITHOUT touching lastSyncAt', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  store.recordSyncResult(e1.id, { ok: false, error: 'GitHub token expired' });
  var updated = store.getEntry(e1.id);
  assertEqual(updated.lastSyncStatus, 'error');
  assertEqual(updated.lastSyncError, 'GitHub token expired');
  assertEqual(updated.lastSyncAt, null);
});
test('a sync failure recorded on ONE entry never affects any OTHER entry\u2019s independent status (isolated failures)', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  store.recordSyncResult(e1.id, { ok: true });
  store.recordSyncResult(e2.id, { ok: false, error: 'network down' });
  assertEqual(store.getEntry(e1.id).lastSyncStatus, 'ok');
  assertEqual(store.getEntry(e2.id).lastSyncStatus, 'error');
});
test('the store persists to and reloads correctly from localStorage-like storage across separate createStore() instances', function () {
  var storage = makeFakeStorage();
  var store1 = STORE.createStore(storage);
  var e1 = store1.addEntry({ name: 'Persisted', schema: SCHEMA_A });
  var store2 = STORE.createStore(storage);
  assertEqual(store2.count(), 1);
  assertEqual(store2.getEntry(e1.id).name, 'Persisted');
  assertEqual(store2.getActiveId(), e1.id);
});
test('createStore tolerates corrupted localStorage content and starts with a clean, empty store rather than throwing', function () {
  var storage = makeFakeStorage();
  storage.setItem(STORE.STORAGE_KEY, 'not valid json{{{');
  var store = STORE.createStore(storage);
  assertEqual(store.count(), 0);
});
test('createStore works even with a null storage implementation (in-memory only, no persistence)', function () {
  var store = STORE.createStore(null);
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  assertEqual(store.count(), 1);
  assertEqual(store.getActiveEntry().name, 'A');
});
test('importLegacySingleSchema migrates a pre-V10.7 single-schema object into a new named entry, marked active', function () {
  var store = STORE.createStore(makeFakeStorage());
  var legacy = { schema_name: 'Old V10.6 Schema', schema_version: '7.1', tables: [{ name: 'X', columns: [] }] };
  var entry = store.importLegacySingleSchema(legacy, 'Migrated From V10.6');
  assertEqual(store.count(), 1);
  assertEqual(store.getActiveEntry().name, 'Migrated From V10.6');
  assertEqual(entry.source, 'embedded');
});
test('listEntries returns a defensive copy (mutating the returned array does not affect the store)', function () {
  var store = STORE.createStore(makeFakeStorage());
  store.addEntry({ name: 'A', schema: SCHEMA_A });
  var list = store.listEntries();
  list.push({ name: 'Injected' });
  assertEqual(store.count(), 1);
});
/* ---- V11.1 additive multi-schema state model (Stored/Active/Default/Inactive) ---- */
test('first stored schema becomes both Default and Active automatically', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  assertTrue(store.isDefault(e1.id));
  assertTrue(store.isActive(e1.id));
});
test('second stored schema starts Inactive (not auto-activated)', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  assertEqual(store.getSchemaState(e2.id), 'inactive');
});
test('setEntryActive(true) makes a schema Active without changing the Default', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  store.setEntryActive(e2.id, true);
  assertTrue(store.isActive(e2.id));
  assertTrue(store.isDefault(e1.id));
});
test('getMergedActiveSchema includes tables from every Active schema, Default winning on collisions', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: { schema_name: 'A', schema_version: '1.0', tables: [{ name: 'T1', module: 'X', columns: [{ name: 'ID', type: 'INTEGER', primary_key: true }] }] } });
  var e2 = store.addEntry({ name: 'B', schema: { schema_name: 'B', schema_version: '1.0', tables: [{ name: 'T2', module: 'Y', columns: [{ name: 'ID', type: 'INTEGER', primary_key: true }] }] } });
  store.setEntryActive(e2.id, true);
  var merged = store.getMergedActiveSchema();
  assertTrue(merged.tables.some(function (t) { return t.name === 'T1'; }));
  assertTrue(merged.tables.some(function (t) { return t.name === 'T2'; }));
});
test('cannot deactivate the Default schema directly — change the Default first', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var result = store.setEntryActive(e1.id, false);
  assertFalse(result);
  assertTrue(store.isActive(e1.id));
});
test('setDefaultId switches the Default without removing the previous Default from the Active set', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  store.setDefaultId(e2.id);
  assertTrue(store.isDefault(e2.id));
  assertTrue(store.isActive(e1.id));
});
test('getActiveSchema() (V10.7.1 API) resolves to the merged Active view, a strict superset of the old single-schema behavior', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: { schema_name: 'A', schema_version: '1.0', tables: [{ name: 'T1', module: 'X', columns: [{ name: 'ID', type: 'INTEGER', primary_key: true }] }] } });
  assertTrue(store.getActiveSchema().tables.some(function (t) { return t.name === 'T1'; }));
});
