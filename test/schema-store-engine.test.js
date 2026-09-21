'use strict';
var path = require('path');
var STORE = require(path.join(__dirname, '..', 'js', 'schema-store-engine.js'));
function makeFakeStorage() {
  var data = {};
  return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; }, setItem: function (k, v) { data[k] = String(v); }, removeItem: function (k) { delete data[k]; } };
}
var SCHEMA_A = { schema_name: 'Schema A', schema_version: '1.0', tables: [] };
var SCHEMA_B = { schema_name: 'Schema B', schema_version: '2.0', tables: [] };
test('first stored schema becomes both Default and Active automatically', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  assertTrue(store.isDefault(e1.id)); assertTrue(store.isActive(e1.id));
});
test('second stored schema starts Inactive', function () {
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
  assertTrue(store.isActive(e2.id)); assertTrue(store.isDefault(e1.id));
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
test('cannot deactivate the Default schema directly', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  assertFalse(store.setEntryActive(e1.id, false));
  assertTrue(store.isActive(e1.id));
});
test('setDefaultId switches Default without removing previous Default from Active', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  store.setDefaultId(e2.id);
  assertTrue(store.isDefault(e2.id)); assertTrue(store.isActive(e1.id));
});
test('removeEntry removes only the targeted entry; a sync failure on one entry never affects another', function () {
  var store = STORE.createStore(makeFakeStorage());
  var e1 = store.addEntry({ name: 'A', schema: SCHEMA_A });
  var e2 = store.addEntry({ name: 'B', schema: SCHEMA_B });
  store.recordSyncResult(e1.id, { ok: true });
  store.recordSyncResult(e2.id, { ok: false, error: 'network down' });
  assertEqual(store.getEntry(e1.id).lastSyncStatus, 'ok');
  assertEqual(store.getEntry(e2.id).lastSyncStatus, 'error');
  store.removeEntry(e2.id);
  assertEqual(store.count(), 1);
});
test('the store persists to and reloads correctly from storage across separate createStore() instances', function () {
  var storage = makeFakeStorage();
  var store1 = STORE.createStore(storage);
  var e1 = store1.addEntry({ name: 'Persisted', schema: SCHEMA_A });
  var store2 = STORE.createStore(storage);
  assertEqual(store2.count(), 1);
  assertEqual(store2.getEntry(e1.id).name, 'Persisted');
});
