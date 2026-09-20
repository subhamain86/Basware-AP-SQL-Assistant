(function (root) {
  'use strict';

  var DEFAULT_SHARED_SCHEMA_PATH = 'schema/shared-schema.json';

  function buildFetchUrl(basePath) {
    var path = basePath || DEFAULT_SHARED_SCHEMA_PATH;
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    return path + sep + 't=' + Date.now();
  }

  function fetchSharedSchema(basePath, fetchImpl) {
    fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error('The fetch API is not available in this environment.'));
    var url = buildFetchUrl(basePath);
    return fetchImpl(url, { cache: 'no-store' }).then(function (res) {
      if (res.status === 404) return { found: false };
      if (!res.ok) return Promise.reject(new Error('The shared schema file could not be read (HTTP ' + res.status + ').'));
      return res.text().then(function (rawText) {
        var parsed;
        try { parsed = JSON.parse(rawText); } catch (e) { return Promise.reject(new Error('The shared schema file does not contain valid JSON.')); }
        var tables = Array.isArray(parsed) ? parsed : parsed.tables;
        if (!Array.isArray(tables)) return Promise.reject(new Error('The shared schema file does not look like a valid AP-SQL Assistant schema.')); 
        return { found: true, schema: parsed, rawText: rawText };
      });
    }, function (err) { return Promise.reject(new Error('Could not reach the shared schema file (' + (err && err.message ? err.message : 'network error') + ').')); });
  }

  function describeSharedSchemaStatus(state) {
    state = state || {};
    if (!state.checked) return { level: 'checking', text: 'Checking for a shared schema at "' + (state.path || DEFAULT_SHARED_SCHEMA_PATH) + '"\u2026' };
    if (state.error) return { level: 'error', text: 'Could not check for a shared schema: ' + state.error };
    if (!state.found) return { level: 'notfound', text: 'No shared schema was found at "' + (state.path || DEFAULT_SHARED_SCHEMA_PATH) + '" (relative to this page). Using the schema already saved in this browser instead. If your organization publishes a shared schema at this location, every device and browser will automatically pick it up from here \u2014 no setup needed.' };
    return { level: 'live', text: 'Using the live shared schema published at "' + (state.path || DEFAULT_SHARED_SCHEMA_PATH) + '". This works automatically on every device and browser that opens this app \u2014 no setup needed.' };
  }

  var API = {
    DEFAULT_SHARED_SCHEMA_PATH: DEFAULT_SHARED_SCHEMA_PATH,
    buildFetchUrl: buildFetchUrl,
    fetchSharedSchema: fetchSharedSchema,
    describeSharedSchemaStatus: describeSharedSchemaStatus
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SHARED_SCHEMA = API;
})(typeof window !== 'undefined' ? window : this);
