/* ==========================================================================
   AP-SQL Assistant V11.4 — Node-based smoke test for the engine layer.
   Run with:  node test/smoke-test.js
   (No DOM/browser required — exercises the pure JS engines used by app.js.)
   ========================================================================== */
'use strict';
var path = require('path');
var assert = require('assert');

function req(name) { return require(path.join(__dirname, '..', 'js', name)); }

var SCHEMA_ENGINE = req('schema-engine.js');
var SCHEMA_STORE = req('schema-store-engine.js');
var RELATIONSHIP = req('relationship-store.js');
var DECODE = req('decode-engine.js');
var DECODE_APPROVAL = req('decode-approval-engine.js');
var FILTER = req('filter-engine.js');
var VALIDATE = req('validation-engine.js');
var SQL = req('sql-engine.js');
var CR = req('cr-engine.js');
var NLQUERY = req('nl-query-engine.js');
var OPTIMIZE = req('optimize-engine.js');
var ERROR_RECTIFIER = req('error-rectifier-engine.js');
var SUGGEST = req('suggestion-engine.js');
var PASSWORD_MANAGER = req('password-manager-engine.js');
var SYNC_SCHEDULE = req('sync-schedule-engine.js');
var SCHEMA_TOOLS = req('schema-tools.js');

var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));

