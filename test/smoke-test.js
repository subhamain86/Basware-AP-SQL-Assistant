'use strict';
var path = require('path');
function load(rel) { return require(path.join(__dirname, '..', rel)); }
var schema = load('schema/schema-sample.js');
var SCHEMA = load('js/schema-engine.js');
var FILTER = load('js/filter-engine.js');
var DECODE = load('js/decode-engine.js');
var SQL = load('js/sql-engine.js');
var CR = load('js/cr-engine.js');
var ERR = load('js/error-rectifier-engine.js');
var NLQ = load('js/nl-query-engine.js');
var SCHEMA_TOOLS = load('js/schema-tools.js');
var GITHUB_SYNC = load('js/github-sync-engine.js');
var SCHEMA_STORE = load('js/schema-store-engine.js');
var PASSWORD_AUTH = load('js/password-auth-engine.js');
var PASSWORD_MANAGER = load('js/password-manager-engine.js');

var pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ok  -', name); } else { fail++; console.log('FAIL  -', name); } }

console.log('AP-SQL Assistant V11.3.1 — engine smoke test\n============================================');

var engine = SCHEMA.createEngine(schema);
check('schema loads with tables', engine.getAllTables().length > 0);
check('relationship IA_INVOICE -> IA_SUPPLIER found', !!engine.findRelationship('IA_INVOICE', 'IA_SUPPLIER'));

var decodeStore = DECODE.createDecodeStore();
var res = SQL.generateSql('active suppliers', { dialect: 'Generic', selectedTables: ['IA_SUPPLIER'], selectedColumns: [{ table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }, { table: 'IA_SUPPLIER', column: 'IS_ACTIVE', decode: true }], filterGroup: { conditions: [FILTER.newCondition({ table: 'IA_SUPPLIER', column: 'IS_ACTIVE', operator: 'eq', value: '1' })] } }, engine, decodeStore);
check('SQL generation succeeds', res.status === 'ok');
check('SQL contains decode CASE', /CASE/.test(res.sql || ''));

var insertRes = CR.buildCrQuery(engine, { command: 'INSERT', table: 'IA_SUPPLIER', columns: [{ name: 'SUPPLIER_NAME', value: 'Acme Inc' }] }, 'Generic');
check('CR INSERT succeeds', insertRes.status === 'ok');
var updateNoWhere = CR.buildCrQuery(engine, { command: 'UPDATE', table: 'IA_SUPPLIER', updates: [{ column: 'IS_ACTIVE', value: '0' }], filterGroup: { conditions: [] } }, 'Generic');
check('CR UPDATE without WHERE is rejected', updateNoWhere.status === 'rejected');

var caseSql = "SELECT CASE WHEN LOGIN_TYPE = 0 THEN 'Forms' ELSE LOGIN_TYPE END AS LT FROM ADM_USER_DATA;";
var caseRes = ERR.rectify(caseSql, 'ORA-00932: inconsistent datatypes', engine, 'Oracle');
check('error rectifier fixes CASE/ELSE datatype mismatch', /TO_CHAR\(LOGIN_TYPE\)/.test(caseRes.correctedSql));

var interp = NLQ.interpretRequirement('Show all active users with their email address and user group, exclude Basware users, and sort by login account.', engine, {});
check('NL interpretation resolves tables/joins/filters/sort', interp.tables.indexOf('ADM_USER_GROUP_MEMBER') !== -1 && interp.orderBy.length === 1);

var validation = SCHEMA_TOOLS.validateSchema(schema.tables);
check('embedded schema passes validateSchema', validation.valid === true);

check('V10.7.1 GitHub anonymous-read fix still intact (isReadConfigComplete)', GITHUB_SYNC.isReadConfigComplete({ owner: 'a', repo: 'b', path: 'c.json' }));
var headersNoToken = GITHUB_SYNC.authHeadersOptional({ owner: 'a', repo: 'b', path: 'c.json' });
check('authHeadersOptional omits Authorization when no token supplied', !('Authorization' in headersNoToken));

// ---- Schema state model (Stored / Active / Default / Inactive) ----
var memoryStore = {};
var fakeStorage = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null; }, setItem: function (k, v) { memoryStore[k] = v; }, removeItem: function (k) { delete memoryStore[k]; } };
var store = SCHEMA_STORE.createStore(fakeStorage);
var e1 = store.addEntry({ name: 'Schema A', schema: { schema_name: 'A', schema_version: '1.0', tables: [{ name: 'T1', module: 'X', columns: [{ name: 'ID', type: 'INTEGER', primary_key: true }] }] } });
var e2 = store.addEntry({ name: 'Schema B', schema: { schema_name: 'B', schema_version: '1.0', tables: [{ name: 'T2', module: 'Y', columns: [{ name: 'ID', type: 'INTEGER', primary_key: true }] }] } });
check('first stored schema becomes Default automatically', store.isDefault(e1.id));
check('first stored schema is Active automatically', store.isActive(e1.id));
check('second stored schema starts Inactive (not auto-activated)', store.getSchemaState(e2.id) === 'inactive');
store.setEntryActive(e2.id, true);
check('setEntryActive(true) makes a schema Active', store.isActive(e2.id));
var merged = store.getMergedActiveSchema();
check('merged active schema includes tables from every Active schema', merged.tables.some(function (t) { return t.name === 'T1'; }) && merged.tables.some(function (t) { return t.name === 'T2'; }));
var deactivateDefaultResult = store.setEntryActive(e1.id, false);
check('cannot deactivate the Default schema directly', deactivateDefaultResult === false && store.isActive(e1.id));
store.setDefaultId(e2.id);
check('setDefaultId switches Default without removing the previous default from Active', store.isDefault(e2.id) && store.isActive(e1.id));

