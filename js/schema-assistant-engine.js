/**
 * schema-assistant-engine.js — AP-SQL Assistant V11.8
 * AI Schema Assistant (spec section 24). Answers plain-language
 * questions about the active schema ("What is this table used for?",
 * "How are IA_INVOICE and IA_SUPPLIER related?", "What does the
 * STATUS column on IA_INVOICE mean?") strictly from schema metadata
 * that already exists (table notes, column descriptions, PK/FK,
 * decode definitions) — never invented. Every answer is tagged with
 * where the fact came from, so schema-derived facts are always
 * clearly distinguished from any interpretive narration added around
 * them (spec section 24: "must clearly distinguish schema-derived
 * facts from AI interpretation").
 */
(function (root) {
  'use strict';
  function up(s) { return String(s || '').toUpperCase(); }
  function tokenize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(' ').filter(Boolean); }

  function findMentionedTable(question, engine) {
    var qUpper = up(question);
    var tables = engine.getAllTables();
    var exact = tables.filter(function (t) { return qUpper.indexOf(t.name) !== -1; });
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return exact.sort(function (a, b) { return b.name.length - a.name.length; })[0];
    var qWords = tokenize(question);
    var best = null, bestScore = 0;
    tables.forEach(function (t) {
      var bare = t.name.replace(/^[A-Z]+_/, '').toLowerCase();
      var score = qWords.filter(function (w) { return bare.indexOf(w) !== -1 || w.indexOf(bare) !== -1; }).length;
      if (score > bestScore) { bestScore = score; best = t; }
    });
    return bestScore > 0 ? best : null;
  }
  function findMentionedColumn(question, engine, table) {
    if (!table) return null;
    var qUpper = up(question);
    var exact = table.columns.filter(function (c) { return qUpper.indexOf(c.name) !== -1; });
    if (exact.length) return exact.sort(function (a, b) { return b.name.length - a.name.length; })[0];
    return null;
  }
  function describeTable(table, engine) {
    var facts = [];
    facts.push({ fact: 'Module', value: table.module });
    if (table.notes) facts.push({ fact: 'Description (from schema)', value: table.notes });
    var pk = table.columns.filter(function (c) { return c.primary_key; }).map(function (c) { return c.name; });
    if (pk.length) facts.push({ fact: 'Primary key', value: pk.join(', ') });
    var outgoingFks = table.columns.filter(function (c) { return c.foreign_key; }).map(function (c) { return c.name + ' \u2192 ' + c.foreign_key.table + '.' + c.foreign_key.column; });
    if (outgoingFks.length) facts.push({ fact: 'References (foreign keys)', value: outgoingFks.join('; ') });
    var incoming = [];
    engine.getAllTables().forEach(function (t2) {
      if (t2.name === table.name) return;
      t2.columns.forEach(function (c2) { if (c2.foreign_key && up(c2.foreign_key.table) === up(table.name)) incoming.push(t2.name + '.' + c2.name); });
    });
    if (incoming.length) facts.push({ fact: 'Referenced by', value: incoming.join(', ') });
    facts.push({ fact: 'Column count', value: String(table.columns.length) });
    var narrative = table.notes
      ? ('Based on the schema description, ' + table.name + ' ' + (/^[A-Z]/.test(table.notes) ? table.notes.charAt(0).toLowerCase() + table.notes.slice(1) : table.notes) + '.')
      : ('The active schema does not include a description for ' + table.name + '; the facts below are derived only from its structure (columns, primary key, and relationships).');
    return { found: true, subject: table.name, subjectType: 'table', facts: facts, narrative: narrative, groundedInSchema: !!table.notes };
  }
  function describeColumn(table, column, engine) {
    var facts = [];
    facts.push({ fact: 'Table', value: table.name });
    facts.push({ fact: 'Data type', value: column.type || 'Not specified in schema' });
    facts.push({ fact: 'Nullable', value: column.nullable === false ? 'No' : 'Yes' });
    if (column.primary_key) facts.push({ fact: 'Role', value: 'Primary key' });
    if (column.foreign_key) facts.push({ fact: 'Foreign key', value: 'References ' + column.foreign_key.table + '.' + column.foreign_key.column });
    if (column.alias) facts.push({ fact: 'Alias', value: column.alias });
    if (column.description) facts.push({ fact: 'Description (from schema)', value: column.description });
    if (Array.isArray(column.decode) && column.decode.length) facts.push({ fact: 'CASE/DECODE values', value: column.decode.map(function (p) { return p.code + ' = ' + p.label; }).join('; ') });
    var narrative = column.description
      ? ('Based on the schema description: ' + column.description)
      : ('The active schema does not include a description for this column; the facts above come only from its declared data type, keys, and any documented decode values.');
    return { found: true, subject: table.name + '.' + column.name, subjectType: 'column', facts: facts, narrative: narrative, groundedInSchema: !!column.description };
  }
  function describeRelationship(tableA, tableB, engine) {
    var rel = engine.findRelationship(tableA.name, tableB.name);
    if (!rel) {
      return { found: false, subject: tableA.name + ' \u2194 ' + tableB.name, subjectType: 'relationship', facts: [], narrative: 'No documented relationship was found between ' + tableA.name + ' and ' + tableB.name + ' in the active schema. If these tables should be related, add the relationship via Update Schema or the "Save relationship to schema" option in the Query Builder.', groundedInSchema: false };
    }
    var facts = [{ fact: 'Foreign key', value: rel.fromTable + '.' + rel.fromColumn + ' \u2192 ' + rel.toTable + '.' + rel.toColumn }];
    return { found: true, subject: rel.fromTable + ' \u2194 ' + rel.toTable, subjectType: 'relationship', facts: facts, narrative: rel.fromTable + ' connects to ' + rel.toTable + ' through ' + rel.fromColumn + ', which references ' + rel.toTable + '.' + rel.toColumn + '.', groundedInSchema: true };
  }
  function answerQuestion(question, engine) {
    question = String(question || '').trim();
    if (!question) return { found: false, subject: null, subjectType: null, facts: [], narrative: 'Please ask a question about a table, column, or relationship in the active schema.', groundedInSchema: false };
    var isRelationshipQuestion = /relat|connect|join|link/i.test(question);
    var mentionedTables = engine.getAllTables().filter(function (t) { return up(question).indexOf(t.name) !== -1; });
    if (isRelationshipQuestion && mentionedTables.length >= 2) return describeRelationship(mentionedTables[0], mentionedTables[1], engine);
    var table = findMentionedTable(question, engine);
    if (!table) return { found: false, subject: null, subjectType: null, facts: [], narrative: 'Could not identify which table or column this question refers to. Try naming the exact table (e.g. "IA_INVOICE") or column.', groundedInSchema: false };
    var column = findMentionedColumn(question, engine, table);
    if (column) return describeColumn(table, column, engine);
    return describeTable(table, engine);
  }
  var API = { answerQuestion: answerQuestion, findMentionedTable: findMentionedTable, findMentionedColumn: findMentionedColumn, describeTable: describeTable, describeColumn: describeColumn, describeRelationship: describeRelationship };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_ASSISTANT = API;
})(typeof window !== 'undefined' ? window : this);
