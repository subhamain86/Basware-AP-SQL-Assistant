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
      for (j = 1; j <= n; j++) {
        var cost = a[i - 1].toUpperCase() === b[j - 1].toUpperCase() ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }
  function findClosestName(target, candidates, maxDistance) {
    if (!target || !candidates || !candidates.length) return null;
    var best = null, bestDist = Infinity;
    candidates.forEach(function (c) {
      if (String(c).toUpperCase() === String(target).toUpperCase()) return;
      var d = levenshtein(target, c);
      if (d < bestDist) { bestDist = d; best = c; }
    });
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
  function quoteIdentifierVariants(name) {
    return new RegExp('(["\'\\[`]?)\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b\\1', 'g');
  }

  var RULE_CASE_ELSE_DATATYPE = {
    id: 'case-else-datatype',
    matchError: /inconsistent datatype|conversion failed|cannot convert|type mismatch|invalid.*use of|ORA-00932/i,
    apply: function (sql, ctx) {
      if (!DATATYPE) return null;
      var caseRe = /\bCASE\b[\s\S]*?\bELSE\s+([A-Za-z_][\w\.]*)\s*(?=\bEND\b)/gi;
      var changes = []; var newSql = sql; var m; var anyFound = false;
      while ((m = caseRe.exec(sql))) {
        var colRef = m[1];
        var bareCol = colRef.indexOf('.') !== -1 ? colRef.split('.').pop() : colRef;
        var tableForCol = colRef.indexOf('.') !== -1 ? colRef.split('.')[0] : (ctx.tables.primary || ctx.tables.all[0]);
        var schemaCol = tableForCol ? ctx.engine.getColumn(tableForCol, bareCol) : null;
        if (!schemaCol && ctx.tables.all.length) {
          for (var i = 0; i < ctx.tables.all.length && !schemaCol; i++) schemaCol = ctx.engine.getColumn(ctx.tables.all[i], bareCol);
        }
        if (!schemaCol || !schemaCol.type) continue;
        if (!DATATYPE.needsConversion(schemaCol.type)) continue;
        var replacement = DATATYPE.getCompatibleElseExpression(colRef, schemaCol.type, ctx.dialect);
        if (replacement === colRef) continue;
        var fromFragment = 'ELSE ' + colRef;
        var toFragment = 'ELSE ' + replacement;
        if (newSql.indexOf(fromFragment) !== -1) {
          newSql = newSql.replace(fromFragment, toFragment);
          changes.push({ from: fromFragment, to: toFragment });
          anyFound = true;
        }
      }
      if (!anyFound) return null;
      return {
        sql: newSql,
        identified: 'The CASE expression returns text values in the THEN clauses but returns a non-text column value directly in the ELSE clause, which most databases reject as an inconsistent-datatype error.',
        applied: 'The ELSE clause has been updated to convert the column to text (using the syntax appropriate for the ' + ctx.dialect + ' dialect) so that every branch of the CASE expression returns a compatible data type.',
        changes: changes
      };
    }
  };

  var RULE_WHERE_DATATYPE = {
    id: 'where-comparison-datatype',
    matchError: /inconsistent datatype|conversion failed|cannot convert|type mismatch|incorrect syntax near|operator does not exist|ORA-00932/i,
    apply: function (sql, ctx) {
      var whereMatch = sql.match(/\bWHERE\b([\s\S]*?)(?:\bGROUP BY\b|\bORDER BY\b|\bHAVING\b|;|$)/i);
      if (!whereMatch) return null;
      var whereText = whereMatch[1];
      var cmpRe = /([A-Za-z_][\w]*\.)?([A-Za-z_][\w]*)\s*(=|<>|!=)\s*'([^']*)'/g;
      var changes = []; var newSql = sql; var m;
      while ((m = cmpRe.exec(whereText))) {
        var tablePrefix = m[1] ? m[1].slice(0, -1) : (ctx.tables.primary || ctx.tables.all[0]);
        var colName = m[2], op = m[3], literal = m[4];
        var schemaCol = tablePrefix ? ctx.engine.getColumn(tablePrefix, colName) : null;
        if (!schemaCol) continue;
        var category = DATATYPE ? DATATYPE.classify(schemaCol.type) : 'unknown';
        if (category !== 'numeric') continue;
        if (!/^-?\d+(\.\d+)?$/.test(literal)) continue;
        var fromFragment = (m[1] || '') + colName + ' ' + op + " '" + literal + "'";
        var toFragment = (m[1] || '') + colName + ' ' + op + ' ' + literal;
        if (newSql.indexOf(fromFragment) !== -1) {
          newSql = newSql.replace(fromFragment, toFragment);
          changes.push({ from: fromFragment, to: toFragment });
        }
      }
      if (!changes.length) return null;
      return {
        sql: newSql,
        identified: 'A WHERE condition compares a numeric column against a quoted text literal, which some databases reject as an inconsistent-datatype error.',
        applied: 'The quotes have been removed from the numeric literal so the comparison uses matching data types on both sides.',
        changes: changes
      };
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
      return {
        sql: newSql,
        identified: 'The column "' + bad + '" referenced in the SQL does not appear to exist in the active schema for the table(s) used in this query.',
        applied: 'Replaced "' + bad + '" with "' + suggestion + '", the closest matching column name found in the active schema for the table(s) in this query.',
        changes: [{ from: bad, to: suggestion }]
      };
    }
  };

  var RULE_INVALID_TABLE = {
    id: 'invalid-table',
    matchError: /table or view does not exist|invalid object name|relation .* does not exist|doesn.t exist|ORA-00942/i,
    apply: function (sql, ctx) {
      var idMatch = ctx.errorText.match(/"([A-Za-z_][\w]*)"|'([A-Za-z_][\w]*)"?|\[([A-Za-z_][\w]*)\]|`([A-Za-z_][\w]*)`/);
      var bad = idMatch ? (idMatch[1] || idMatch[2] || idMatch[3] || idMatch[4]) : (ctx.tables.primary && !ctx.engine.getTable(ctx.tables.primary) ? ctx.tables.primary : null);
      if (!bad) return null;
      if (ctx.engine.getTable(bad)) return null;
      var allTableNames = ctx.engine.getAllTables().map(function (t) { return t.name; });
      var suggestion = findClosestName(bad, allTableNames);
      if (!suggestion) return null;
      var re = quoteIdentifierVariants(bad);
      var newSql = sql.replace(re, function (whole, quote) { return quote + suggestion + quote; });
      if (newSql === sql) return null;
      return {
        sql: newSql,
        identified: 'The table "' + bad + '" referenced in the SQL does not appear to exist in the active schema.',
        applied: 'Replaced "' + bad + '" with "' + suggestion + '", the closest matching table name found in the active schema.',
        changes: [{ from: bad, to: suggestion }]
      };
    }
  };

  var AGG_FUNCS = /^(COUNT|SUM|AVG|MIN|MAX)\s*\(/i;
  var RULE_GROUP_BY = {
    id: 'group-by-missing-column',
    matchError: /not a group by expression|not contained in either an aggregate function or the group by clause|must appear in the group by clause|ORA-00979/i,
    apply: function (sql, ctx) {
      var selectMatch = sql.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
      if (!selectMatch) return null;
      var selectItems = splitTopLevel(selectMatch[1]);
      var nonAggCols = selectItems.map(function (s) { return s.trim(); }).filter(function (s) { return s && !AGG_FUNCS.test(s) && !/^\*/.test(s); }).map(function (s) { return s.replace(/\s+AS\s+\w+$/i, '').trim(); });
      if (!nonAggCols.length) return null;
      var hasAgg = selectItems.some(function (s) { return AGG_FUNCS.test(s.trim()); });
      if (!hasAgg) return null;
      var groupByMatch = sql.match(/\bGROUP BY\b([\s\S]*?)(?:\bHAVING\b|\bORDER BY\b|;|$)/i);
      var existingGroupCols = groupByMatch ? splitTopLevel(groupByMatch[1]).map(function (s) { return s.trim(); }) : [];
      var missing = nonAggCols.filter(function (c) { return existingGroupCols.indexOf(c) === -1; });
      if (!missing.length) return null;
      var newSql;
      if (groupByMatch) {
        var oldClause = 'GROUP BY' + groupByMatch[1];
        var newClause = 'GROUP BY' + groupByMatch[1].replace(/\s*$/, '') + ', ' + missing.join(', ');
        newSql = sql.replace(oldClause, newClause);
      } else {
        var insertAfter = sql.match(/\bFROM\b[\s\S]*?(?=\bWHERE\b|\bORDER BY\b|;|$)/i);
        if (!insertAfter) return null;
        newSql = sql.slice(0, insertAfter.index + insertAfter[0].length) + '\nGROUP BY ' + nonAggCols.join(', ') + sql.slice(insertAfter.index + insertAfter[0].length);
      }
      return {
        sql: newSql,
        identified: 'The SELECT list includes column(s) that are neither wrapped in an aggregate function (COUNT/SUM/AVG/MIN/MAX) nor listed in the GROUP BY clause.',
        applied: 'Added the missing column(s) \u2014 ' + missing.join(', ') + ' \u2014 to the GROUP BY clause so every non-aggregated SELECT column is accounted for.',
        changes: [{ from: groupByMatch ? ('GROUP BY' + groupByMatch[1]) : '(no GROUP BY clause)', to: 'GROUP BY ' + (groupByMatch ? existingGroupCols.concat(missing).join(', ') : nonAggCols.join(', ')) }]
      };
    }
  };
  function splitTopLevel(text) {
    var parts = []; var depth = 0; var current = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '(') depth++; if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  var RULE_DATE_FORMAT = {
    id: 'date-format',
    matchError: /does not match the format string|literal does not match|conversion failed when converting date|invalid datetime format|date\/time field value out of range|ORA-01861|ORA-01858/i,
    apply: function (sql, ctx) {
      if (!DATATYPE) return null;
      var cmpRe = /([A-Za-z_][\w]*\.)?([A-Za-z_][\w]*)\s*(=|>=|<=|>|<)\s*'([^']*)'/g;
      var changes = []; var newSql = sql; var m;
      while ((m = cmpRe.exec(sql))) {
        var tablePrefix = m[1] ? m[1].slice(0, -1) : (ctx.tables.primary || ctx.tables.all[0]);
        var colName = m[2], op = m[3], literal = m[4];
        var schemaCol = tablePrefix ? ctx.engine.getColumn(tablePrefix, colName) : null;
        if (!schemaCol) continue;
        var category = DATATYPE.classify(schemaCol.type);
        if (category !== 'date' && category !== 'timestamp') continue;
        if (!/^\d{4}-\d{2}-\d{2}/.test(literal)) continue;
        var wrapped = DATATYPE.wrapDateLiteral("'" + literal + "'", ctx.dialect);
        var fromFragment = (m[1] || '') + colName + ' ' + op + " '" + literal + "'";
        var toFragment = (m[1] || '') + colName + ' ' + op + ' ' + wrapped;
        if (newSql.indexOf(fromFragment) !== -1 && fromFragment !== toFragment) {
          newSql = newSql.replace(fromFragment, toFragment);
          changes.push({ from: fromFragment, to: toFragment });
        }
      }
      if (!changes.length) return null;
      return {
        sql: newSql,
        identified: 'A date/timestamp column is being compared against a plain text literal, which some databases cannot implicitly interpret as a date.',
        applied: 'Wrapped the date literal(s) in the date-parsing syntax appropriate for the ' + ctx.dialect + ' dialect.',
        changes: changes
      };
    }
  };

  var RULE_NULL_COMPARISON = {
    id: 'null-comparison',
    matchError: /null/i, alwaysTry: true,
    apply: function (sql) {
      var changes = []; var newSql = sql;
      newSql = newSql.replace(/([\w.]+)\s*=\s*NULL\b/gi, function (whole, colRef) { changes.push({ from: colRef + ' = NULL', to: colRef + ' IS NULL' }); return colRef + ' IS NULL'; });
      newSql = newSql.replace(/([\w.]+)\s*(?:<>|!=)\s*NULL\b/gi, function (whole, colRef) { changes.push({ from: colRef + ' <> NULL', to: colRef + ' IS NOT NULL' }); return colRef + ' IS NOT NULL'; });
      if (!changes.length) return null;
      return {
        sql: newSql,
        identified: 'The SQL compares a column to NULL using "=" or "<>", which does not work as expected in standard SQL (NULL is never equal or unequal to anything, including itself).',
        applied: 'Rewrote the comparison(s) to use "IS NULL" / "IS NOT NULL", which is the correct way to test for NULL in SQL.',
        changes: changes
      };
    }
  };

  var RULE_TRAILING_COMMA = {
    id: 'trailing-comma',
    matchError: /sql command not properly ended|incorrect syntax near|syntax error at or near|you have an error in your sql syntax|ORA-00933|ORA-00936/i, alwaysTry: true,
    apply: function (sql) {
      var changes = []; var newSql = sql;
      newSql = newSql.replace(/,(\s*)(FROM|WHERE|GROUP BY|ORDER BY|HAVING)\b/gi, function (whole, ws, kw) { changes.push({ from: ',' + ws + kw, to: ws + kw }); return ws + kw; });
      newSql = newSql.replace(/,(\s*\))/g, function (whole, tail) { changes.push({ from: ',' + tail, to: tail }); return tail; });
      if (!changes.length) return null;
      return {
        sql: newSql,
        identified: 'The SQL contains a stray comma immediately before a keyword or closing parenthesis, which most databases treat as a syntax error.',
        applied: 'Removed the stray trailing comma.',
        changes: changes
      };
    }
  };

  var NULLFN_BY_DIALECT = { 'Oracle': 'NVL', 'SQL Server': 'ISNULL', 'PostgreSQL': 'COALESCE', 'MySQL': 'IFNULL', 'Generic': 'COALESCE' };
  var ALL_NULLFNS = ['NVL', 'ISNULL', 'IFNULL', 'COALESCE'];
  var RULE_NULLFN_DIALECT = {
    id: 'nullfn-dialect',
    matchError: /invalid identifier|is not a recognized|function .* does not exist|unknown function|not a valid function|invalid procedure or function|ORA-00904/i, alwaysTry: true,
    apply: function (sql, ctx) {
      var correct = NULLFN_BY_DIALECT[ctx.dialect] || 'COALESCE';
      var changes = []; var newSql = sql;
      ALL_NULLFNS.forEach(function (fn) {
        if (fn === correct) return;
        var re = new RegExp('\\b' + fn + '\\s*\\(', 'gi');
        var m;
        while ((m = re.exec(sql))) {
          var start = m.index + m[0].length; var depth = 1; var i = start; var argText = '';
          while (i < sql.length && depth > 0) { var ch = sql[i]; if (ch === '(') depth++; if (ch === ')') depth--; if (depth > 0) argText += ch; i++; }
          var argCount = splitTopLevel(argText).length;
          if ((correct === 'ISNULL' || correct === 'NVL' || correct === 'IFNULL') && argCount !== 2) continue;
          var fromFragment = fn + '(' + argText + ')';
          var toFragment = correct + '(' + argText + ')';
          if (newSql.indexOf(fromFragment) !== -1) { newSql = newSql.replace(fromFragment, toFragment); changes.push({ from: fromFragment, to: toFragment }); }
        }
      });
      if (!changes.length) return null;
      return {
        sql: newSql,
        identified: 'The SQL uses a NULL-handling function that is not available in the selected SQL dialect (' + ctx.dialect + ').',
        applied: 'Replaced it with ' + correct + '(...), the equivalent function for the ' + ctx.dialect + ' dialect.',
        changes: changes
      };
    }
  };

  var RULE_JOIN_RELATIONSHIP = {
    id: 'join-relationship',
    matchError: /invalid.*join|ambiguous column|join condition|on clause/i,
    apply: function (sql, ctx) {
      var onRe = /JOIN\s+([A-Za-z_][\w]*)[\s\S]*?\bON\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)/i;
      var m = sql.match(onRe);
      if (!m) return null;
      var joinedTable = m[1], leftTable = m[2], leftCol = m[3], rightTable = m[4], rightCol = m[5];
      var leftOk = ctx.engine.columnExists(leftTable, leftCol);
      var rightOk = ctx.engine.columnExists(rightTable, rightCol);
      if (leftOk && rightOk) return null;
      var rel = ctx.engine.findRelationship(leftTable, rightTable);
      if (!rel) return null;
      var fromFragment = leftTable + '.' + leftCol + ' = ' + rightTable + '.' + rightCol;
      var toFragment = rel.fromTable + '.' + rel.fromColumn + ' = ' + rel.toTable + '.' + rel.toColumn;
      if (sql.indexOf(fromFragment) === -1) return null;
      var newSql = sql.replace(fromFragment, toFragment);
      return {
        sql: newSql,
        identified: 'The JOIN condition references a column that does not exist on one of the joined tables (' + leftTable + '.' + leftCol + ' / ' + rightTable + '.' + rightCol + ').',
        applied: 'Replaced the join condition with the relationship documented in the active schema between ' + leftTable + ' and ' + rightTable + '.',
        changes: [{ from: fromFragment, to: toFragment }]
      };
    }
  };

  var RULES = [RULE_CASE_ELSE_DATATYPE, RULE_WHERE_DATATYPE, RULE_INVALID_COLUMN, RULE_INVALID_TABLE, RULE_GROUP_BY, RULE_DATE_FORMAT, RULE_JOIN_RELATIONSHIP, RULE_NULL_COMPARISON, RULE_TRAILING_COMMA, RULE_NULLFN_DIALECT];

  function detectDialectFromError(errorText) {
    var t = String(errorText || '');
    if (/ORA-\d{5}/i.test(t)) return 'Oracle';
    if (/Msg \d+, Level \d+, State \d+|Incorrect syntax near|\[Microsoft\]\[ODBC/i.test(t)) return 'SQL Server';
    if (/^ERROR:\s|relation ".*" does not exist|PG::/i.test(t)) return 'PostgreSQL';
    if (/You have an error in your SQL syntax|MySQL server version/i.test(t)) return 'MySQL';
    return null;
  }

  function rectify(sql, errorText, engine, dialect) {
    sql = String(sql || '');
    errorText = String(errorText || '');
    dialect = DIALECTS.indexOf(dialect) !== -1 ? dialect : 'Generic';
    var ctx = { engine: engine, dialect: dialect, errorText: errorText, tables: extractTables(sql) };

    if (!sql.trim()) {
      return { correctedSql: sql, changed: false, errorIdentified: 'No SQL was supplied to analyze.', correctionApplied: 'Please paste the SQL query that produced the error in Box 2, then try again.', changes: [], ruleId: null };
    }

    var matched = RULES.filter(function (r) { return r.matchError && r.matchError.test(errorText); });
    for (var i = 0; i < matched.length; i++) {
      var res = matched[i].apply(sql, ctx);
      if (res) return { correctedSql: res.sql, changed: true, errorIdentified: res.identified, correctionApplied: res.applied, changes: res.changes, ruleId: matched[i].id };
    }
    var fallback = RULES.filter(function (r) { return r.alwaysTry && matched.indexOf(r) === -1; });
    for (var j = 0; j < fallback.length; j++) {
      var res2 = fallback[j].apply(sql, ctx);
      if (res2) return { correctedSql: res2.sql, changed: true, errorIdentified: res2.identified, correctionApplied: res2.applied, changes: res2.changes, ruleId: fallback[j].id };
    }
    return {
      correctedSql: sql, changed: false,
      errorIdentified: 'No specific, schema-supported correction could be automatically determined for this error from the supplied SQL and the active schema.',
      correctionApplied: 'No automatic change was made, to avoid guessing. Please review the SQL and error manually, double-check the table/column names against Used Schema, or consult your database documentation.',
      changes: [], ruleId: null
    };
  }

  var API = { rectify: rectify, detectDialectFromError: detectDialectFromError, levenshtein: levenshtein, findClosestName: findClosestName, extractTables: extractTables, DIALECTS: DIALECTS, RULES: RULES };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_ERROR_RECTIFIER = API;
})(typeof window !== 'undefined' ? window : this);