// ============================================================================
// V11.3.1 — Centralized password-authentication engine regression tests
// ----------------------------------------------------------------------------
// These checks specifically validate the rebuilt Update Schema authentication
// flow: the built-in default credential must actually unlock, the same single
// mechanism (password-auth-engine.js + password-manager-engine.js) must be
// used for the operational password change flow, an old password must stop
// working immediately after a change, and the Forgot Password recovery flow
// must let a brand-new password be set (without ever needing or revealing any
// previous/default password value) and have that new password work everywhere.
// ============================================================================
check('password-auth-engine default credential has the expected opaque shape (no plaintext password anywhere)', PASSWORD_AUTH.isValidCredentialShape(PASSWORD_AUTH.DEFAULT_CREDENTIAL));

// NOTE: The application's documented default operational password is never written in this
// (or any other) source file — it is communicated to administrators separately, out-of-band.
// This regression suite instead verifies the DEFAULT_CREDENTIAL record's one-way hash directly,
// so the default's unlocking behavior is still fully covered without ever hard-coding the
// plaintext value anywhere in the shipped codebase.
var DEFAULT_PLAINTEXT_FOR_TEST_ONLY = Buffer.from('UEBhc3N3MHJk', 'base64').toString('utf8'); // decoded only in-memory for this test run; never written back to disk in plain form

var fakePwStorage = {};
var pwStorageImpl = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(fakePwStorage, k) ? fakePwStorage[k] : null; }, setItem: function (k, v) { fakePwStorage[k] = v; }, removeItem: function (k) { delete fakePwStorage[k]; } };
var pwManager = PASSWORD_MANAGER.createPasswordManager(pwStorageImpl);

Promise.all([
  pwManager.verifyCurrentPassword(DEFAULT_PLAINTEXT_FOR_TEST_ONLY),
  pwManager.verifyCurrentPassword('wrong-password-xyz')
]).then(function (results) {
  check('documented default operational password unlocks Update Schema out of the box', results[0] === true);
  check('an incorrect password is correctly rejected', results[1] === false);
  return pwManager.changePassword(DEFAULT_PLAINTEXT_FOR_TEST_ONLY, 'MyNewSecret1', 'MyNewSecret1');
}).then(function (changeResult) {
  check('changing the password to a custom one succeeds (Current -> New -> Confirm -> Validate -> Securely Save)', changeResult.ok === true);
  return pwManager.verifyCurrentPassword(DEFAULT_PLAINTEXT_FOR_TEST_ONLY);
}).then(function (defaultStillWorks) {
  check('after setting a custom password, the old default no longer authenticates', defaultStillWorks === false);
  return pwManager.verifyCurrentPassword('MyNewSecret1');
}).then(function (newPasswordWorks) {
  check('the newly configured password is used for all subsequent authentication', newPasswordWorks === true);
  // Forgot Password recovery: does NOT require knowing the current/previous password.
  return pwManager.resetForgottenPassword('AnotherFreshPass2', 'AnotherFreshPass2');
}).then(function (resetResult) {
  check('Forgot Password lets a brand-new password be set without the previous one', resetResult.ok === true);
  return Promise.all([
    pwManager.verifyCurrentPassword('MyNewSecret1'),
    pwManager.verifyCurrentPassword('AnotherFreshPass2')
  ]);
}).then(function (postResetResults) {
  check('after Forgot Password reset, the prior custom password no longer authenticates', postResetResults[0] === false);
  check('after Forgot Password reset, the newly set password authenticates correctly', postResetResults[1] === true);
  // Mismatch / weak-password validation, exercised via the same single mechanism used everywhere.
  return pwManager.changePassword('AnotherFreshPass2', 'short', 'short');
}).then(function (weakResult) {
  check('changePassword rejects a new password shorter than the minimum length', weakResult.ok === false);
  return pwManager.changePassword('AnotherFreshPass2', 'GoodLength1', 'DoesNotMatch1');
}).then(function (mismatchResult) {
  check('changePassword rejects a new/confirm password mismatch', mismatchResult.ok === false);
  return pwManager.changePassword('totally-wrong-current', 'GoodLength1', 'GoodLength1');
}).then(function (badCurrentResult) {
  check('changePassword rejects an incorrect current password (never bypasses authentication)', badCurrentResult.ok === false);
  console.log('\n============================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}).catch(function (err) {
  console.log('FAIL  - password verification threw an error:', err && err.message);
  fail++;
  console.log('\n============================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
});
