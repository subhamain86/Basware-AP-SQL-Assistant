'use strict';
var path = require('path');
if (typeof global.crypto === 'undefined') global.crypto = require('crypto').webcrypto;
var TOOLS = require(path.join(__dirname, '..', 'js', 'schema-tools.js'));
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
test('verifyPassword rejects wrong password', function () { return TOOLS.verifyPassword('wrong').then(function (ok) { assertFalse(ok); }); });
test('sha256Fallback stable 64-char hex', function () { var h = TOOLS.sha256Fallback('hello'); assertEqual(h.length, 64); assertTrue(/^[0-9a-f]{64}$/.test(h)); });
test('parseCsvText handles quotes/commas', function () { assertEqual(TOOLS.parseCsvText('A,B\n1,"a, b"')[1][1], 'a, b'); });
test('csvToTables rejects short file', function () { assertThrows(function () { TOOLS.csvToTables('OnlyHeader'); }); });
test('buildTablesFromFlatRows groups + decode/fk', function () { var r = TOOLS.buildTablesFromFlatRows(TOOLS.SAMPLE_HEADER, TOOLS.buildSampleRows()); assertEqual(r.tables.length, 2); var invoiceTable = r.tables.filter(function (t) { return t.name === 'IA_INVOICE'; })[0]; assertEqual(invoiceTable.columns.filter(function (c) { return c.name === 'STATUS'; })[0].decode.length, 4); });
test('validateSchema catches duplicates', function () { assertFalse(TOOLS.validateSchema([{ name: 'T1', columns: [{ name: 'A' }] }, { name: 'T1', columns: [{ name: 'B' }] }]).valid); assertTrue(TOOLS.validateSchema([{ name: 'T3', columns: [{ name: 'A' }] }]).valid); });
test('computeDiff counts additions', function () { assertEqual(TOOLS.computeDiff(schema, [{ name: 'NEW', module: 'IA', columns: [{ name: 'X' }] }]).addedTableCount, 1); });
test('mergeSchemas adds tables + bumps version', function () { var r = TOOLS.mergeSchemas(schema, [{ name: 'BRAND_NEW', module: 'ADM', columns: [{ name: 'ID' }] }], 'x.json'); assertTrue(r.addedTables.indexOf('BRAND_NEW') !== -1); assertEqual(r.previousSchemaBackup.tables.length, schema.tables.length); });
test('bumpVersion increments', function () { assertEqual(TOOLS.bumpVersion('10.7'), '10.8'); });
test('writeZip local header signature', function () { var z = TOOLS.writeZip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]); assertEqual(z[0], 0x50); assertEqual(z[1], 0x4b); });
test('detectFormat', function () { assertEqual(TOOLS.detectFormat('a.json'), '.json'); assertEqual(TOOLS.detectFormat('a.exe'), null); });
test('buildEmptySchema clears tables but keeps name/labels, never mutates input', function () {
  var before = JSON.stringify(schema);
  var empty = TOOLS.buildEmptySchema(schema);
  assertEqual(empty.tables.length, 0);
  assertEqual(empty.schema_name, schema.schema_name);
  assertEqual(empty.schema_version, '0.0');
  assertEqual(JSON.stringify(schema), before);
});
test('buildEmptySchema result still passes validateSchema', function () { assertTrue(TOOLS.validateSchema(TOOLS.buildEmptySchema(schema).tables).valid); });
test('saveRelationshipToSchema adds a foreign_key to the source column and bumps version', function () {
  var updated = TOOLS.saveRelationshipToSchema(schema, 'OM_ORDER', 'ORDER_ID', 'IA_INVOICE', 'INVOICE_ID');
  var col = updated.tables.filter(function (t) { return t.name === 'OM_ORDER'; })[0].columns.filter(function (c) { return c.name === 'ORDER_ID'; })[0];
  assertEqual(col.foreign_key, { table: 'IA_INVOICE', column: 'INVOICE_ID' });
  assertTrue(updated.schema_version !== schema.schema_version);
});
test('saveRelationshipToSchema never mutates the schema it was given', function () {
  var before = JSON.stringify(schema);
  TOOLS.saveRelationshipToSchema(schema, 'OM_ORDER', 'ORDER_ID', 'IA_INVOICE', 'INVOICE_ID');
  assertEqual(JSON.stringify(schema), before);
});
test('saveRelationshipToSchema throws clear errors for unknown table/column', function () {
  assertThrows(function () { TOOLS.saveRelationshipToSchema(schema, 'NOPE_TABLE', 'X', 'IA_INVOICE', 'INVOICE_ID'); });
  assertThrows(function () { TOOLS.saveRelationshipToSchema(schema, 'OM_ORDER', 'NOPE_COLUMN', 'IA_INVOICE', 'INVOICE_ID'); });
});
