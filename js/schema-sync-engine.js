/* schema-sync-engine.js — Cross-device schema sync "Option A": link the active/default
   schema to a single shared file (SharePoint library, synced OneDrive folder, or shared
   network drive) using the File System Access API in Chromium-based browsers. Reads/writes
   only that one file through the browser's own permission system. */
(function (root) {
  'use strict';

  function isSupported() { return typeof window !== 'undefined' && 'showOpenFilePicker' in window; }

  function createLinker(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    var handle = null; // FileSystemFileHandle (not persisted across reloads without IndexedDB;
                        // kept in-memory per session, matching browser storage constraints)

    function link() {
      if (!isSupported()) return Promise.reject(new Error('Cross-device schema sync requires a Chromium-based browser (Chrome or Edge).'));
      return window.showOpenFilePicker({
        types: [{ description: 'Schema JSON', accept: { 'application/json': ['.json'] } }]
      }).then(function (handles) { handle = handles[0]; return true; });
    }

    function isLinked() { return !!handle; }

    function readLinkedFile() {
      if (!handle) return Promise.reject(new Error('No linked file. Use Link File first.'));
      return handle.getFile().then(function (file) { return file.text(); }).then(function (text) { return JSON.parse(text); });
    }

    function writeLinkedFile(schemaObj) {
      if (!handle) return Promise.reject(new Error('No linked file. Use Link File first.'));
      return handle.requestPermission({ mode: 'readwrite' }).then(function (perm) {
        if (perm !== 'granted') throw new Error('Write permission to the linked file was not granted.');
        return handle.createWritable();
      }).then(function (writable) {
        return writable.write(JSON.stringify(schemaObj, null, 2)).then(function () { return writable.close(); });
      });
    }

    function unlink() { handle = null; }

    return { link: link, isLinked: isLinked, readLinkedFile: readLinkedFile, writeLinkedFile: writeLinkedFile, unlink: unlink };
  }

  var API = { isSupported: isSupported, createLinker: createLinker };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_SYNC = API;
})(typeof window !== 'undefined' ? window : this);
