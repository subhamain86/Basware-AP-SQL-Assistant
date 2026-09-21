'use strict';
var path = require('path');
function load(rel) { return require(path.join(__dirname, '..', rel)); }

var schema = load('schema/schema-sample.js');
var SCHEMA = load('js/schema-engine.js');
var RELSTORE = load('js/relationship-store.js');
var FILTER = load('js/filter-engine.js');
var DECODE = load('js/decode-engine.js');
var SQL = load('js/sql-engine.js');
var CR = load('js/cr-engine.js');
var ERR = load('js/error-rectifier-engine.js');
var NLQ = load('js/nl-query-engine.js');
var CONV = load('js/conversation-engine.js');
var VALID = load('js/validation-engine.js');
var OPT = load('js/optimize-engine.js');
var SCHEMA_TOOLS = load('js/schema-tools.js');
var GITHUB_SYNC = load('js/github-sync-engine.js');
var SCHEMA_STORE = load('js/schema-store-engine.js');
var PASSWORD_MANAGER = load('js/password-manager-engine.js');
var VAULT = load('js/credential-vault-engine.js');
var SYNC_SCHEDULE = load('js/sync-schedule-engine.js');

var pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  -', name); }
  else { fail++; console.log('FAIL  -', name); }
}

console.log('AP-SQL Assistant V11.5 — engine smoke test');
console.log('===========================================');

var engine = SCHEMA.createEngine(schema);
var relStore = RELSTORE.createRelationshipStore();
var effEngine = RELSTORE.createEffectiveEngine(engine, relStore);
var decodeStore = DECODE.createDecodeStore();

check('schema loads with tables', engine.getAllTables().length > 0);
check('relationship IA_INVOICE -> IA_SUPPLIER found', !!engine.findRelationship('IA_INVOICE', 'IA_SUPPLIER'));
check('relationship IA_INVOICE -> PP_PURCHASE_ORDER found', !!engine.findRelationship('IA_INVOICE', 'PP_PURCHASE_ORDER'));
check('unrelated tables report no relationship', !engine.findRelationship('ADM_USER_GROUP_MEMBER', 'PP_PURCHASE_ORDER'));

// ---- schema-tools ----
var validation = SCHEMA_TOOLS.validateSchema(schema.tables);
check('embedded schema passes validateSchema', validation.valid === true);
var badTables = [{ name: 'A', columns: [{ name: 'X', foreign_key: { table: 'NOPE', column: 'Y' } }] }];
check('validateSchema catches unknown FK target', SCHEMA_TOOLS.validateSchema(badTables).valid === false);
var csv = SCHEMA_TOOLS.sampleCsv();
check('sampleCsv produces content', typeof csv === 'string' && csv.length > 20);
var parsedFromCsv = SCHEMA_TOOLS.parseCsvToSchema(csv);
check('CSV round-trips into at least 1 table', parsedFromCsv.tables.length >= 1);

// ---- sql-engine: basic SELECT ----
var res1 = SQL.generateSql('active suppliers', {
  dialect: 'Generic', selectedTables: ['IA_SUPPLIER'],
  selectedColumns: [{ table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }, { table: 'IA_SUPPLIER', column: 'IS_ACTIVE', decode: true }],
  filterGroup: { conditions: [FILTER.newCondition({ table: 'IA_SUPPLIER', column: 'IS_ACTIVE', operator: 'eq', value: '1' })] }
}, effEngine, decodeStore, effEngine);
check('SQL generation succeeds (single table)', res1.status === 'ok');
check('SQL contains decode CASE', /CASE/.test(res1.sql || ''));

