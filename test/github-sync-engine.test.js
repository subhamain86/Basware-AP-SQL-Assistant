'use strict';
var path = require('path');
var G = require(path.join(__dirname, '..', 'js', 'github-sync-engine.js'));
function fakeResponse(status, jsonBody) { return { status: status, ok: status >= 200 && status < 300, json: function () { return Promise.resolve(jsonBody); } }; }
function makeFakeGitHubFetch(opts) {
  opts = opts || {};
  var store = { content: opts.initialContent || null, sha: opts.initialSha || null };
  var forcedStatus = null;
  function fetchImpl(url, init) {
    if (forcedStatus != null) { var s = forcedStatus; forcedStatus = null; return Promise.resolve(fakeResponse(s, {})); }
    var method = (init && init.method) || 'GET';
    if (method === 'GET') {
      if (store.content == null) return Promise.resolve(fakeResponse(404, {}));
      return Promise.resolve(fakeResponse(200, { content: G.utf8ToBase64(store.content), sha: store.sha, encoding: 'base64' }));
    }
    if (method === 'PUT') {
      var body = JSON.parse(init.body);
      if (store.content != null && body.sha !== store.sha) return Promise.resolve(fakeResponse(409, {}));
      var newSha = 'sha-' + Math.random().toString(36).slice(2);
      store.content = G.base64ToUtf8(body.content);
      store.sha = newSha;
      return Promise.resolve(fakeResponse(200, { content: { sha: newSha } }));
    }
    if (method === 'DELETE') {
      var delBody = JSON.parse(init.body);
      if (store.content == null) return Promise.resolve(fakeResponse(404, {}));
      if (delBody.sha !== store.sha) return Promise.resolve(fakeResponse(409, {}));
      store.content = null; store.sha = null;
      return Promise.resolve(fakeResponse(200, {}));
    }
    return Promise.resolve(fakeResponse(500, {}));
  }
  fetchImpl._store = store;
  fetchImpl._forceNextStatus = function (status) { forcedStatus = status; };
  return fetchImpl;
}
function makeFakeGitHubFetchCapturingAuth(opts) {
  opts = opts || {};
  var store = { content: opts.initialContent || null, sha: opts.initialSha || null };
  var lastAuthHeader = { seen: false, value: undefined };
  function fetchImpl(url, init) {
    if (((init && init.method) || 'GET') === 'GET') {
      lastAuthHeader.seen = !!(init && init.headers && Object.prototype.hasOwnProperty.call(init.headers, 'Authorization'));
      lastAuthHeader.value = init && init.headers ? init.headers.Authorization : undefined;
      if (fetchImpl._store.content == null) return Promise.resolve(fakeResponse(404, {}));
      return Promise.resolve(fakeResponse(200, { content: G.utf8ToBase64(fetchImpl._store.content), sha: fetchImpl._store.sha }));
    }
    return Promise.resolve(fakeResponse(500, {}));
  }
  fetchImpl._store = store;
  fetchImpl._lastAuthHeader = lastAuthHeader;
  return fetchImpl;
}
var VALID_CONFIG = { owner: 'acme-corp', repo: 'ap-sql-schema-store', path: 'ap-sql-assistant-schema.json', branch: 'main', token: 'ghp_faketoken123' };
test('base64EncodeBytes/base64DecodeToBytes round-trips arbitrary byte sequences', function () {
  var bytes = new Uint8Array([0, 1, 2, 254, 255, 128, 64, 32, 16, 8, 4, 2, 1]);
  var decoded = G.base64DecodeToBytes(G.base64EncodeBytes(bytes));
  assertEqual(Array.from(decoded), Array.from(bytes));
});
test('utf8ToBase64/base64ToUtf8 round-trips unicode text correctly', function () {
  var text = 'Alusta Single-Sign-On (déprécié) — 日本語テスト';
  assertEqual(G.base64ToUtf8(G.utf8ToBase64(text)), text);
});
test('isConfigComplete is true only when owner, repo, path, and token are all present', function () {
  assertTrue(G.isConfigComplete(VALID_CONFIG));
  assertFalse(G.isConfigComplete({ owner: 'x', repo: 'y', path: 'z.json' }));
});
test('normalizeBranch defaults to "main" when no branch is specified', function () {
  assertEqual(G.normalizeBranch(), 'main');
  assertEqual(G.normalizeBranch({ branch: 'develop' }), 'develop');
});
test('fetchRemoteSchema resolves {exists:false} for a 404', function () {
  var fetchImpl = makeFakeGitHubFetch({});
  return G.fetchRemoteSchema(VALID_CONFIG, fetchImpl).then(function (result) { assertEqual(result.exists, false); });
});
test('fetchRemoteSchema resolves the parsed schema and sha for a valid existing file', function () {
  var schemaJson = JSON.stringify({ schema_name: 'Test', tables: [{ name: 'T', columns: [{ name: 'C' }] }] });
  var fetchImpl = makeFakeGitHubFetch({ initialContent: schemaJson, initialSha: 'abc123' });
  return G.fetchRemoteSchema(VALID_CONFIG, fetchImpl).then(function (result) {
    assertTrue(result.exists);
    assertEqual(result.schema.schema_name, 'Test');
    assertEqual(result.sha, 'abc123');
  });
});
test('fetchRemoteSchema rejects with a clear message on 401', function () {
  var fetchImpl = makeFakeGitHubFetch({ initialContent: '', initialSha: 's' });
  fetchImpl._forceNextStatus(401);
  return G.fetchRemoteSchema(VALID_CONFIG, fetchImpl).then(function () { throw new Error('expected rejection'); }, function (err) { assertIncludes(err.message, 'Unauthorized'); });
});
test('pushSchemaToGitHub creates a brand-new file and returns the new sha', function () {
  var fetchImpl = makeFakeGitHubFetch({});
  return G.pushSchemaToGitHub(VALID_CONFIG, { schema_name: 'New', tables: [] }, null, fetchImpl).then(function (result) {
    assertTrue(!!result.sha);
    assertEqual(JSON.parse(fetchImpl._store.content).schema_name, 'New');
  });
});
test('pushSchemaToGitHub rejects with a conflict flag when the supplied sha no longer matches (409)', function () {
  var fetchImpl = makeFakeGitHubFetch({ initialContent: JSON.stringify({ schema_name: 'Old', tables: [] }), initialSha: 'sha-current' });
  return G.pushSchemaToGitHub(VALID_CONFIG, { schema_name: 'MyEdit', tables: [] }, 'sha-stale', fetchImpl).then(function () { throw new Error('expected rejection'); }, function (err) {
    assertTrue(err.conflict === true);
  });
});
test('deleteRemoteFile successfully removes an existing file with the correct current sha', function () {
  var fetchImpl = makeFakeGitHubFetch({ initialContent: JSON.stringify({ schema_name: 'ToDelete', tables: [] }), initialSha: 'sha-1' });
  return G.deleteRemoteFile(VALID_CONFIG, 'sha-1', fetchImpl).then(function (result) {
    assertTrue(result.deleted);
    assertEqual(fetchImpl._store.content, null);
  });
});
test('describeGitHubSyncStatus: unconfigured/connected/conflict/error', function () {
  assertEqual(G.describeGitHubSyncStatus().level, 'unconfigured');
  assertEqual(G.describeGitHubSyncStatus({ configured: true, owner: 'acme', repo: 'r', path: 'p.json' }).level, 'connected');
  assertEqual(G.describeGitHubSyncStatus({ configured: true, conflict: true }).level, 'conflict');
  assertEqual(G.describeGitHubSyncStatus({ configured: true, error: 'oops' }).level, 'error');
});
/* =====================================================================
   V10.7.1 VAULT AUTHENTICATION BUG FIX — dedicated regression coverage.
   The original bug: the vault-unlock lookup hardcoded the literal
   string 'unauthenticated-lookup' as the Bearer token, which GitHub
   always rejected with 401, regardless of what (if anything) the user
   had typed into the real Token field. These tests prove the fix.
   ===================================================================== */
