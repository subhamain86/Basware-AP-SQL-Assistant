/* github-sync-engine.js — GitHub-hosted schema sync (read + optional authenticated write).
   Preserves the V10.7.1 "anonymous-read fix": reading a public schema file never requires
   a token, so Live Shared Schema / GitHub Pages consumers work with zero setup. A token is
   only required to *publish* (write) an update back to the repository. */
(function (root) {
  'use strict';

  function isReadConfigComplete(cfg) { return !!(cfg && cfg.owner && cfg.repo && cfg.path); }

  function authHeadersOptional(cfg) {
    var headers = { Accept: 'application/vnd.github+json' };
    if (cfg && cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    return headers;
  }

  function rawUrl(cfg) {
    var branch = cfg.branch || 'main';
    return 'https://raw.githubusercontent.com/' + cfg.owner + '/' + cfg.repo + '/' + branch + '/' + cfg.path;
  }
  function contentsApiUrl(cfg) {
    return 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + cfg.path + (cfg.branch ? '?ref=' + cfg.branch : '');
  }

  // Anonymous, unauthenticated read of the raw file — works even with no token configured.
  function fetchSchemaAnonymous(cfg, fetchImpl) {
    fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error('No fetch implementation available.'));
    if (!isReadConfigComplete(cfg)) return Promise.reject(new Error('GitHub sync is not fully configured (owner/repo/path required).'));
    return fetchImpl(rawUrl(cfg), { headers: authHeadersOptional({}) }).then(function (res) {
      if (!res.ok) throw new Error('GitHub returned ' + res.status + ' while fetching the schema file.');
      return res.json();
    });
  }

  // Authenticated write — requires a valid Personal Access Token with repo contents:write scope.
  function publishSchema(cfg, schemaObj, fetchImpl) {
    fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error('No fetch implementation available.'));
    if (!cfg.token) return Promise.reject(new Error('A Personal Access Token is required to publish (write) to GitHub.'));
    var body = JSON.stringify(schemaObj, null, 2);
    var b64 = (typeof Buffer !== 'undefined') ? Buffer.from(body, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(body)));
    // Look up current file SHA first (required by the Contents API for updates).
    return fetchImpl(contentsApiUrl(cfg), { headers: authHeadersOptional(cfg) }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (existing) {
      var payload = {
        message: 'Update schema via AP-SQL Assistant',
        content: b64,
        branch: cfg.branch || 'main'
      };
      if (existing && existing.sha) payload.sha = existing.sha;
      return fetchImpl(contentsApiUrl(cfg), {
        method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, authHeadersOptional(cfg)),
        body: JSON.stringify(payload)
      });
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (errBody) {
          var msg = (errBody && errBody.message) || (res.status + ' ' + res.statusText);
          if (res.status === 401) throw new Error('GitHub rejected the Personal Access Token (401 Unauthorized). Double-check the token and that it hasn\u2019t expired.');
          throw new Error('GitHub publish failed: ' + msg);
        });
      }
      return res.json();
    });
  }

  var API = {
    isReadConfigComplete: isReadConfigComplete, authHeadersOptional: authHeadersOptional,
    rawUrl: rawUrl, contentsApiUrl: contentsApiUrl,
    fetchSchemaAnonymous: fetchSchemaAnonymous, publishSchema: publishSchema
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_GITHUB_SYNC = API;
})(typeof window !== 'undefined' ? window : this);
