/* ==========================================================================
   AP-SQL Assistant — Node-based smoke test for the core engine layer.
   Runs without a browser (no DOM) to verify that schema loading, SQL
   generation, CR generation, error rectification, and the V10.7.1 GitHub
   vault-unlock fix all still work after the V10.8 Guided Walkthrough
   redesign. This complements manual UI/responsive testing, which requires
   a real browser and is covered by MANUAL_QA_CHECKLIST.md in this folder.
   Run with:  node test/smoke-test.js
   ========================================================================== */
'use strict';
var path = require('path');
function load(rel) { return require(path.join(__dirname, '..', rel)); }

var schema = load('schema/schema-sample.js');
var DATATYPE = load('js/datatype-engine.js');
var SCHEMA = load('js/schema-engine.js');
var FILTER = load('js/filter-engine.js');
var DECODE = load('js/decode-engine.js');
var VALIDATE = load('js/validation-engine.js');
var SQL = load('js/sql-engine.js');
var CR = load('js/cr-engine.js');
var ERR = load('js/error-rectifier-engine.js');
var NLQ = load('js/nl-query-engine.js');
var SCHEMA_TOOLS = load('js/schema-tools.js');
var GITHUB_SYNC = load('js/github-sync-engine.js');

var pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  -', name); }
  else { fail++; console.log('FAIL  -', name); }
}

console.log('AP-SQL Assistant — smoke test\n==============================');

// 1. Schema engine
var engine = SCHEMA.createEngine(schema);
check('schema loads with tables', engine.getAllTables().length > 0);
check('IA_INVOICE table resolvable', !!engine.getTable('IA_INVOICE'));
check('relationship IA_INVOICE -> IA_SUPPLIER found', !!engine.findRelationship('IA_INVOICE', 'IA_SUPPLIER'));

// 2. Read-only SQL generation
var decodeStore = DECODE.createDecodeStore();
var res = SQL.generateSql('active suppliers', {
  dialect: 'Generic',
  selectedTables: ['IA_SUPPLIER'],
  selectedColumns: [{ table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }, { table: 'IA_SUPPLIER', column: 'IS_ACTIVE', decode: true }],
  filterGroup: { conditions: [FILTER.newCondition({ table: 'IA_SUPPLIER', column: 'IS_ACTIVE', operator: 'eq', value: '1' })] }
}, engine, decodeStore);
check('SQL generation succeeds', res.status === 'ok');
check('SQL contains SELECT', /SELECT/.test(res.sql || ''));
check('SQL contains decode CASE', /CASE/.test(res.sql || ''));

// 3. Join across two tables
var joinRes = SQL.generateSql('invoices with supplier name', {
  dialect: 'Generic', selectedTables: ['IA_INVOICE', 'IA_SUPPLIER'],
  selectedColumns: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }, { table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }]
}, engine, decodeStore);
check('two-table join generation succeeds', joinRes.status === 'ok');
check('SQL contains JOIN', /JOIN/.test(joinRes.sql || ''));

// 4. Recursive hierarchy
var hierRes = SQL.generateSql(null, { selectedTables: ['ADM_USER_DATA'], recursiveHierarchy: { table: 'ADM_USER_DATA' } }, engine, decodeStore);
check('recursive hierarchy generation succeeds', hierRes.status === 'ok');
check('SQL contains RECURSIVE', /RECURSIVE/.test(hierRes.sql || ''));

// 5. CR builder — INSERT / UPDATE (with + without WHERE)
var insertRes = CR.buildCrQuery(engine, { command: 'INSERT', table: 'IA_SUPPLIER', columns: [{ name: 'SUPPLIER_NAME', value: 'Acme Inc' }, { name: 'IS_ACTIVE', value: '1' }] }, 'Generic');
check('CR INSERT succeeds', insertRes.status === 'ok');

var updateNoWhere = CR.buildCrQuery(engine, { command: 'UPDATE', table: 'IA_SUPPLIER', updates: [{ column: 'IS_ACTIVE', value: '0' }], filterGroup: { conditions: [] } }, 'Generic');
check('CR UPDATE without WHERE is rejected', updateNoWhere.status === 'rejected');

var updateWithWhere = CR.buildCrQuery(engine, { command: 'UPDATE', table: 'IA_SUPPLIER', updates: [{ column: 'IS_ACTIVE', value: '0' }], filterGroup: { conditions: [FILTER.newCondition({ table: 'IA_SUPPLIER', column: 'SUPPLIER_ID', operator: 'eq', value: '42' })] } }, 'Generic');
check('CR UPDATE with WHERE succeeds', updateWithWhere.status === 'ok');

// 6. Error Rectifier
var badSql = "SELECT * FROM IA_SUPPLIER WHERE SUPPLIER_EMAIL = NULL";
var errRes = ERR.rectify(badSql, 'ORA-00932: inconsistent datatypes', engine, 'Oracle');
check('error rectifier returns a corrected SQL string', typeof errRes.correctedSql === 'string' && errRes.correctedSql.length > 0);

var caseSql = "SELECT CASE WHEN LOGIN_TYPE = 0 THEN 'Forms' ELSE LOGIN_TYPE END AS LT FROM ADM_USER_DATA;";
var caseRes = ERR.rectify(caseSql, 'ORA-00932: inconsistent datatypes: expected CHAR got NUMBER', engine, 'Oracle');
check('error rectifier fixes CASE/ELSE datatype mismatch (regression from V10.7.1)', /TO_CHAR\(LOGIN_TYPE\)/.test(caseRes.correctedSql));

// 7. Natural-language interpretation
var interp = NLQ.interpretRequirement('Show active suppliers with their email address', engine, {});
check('NL interpretation identifies at least one table', interp.tables.length > 0);

var successCriteria = NLQ.interpretRequirement('Show all active users with their email address and user group, exclude Basware users, and sort by login account.', engine, {});
check('success-criteria sentence resolves tables/joins/filters/sort with zero manual selection', successCriteria.tables.indexOf('ADM_USER_GROUP_MEMBER') !== -1 && successCriteria.orderBy.length === 1);

// 8. Schema tools — validation + sample blob generation
var validation = SCHEMA_TOOLS.validateSchema(schema.tables);
check('embedded schema passes validateSchema', validation.valid === true);

// 9. V10.7.1 GitHub vault-unlock fix — regression coverage
check('isReadConfigComplete is true with no token (read-only lookups do not require one)', GITHUB_SYNC.isReadConfigComplete({ owner: 'acme', repo: 'repo', path: 'schema/x.json' }));
var headersNoToken = GITHUB_SYNC.authHeadersOptional({ owner: 'acme', repo: 'repo', path: 'x.json' });
check('authHeadersOptional omits Authorization header when no token is supplied (anonymous read)', !('Authorization' in headersNoToken));
var headersWithToken = GITHUB_SYNC.authHeadersOptional({ owner: 'acme', repo: 'repo', path: 'x.json', token: 'ghp_real' });
check('authHeadersOptional sends the real token when one is supplied', headersWithToken.Authorization === 'Bearer ghp_real');
check('no hardcoded placeholder token anywhere in headers', JSON.stringify(headersNoToken).indexOf('unauthenticated-lookup') === -1 && JSON.stringify(headersWithToken).indexOf('unauthenticated-lookup') === -1);

console.log('\n==============================');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
