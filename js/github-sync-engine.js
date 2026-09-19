(function (root) {
  'use strict';

  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64EncodeBytes(bytes) {
    var out = ''; var i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64_CHARS[(n >>> 18) & 63] + B64_CHARS[(n >>> 12) & 63] + B64_CHARS[(n >>> 6) & 63] + B64_CHARS[n & 63];
    }
    var remaining = bytes.length - i;
    if (remaining === 1) {
      var n1 = bytes[i] << 16;
      out += B64_CHARS[(n1 >>> 18) & 63] + B64_CHARS[(n1 >>> 12) & 63] + '==';
    } else if (remaining === 2) {
      var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64_CHARS[(n2 >>> 18) & 63] + B64_CHARS[(n2 >>> 12) & 63] + B64_CHARS[(n2 >>> 6) & 63] + '=';
    }
    return out;
  }
  function base64DecodeToBytes(b64) {
    var clean = String(b64 || '').replace(/[\r\n\s]/g, '');
    var lookup = {};
    for (var i = 0; i < B64_CHARS.length; i++) lookup[B64_CHARS[i]] = i;
    var cleanNoPad = clean.replace(/=+$/, '');
    var byteLen = Math.floor((cleanNoPad.length * 6) / 8);
    var bytes = new Uint8Array(byteLen);
    var bitBuffer = 0, bitCount = 0, byteIdx = 0;
    for (var j = 0; j < cleanNoPad.length; j++) {
      var val = lookup[cleanNoPad[j]];
      if (val === undefined) continue;
      bitBuffer = (bitBuffer << 6) | val;
      bitCount += 6;
      if (bitCount >= 8) {
        bitCount -= 8;
        bytes[byteIdx++] = (bitBuffer >>> bitCount) & 0xFF;
      }
    }
    return bytes;
  }
  function utf8ToBase64(str) { return base64EncodeBytes(new TextEncoder().encode(String(str))); }
  function base64ToUtf8(b64) { return new TextDecoder().decode(base64DecodeToBytes(b64)); }

  var CONFIG_STORAGE_KEY = 'ap_sql_github_sync_v1';
  function createConfigStore(storageImpl) {
    storageImpl = storageImpl || (typeof localStorage !== 'undefined' ? localStorage : null);
    function saveConfig(config) {
      if (!storageImpl) return;
      storageImpl.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    }
    function loadConfig() {
      if (!storageImpl) return null;
      var raw = storageImpl.getItem(CONFIG_STORAGE_KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
    function clearConfig() {
      if (!storageImpl) return;
      if (typeof storageImpl.removeItem === 'function') storageImpl.removeItem(CONFIG_STORAGE_KEY);
      else storageImpl.setItem(CONFIG_STORAGE_KEY, '');
    }
    return { saveConfig: saveConfig, loadConfig: loadConfig, clearConfig: clearConfig };
  }

  function isConfigComplete(config) {
    return !!(config && config.owner && config.repo && config.path && config.token);
  }
  function normalizeBranch(config) { return (config && config.branch) ? config.branch : 'main'; }

  function buildContentsUrl(config) {
    var branch = normalizeBranch(config);
    return 'https://api.github.com/repos/' + encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo) +
      '/contents/' + config.path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(branch);
  }
  function buildContentsWriteUrl(config) {
    return 'https://api.github.com/repos/' + encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo) +
      '/contents/' + config.path.split('/').map(encodeURIComponent).join('/');
  }
  function authHeaders(config) {
    return { Authorization: 'Bearer ' + config.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }

  function fetchRemoteSchema(config, fetchImpl) {
    fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error('The fetch API is not available in this environment.'));
    if (!isConfigComplete(config)) return Promise.reject(new Error('GitHub sync is not fully configured (repository owner, name, file path, and a Personal Access Token are all required).'));
    return fetchImpl(buildContentsUrl(config), { headers: authHeaders(config) }).then(function (res) {
      if (res.status === 404) return { exists: false };
      if (res.status === 401) return Promise.reject(new Error('GitHub rejected the Personal Access Token (401 Unauthorized). Double-check the token and that it hasn\u2019t expired.'));
      if (res.status === 403) return Promise.reject(new Error('GitHub denied access to this repository (403 Forbidden). The token may be missing the required Contents permission, or you may have hit a rate limit.'));
      if (!res.ok) return Promise.reject(new Error('GitHub returned an unexpected error (HTTP ' + res.status + ') while reading the schema file.'));
      return res.json().then(function (body) {
        if (Array.isArray(body)) return Promise.reject(new Error('The configured path points to a folder, not a file. Please point to a specific .json file.'));
        var decoded;
        try { decoded = base64ToUtf8(body.content); } catch (e) { return Promise.reject(new Error('Could not decode the contents of the linked schema file.')); }
        var parsed;
        try { parsed = JSON.parse(decoded); } catch (e) { return Promise.reject(new Error('The linked schema file does not contain valid JSON.')); }
        var tables = Array.isArray(parsed) ? parsed : parsed.tables;
        if (!Array.isArray(tables)) return Promise.reject(new Error('The linked file does not look like a valid AP-SQL Assistant schema.'));
        return { exists: true, schema: parsed, sha: body.sha };
      });
    }, function () { return Promise.reject(new Error('Could not reach GitHub (network error). Check your internet connection and try again.')); });
  }

  function pushSchemaToGitHub(config, schemaObj, sha, fetchImpl) {
    fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error('The fetch API is not available in this environment.'));
    if (!isConfigComplete(config)) return Promise.reject(new Error('GitHub sync is not fully configured (repository owner, name, file path, and a Personal Access Token are all required).'));
    var body = {
      message: 'Update AP-SQL Assistant schema (' + new Date().toISOString() + ')',
      content: utf8ToBase64(JSON.stringify(schemaObj, null, 2)),
      branch: normalizeBranch(config)
    };
    if (sha) body.sha = sha;
    return fetchImpl(buildContentsWriteUrl(config), {
      method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(config)), body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 409) { var err = new Error('Someone else updated the shared schema file since this browser last checked it.'); err.conflict = true; return Promise.reject(err); }
      if (res.status === 401) return Promise.reject(new Error('GitHub rejected the Personal Access Token (401 Unauthorized).'));
      if (res.status === 403) return Promise.reject(new Error('GitHub denied this write (403 Forbidden). The token may be missing the required Contents: Read and write permission.'));
      if (res.status === 422) return Promise.reject(new Error('GitHub rejected this update (422) \u2014 the repository, branch, or file path may not be valid.'));
      if (res.status !== 200 && res.status !== 201) return Promise.reject(new Error('GitHub returned an unexpected error (HTTP ' + res.status + ') while writing the schema file.'));
      return res.json().then(function (respBody) { return { sha: respBody.content && respBody.content.sha }; });
    }, function () { return Promise.reject(new Error('Could not reach GitHub (network error). Check your internet connection and try again.')); });
  }

  function deleteRemoteFile(config, sha, fetchImpl) {
    fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error('The fetch API is not available in this environment.'));
    if (!isConfigComplete(config)) return Promise.reject(new Error('GitHub sync is not fully configured (repository owner, name, file path, and a Personal Access Token are all required).'));
    if (!sha) return Promise.reject(new Error('Cannot delete the shared schema file without first knowing its current version (sha). Try checking/syncing first.'));
    var body = { message: 'Delete AP-SQL Assistant shared schema (' + new Date().toISOString() + ')', sha: sha, branch: normalizeBranch(config) };
    return fetchImpl(buildContentsWriteUrl(config), {
      method: 'DELETE', headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(config)), body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 409) { var err = new Error('Someone else updated the shared schema file since this browser last checked it, so it was not deleted.'); err.conflict = true; return Promise.reject(err); }
      if (res.status === 404) { var err2 = new Error('The shared schema file no longer exists at that location (it may already have been deleted).'); err2.conflict = true; return Promise.reject(err2); }
      if (res.status === 401) return Promise.reject(new Error('GitHub rejected the Personal Access Token (401 Unauthorized).'));
      if (res.status === 403) return Promise.reject(new Error('GitHub denied this delete (403 Forbidden). The token may be missing the required Contents: Read and write permission.'));
      if (res.status === 422) return Promise.reject(new Error('GitHub rejected this delete (422) \u2014 the repository, branch, or file path may not be valid.'));
      if (res.status !== 200) return Promise.reject(new Error('GitHub returned an unexpected error (HTTP ' + res.status + ') while deleting the shared schema file.'));
      return { deleted: true };
    }, function () { return Promise.reject(new Error('Could not reach GitHub (network error). Check your internet connection and try again.')); });
  }

  /**
   * fetchRawJsonFile(config, fetchImpl) — V10.7. Like fetchRemoteSchema,
   * but WITHOUT the "must look like an AP-SQL Assistant schema" (i.e.
   * must have a `.tables` array) validation. This is used for
   * non-schema JSON files stored in the same repository via the same
   * Contents API — specifically, the encrypted credential vault blob,
   * whose shape (`{ type, v, salt, iv, ciphertext }`) is intentionally
   * quite different from a schema file and would always fail
   * fetchRemoteSchema's schema-shape check.
   */
  function fetchRawJsonFile(config, fetchImpl) {
    fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error('The fetch API is not available in this environment.'));
    if (!isConfigComplete(config)) return Promise.reject(new Error('GitHub sync is not fully configured (repository owner, name, file path, and a Personal Access Token are all required).'));
    return fetchImpl(buildContentsUrl(config), { headers: authHeaders(config) }).then(function (res) {
      if (res.status === 404) return { exists: false };
      if (res.status === 401) return Promise.reject(new Error('GitHub rejected the Personal Access Token (401 Unauthorized). Double-check the token and that it hasn\u2019t expired.'));
      if (res.status === 403) return Promise.reject(new Error('GitHub denied access to this repository (403 Forbidden). The token may be missing the required Contents permission, or you may have hit a rate limit.'));
      if (!res.ok) return Promise.reject(new Error('GitHub returned an unexpected error (HTTP ' + res.status + ') while reading the file.'));
      return res.json().then(function (body) {
        if (Array.isArray(body)) return Promise.reject(new Error('The configured path points to a folder, not a file. Please point to a specific file.'));
        var decoded;
        try { decoded = base64ToUtf8(body.content); } catch (e) { return Promise.reject(new Error('Could not decode the contents of the linked file.')); }
        var parsed;
        try { parsed = JSON.parse(decoded); } catch (e) { return Promise.reject(new Error('The linked file does not contain valid JSON.')); }
        return { exists: true, content: parsed, sha: body.sha };
      });
    }, function () { return Promise.reject(new Error('Could not reach GitHub (network error). Check your internet connection and try again.')); });
  }

  function describeGitHubSyncStatus(state) {
    state = state || {};
    if (state.error) return { level: 'error', text: state.error };
    if (!state.configured) return { level: 'unconfigured', text: 'Not set up yet. Enter your repository details and a Personal Access Token below, then click Connect to start syncing the schema through GitHub \u2014 this works in any browser, which is ideal when this app itself is hosted on GitHub Pages.' };
    if (state.conflict) return { level: 'conflict', text: 'Someone else updated the shared schema file on GitHub since this browser last checked it. Click "Sync Now" to fetch the latest version.' };
    return { level: 'connected', text: 'Connected to ' + state.owner + '/' + state.repo + ' \u2014 ' + state.path + ' (branch: ' + (state.branch || 'main') + '). Every Apply / Delete / Save Relationship action also updates this file, and this browser automatically checks it for changes made elsewhere.' };
  }

  var API = {
    base64EncodeBytes: base64EncodeBytes, base64DecodeToBytes: base64DecodeToBytes,
    utf8ToBase64: utf8ToBase64, base64ToUtf8: base64ToUtf8,
    createConfigStore: createConfigStore, isConfigComplete: isConfigComplete, normalizeBranch: normalizeBranch,
    buildContentsUrl: buildContentsUrl, buildContentsWriteUrl: buildContentsWriteUrl,
    fetchRemoteSchema: fetchRemoteSchema, pushSchemaToGitHub: pushSchemaToGitHub, deleteRemoteFile: deleteRemoteFile,
    fetchRawJsonFile: fetchRawJsonFile,
    describeGitHubSyncStatus: describeGitHubSyncStatus
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_GITHUB_SYNC = API;
})(typeof window !== 'undefined' ? window : this);
