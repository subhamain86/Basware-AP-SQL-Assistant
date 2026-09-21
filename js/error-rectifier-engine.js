/* error-rectifier-engine.js — given a pasted database error + the SQL that caused it,
   proposes a corrected query with a plain-language explanation. Schema-aware: never
   invents new schema objects, only fixes column/alias/datatype/syntax issues using
   what's really in the active schema. */
(function (root) {
  'use strict';

  var DATATYPE = (typeof module === 'object' && module.exports) ? require('./datatype-engine.js') : root.APSQL_DATATYPE;

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

  function closestName(target, candidates) {
    var best = null, bestScore = Infinity;
    candidates.forEach(function (c) {
      var s = levenshtein(target.toUpperCase(), c.toUpperCase());
      if (s < bestScore) { bestScore = s; best = c; }
    });
    return (best && bestScore <= Math.max(2, Math.ceil(target.length * 0.3))) ? best : null;
  }

  function allColumnNames(engine) {
    var out = [];
    engine.getAllTables().forEach(function (t) { (t.columns || []).forEach(function (c) { out.push(c.name); }); });
    return out;
  }
  function allTableNames(engine) { return engine.getAllTables().map(function (t) { return t.name; }); }

  function rectify(sql, errorText, engine, dialect) {
    var corrected = sql;
    var changes = [];
    var explanationParts = [];
    dialect = dialect || 'Generic';

    // 1) Unknown table/column (ORA-00904, "invalid identifier", "unknown column", etc.)
    var invalidIdMatch = /"([A-Za-z0-9_.]+)"\s*:\s*invalid identifier/i.exec(errorText) ||
      /invalid identifier[:\s]+"?([A-Za-z0-9_.]+)"?/i.exec(errorText) ||
      /unknown column\s+'?"?([A-Za-z0-9_.]+)"?'?/i.exec(errorText) ||
      /column\s+"?([A-Za-z0-9_.]+)"?\s+does not exist/i.exec(errorText);
    if (invalidIdMatch) {
      var bad = invalidIdMatch[1].split('.').pop();
      var suggestion = closestName(bad, allColumnNames(engine)) || closestName(bad, allTableNames(engine));
      if (suggestion && suggestion.toUpperCase() !== bad.toUpperCase()) {
        var re = new RegExp('\\b' + bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        corrected = corrected.replace(re, suggestion);
        changes.push('Replaced unrecognized identifier "' + bad + '" with "' + suggestion + '" (closest match in the active schema).');
        explanationParts.push('The database reported "' + bad + '" as invalid because it does not exist in the active schema; "' + suggestion + '" is the closest valid name.');
      }
    }

    // 2) Datatype mismatch in CASE/ELSE (ORA-00932 and similar) — cast the ELSE branch.
    if (/inconsistent datatypes|datatype mismatch|conversion failed/i.test(errorText)) {
      var caseElseRe = /ELSE\s+([A-Za-z0-9_.]+)\s+END/gi;
      var m2;
      var didCast = false;
      while ((m2 = caseElseRe.exec(sql))) {
        var target = m2[1];
        if (/^'/.test(target)) continue; // already a string literal
        var castExpr = DATATYPE.toChar(target, dialect);
        corrected = corrected.replace(m2[0], 'ELSE ' + castExpr + ' END');
        changes.push('Cast "' + target + '" to a character type in the ELSE branch so it matches the THEN branches.');
        didCast = true;
      }
      if (didCast) explanationParts.push('A CASE expression mixed a text result in THEN with a raw numeric/date column in ELSE; the database requires every branch to share a compatible type, so the ELSE value is now explicitly cast.');
    }

    // 3) Missing FROM-clause / ambiguous column
    if (/ambiguous column name/i.test(errorText)) {
      explanationParts.push('A column name matched more than one joined table. Qualify it with its table alias (e.g. alias.column) to remove the ambiguity.');
    }

    // 4) Missing GROUP BY column (aggregate + non-aggregate mismatch)
    if (/not a single-group group function|must appear in the GROUP BY clause/i.test(errorText)) {
      explanationParts.push('An aggregate (COUNT/SUM/AVG/MIN/MAX) was mixed with a non-aggregated column that is not in GROUP BY. Add every non-aggregated selected column to GROUP BY, or remove it from the select list.');
    }

    // 5) Unterminated string / syntax error fallback
    if (/ORA-00933|SQL command not properly ended|syntax error/i.test(errorText) && !changes.length) {
      if (!/;\s*$/.test(corrected.trim())) { corrected = corrected.trim() + ';'; changes.push('Added the missing terminating semicolon.'); }
    }

    if (!changes.length) {
      explanationParts.push('No automatic correction rule matched this error text confidently enough to safely change the SQL. Review the error and query manually, or provide more detail (exact table/column names) so a more precise fix can be proposed.');
    }

    return {
      status: changes.length ? 'corrected' : 'unresolved',
      originalSql: sql,
      correctedSql: corrected,
      changes: changes,
      explanation: explanationParts.join(' ')
    };
  }

  var API = { rectify: rectify, levenshtein: levenshtein, closestName: closestName };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_ERROR_RECTIFIER = API;
})(typeof window !== 'undefined' ? window : this);
