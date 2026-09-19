'use strict';
var path = require('path');
var G = require(path.join(__dirname, '..', 'js', 'github-sync-engine.js'));

function makeFakeGitHubFetch(opts) {
  opts = opts || {};
  var store = { content: opts.initialContent || null, sha: opts.initialSha || null };
  var forcedStatus = null;
  var calls = [];
  function fetchImpl(url, init) {
    calls.push({ url: url, init: init });
    if (forcedStatus != null) { var s = forcedStatus; forcedStatus = null; return Promise.resolve(fakeResponse(s, {})); }
    var method = (init && init.method) || 'GET';
    if (method === 'GET') {
      if (store.content == null) return Promise.resolve(fakeResponse(404, {}));
      return Promise.resolve(fakeResponse(200, { content: G.utf8ToBase64(store.content), sha: store.sha, encoding: 'base64' }));
    }
    if (method === 'PUT') {
      var body = JSON.parse(init.body);
      if (store.content != null && body.sha !== store.sha) return Promise.resolve(fakeResponse(409, {}));
      var newSha = 'sha-' + (calls.length);
      store.content = G.base64ToUtf8(body.content);
      store.sha = newSha;
      return Promise.resolve(fakeResponse(store.sha === newSha && calls.length === 1 ? 201 : 200, { content: { sha: newSha } }));
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
  function fakeResponse(status, jsonBody) { return { status: status, ok: status >= 200 && status < 300, json: function () { return Promise.resolve(jsonBody); } }; }
  fetchImpl._store = store; fetchImpl._calls = calls;
  fetchImpl._forceNextStatus = function (status) { forcedStatus = status; };
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
  assertEqual(G.normalizeBranch({}), 'main');
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
  var fetchImpl = makeFakeGitHubFetch({ initialContent: '{}', initialSha: 's' });
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
test('pushSchemaToGitHub rejects with {conflict:true} when the supplied sha no longer matches (409)', function () {
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
test('deleteRemoteFile rejects with {conflict:true} when the file was already changed (stale sha, 409)', function () {
  var fetchImpl = makeFakeGitHubFetch({ initialContent: JSON.stringify({ schema_name: 'X', tables: [] }), initialSha: 'sha-current' });
  return G.deleteRemoteFile(VALID_CONFIG, 'sha-stale', fetchImpl).then(function () { throw new Error('expected rejection'); }, function (err) { assertTrue(err.conflict === true); });
});
test('end-to-end: create, then read it back, then update it, then read the update back', function () {
  var fetchImpl = makeFakeGitHubFetch({});
  return G.fetchRemoteSchema(VALID_CONFIG, fetchImpl)
    .then(function (r0) { assertFalse(r0.exists); return G.pushSchemaToGitHub(VALID_CONFIG, { schema_name: 'V1', tables: [] }, null, fetchImpl); })
    .then(function () { return G.fetchRemoteSchema(VALID_CONFIG, fetchImpl); })
    .then(function (r1) { assertTrue(r1.exists); assertEqual(r1.schema.schema_name, 'V1'); return G.pushSchemaToGitHub(VALID_CONFIG, { schema_name: 'V2', tables: [] }, r1.sha, fetchImpl); })
    .then(function () { return G.fetchRemoteSchema(VALID_CONFIG, fetchImpl); })
    .then(function (r2) { assertTrue(r2.exists); assertEqual(r2.schema.schema_name, 'V2'); });
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
test('fetchRawJsonFile rejects clearly on a non-404 HTTP error status (e.g. 401)', function () {
  var fetchImpl = makeFakeGitHubFetch({ initialContent: '{}', initialSha: 's' });
  fetchImpl._forceNextStatus(401);
  return G.fetchRawJsonFile(VALID_CONFIG, fetchImpl).then(function () { throw new Error('expected rejection'); }, function (err) { assertIncludes(err.message, 'Unauthorized'); });
});
test('fetchRawJsonFile rejects clearly when the file content is not valid JSON', function () {
  var fetchImpl = makeFakeGitHubFetch({ initialContent: 'not valid json {{{', initialSha: 's' });
  return G.fetchRawJsonFile(VALID_CONFIG, fetchImpl).then(function () { throw new Error('expected rejection'); }, function (err) { assertIncludes(err.message, 'valid JSON'); });
});
test('fetchRawJsonFile rejects when config is incomplete, without making any network call', function () {
  var fetchImpl = makeFakeGitHubFetch({});
  return G.fetchRawJsonFile({ owner: 'x' }, fetchImpl).then(function () { throw new Error('expected rejection'); }, function (err) { assertIncludes(err.message, 'not fully configured'); assertEqual(fetchImpl._calls.length, 0); });
});
test('end-to-end: pushSchemaToGitHub can publish a non-schema-shaped vault blob, and fetchRawJsonFile reads it back correctly (fetchRemoteSchema would have rejected this same content)', function () {
  var fetchImpl = makeFakeGitHubFetch({});
  var vaultShape = { type: 'ap-sql-assistant-credential-vault', v: 1, salt: 'ZZZZ', iv: 'YYYY', ciphertext: 'XXXX' };
  return G.pushSchemaToGitHub(VALID_CONFIG, vaultShape, null, fetchImpl)
    .then(function () { return G.fetchRawJsonFile(VALID_CONFIG, fetchImpl); })
    .then(function (result) { assertTrue(result.exists); assertEqual(result.content.ciphertext, 'XXXX'); })
    .then(function () { return G.fetchRemoteSchema(VALID_CONFIG, fetchImpl).then(function () { throw new Error('expected fetchRemoteSchema to reject a non-schema-shaped vault blob'); }, function (err) { assertIncludes(err.message, 'valid AP-SQL Assistant schema'); }); });
});
test('describeGitHubSyncStatus: unconfigured/connected/conflict/error', function () {
  assertEqual(G.describeGitHubSyncStatus({ configured: false }).level, 'unconfigured');
  assertEqual(G.describeGitHubSyncStatus({ configured: true, owner: 'acme', repo: 'r', path: 'p.json' }).level, 'connected');
  assertEqual(G.describeGitHubSyncStatus({ configured: true, conflict: true }).level, 'conflict');
  assertEqual(G.describeGitHubSyncStatus({ configured: true, error: 'oops' }).level, 'error');
});
