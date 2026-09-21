(function (root) {
  'use strict';
  var DATATYPE = (typeof module === 'object' && module.exports) ? require('./datatype-engine.js') : root.APSQL_DATATYPE;
  var DIALECTS = ['Oracle', 'SQL Server', 'PostgreSQL', 'MySQL', 'Generic'];
  function levenshtein(a, b) {
    a = String(a || ''); b = String(b || '');
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) { var cost = a[i - 1].toUpperCase() === b[j - 1].toUpperCase() ? 0 : 1; cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost); }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }
  function findClosestName(target, candidates, maxDistance) {
    if (!target || !candidates || !candidates.length) return null;
    var best = null, bestDist = Infinity;
    candidates.forEach(function (c) { if (String(c).toUpperCase() === String(target).toUpperCase()) return; var d = levenshtein(target, c); if (d < bestDist) { bestDist = d; best = c; } });
    var threshold = maxDistance != null ? maxDistance : Math.max(2, Math.ceil(String(target).length * 0.4));
    return (best && bestDist <= threshold) ? best : null;
  }
  function extractTables(sql) {
    var primary = null, joined = [];
    var fromMatch = sql.match(/\bFROM\s+([A-Za-z_][\w]*)/i);
    if (fromMatch) primary = fromMatch[1];
    var joinRe = /\bJOIN\s+([A-Za-z_][\w]*)/ig, jm;
    while ((jm = joinRe.exec(sql))) joined.push(jm[1]);
    return { primary: primary, joined: joined, all: (primary ? [primary] : []).concat(joined) };
  }
  function quoteIdentifierVariants(name) { return new RegExp('(["\'\\[`]?)\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b\\1', 'g'); }
  var RULE_CASE_ELSE_DATATYPE = {
    id: 'case-else-datatype',
    matchError: /inconsistent datatype|conversion failed|cannot convert|type mismatch|invalid.*use of|ORA-00932/i,
    apply: function (sql, ctx) {
      if (!DATATYPE) return null;
      var caseRe = /\bCASE\b[\s\S]*?\bELSE\s+([A-Za-z_][\w.]*)\s*(?=\bEND\b)/gi;
      var changes = []; var newSql = sql; var m; var anyFound = false;
      while ((m = caseRe.exec(sql))) {
        var colRef = m[1];
        var bareCol = colRef.indexOf('.') !== -1 ? colRef.split('.').pop() : colRef;
        var tableForCol = colRef.indexOf('.') !== -1 ? colRef.split('.')[0] : (ctx.tables.primary || ctx.tables.all[0]);
        var schemaCol = tableForCol ? ctx.engine.getColumn(tableForCol, bareCol) : null;
        if (!schemaCol && ctx.tables.all.length) { for (var i = 0; i < ctx.tables.all.length && !schemaCol; i++) schemaCol = ctx.engine.getColumn(ctx.tables.all[i], bareCol); }
        if (!schemaCol || !schemaCol.type) continue;
        if (!DATATYPE.needsConversion(schemaCol.type)) continue;
        var replacement = DATATYPE.getCompatibleElseExpression(colRef, schemaCol.type, ctx.dialect);
        if (replacement === colRef) continue;
        var fromFragment = 'ELSE ' + colRef; var toFragment = 'ELSE ' + replacement;
        if (newSql.indexOf(fromFragment) !== -1) { newSql = newSql.replace(fromFragment, toFragment); changes.push({ from: fromFragment, to: toFragment }); anyFound = true; }
      }
      if (!anyFound) return null;
      return { sql: newSql, identified: 'The CASE expression returns text values in the THEN clauses but returns a non-text column value directly in the ELSE clause, which most databases reject as an inconsistent-datatype error. This is schema-aware: the actual column data type documented in the active schema was used to determine the fix.', applied: 'The ELSE clause has been updated to convert the column to text (using syntax appropriate for the ' + ctx.dialect + ' dialect) so every branch of the CASE expression returns a compatible data type.', changes: changes };
    }
  };
  var RULE_INVALID_COLUMN = {
    id: 'invalid-column',
    matchError: /invalid identifier|invalid column name|column .* does not exist|unknown column|ORA-00904/i,
    apply: function (sql, ctx) {
      var idMatch = ctx.errorText.match(/"([A-Za-z_][\w]*)"|'([A-Za-z_][\w]*)'|\[([A-Za-z_][\w]*)\]|`([A-Za-z_][\w]*)`/);
      var bad = idMatch ? (idMatch[1] || idMatch[2] || idMatch[3] || idMatch[4]) : null;
      if (!bad) return null;
      if (!sql.match(quoteIdentifierVariants(bad))) return null;
      var candidateCols = [];
      ctx.tables.all.forEach(function (t) { var tbl = ctx.engine.getTable(t); if (tbl) tbl.columns.forEach(function (c) { candidateCols.push(c.name); }); });
      var suggestion = findClosestName(bad, candidateCols);
      if (!suggestion) return null;
      var re = quoteIdentifierVariants(bad);
      var newSql = sql.replace(re, function (whole, quote) { return quote + suggestion + quote; });
      if (newSql === sql) return null;
      return { sql: newSql, identified: 'The column "' + bad + '" referenced in the SQL does not appear to exist in the active schema for the table(s) used in this query.', applied: 'Replaced "' + bad + '" with "' + suggestion + '", the closest matching column name found in the active schema.', changes: [{ from: bad, to: suggestion }] };
    }
  };
  var RULE_INVALID_TABLE = {
    id: 'invalid-table',
    matchError: /table or view does not exist|invalid object name|relation .* does not exist|doesn.t exist|ORA-00942/i,
    apply: function (sql, ctx) {
      var idMatch = ctx.errorText.match(/"([A-Za-z_][\w]*)"|'([A-Za-z_][\w]*)'|\[([A-Za-z_][\w]*)\]|`([A-Za-z_][\w]*)`/);
      var bad = idMatch ? (idMatch[1] || idMatch[2] || idMatch[3] || idMatch[4]) : (ctx.tables.primary && !ctx.engine.getTable(ctx.tables.primary) ? ctx.tables.primary : null);
      if (!bad) return null;
      if (ctx.engine.getTable(bad)) return null;
      var allTableNames = ctx.engine.getAllTables().map(function (t) { return t.name; });
      var suggestion = findClosestName(bad, allTableNames);
      if (!suggestion) return null;
      var re = quoteIdentifierVariants(bad);
      var newSql = sql.replace(re, function (whole, quote) { return quote + suggestion + quote; });
      if (newSql === sql) return null;
      return { sql: newSql, identified: 'The table "' + bad + '" referenced in the SQL does not appear to exist in the active schema.', applied: 'Replaced "' + bad + '" with "' + suggestion + '", the closest matching table name found in the active schema.', changes: [{ from: bad, to: suggestion }] };
    }
  };
  var RULE_NULL_COMPARISON = {
    id: 'null-comparison', matchError: /null/i, alwaysTry: true,
    apply: function (sql) {
      var changes = []; var newSql = sql;
      newSql = newSql.replace(/([\w.]+)\s*=\s*NULL\b/gi, function (whole, colRef) { changes.push({ from: colRef + ' = NULL', to: colRef + ' IS NULL' }); return colRef + ' IS NULL'; });
      newSql = newSql.replace(/([\w.]+)\s*(?:<>|!=)\s*NULL\b/gi, function (whole, colRef) { changes.push({ from: colRef + ' <> NULL', to: colRef + ' IS NOT NULL' }); return colRef + ' IS NOT NULL'; });
      if (!changes.length) return null;
      return { sql: newSql, identified: 'The SQL compares a column to NULL using "=" or "<>", which does not work as expected in standard SQL.', applied: 'Rewrote the comparison(s) to use "IS NULL" / "IS NOT NULL".', changes: changes };
    }
  };
  var RULE_TRAILING_COMMA = {
    id: 'trailing-comma', matchError: /sql command not properly ended|incorrect syntax near|syntax error at or near|you have an error in your sql syntax|ORA-00933|ORA-00936/i, alwaysTry: true,
    apply: function (sql) {
      var changes = []; var newSql = sql;
      newSql = newSql.replace(/,(\s*)(FROM|WHERE|GROUP BY|ORDER BY|HAVING)\b/gi, function (whole, ws, kw) { changes.push({ from: ',' + ws + kw, to: ws + kw }); return ws + kw; });
      newSql = newSql.replace(/,(\s*\))/g, function (whole, tail) { changes.push({ from: ',' + tail, to: tail }); return tail; });
      if (!changes.length) return null;
      return { sql: newSql, identified: 'The SQL contains a stray comma immediately before a keyword or closing parenthesis.', applied: 'Removed the stray trailing comma.', changes: changes };
    }
  };
  var RULE_JOIN_RELATIONSHIP = {
    id: 'join-relationship', matchError: /invalid.*join|ambiguous column|join condition|on clause/i,
    apply: function (sql, ctx) {
      var onRe = /JOIN\s+([A-Za-z_][\w]*)[\s\S]*?\bON\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)/i;
      var m = sql.match(onRe); if (!m) return null;
      var leftTable = m[2], leftCol = m[3], rightTable = m[4], rightCol = m[5];
      var leftOk = ctx.engine.columnExists(leftTable, leftCol); var rightOk = ctx.engine.columnExists(rightTable, rightCol);
      if (leftOk && rightOk) return null;
      var rel = ctx.engine.findRelationship(leftTable, rightTable); if (!rel) return null;
      var fromFragment = leftTable + '.' + leftCol + ' = ' + rightTable + '.' + rightCol;
      var toFragment = rel.fromTable + '.' + rel.fromColumn + ' = ' + rel.toTable + '.' + rel.toColumn;
      if (sql.indexOf(fromFragment) === -1) return null;
      var newSql = sql.replace(fromFragment, toFragment);
      return { sql: newSql, identified: 'The JOIN condition references a column that does not exist on one of the joined tables.', applied: 'Replaced the join condition with the relationship documented in the active schema between ' + leftTable + ' and ' + rightTable + '.', changes: [{ from: fromFragment, to: toFragment }] };
    }
  };
  var RULES = [RULE_CASE_ELSE_DATATYPE, RULE_INVALID_COLUMN, RULE_INVALID_TABLE, RULE_JOIN_RELATIONSHIP, RULE_NULL_COMPARISON, RULE_TRAILING_COMMA];
  function detectDialectFromError(errorText) {
    var t = String(errorText || '');
    if (/ORA-\d{5}/i.test(t)) return 'Oracle';
    if (/Msg \d+, Level \d+, State \d+|Incorrect syntax near|\[Microsoft\]\[ODBC/i.test(t)) return 'SQL Server';
    if (/^ERROR:\s|relation ".*" does not exist|PG::/i.test(t)) return 'PostgreSQL';
    if (/You have an error in your SQL syntax|MySQL server version/i.test(t)) return 'MySQL';
    return null;
  }
  function rectify(sql, errorText, engine, dialect) {
    sql = String(sql || ''); errorText = String(errorText || '');
    dialect = DIALECTS.indexOf(dialect) !== -1 ? dialect : 'Generic';
    var ctx = { engine: engine, dialect: dialect, errorText: errorText, tables: extractTables(sql) };
    if (!sql.trim()) return { correctedSql: sql, changed: false, errorIdentified: 'No SQL was supplied to analyze.', correctionApplied: 'Please paste the SQL query that produced the error, then try again.', changes: [], ruleId: null };
    var matched = RULES.filter(function (r) { return r.matchError && r.matchError.test(errorText); });
    for (var i = 0; i < matched.length; i++) { var res = matched[i].apply(sql, ctx); if (res) return { correctedSql: res.sql, changed: true, errorIdentified: res.identified, correctionApplied: res.applied, changes: res.changes, ruleId: matched[i].id }; }
    var fallback = RULES.filter(function (r) { return r.alwaysTry && matched.indexOf(r) === -1; });
    for (var j = 0; j < fallback.length; j++) { var res2 = fallback[j].apply(sql, ctx); if (res2) return { correctedSql: res2.sql, changed: true, errorIdentified: res2.identified, correctionApplied: res2.applied, changes: res2.changes, ruleId: fallback[j].id }; }
    return { correctedSql: sql, changed: false, errorIdentified: 'No specific, schema-supported correction could be automatically determined for this error.', correctionApplied: 'No automatic change was made, to avoid guessing. Please review the SQL and error manually.', changes: [], ruleId: null };
  }
  var API = { rectify: rectify, detectDialectFromError: detectDialectFromError, levenshtein: levenshtein, findClosestName: findClosestName, extractTables: extractTables, DIALECTS: DIALECTS, RULES: RULES };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_ERROR_RECTIFIER = API;
})(typeof window !== 'undefined' ? window : this);