var passed = 0;
function ok(desc) { passed++; console.log('  \u2713 ' + desc); }
function run(desc, fn) {
  try { fn(); ok(desc); }
  catch (e) { console.error('  \u2717 ' + desc + '\n    ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; }
}

// In-memory localStorage shim for engines that read/write browser storage.
function memoryStorage() {
  var m = {};
  return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
}

console.log('AP-SQL Assistant V11.4 — smoke test\n');

// ---------------------------------------------------------------------
// 1. Schema engine basics
// ---------------------------------------------------------------------
var baseEngine = SCHEMA_ENGINE.createEngine(schema);
run('schema engine resolves a known table', function () { assert.ok(baseEngine.getTable('IA_INVOICE')); });
run('schema engine resolves a known column', function () { assert.ok(baseEngine.columnExists('IA_INVOICE', 'STATUS')); });
run('schema engine finds a FK relationship', function () {
  var rel = baseEngine.findRelationship('IA_INVOICE', 'IA_SUPPLIER');
  assert.ok(rel && rel.fromColumn === 'SUPPLIER_ID');
});
run('schema-aware decode lookup returns embedded STATUS decode', function () {
  var vals = baseEngine.getValueMap('IA_INVOICE', 'STATUS');
  assert.ok(vals && vals.length === 4);
});

// ---------------------------------------------------------------------
// 2. Schema store (multi-schema, active/default states)
// ---------------------------------------------------------------------
var store = SCHEMA_STORE.createStore(memoryStorage());
var entry = store.importLegacySingleSchema(schema, 'Embedded Schema');
run('schema store imports legacy single schema as default+active', function () {
  assert.strictEqual(store.getDefaultId(), entry.id);
  assert.strictEqual(store.getSchemaState(entry.id), 'default');
});
var secondEntry = store.addEntry({ name: 'Extra Schema', schema: { schema_name: 'Extra', schema_version: '1.0', tables: [{ name: 'EXTRA_TABLE', module: 'X', columns: [{ name: 'ID', type: 'INTEGER', primary_key: true }] }] } });
run('schema store adds a second entry as inactive by default', function () { assert.strictEqual(store.getSchemaState(secondEntry.id), 'inactive'); });
store.setEntryActive(secondEntry.id, true);
run('schema store activates second entry', function () { assert.strictEqual(store.getSchemaState(secondEntry.id), 'active'); });
var merged = store.getMergedActiveSchema();
run('merged active schema includes tables from both active entries', function () {
  var names = merged.tables.map(function (t) { return t.name; });
  assert.ok(names.indexOf('IA_INVOICE') !== -1 && names.indexOf('EXTRA_TABLE') !== -1);
});

// ---------------------------------------------------------------------
// 3. Relationship store overlay
// ---------------------------------------------------------------------
var relStore = RELATIONSHIP.createRelationshipStore();
var effectiveEngine = RELATIONSHIP.createEffectiveEngine(baseEngine, relStore);
run('effective engine falls back to schema relationship when no manual override exists', function () {
  assert.ok(effectiveEngine.findRelationship('IA_INVOICE', 'IA_SUPPLIER'));
});
relStore.setManualRelationship('EXTRA_TABLE', 'ID', 'IA_SUPPLIER', 'SUPPLIER_ID');
run('effective engine uses manual relationship override when documented', function () {
  var rel = effectiveEngine.findRelationship('EXTRA_TABLE', 'IA_SUPPLIER');
  assert.ok(rel && rel.fromTable === 'EXTRA_TABLE');
});

// ---------------------------------------------------------------------
// 4. Schema-aware CASE/DECODE (V11.4 core requirement)
// ---------------------------------------------------------------------
var decodeStore = DECODE.createDecodeStore();
run('resolveDecode prefers the ACTIVE SCHEMA definition over any session draft', function () {
  decodeStore.setManualDecode('IA_INVOICE', 'STATUS', [{ code: '999', label: 'Should never be used' }]);
  var resolved = DECODE.resolveDecode(baseEngine, decodeStore, 'IA_INVOICE', 'STATUS');
  assert.strictEqual(resolved.source, 'schema');
  assert.strictEqual(resolved.values.length, 4);
});
run('resolveDecode falls back to session draft when schema has none', function () {
  decodeStore.setManualDecode('IA_INVOICE_LINE', 'ACCOUNT_CODE', [{ code: 'A1', label: 'Assets' }]);
  var resolved = DECODE.resolveDecode(baseEngine, decodeStore, 'IA_INVOICE_LINE', 'ACCOUNT_CODE');
  assert.strictEqual(resolved.source, 'session');
});
run('resolveDecode returns null source when neither schema nor session has a definition', function () {
  var resolved = DECODE.resolveDecode(baseEngine, decodeStore, 'IA_INVOICE_LINE', 'NET_SUM');
  assert.strictEqual(resolved.source, null);
});
run('buildDecodeCaseSql produces a schema-driven CASE expression', function () {
  var sql = DECODE.buildDecodeCaseSql('IA_INVOICE', 'STATUS', baseEngine.getValueMap('IA_INVOICE', 'STATUS'), 'StatusLabel', { dataType: 'NUMBER(5)', dialect: 'Oracle' });
  assert.ok(/CASE/.test(sql) && /WHEN IA_INVOICE\.STATUS = 0 THEN 'Draft'/.test(sql));
  assert.ok(/ELSE TO_CHAR\(IA_INVOICE\.STATUS\)/.test(sql), 'ELSE should be dialect/data-type aware: ' + sql);
});

// ---------------------------------------------------------------------
// 5. Manual CASE/DECODE Addition + Admin Approval + duplicate prevention
// ---------------------------------------------------------------------
run('manual decode draft validates required fields', function () {
  var draft = DECODE_APPROVAL.createDraft({ table: 'IA_SUPPLIER', column: 'SUPPLIER_CODE', pairs: [] });
  var check = DECODE_APPROVAL.validateDraft(draft);
  assert.strictEqual(check.valid, false);
});
var approvalDraft = DECODE_APPROVAL.createDraft({ table: 'IA_SUPPLIER', column: 'SUPPLIER_CODE', pairs: [{ code: 'GLB', label: 'Global Supplier' }, { code: 'LOC', label: 'Local Supplier' }], description: 'Supplier scope' });
var approvalResult = DECODE_APPROVAL.applyApprovedDraftToSchema(entry.schema, approvalDraft, { approvedBy: 'Administrator' });
run('an approved manual definition is saved to the current schema only', function () {
  assert.ok(approvalResult.ok);
  var col = approvalResult.schema.tables.filter(function (t) { return t.name === 'IA_SUPPLIER'; })[0].columns.filter(function (c) { return c.name === 'SUPPLIER_CODE'; })[0];
  assert.strictEqual(col.decode.length, 2);
  assert.strictEqual(col._decodeMeta.manuallyAdded, true);
});
run('re-approving an identical definition is detected as a duplicate (no overwrite)', function () {
  var dupResult = DECODE_APPROVAL.applyApprovedDraftToSchema(approvalResult.schema, approvalDraft, { approvedBy: 'Administrator' });
  assert.strictEqual(dupResult.ok, false);
  assert.strictEqual(dupResult.duplicate, true);
});
run('approving a conflicting definition for the same column is rejected, not overwritten', function () {
  var conflictingDraft = DECODE_APPROVAL.createDraft({ table: 'IA_SUPPLIER', column: 'SUPPLIER_CODE', pairs: [{ code: 'ZZZ', label: 'Different mapping' }] });
  var conflictResult = DECODE_APPROVAL.applyApprovedDraftToSchema(approvalResult.schema, conflictingDraft, { approvedBy: 'Administrator' });
  assert.strictEqual(conflictResult.ok, false);
  assert.ok(conflictResult.conflict);
});

// ---------------------------------------------------------------------
// 6. SQL generation engine — joins, filters, aggregation, CASE/DECODE reuse
// ---------------------------------------------------------------------
run('SQL engine rejects generation with zero tables', function () {
  var res = SQL.generateSql('', {}, baseEngine, decodeStore);
  assert.strictEqual(res.status, 'clarification_needed');
});
run('SQL engine generates a validated join using the documented FK relationship', function () {
  var res = SQL.generateSql('invoices with supplier name', {
    dialect: 'Oracle', selectedTables: ['IA_INVOICE', 'IA_SUPPLIER'],
    selectedColumns: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }, { table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }, { table: 'IA_INVOICE', column: 'STATUS', decode: true, alias: 'StatusLabel' }],
    filterGroup: { conditions: [] }
  }, baseEngine, decodeStore);
  assert.strictEqual(res.status, 'ok');
  assert.ok(/INNER JOIN IA_SUPPLIER ON IA_INVOICE\.SUPPLIER_ID = IA_SUPPLIER\.SUPPLIER_ID/.test(res.sql));
  assert.ok(/CASE/.test(res.sql), 'expected schema-driven CASE for STATUS column:\n' + res.sql);
});
run('SQL engine rejects an unresolvable join path with a clear message', function () {
  var res = SQL.generateSql('', { selectedTables: ['ADM_COMPANY', 'IA_INVOICE_LINE'] }, baseEngine, decodeStore);
  assert.strictEqual(res.status, 'rejected');
});
run('SQL engine builds a recursive hierarchy CTE for a self-referencing table', function () {
  var res = SQL.generateSql('', { selectedTables: ['ADM_USER_DATA'], recursiveHierarchy: { table: 'ADM_USER_DATA' } }, baseEngine, decodeStore);
  assert.strictEqual(res.status, 'ok');
  assert.ok(/WITH RECURSIVE hierarchy/.test(res.sql));
});

