'use strict';
var path = require('path');
var S = require(path.join(__dirname, '..', 'js', 'shared-schema-loader.js'));
function fakeFetch(status, bodyText, opts) {
  opts = opts || {};
  return function () {
    if (opts.networkError) return Promise.reject(new Error(opts.networkErrorMessage || 'simulated offline'));
    return Promise.resolve({ status: status, ok: status >= 200 && status < 300, text: function () { return Promise.resolve(bodyText); } });
  };
}
test('buildFetchUrl uses the default path when none is supplied', function () {
  assertIncludes(S.buildFetchUrl(), 'schema/shared-schema.json');
});
test('buildFetchUrl appends a cache-busting timestamp query param', function () {
  assertTrue(/\?t=\d+$/.test(S.buildFetchUrl('schema/shared-schema.json')));
});
test('fetchSharedSchema resolves {found:false} for a 404 — not treated as an error', function () {
  return S.fetchSharedSchema('schema/shared-schema.json', fakeFetch(404, '')).then(function (result) { assertEqual(result.found, false); });
});
test('fetchSharedSchema resolves the parsed schema for a valid 200 response', function () {
  var body = JSON.stringify({ schema_name: 'Shared Org Schema', schema_version: '3.1', tables: [{ name: 'T', columns: [{ name: 'C' }] }] });
  return S.fetchSharedSchema('schema/shared-schema.json', fakeFetch(200, body)).then(function (result) {
    assertTrue(result.found);
    assertEqual(result.schema.schema_name, 'Shared Org Schema');
  });
});
test('fetchSharedSchema rejects clearly on a non-404 HTTP error status', function () {
  return S.fetchSharedSchema('schema/shared-schema.json', fakeFetch(500, '')).then(function () { throw new Error('expected rejection'); }, function (err) { assertIncludes(err.message, 'HTTP 500'); });
});
test('fetchSharedSchema rejects clearly when the response body is not valid JSON', function () {
  return S.fetchSharedSchema('schema/shared-schema.json', fakeFetch(200, 'not valid json{{{')).then(function () { throw new Error('expected rejection'); }, function (err) { assertIncludes(err.message, 'valid JSON'); });
});
test('fetchSharedSchema always requests with cache: no-store', function () {
  var capturedInit = null;
  var fetchImpl = function (url, init) { capturedInit = init; return Promise.resolve({ status: 404, ok: false, text: function () { return Promise.resolve(''); } }); };
  return S.fetchSharedSchema('schema/shared-schema.json', fetchImpl).then(function () { assertEqual(capturedInit.cache, 'no-store'); });
});
test('describeSharedSchemaStatus: checking/notfound/live/error states', function () {
  assertEqual(S.describeSharedSchemaStatus({ checked: false }).level, 'checking');
  assertEqual(S.describeSharedSchemaStatus({ checked: true, found: false, path: 'x' }).level, 'notfound');
  assertEqual(S.describeSharedSchemaStatus({ checked: true, found: true, path: 'x' }).level, 'live');
  assertEqual(S.describeSharedSchemaStatus({ checked: true, error: 'oops' }).level, 'error');
});
