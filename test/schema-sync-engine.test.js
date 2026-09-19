'use strict';
var path = require('path');
var SYNC = require(path.join(__dirname, '..', 'js', 'schema-sync-engine.js'));

function makeFakeIndexedDB() {
  var stores = {};
  return {
    open: function (dbName, version) {
      var req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, error: null };
      setTimeout(function () {
        var isNew = !stores[dbName];
        if (isNew) stores[dbName] = {};
        var db = {
          createObjectStore: function (storeName) { stores[dbName][storeName] = {}; },
          transaction: function (storeName, mode) {
            var tx = { oncomplete: null, onerror: null, error: null };
            var objectStoreApi = {
              put: function (value, key) { var putReq = { onsuccess: null, onerror: null }; setTimeout(function () { stores[dbName][storeName][key] = value; if (tx.oncomplete) tx.oncomplete(); if (putReq.onsuccess) putReq.onsuccess(); }, 0); return putReq; },
              get: function (key) { var getReq = { result: undefined, onsuccess: null, onerror: null }; setTimeout(function () { getReq.result = stores[dbName][storeName][key]; if (getReq.onsuccess) getReq.onsuccess(); }, 0); return getReq; },
              delete: function (key) { var delReq = { onsuccess: null, onerror: null }; setTimeout(function () { delete stores[dbName][storeName][key]; if (tx.oncomplete) tx.oncomplete(); if (delReq.onsuccess) delReq.onsuccess(); }, 0); return delReq; }
            };
            tx.objectStore = function () { return objectStoreApi; };
            return tx;
          }
        };
        if (isNew && req.onupgradeneeded) { req.result = db; req.onupgradeneeded(); }
        req.result = db;
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }
  };
}

test('reports supported when both picker functions exist on the window object', function () {
  assertTrue(SYNC.isFileSystemAccessSupported({ showSaveFilePicker: function () {}, showOpenFilePicker: function () {} }));
});
test('reports unsupported when either picker function is missing', function () {
  assertFalse(SYNC.isFileSystemAccessSupported({ showSaveFilePicker: function () {} }));
  assertFalse(SYNC.isFileSystemAccessSupported({}));
});
test('saveHandle then loadHandle round-trips the exact same handle object', function () {
  var store = SYNC.createHandleStore(makeFakeIndexedDB());
  var fakeHandle = { name: 'schema.json', __marker: 'abc123' };
  return store.saveHandle(fakeHandle).then(function () { return store.loadHandle(); }).then(function (h) {
    assertEqual(h.name, 'schema.json');
    assertEqual(h.__marker, 'abc123');
  });
});
test('readSchemaFromHandle parses a valid schema object with a tables array', function () {
  var handle = { getFile: function () { return Promise.resolve({ lastModified: 12345, text: function () { return Promise.resolve(JSON.stringify({ schema_name: 'X', tables: [{ name: 'T', columns: [] }] })); } }); } };
  return SYNC.readSchemaFromHandle(handle).then(function (result) {
    assertEqual(result.schema.schema_name, 'X');
    assertEqual(result.lastModified, 12345);
  });
});
test('readSchemaFromHandle rejects with a clear error on invalid JSON', function () {
  var handle = { getFile: function () { return Promise.resolve({ lastModified: 1, text: function () { return Promise.resolve('not json{{{'); } }); } };
  return SYNC.readSchemaFromHandle(handle).then(function () { throw new Error('expected rejection'); }, function (err) { assertIncludes(err.message, 'valid JSON'); });
});
test('describeSyncStatus: unsupported/unlinked/linked/error/reconnect states', function () {
  assertEqual(SYNC.describeSyncStatus({ supported: false }).level, 'unsupported');
  assertEqual(SYNC.describeSyncStatus({ supported: true, linked: false }).level, 'unlinked');
  assertEqual(SYNC.describeSyncStatus({ supported: true, linked: true, fileName: 'x.json' }).level, 'linked');
  assertEqual(SYNC.describeSyncStatus({ supported: true, error: 'oops' }).level, 'error');
  assertEqual(SYNC.describeSyncStatus({ supported: true, linked: true, needsReconnect: true }).level, 'reconnect');
});
