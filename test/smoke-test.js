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

var pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ok  -', name); } else { fail++; console.log('FAIL  -', name); } }

console.log('AP-SQL Assistant V10.9 — engine smoke test\n============================================');
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
check('no hardcoded placeholder token anywhere', JSON.stringify(headersNoToken).indexOf('unauthenticated-lookup') === -1);

console.log('\n============================================');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
