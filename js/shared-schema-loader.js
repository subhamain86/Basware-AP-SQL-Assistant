/* shared-schema-loader.js — "Live Shared Schema": on every page load, do a plain,
   unauthenticated check for a schema file at a well-known relative path. If found,
   every Query Builder automatically uses it (folded into the Default schema). */
(function (root) {
  'use strict';

  var DEFAULT_PATH = 'schema/shared-schema.json';

  function checkNow(path, fetchImpl) {
    fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    path = path || DEFAULT_PATH;
    if (!fetchImpl) return Promise.resolve({ found: false, reason: 'No fetch implementation available in this environment.' });
    return fetchImpl(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) return { found: false, reason: 'No file found at ' + path + ' (HTTP ' + res.status + ').' };
      return res.json().then(function (data) { return { found: true, schema: data, path: path }; });
    }).catch(function (err) {
      return { found: false, reason: 'Could not read ' + path + ': ' + (err && err.message ? err.message : 'unknown error') + '.' };
    });
  }

  var API = { DEFAULT_PATH: DEFAULT_PATH, checkNow: checkNow };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SHARED_SCHEMA_LOADER = API;
})(typeof window !== 'undefined' ? window : this);