test('isReadConfigComplete is TRUE even with no token at all (only owner/repo/path required for reads)', function () {
  assertTrue(G.isReadConfigComplete({ owner: 'acme', repo: 'repo', path: 'schema/x.json' }));
  assertTrue(G.isReadConfigComplete({ owner: 'acme', repo: 'repo', path: 'schema/x.json', token: 'real-token' }));
});
test('isReadConfigComplete is FALSE when owner, repo, or path is missing, regardless of token', function () {
  assertFalse(G.isReadConfigComplete({ repo: 'repo', path: 'x.json' }));
  assertFalse(G.isReadConfigComplete({ owner: 'acme', path: 'x.json' }));
  assertFalse(G.isReadConfigComplete({ owner: 'acme', repo: 'repo' }));
});
test('authHeadersOptional omits the Authorization header entirely when no token is present (true anonymous request)', function () {
  var headers = G.authHeadersOptional({ owner: 'acme', repo: 'repo', path: 'x.json' });
  assertFalse('Authorization' in headers);
  assertTrue('Accept' in headers);
});
test('authHeadersOptional includes a real Authorization header when a real token IS present', function () {
  var headers = G.authHeadersOptional({ owner: 'acme', repo: 'repo', path: 'x.json', token: 'ghp_realTokenValue' });
  assertEqual(headers.Authorization, 'Bearer ghp_realTokenValue');
});
test('authHeadersOptional NEVER fabricates a placeholder token string anywhere (the root cause of the original bug)', function () {
  var headers1 = G.authHeadersOptional({ owner: 'acme', repo: 'repo', path: 'x.json' });
  var headers2 = G.authHeadersOptional();
  assertFalse(JSON.stringify(headers1).indexOf('unauthenticated-lookup') !== -1);
  assertFalse(JSON.stringify(headers2).indexOf('unauthenticated-lookup') !== -1);
});
test('fetchRawJsonFile succeeds with NO token at all (anonymous read of a "public" repo) — this used to always 401', function () {
  var fetchImpl = makeFakeGitHubFetchCapturingAuth({ initialContent: JSON.stringify({ type: 'ap-sql-assistant-credential-vault', v: 1, salt: 'AAAA', iv: 'BBBB', ciphertext: 'CCCC' }), initialSha: 'vault-sha' });
  return G.fetchRawJsonFile({ owner: 'acme', repo: 'repo', path: 'vault.json' }, fetchImpl).then(function (result) {
    assertTrue(result.exists);
    assertEqual(result.content.type, 'ap-sql-assistant-credential-vault');
    assertFalse(fetchImpl._lastAuthHeader.seen, 'no Authorization header should have been sent for an anonymous lookup');
  });
});
test('fetchRawJsonFile sends the REAL typed token (never a fabricated one) when the caller supplies one', function () {
  var fetchImpl = makeFakeGitHubFetchCapturingAuth({ initialContent: JSON.stringify({ type: 'ap-sql-assistant-credential-vault' }), initialSha: 's' });
  return G.fetchRawJsonFile({ owner: 'acme', repo: 'repo', path: 'vault.json', token: 'ghp_myRealBootstrapToken' }, fetchImpl).then(function () {
    assertTrue(fetchImpl._lastAuthHeader.seen);
    assertEqual(fetchImpl._lastAuthHeader.value, 'Bearer ghp_myRealBootstrapToken');
  });
});
test('fetchRawJsonFile resolves {exists:false} for a 404 (no vault file published yet)', function () {
  var fetchImpl = makeFakeGitHubFetch({});
  return G.fetchRawJsonFile(VALID_CONFIG, fetchImpl).then(function (result) { assertEqual(result.exists, false); });
});
test('fetchRawJsonFile resolves arbitrary non-schema JSON (e.g. a credential vault shape) WITHOUT requiring a .tables array', function () {
  var vaultShape = { type: 'ap-sql-assistant-credential-vault', v: 1, salt: 'AAAA', iv: 'BBBB', ciphertext: 'CCCC' };
  var fetchImpl = makeFakeGitHubFetch({ initialContent: JSON.stringify(vaultShape), initialSha: 'vault-sha-1' });
  return G.fetchRawJsonFile(VALID_CONFIG, fetchImpl).then(function (result) {
    assertTrue(result.exists);
    assertEqual(result.content.type, 'ap-sql-assistant-credential-vault');
    assertEqual(result.sha, 'vault-sha-1');
  });
});
test('fetchRawJsonFile rejects when owner/repo/path is incomplete, without making any network call', function () {
  var fetchImpl = makeFakeGitHubFetch({});
  return G.fetchRawJsonFile({ owner: 'x' }, fetchImpl).then(function () { throw new Error('expected rejection'); }, function (err) { assertIncludes(err.message, 'not fully configured'); });
});
test('end-to-end (the exact reported failure scenario, now fixed): publish a vault with a real token, then unlock it with NO token at all, succeeding via anonymous read', function () {
  var fetchImpl = makeFakeGitHubFetchCapturingAuth({});
  var vaultShape = { type: 'ap-sql-assistant-credential-vault', v: 1, salt: 'ZZZZ', iv: 'YYYY', ciphertext: 'XXXX' };
  fetchImpl._store = { content: JSON.stringify(vaultShape), sha: 'sha-published' };
  return G.fetchRawJsonFile({ owner: 'acme-corp', repo: 'ap-sql-schema-store', path: 'schema/shared-schema.vault.json' }, fetchImpl).then(function (result) {
    assertTrue(result.exists, 'the vault lookup must succeed without ever needing a hardcoded or fabricated token');
    assertEqual(result.content.ciphertext, 'XXXX');
  });
});
