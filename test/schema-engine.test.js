'use strict';
var path = require('path');
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
var SCHEMA_ENGINE = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
var engine = SCHEMA_ENGINE.createEngine(schema);

test('getAllTables returns every table in the schema', function () { assertEqual(engine.getAllTables().length, schema.tables.length); });
test('getTable finds a table by exact name', function () { assertEqual(engine.getTable('IA_INVOICE').name, 'IA_INVOICE'); });
test('getTable is case-insensitive', function () { assertEqual(engine.getTable('ia_invoice').name, 'IA_INVOICE'); });
test('getTable returns null for an unknown table', function () { assertEqual(engine.getTable('NOPE'), null); });
test('tableExists true/false', function () { assertTrue(engine.tableExists('IA_INVOICE')); assertFalse(engine.tableExists('NOPE')); });
test('getColumn finds a column by exact name, case-insensitively', function () {
  assertEqual(engine.getColumn('IA_INVOICE', 'INVOICE_NUMBER').name, 'INVOICE_NUMBER');
  assertEqual(engine.getColumn('IA_INVOICE', 'invoice_number').name, 'INVOICE_NUMBER');
});
test('getColumn returns null for unknown table or column', function () { assertEqual(engine.getColumn('NOPE', 'X'), null); assertEqual(engine.getColumn('IA_INVOICE', 'NOPE'), null); });
test('columnExists true/false', function () { assertTrue(engine.columnExists('IA_INVOICE', 'STATUS')); assertFalse(engine.columnExists('IA_INVOICE', 'NOPE')); });
test('getModuleLabels returns the schema module_labels object', function () { assertEqual(engine.getModuleLabels().IA, 'Invoice Automation'); });
test('getValueMap returns the decode array for a column that has one', function () { assertEqual(engine.getValueMap('IA_INVOICE', 'STATUS').length, 4); });
test('getValueMap returns null for a column with no decode', function () { assertEqual(engine.getValueMap('IA_INVOICE', 'INVOICE_NUMBER'), null); });
test('findRelationship finds a direct FK from A to B', function () {
  var rel = engine.findRelationship('IA_INVOICE', 'IA_SUPPLIER');
  assertEqual(rel.fromTable, 'IA_INVOICE'); assertEqual(rel.fromColumn, 'SUPPLIER_ID');
  assertEqual(rel.toTable, 'IA_SUPPLIER'); assertEqual(rel.toColumn, 'SUPPLIER_ID');
});
test('findRelationship also finds the reverse direction (FK on B pointing to A)', function () {
  var rel = engine.findRelationship('IA_SUPPLIER', 'IA_INVOICE');
  assertEqual(rel.fromTable, 'IA_INVOICE'); assertEqual(rel.toTable, 'IA_SUPPLIER');
});
test('findRelationship returns null when no relationship exists', function () { assertEqual(engine.findRelationship('IA_INVOICE', 'ADM_USER_GROUP'), null); });
test('getSelfReferencingEdges finds a self-referencing FK (e.g. ADM_USER_DATA supervisor chain)', function () {
  var edges = engine.getSelfReferencingEdges('ADM_USER_DATA');
  assertEqual(edges.length, 1); assertEqual(edges[0].fromColumn, 'SUPERVISOR_USER_ID'); assertEqual(edges[0].toColumn, 'USER_ID');
});
test('getSelfReferencingEdges returns an empty array for a table with no self-reference', function () { assertEqual(engine.getSelfReferencingEdges('IA_INVOICE').length, 0); });
test('getStatus reports accurate counts', function () {
  var st = engine.getStatus();
  assertEqual(st.schemaName, schema.schema_name);
  assertEqual(st.tableCount, schema.tables.length);
  assertTrue(st.columnCount > 0);
  assertTrue(st.moduleCount > 0);
});
test('createEngine tolerates a schema with no tables array at all', function () {
  var emptyEngine = SCHEMA_ENGINE.createEngine({});
  assertEqual(emptyEngine.getAllTables().length, 0);
  assertEqual(emptyEngine.getStatus().tableCount, 0);
});