// ---- sql-engine: joins across 3 tables ----
var res2 = SQL.generateSql('invoices with supplier and PO', {
  dialect: 'Oracle', selectedTables: ['IA_INVOICE', 'IA_SUPPLIER', 'PP_PURCHASE_ORDER'],
  selectedColumns: [
    { table: 'IA_INVOICE', column: 'INVOICE_NUMBER' },
    { table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' },
    { table: 'PP_PURCHASE_ORDER', column: 'PO_AMOUNT' }
  ],
  orderBy: [{ table: 'PP_PURCHASE_ORDER', column: 'PO_AMOUNT', dir: 'desc' }],
  limit: 10
}, effEngine, decodeStore, effEngine);
check('multi-table join SQL generation succeeds', res2.status === 'ok');
check('generated SQL includes two JOINs', (res2.sql.match(/JOIN/g) || []).length === 2);
check('Oracle dialect uses FETCH FIRST for limit', /FETCH FIRST 10 ROWS ONLY/.test(res2.sql));

// ---- sql-engine: aggregation + group by ----
var res3 = SQL.generateSql('total invoice amount per supplier', {
  dialect: 'Generic', selectedTables: ['IA_INVOICE', 'IA_SUPPLIER'],
  selectedColumns: [
    { table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' },
    { table: 'IA_INVOICE', column: 'INVOICE_AMOUNT', aggregate: 'SUM', alias: 'total_amount' }
  ],
  groupBy: [{ table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }],
  having: 'SUM(INV.INVOICE_AMOUNT) > 1000'
}, effEngine, decodeStore, effEngine);
check('aggregation + GROUP BY + HAVING generation succeeds', res3.status === 'ok');
check('SQL has GROUP BY and HAVING', /GROUP BY/.test(res3.sql) && /HAVING/.test(res3.sql));

// ---- sql-engine: CTE + EXISTS + window function ----
var res4 = SQL.generateSql('invoices ranked by amount within supplier, only where a PO exists', {
  dialect: 'PostgreSQL', selectedTables: ['IA_INVOICE'],
  selectedColumns: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }, { table: 'IA_INVOICE', column: 'INVOICE_AMOUNT' }],
  windowFunctions: [{ fn: 'RANK', partitionBy: [{ table: 'IA_INVOICE', column: 'SUPPLIER_ID' }], orderBy: [{ table: 'IA_INVOICE', column: 'INVOICE_AMOUNT', dir: 'desc' }], alias: 'amount_rank' }],
  existsFilters: [{ table: 'PP_PURCHASE_ORDER', condition: FILTER.newCondition({ table: 'PP_PURCHASE_ORDER', column: 'PO_AMOUNT', operator: 'gt', value: '0' }) }],
  cteName: 'ranked_invoices'
}, effEngine, decodeStore, effEngine);
check('CTE + window function + EXISTS generation succeeds', res4.status === 'ok');
check('SQL wraps in WITH ... AS (...)', /^WITH ranked_invoices AS \(/.test(res4.sql));
check('SQL contains RANK() OVER', /RANK\(\) OVER/.test(res4.sql));
check('SQL contains EXISTS', /EXISTS/.test(res4.sql));

// ---- sql-engine: recursive hierarchy ----
var res5 = SQL.generateSql('org chart', {
  dialect: 'PostgreSQL', selectedTables: ['ADM_USER_DATA'],
  selectedColumns: [{ table: 'ADM_USER_DATA', column: 'LOGIN_ACCOUNT' }],
  recursiveHierarchy: { table: 'ADM_USER_DATA', parentColumn: 'MANAGER_USER_ID', cteName: 'org_chart' }
}, effEngine, decodeStore, effEngine);
check('recursive hierarchy CTE generation succeeds', res5.status === 'ok');
check('SQL uses WITH RECURSIVE for PostgreSQL', /WITH RECURSIVE org_chart/.test(res5.sql));

// ---- sql-engine: set operations ----
var res6 = SQL.generateSql('active + inactive suppliers combined', {
  dialect: 'Generic', selectedTables: ['IA_SUPPLIER'],
  selectedColumns: [{ table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }],
  setOperation: { type: 'unionall', querySql: 'SELECT SUPPLIER_NAME FROM IA_SUPPLIER;' }
}, effEngine, decodeStore, effEngine);
check('UNION ALL set-operation generation succeeds', res6.status === 'ok' && /UNION ALL/.test(res6.sql));

// ---- validation-engine ----
var v1 = VALID.validateAgainstSchema(res2.sql, effEngine, res2.tablesUsed);
check('validation-engine approves a correctly generated multi-join query', v1.valid === true);
var v2 = VALID.assertReadOnly('DROP TABLE IA_INVOICE;');
check('validation-engine flags DDL in a read-only context', v2.ok === false);
var v3 = VALID.assertReadOnly(res1.sql);
check('validation-engine allows a plain SELECT', v3.ok === true);

// ---- cr-engine ----
var insertRes = CR.buildCrQuery(effEngine, { command: 'INSERT', table: 'IA_SUPPLIER', columns: [{ name: 'SUPPLIER_NAME', value: 'Acme Inc' }] }, 'Generic');
check('CR INSERT succeeds', insertRes.status === 'ok');
var updateNoWhere = CR.buildCrQuery(effEngine, { command: 'UPDATE', table: 'IA_SUPPLIER', updates: [{ column: 'IS_ACTIVE', value: '0' }], filterGroup: { conditions: [] } }, 'Generic');
check('CR UPDATE without WHERE is rejected', updateNoWhere.status === 'rejected');
var updateWithWhere = CR.buildCrQuery(effEngine, {
  command: 'UPDATE', table: 'IA_SUPPLIER', updates: [{ column: 'IS_ACTIVE', value: '0' }],
  filterGroup: { conditions: [FILTER.newCondition({ table: 'IA_SUPPLIER', column: 'SUPPLIER_ID', operator: 'eq', value: '42' })] }
}, 'Generic');
check('CR UPDATE with WHERE succeeds', updateWithWhere.status === 'ok');
var deleteNoWhereOverride = CR.buildCrQuery(effEngine, { command: 'DELETE', table: 'IA_SUPPLIER', filterGroup: { conditions: [] }, explicitOverride: true }, 'Generic');
check('CR DELETE without WHERE but with explicit override succeeds (and warns)', deleteNoWhereOverride.status === 'ok' && deleteNoWhereOverride.warnings.length > 0);

// ---- error-rectifier-engine ----
var caseSql = "SELECT CASE WHEN LOGIN_TYPE = 0 THEN 'Forms' ELSE LOGIN_TYPE END AS LT FROM ADM_USER_DATA;";
var caseRes = ERR.rectify(caseSql, 'ORA-00932: inconsistent datatypes', effEngine, 'Oracle');
check('error rectifier fixes CASE/ELSE datatype mismatch', /TO_CHAR\(LOGIN_TYPE\)/.test(caseRes.correctedSql));
var typoSql = 'SELECT SUPPLIER_NAM FROM IA_SUPPLIER;';
var typoRes = ERR.rectify(typoSql, 'ORA-00904: "SUPPLIER_NAM": invalid identifier', effEngine, 'Oracle');
check('error rectifier fixes a misspelled column name', /SUPPLIER_NAME/.test(typoRes.correctedSql));

// ---- nl-query-engine + conversation-engine ----
var interp = NLQ.interpretRequirement('Show all active users with their email address and user group, sort by login account.', effEngine, {});
check('NL interpretation resolves tables/joins', interp.tables.indexOf('ADM_USER_GROUP_MEMBER') !== -1 || interp.tables.indexOf('ADM_USER_DATA') !== -1);

var convo = CONV.createConversation();
var p1 = convo.submit('Show invoices from supplier ABC', effEngine);
check('conversation: first turn resolves IA_INVOICE', p1.tables.indexOf('IA_INVOICE') !== -1);
var p2 = convo.submit('Only show the last 3 months', effEngine);
check('conversation: follow-up adds a relative date filter', p2.filterConditions.some(function (c) { return /__MONTHS_AGO_3/.test(c.value); }));
var p3 = convo.submit('Add supplier name', effEngine);
check('conversation: follow-up adds a supplier-name column', p3.columns.some(function (c) { return c.table === 'IA_SUPPLIER'; }));
var p4 = convo.submit('Sort by highest amount', effEngine);
check('conversation: follow-up sets descending order', p4.orderBy.length > 0 && p4.orderBy[0].dir === 'desc');

var relDate = NLQ.resolveRelativeDates('__DAYS_AGO_30');
check('relative date placeholder resolves to a real ISO date', /^\d{4}-\d{2}-\d{2}$/.test(relDate));

// ---- decode-engine duplicate/conflict protection ----
var dupCheck = DECODE.validateNewDefinition(effEngine, decodeStore, 'IA_SUPPLIER', 'IS_ACTIVE', { cases: [{ when: '1', then: 'Active' }], else_value: 'x' });
check('decode-engine rejects a conflicting manual definition when a schema one already exists', dupCheck.valid === false);

// ---- optimize-engine ----
var explanation = OPT.explainQuery(res2, effEngine);
check('optimize-engine produces a non-empty plain-language explanation', typeof explanation === 'string' && explanation.length > 0);

// ---- github-sync-engine (V10.7.1 anonymous-read fix retained) ----
check('V10.7.1 GitHub anonymous-read fix still intact (isReadConfigComplete)', GITHUB_SYNC.isReadConfigComplete({ owner: 'a', repo: 'b', path: 'c.json' }));
var headersNoToken = GITHUB_SYNC.authHeadersOptional({ owner: 'a', repo: 'b', path: 'c.json' });
check('authHeadersOptional omits Authorization when no token supplied', !('Authorization' in headersNoToken));

// ---- schema-store-engine (Stored/Active/Default/Inactive) ----
var memoryStore = {};
var fakeStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null; },
  setItem: function (k, v) { memoryStore[k] = v; }, removeItem: function (k) { delete memoryStore[k]; }
};
var store = SCHEMA_STORE.createStore(fakeStorage);
var e1 = store.addEntry({ name: 'Schema A', schema: { schema_name: 'A', schema_version: '1.0', tables: [{ name: 'T1', module: 'X', columns: [{ name: 'ID', type: 'INTEGER', primary_key: true }] }] } });
var e2 = store.addEntry({ name: 'Schema B', schema: { schema_name: 'B', schema_version: '1.0', tables: [{ name: 'T2', module: 'Y', columns: [{ name: 'ID', type: 'INTEGER', primary_key: true }] }] } });
check('first stored schema becomes Default automatically', store.isDefault(e1.id));
check('first stored schema is Active automatically', store.isActive(e1.id));
check('second stored schema starts Inactive', store.getSchemaState(e2.id) === 'inactive');
store.setEntryActive(e2.id, true);
check('setEntryActive(true) makes a schema Active', store.isActive(e2.id));
var merged = store.getMergedActiveSchema();
check('merged active schema includes tables from every Active schema', merged.tables.some(function (t) { return t.name === 'T1'; }) && merged.tables.some(function (t) { return t.name === 'T2'; }));
var deactivateDefaultResult = store.setEntryActive(e1.id, false);
check('cannot deactivate the Default schema directly', deactivateDefaultResult === false && store.isActive(e1.id));
store.setDefaultId(e2.id);
check('setDefaultId switches Default without removing previous default from Active', store.isDefault(e2.id) && store.isActive(e1.id));