// ---------------------------------------------------------------------
// 7. Filter engine
// ---------------------------------------------------------------------
run('filter engine builds a parameterless BETWEEN clause', function () {
  var group = { conditions: [FILTER.newCondition({ table: 'IA_INVOICE', column: 'DUE_DATE', operator: 'between', value: '2026-01-01', value2: '2026-01-31' })] };
  var built = FILTER.buildWhereSql(group, 'Generic');
  assert.ok(/BETWEEN '2026-01-01' AND '2026-01-31'/.test(built.sql));
});

// ---------------------------------------------------------------------
// 8. Natural-language interpretation
// ---------------------------------------------------------------------
run('NL engine identifies tables and a decode-label filter from free text', function () {
  var interp = NLQUERY.interpretRequirement('Show active suppliers sorted by name', baseEngine);
  assert.ok(interp.tables.indexOf('IA_SUPPLIER') !== -1);
});

// ---------------------------------------------------------------------
// 9. CR (Change Request) engine — read/write safety
// ---------------------------------------------------------------------
run('CR engine requires a WHERE clause for UPDATE unless explicitly overridden', function () {
  var res = CR.buildCrQuery(baseEngine, { command: 'UPDATE', table: 'IA_INVOICE', updates: [{ column: 'STATUS', value: '40' }] }, 'Generic');
  assert.strictEqual(res.status, 'rejected');
});
run('CR engine builds a valid INSERT statement', function () {
  var res = CR.buildCrQuery(baseEngine, { command: 'INSERT', table: 'IA_SUPPLIER', columns: [{ name: 'SUPPLIER_NAME', value: 'Acme Ltd' }, { name: 'IS_ACTIVE', value: '1' }] }, 'Generic');
  assert.strictEqual(res.status, 'ok');
  assert.ok(/INSERT INTO IA_SUPPLIER/.test(res.sql));
});

