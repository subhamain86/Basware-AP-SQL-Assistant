'use strict';
var path = require('path');
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
var SCHEMA_ENGINE = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
var engine = SCHEMA_ENGINE.createEngine(schema);
test('getAllTables returns every table in the schema', function () { assertEqual(engine.getAllTables().length, schema.tables.length); });
test('getTable is case-insensitive', function () { assertEqual(engine.getTable('ia_invoice').name, 'IA_INVOICE'); });
test('getColumn finds a column, case-insensitively', function () { assertEqual(engine.getColumn('IA_INVOICE', 'invoice_number').name, 'INVOICE_NUMBER'); });
test('columnExists true/false', function () { assertTrue(engine.columnExists('IA_INVOICE', 'STATUS')); assertFalse(engine.columnExists('IA_INVOICE', 'NOPE')); });
test('getValueMap returns decode array', function () { assertEqual(engine.getValueMap('IA_INVOICE', 'STATUS').length, 4); });
test('findRelationship finds a direct FK both directions', function () {
  assertEqual(engine.findRelationship('IA_INVOICE', 'IA_SUPPLIER').fromColumn, 'SUPPLIER_ID');
  assertEqual(engine.findRelationship('IA_SUPPLIER', 'IA_INVOICE').toTable, 'IA_SUPPLIER');
});
test('getSelfReferencingEdges finds supervisor chain', function () {
  var edges = engine.getSelfReferencingEdges('ADM_USER_DATA');
  assertEqual(edges.length, 1); assertEqual(edges[0].fromColumn, 'SUPERVISOR_USER_ID');
});
test('getStatus reports accurate counts', function () {
  var st = engine.getStatus();
  assertEqual(st.tableCount, schema.tables.length);
  assertTrue(st.columnCount > 0);
});
