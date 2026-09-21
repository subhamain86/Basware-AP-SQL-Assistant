/* validation-engine.js — validates generated SQL before it is shown to the user, and
   attempts a bounded self-correction pass when something is wrong (spec section 14). */
(function (root) {
  'use strict';

  var FORBIDDEN_READONLY = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE'];

  function up(s) { return String(s == null ? '' : s).toUpperCase(); }

  function balancedParens(sql) {
    var depth = 0;
    for (var i = 0; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      if (sql[i] === ')') depth--;
      if (depth < 0) return false;
    }
    return depth === 0;
  }

  function extractIdentifierTokens(sql) {
    return (sql.match(/[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?/g) || []);
  }

  // Read-only guard: reject if the SQL contains a data-changing / DDL statement.
  function assertReadOnly(sql) {
    var upperSql = up(sql);
    var offenders = FORBIDDEN_READONLY.filter(function (kw) {
      return new RegExp('(^|\\s|;)' + kw + '(\\s|\\()').test(upperSql);
    });
    return { ok: offenders.length === 0, offenders: offenders };
  }

  // Validates that every TABLE / TABLE.COLUMN mentioned in the SQL corresponds to
  // something in the active schema (best-effort: uses word-boundary matching, so it can
  // still catch obviously hallucinated names without needing a full SQL parser).
  function validateAgainstSchema(sql, engine, tablesUsed) {
    var errors = [];
    var warnings = [];
    if (!balancedParens(sql)) errors.push('Unbalanced parentheses in generated SQL.');

    var knownTables = {};
    engine.getAllTables().forEach(function (t) { knownTables[up(t.name)] = t; });

    (tablesUsed || []).forEach(function (tn) {
      if (!knownTables[up(tn)]) errors.push('SQL references table "' + tn + '" which does not exist in the active schema.');
    });

    // Alias.column sanity check against the tables actually used
    var aliasColPattern = /\b([a-zA-Z][a-zA-Z0-9_]{0,6})\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
    var m;
    var validColumnNames = {};
    (tablesUsed || []).forEach(function (tn) {
      var t = knownTables[up(tn)];
      if (!t) return;
      (t.columns || []).forEach(function (c) { validColumnNames[up(c.name)] = true; });
    });
    while ((m = aliasColPattern.exec(sql))) {
      var colName = m[2];
      if (/^(AS|ON|AND|OR|SELECT|FROM|WHERE|JOIN)$/i.test(colName)) continue;
      if (Object.keys(validColumnNames).length && !validColumnNames[up(colName)]) {
        warnings.push('Column reference "' + m[0] + '" was not recognized in the active schema and may be ambiguous or incorrect.');
      }
    }

    var readOnly = assertReadOnly(sql);
    if (!readOnly.ok) errors.push('Generated SQL contains a disallowed statement type for a read-only query: ' + readOnly.offenders.join(', ') + '.');

    return { valid: errors.length === 0, errors: errors, warnings: warnings };
  }

  // Bounded self-correction: given a failed sql-engine result and the plan/options that
  // produced it, try a small number of automatic fixes and re-validate. Returns the best
  // available result plus a log of what was attempted.
  function selfCorrect(generateFn, requirement, options, engine, decodeStore, relationshipEngine, maxAttempts) {
    maxAttempts = maxAttempts || 3;
    var attempts = [];
    var currentOptions = JSON.parse(JSON.stringify(options));
    for (var i = 0; i < maxAttempts; i++) {
      var result = generateFn(requirement, currentOptions, engine, decodeStore, relationshipEngine);
      if (result.status === 'ok') {
        var v = validateAgainstSchema(result.sql, engine, result.tablesUsed);
        if (v.valid) {
          result.validation = v;
          result.attempts = attempts.length;
          return result;
        }
        attempts.push({ attempt: i + 1, sql: result.sql, errors: v.errors });
        // Simple corrective strategy: drop unresolved-looking selected columns and retry.
        if (currentOptions.selectedColumns && currentOptions.selectedColumns.length > 0) {
          currentOptions.selectedColumns = currentOptions.selectedColumns.slice(0, -1);
          continue;
        }
        break;
      } else {
        attempts.push({ attempt: i + 1, errors: result.errors });
        break;
      }
    }
    return { status: 'error', errors: ['Automatic validation/self-correction could not produce a valid query.'], attempts: attempts };
  }

  var API = {
    balancedParens: balancedParens, extractIdentifierTokens: extractIdentifierTokens,
    assertReadOnly: assertReadOnly, validateAgainstSchema: validateAgainstSchema, selfCorrect: selfCorrect,
    FORBIDDEN_READONLY: FORBIDDEN_READONLY
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_VALIDATION = API;
})(typeof window !== 'undefined' ? window : this);
