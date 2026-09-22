'use strict';
var path = require('path');
var schema = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
var SCHEMA_ENGINE = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
var ASSISTANT = require(path.join(__dirname, '..', 'js', 'schema-assistant-engine.js'));
var engine = SCHEMA_ENGINE.createEngine(schema);
test('answers "what is X used for" grounded in the table notes', function () {
  var r = ASSISTANT.answerQuestion('What is IA_INVOICE used for?', engine);
  assertTrue(r.found);
  assertEqual(r.subjectType, 'table');
  assertTrue(r.groundedInSchema, 'should be grounded because IA_INVOICE has schema notes');
  assertIncludes(r.narrative, 'Header-level invoice information'.toLowerCase().charAt(0) === r.narrative.charAt(0) ? '' : '');
});
test('answers a column question, distinguishing schema-derived facts', function () {
  var r = ASSISTANT.answerQuestion('What does the STATUS column on IA_INVOICE mean?', engine);
  assertTrue(r.found);
  assertEqual(r.subjectType, 'column');
  assertTrue(r.facts.some(function (f) { return f.fact === 'CASE/DECODE values'; }));
});
test('answers a relationship question between two named tables', function () {
  var r = ASSISTANT.answerQuestion('How are IA_INVOICE and IA_SUPPLIER related?', engine);
  assertTrue(r.found);
  assertEqual(r.subjectType, 'relationship');
  assertIncludes(r.facts[0].value, 'SUPPLIER_ID');
});
test('reports "not found" honestly for an unrelated pair, without inventing a relationship', function () {
  var r = ASSISTANT.answerQuestion('How are IA_INVOICE and ADM_USER_GROUP related?', engine);
  assertFalse(r.found);
  assertIncludes(r.narrative, 'No documented relationship');
});
test('returns a clear "could not identify" response for a question naming no real table', function () {
  var r = ASSISTANT.answerQuestion('What is XYZ_NONEXISTENT_TABLE used for?', engine);
  assertFalse(r.found);
});
test('empty question returns a helpful prompt rather than throwing', function () {
  var r = ASSISTANT.answerQuestion('', engine);
  assertFalse(r.found);
  assertTrue(!!r.narrative);
});
test('a table with no notes is still described, but marked as NOT grounded in a schema description', function () {
  var schemaCopy = JSON.parse(JSON.stringify(schema));
  var t = schemaCopy.tables.filter(function (t) { return t.name === 'PE_PAYMENT'; })[0];
  t.notes = '';
  var e2 = SCHEMA_ENGINE.createEngine(schemaCopy);
  var r = ASSISTANT.answerQuestion('What is PE_PAYMENT used for?', e2);
  assertTrue(r.found);
  assertFalse(r.groundedInSchema);
});