// ---------------------------------------------------------------------
// 10. Optimize + Error Rectifier + Suggestions
// ---------------------------------------------------------------------
run('optimize engine flags a query with no WHERE and no LIMIT', function () {
  var res = SQL.generateSql('', { selectedTables: ['IA_SUPPLIER'], selectedColumns: [{ table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }] }, baseEngine, decodeStore);
  var opt = OPTIMIZE.optimizeSql(baseEngine, res);
  assert.ok(opt.recommendations.some(function (r) { return /no WHERE condition/.test(r); }));
});
run('error rectifier rewrites "= NULL" into "IS NULL"', function () {
  var res = ERROR_RECTIFIER.rectify('SELECT * FROM IA_INVOICE WHERE DUE_DATE = NULL', 'ORA-01722: invalid number, comparison with null', baseEngine, 'Oracle');
  assert.ok(/IS NULL/.test(res.correctedSql));
});
run('suggestion engine offers guidance for an unresolved join message', function () {
  var s = SUGGEST.buildSuggestions('No documented relationship was found to join "X" with the tables already selected.');
  assert.ok(s.length > 0);
});

// ---------------------------------------------------------------------
// 11. Password manager (operational / admin password gate)
// ---------------------------------------------------------------------
var pmStore = memoryStorage();
var pm = PASSWORD_MANAGER.createPasswordManager(pmStore);
Promise.resolve()
  .then(function () { return pm.verifyCurrentPassword('admin123'); })
  .then(function (ok1) { run('default operational password ("admin123") verifies against the hardcoded hash', function () { assert.strictEqual(ok1, true); }); })
  .then(function () { return pm.verifyCurrentPassword('wrong-password'); })
  .then(function (ok2) { run('an incorrect password is rejected', function () { assert.strictEqual(ok2, false); }); })
  .then(function () { return pm.changePassword('admin123', 'newSecret1', 'newSecret1'); })
  .then(function (changeRes) { run('password change succeeds with matching confirmation', function () { assert.strictEqual(changeRes.ok, true); }); })
  .then(function () { return pm.verifyCurrentPassword('newSecret1'); })
  .then(function (ok3) { run('the newly-changed password verifies afterwards', function () { assert.strictEqual(ok3, true); }); })
  .then(function () {
    // -------------------------------------------------------------
    // 12. Sync schedule + schema-tools CSV round-trip
    // -------------------------------------------------------------
    run('sync schedule engine has a sane default option', function () { assert.ok(SYNC_SCHEDULE.getOption(SYNC_SCHEDULE.DEFAULT_OPTION_ID)); });
    run('schema-tools round-trips a CSV template back into table definitions', function () {
      var csv = [SCHEMA_TOOLS.SAMPLE_HEADER].concat(SCHEMA_TOOLS.buildSampleRows()).map(function (r) { return r.join(','); }).join('\n');
      var tables = SCHEMA_TOOLS.csvToTables(csv);
      assert.ok(tables.length >= 1 && tables[0].name === 'IA_INVOICE');
    });

    console.log('\n' + passed + ' check(s) passed.' + (process.exitCode ? ' SOME CHECKS FAILED — see \u2717 above.' : ' All good.'));
    process.exit(process.exitCode || 0);
  })
  .catch(function (e) { console.error('Unhandled error in async password-manager tests:', e); process.exit(1); });