// ---- password-manager-engine ----
var fakePwStorage = {};
var pwStorageImpl = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(fakePwStorage, k) ? fakePwStorage[k] : null; },
  setItem: function (k, v) { fakePwStorage[k] = v; }, removeItem: function (k) { delete fakePwStorage[k]; }
};
var pwManager = PASSWORD_MANAGER.createPasswordManager(pwStorageImpl);

// ---- sync-schedule-engine ----
check('sync-schedule "manual" is never due', SYNC_SCHEDULE.isDue('manual', null) === false);
check('sync-schedule "daily" is due when never synced', SYNC_SCHEDULE.isDue('daily', null) === true);
check('sync-schedule "daily" is not due 1 hour after last sync', SYNC_SCHEDULE.isDue('daily', new Date().toISOString()) === false);

// ---- credential-vault-engine ----
var vaultPromise = VAULT.encryptVault({ owner: 'basware', repo: 'ap-schema', path: 'schema.json', token: 'ghp_test123' }, 'MySecret1').then(function (vault) {
  check('vault encryption produces AES-256-GCM shape', VAULT.isVaultShape(vault));
  return VAULT.decryptVault(vault, 'MySecret1');
}).then(function (decrypted) {
  check('vault decrypts back to original payload with correct password', decrypted.token === 'ghp_test123');
  return VAULT.encryptVault({ a: 1 }, 'pw').then(function (v2) { return VAULT.decryptVault(v2, 'wrong-password').then(function () { return 'should-not-resolve'; }, function () { return 'rejected-as-expected'; }); });
}).then(function (r) {
  check('vault decryption fails with wrong password', r === 'rejected-as-expected');
});

Promise.all([
  pwManager.verifyCurrentPassword('P@assw0rd'),
  pwManager.verifyCurrentPassword('wrong-password-xyz'),
  vaultPromise
]).then(function (results) {
  check('documented default password "P@assw0rd" successfully unlocks Update Schema', results[0] === true);
  check('an incorrect password is correctly rejected', results[1] === false);
  return pwManager.changePassword('P@assw0rd', 'MyNewSecret1', 'MyNewSecret1');
}).then(function (changeResult) {
  check('changing the password to a custom one succeeds', changeResult.ok === true);
  return pwManager.verifyCurrentPassword('P@assw0rd');
}).then(function (oldStillWorks) {
  check('after setting a custom password, the old default no longer unlocks', oldStillWorks === false);
  pwManager.resetToDefault();
  return pwManager.verifyCurrentPassword('P@assw0rd');
}).then(function (worksAfterReset) {
  check('"Forgot password? Reset to default" restores P@assw0rd access', worksAfterReset === true);

  console.log('\n===========================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}).catch(function (err) {
  console.log('FAIL  - an async check threw an error:', err && err.stack ? err.stack : err);
  fail++;
  console.log('\n===========================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
});
