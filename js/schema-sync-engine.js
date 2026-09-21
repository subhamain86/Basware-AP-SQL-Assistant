(function (root) {
  'use strict';

  function isFileSystemAccessSupported(win) {
    win = win || (typeof window !== 'undefined' ? window : {});
    return typeof win.showSaveFilePicker === 'function' && typeof win.showOpenFilePicker === 'function';
  }

  function createHandleStore(idbFactory) {
    idbFactory = idbFactory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    var DB_NAME = 'ap_sql_sync_v1';
    var STORE_NAME = 'handles';
    var HANDLE_KEY = 'linkedSchemaFile';

    function openDb() {
      return new Promise(function (resolve, reject) {
        if (!idbFactory) { reject(new Error('IndexedDB is not available in this browser.')); return; }
        var req = idbFactory.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE_NAME); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject((req.error) || new Error('Failed to open IndexedDB.')); };
      });
    }
    function saveHandle(handle) {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    }
    function loadHandle() {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE_NAME, 'readonly');
          var req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { reject(req.error); };
        });
      });
    }
    function clearHandle() {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    }
    return { saveHandle: saveHandle, loadHandle: loadHandle, clearHandle: clearHandle };
  }

  function verifyPermission(handle, mode) {
    mode = mode || 'readwrite';
    var opts = { mode: mode };
    return handle.queryPermission(opts).then(function (status) {
      if (status === 'granted') return true;
      return handle.requestPermission(opts).then(function (status2) { return status2 === 'granted'; });
    });
  }
  function verifyPermissionSilent(handle, mode) {
    mode = mode || 'readwrite';
    return handle.queryPermission({ mode: mode }).then(function (status) { return status === 'granted'; });
  }

  function readSchemaFromHandle(handle) {
    return handle.getFile().then(function (file) {
      return file.text().then(function (text) {
        var parsed;
        try { parsed = JSON.parse(text); } catch (e) { throw new Error('The linked shared schema file does not contain valid JSON.'); }
        var tables = Array.isArray(parsed) ? parsed : parsed.tables;
        if (!Array.isArray(tables)) throw new Error('The linked shared schema file does not look like a valid AP-SQL Assistant schema.');
        return { schema: parsed, lastModified: file.lastModified };
      });
    });
  }
  function writeSchemaToHandle(handle, schemaObj) {
    return handle.createWritable().then(function (writable) {
      return writable.write(JSON.stringify(schemaObj, null, 2)).then(function () { return writable.close(); });
    });
  }

  function describeSyncStatus(state) {
    state = state || {};
    if (!state.supported) return { level: 'unsupported', text: 'This browser does not support linking a shared schema file (this needs Chrome, Edge, or another Chromium-based browser). The schema will stay saved only in this browser, as in previous versions.' };
    if (state.error) return { level: 'error', text: state.error };
    if (state.needsReconnect) return { level: 'reconnect', text: 'Linked to "' + (state.fileName || 'a shared file') + '", but this browser needs you to reconnect before it can read or write it again (this can happen after closing and reopening the browser).' };
    if (!state.linked) return { level: 'unlinked', text: 'Not linked to a shared file yet. The schema is currently saved only in this browser. Link a file in a shared location (SharePoint, OneDrive, or a network drive) to sync it across browsers, devices, and users.' };
    return { level: 'linked', text: 'Linked to "' + state.fileName + '". Every Apply / Delete / Save Relationship action also updates this shared file, and this browser automatically checks it for updates made elsewhere.' };
  }

  var API = {
    isFileSystemAccessSupported: isFileSystemAccessSupported,
    createHandleStore: createHandleStore,
    verifyPermission: verifyPermission,
    verifyPermissionSilent: verifyPermissionSilent,
    readSchemaFromHandle: readSchemaFromHandle,
    writeSchemaToHandle: writeSchemaToHandle,
    describeSyncStatus: describeSyncStatus
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SYNC = API;
})(typeof window !== 'undefined' ? window : this);
