/* =========================================================================
   ENGINES — filter / join / decode / SQL generation / CR / error-rectifier
   Ported and consolidated from the V15.x engine architecture
   (filterEngine, joinAutoEngine, decodeEngine, relatedEngine, sqlEngine,
   crEngine, sqlSchemaValidator, errorRectifierEngine).
   ========================================================================= */
(function () {
  'use strict';
  var U = window.SQLA.Utils;
  var Engines = {};

  /* ---------------------------------------------------------- Decode --- */
  Engines.decodeLegend = function (column) {
    if (!column.decode || !column.decode.length) return '';
    return column.decode.map(function (d) { return d.rawValue + '=' + d.label; }).join(', ');
  };
  function formatRawValueForCase(raw) {
    var t = U.safeTrim(raw);
    return U.isNumeric(t) ? t : U.quoteLiteral(t);
  }
  // V-series requirement: DECODE is always rendered as a portable CASE
  // expression (never a dialect-specific DECODE(...) call).
  Engines.buildSchemaDecodeExpression = function (sourceExpr, column, alias) {
    var entries = column.decode || [];
    if (!entries.length) return sourceExpr;
    var whens = entries.map(function (e) {
      return 'WHEN ' + sourceExpr + ' = ' + formatRawValueForCase(e.rawValue) + " THEN " + U.quoteLiteral(U.safeTrim(e.label));
    }).join('\n    ');
    return 'CASE\n    ' + whens + "\n    ELSE 'Unknown'\n  END AS " + alias;
  };
  Engines.buildManualCaseExpression = function (whens, elseValue, alias) {
    var clauses = whens.map(function (w) { return 'WHEN ' + w.whenExpr + ' THEN ' + U.quoteLiteral(w.thenValue); }).join('\n    ');
    var elsePart = U.safeTrim(elseValue) ? '\n    ELSE ' + U.quoteLiteral(elseValue) : '';
    return 'CASE\n    ' + clauses + elsePart + '\n  END AS ' + alias;
  };

  /* ----------------------------------------------------------- Filter -- */
  var OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL'];
  Engines.OPERATORS = OPERATORS;
  Engines.renderFilterClause = function (table, column, operator, value, value2) {
    var ref = table + '.' + column;
    switch (operator) {
      case 'IS NULL': return ref + ' IS NULL';
      case 'IS NOT NULL': return ref + ' IS NOT NULL';
      case 'BETWEEN': return ref + ' BETWEEN ' + formatValue(value) + ' AND ' + formatValue(value2);
      case 'LIKE': return ref + " LIKE '" + String(value).replace(/'/g, "''") + "'";
      case 'NOT LIKE': return ref + " NOT LIKE '" + String(value).replace(/'/g, "''") + "'";
      case 'IN':
      case 'NOT IN': {
        var list = String(value).split(',').map(function (v) { return formatValue(v.trim()); }).join(', ');
        return ref + ' ' + operator + ' (' + list + ')';
      }
      default: return ref + ' ' + operator + ' ' + formatValue(value);
    }
  };
  function formatValue(v) {
    if (v === null || v === undefined || v === '') return 'NULL';
    return U.isNumeric(v) ? String(v) : U.quoteLiteral(v);
  }

  /* ------------------------------------------------------------- Join -- */
  Engines.relationshipsInvolving = function (schema, table) {
    return schema.relationships.filter(function (r) { return r.fromTable === table || r.toTable === table; });
  };
  Engines.findRelationshipBetween = function (schema, a, b) {
    return schema.relationships.filter(function (r) {
      return (r.fromTable === a && r.toTable === b) || (r.toTable === a && r.fromTable === b);
    })[0];
  };
  function correlationCondition(rel, anchorTable, innerTable) {
    if (rel.toTable === innerTable) return anchorTable + '.' + rel.fromColumn + ' = ' + innerTable + '.' + rel.toColumn;
    return anchorTable + '.' + rel.toColumn + ' = ' + innerTable + '.' + rel.fromColumn;
  }
  Engines.correlationCondition = correlationCondition;

  // BFS auto-join: finds a join path from primaryTable to each target table,
  // even through an intermediate linking table the user never mentioned.
  Engines.computeAutoJoinPlan = function (schema, primaryTable, targetTables) {
    var joinLines = [];
    var unresolvedWarnings = [];
    var included = { };
    included[primaryTable] = true;

    targetTables.forEach(function (target) {
      if (included[target]) return;
      // BFS over relationship graph from any already-included table to target
      var queue = Object.keys(included).map(function (t) { return { table: t, path: [] }; });
      var visited = {};
      Object.keys(included).forEach(function (t) { visited[t] = true; });
      var found = null;
      while (queue.length) {
        var node = queue.shift();
        var rels = Engines.relationshipsInvolving(schema, node.table);
        for (var i = 0; i < rels.length; i++) {
          var r = rels[i];
          var other = r.fromTable === node.table ? r.toTable : r.fromTable;
          if (visited[other]) continue;
          var newPath = node.path.concat([{ rel: r, from: node.table, to: other }]);
          if (other === target) { found = newPath; break; }
          visited[other] = true;
          queue.push({ table: other, path: newPath });
        }
        if (found) break;
      }
      if (found) {
        found.forEach(function (step) {
          if (included[step.to]) return;
          var cond = correlationCondition(step.rel, step.from, step.to);
          joinLines.push('INNER JOIN ' + step.to + ' ON ' + cond);
          included[step.to] = true;
        });
      } else {
        unresolvedWarnings.push('Could not find a documented join path to ' + target + ' from the current selection — add it manually or check the Active Schema relationships.');
        included[target] = true; // avoid retry storms
      }
    });
    return { joinLines: joinLines, unresolvedWarnings: unresolvedWarnings };
  };

  /* ------------------------------------------------------ Related/EXISTS */
  Engines.buildRelatedFilterClause = function (schema, spec, anchorTable) {
    var rel = Engines.findRelationshipBetween(schema, anchorTable, spec.relatedTable);
    if (!rel) return null;
    var cond = correlationCondition(rel, anchorTable, spec.relatedTable);
    return spec.mode + ' (SELECT 1 FROM ' + spec.relatedTable + ' WHERE ' + cond + ')';
  };
  Engines.buildRelatedCountSelect = function (schema, spec, anchorTable) {
    var rel = Engines.findRelationshipBetween(schema, anchorTable, spec.relatedTable);
    if (!rel) return null;
    var cond = correlationCondition(rel, anchorTable, spec.relatedTable);
    var alias = U.safeTrim(spec.alias) || (spec.relatedTable.toLowerCase() + '_count');
    return '(\n    SELECT COUNT(*)\n    FROM ' + spec.relatedTable + '\n    WHERE ' + cond + '\n  ) AS ' + alias;
  };

  /* --------------------------------------------------------- SQL build - */
  function renderColumn(spec, schema, dialect) {
    if (spec.manualExpr) return spec.manualExpr;
    var base = spec.aggregate ? spec.aggregate + '(' + spec.table + '.' + spec.column + ')' : spec.table + '.' + spec.column;
    if (spec.displayMode === 'schema-decode') {
      var table = schema.tables.filter(function (t) { return t.name === spec.table; })[0];
      var col = table && table.columns.filter(function (c) { return c.name === spec.column; })[0];
      if (col && col.decode && col.decode.length) {
        var alias = spec.alias || spec.column;
        return Engines.buildSchemaDecodeExpression(spec.table + '.' + spec.column, col, alias);
      }
    }
    return spec.alias ? base + ' AS ' + spec.alias : base;
  }

  function limitClause(dialect, n) {
    if (!n) return { top: '', tail: '' };
    if (dialect === 'SQLServer') return { top: 'TOP ' + n + ' ', tail: '' };
    if (dialect === 'Oracle') return { top: '', tail: '\nFETCH FIRST ' + n + ' ROWS ONLY' };
    return { top: '', tail: '\nLIMIT ' + n };
  }

  Engines.buildSelectSQL = function (state, schema) {
    if (!state.selectedTables.length) {
      return '-- Select at least one table (or describe your requirement above) to generate SQL.';
    }
    var primaryTable = state.selectedTables[0];
    var otherTables = state.selectedTables.slice(1);
    var explicitJoinTables = {};
    (state.joins || []).forEach(function (j) { explicitJoinTables[j.table] = true; });
    var autoTargets = otherTables.filter(function (t) { return !explicitJoinTables[t]; });
    var autoPlan = Engines.computeAutoJoinPlan(schema, primaryTable, autoTargets);

    var selectList = state.selectedColumns.length
      ? state.selectedColumns.map(function (c) { return renderColumn(c, schema, state.dialect); }).join(',\n  ')
      : '*';

    var relatedCountParts = (state.advanced.relatedCounts || [])
      .map(function (spec) { return Engines.buildRelatedCountSelect(schema, spec, primaryTable); })
      .filter(function (v) { return !!v; });
    if (relatedCountParts.length) {
      selectList = (selectList === '*' ? primaryTable + '.*' : selectList) + ',\n  ' + relatedCountParts.join(',\n  ');
    }
    if (state.advanced.distinct) selectList = selectList; // DISTINCT handled via keyword below

    var fromLines = [primaryTable];
    (state.joins || []).forEach(function (j) {
      fromLines.push((j.type || 'INNER') + ' JOIN ' + j.table + ' ON ' + j.condition);
    });
    fromLines = fromLines.concat(autoPlan.joinLines);

    var whereParts = [];
    (state.filters || []).forEach(function (f, idx) {
      var clause = Engines.renderFilterClause(f.table, f.column, f.operator, f.value, f.value2);
      whereParts.push(idx === 0 ? clause : (f.combinator || 'AND') + ' ' + clause);
    });
    (state.advanced.relatedFilters || []).forEach(function (spec) {
      var clause = Engines.buildRelatedFilterClause(schema, spec, primaryTable);
      if (clause) whereParts.push((whereParts.length ? 'AND ' : '') + clause);
    });

    var cteParts = (state.advanced.ctes || [])
      .filter(function (c) { return U.safeTrim(c.name) && U.safeTrim(c.body); })
      .map(function (c) { return c.name + ' AS (\n  ' + c.body + '\n)'; });

    var lim = limitClause(state.dialect, state.advanced.limit);

    var lines = [];
    if (cteParts.length) lines.push('WITH ' + cteParts.join(',\n'));
    lines.push('SELECT ' + lim.top + (state.advanced.distinct ? 'DISTINCT ' : '') + '\n  ' + selectList);
    lines.push('FROM ' + fromLines.join('\n'));
    if (whereParts.length) lines.push('WHERE ' + whereParts.join('\n  '));
    if (state.advanced.groupByColumns && state.advanced.groupByColumns.length) {
      lines.push('GROUP BY ' + state.advanced.groupByColumns.join(', '));
    }
    if (state.advanced.havingClause) lines.push('HAVING ' + state.advanced.havingClause);
    if (state.sorts && state.sorts.length) {
      lines.push('ORDER BY ' + state.sorts.map(function (s) { return s.ref + ' ' + s.direction; }).join(', '));
    }
    lines.push('' + lim.tail);

    var sql = lines.join('\n').replace(/\n+$/, '');
    var warnings = autoPlan.unresolvedWarnings.slice();
    return { sql: sql, warnings: warnings };
  };

  /* --------------------------------------------------------- CR builder  */
  Engines.buildCrSQL = function (state) {
    if (!state.table) return '-- Choose a table for this Change Request.';
    if (state.queryType === 'INSERT') {
      var cols = state.values.map(function (v) { return v.column; }).join(', ');
      var vals = state.values.map(function (v) { return formatValue(v.value); }).join(', ');
      return 'INSERT INTO ' + state.table + ' (' + cols + ')\nVALUES (' + vals + ');';
    }
    var whereParts = (state.filters || []).map(function (f, idx) {
      var clause = Engines.renderFilterClause(f.table, f.column, f.operator, f.value, f.value2);
      return idx === 0 ? clause : (f.combinator || 'AND') + ' ' + clause;
    });
    if (!whereParts.length && !state.confirmNoWhere) {
      return '-- SAFETY: ' + state.queryType + ' with no WHERE clause is blocked. Add a filter, or explicitly confirm "no WHERE" if this is intentional.';
    }
    if (state.queryType === 'UPDATE') {
      var sets = state.values.map(function (v) { return v.column + ' = ' + formatValue(v.value); }).join(',\n  ');
      var sql = 'UPDATE ' + state.table + '\nSET ' + sets;
      if (whereParts.length) sql += '\nWHERE ' + whereParts.join('\n  ');
      return sql + ';';
    }
    if (state.queryType === 'DELETE') {
      var sql2 = 'DELETE FROM ' + state.table;
      if (whereParts.length) sql2 += '\nWHERE ' + whereParts.join('\n  ');
      return sql2 + ';';
    }
    return '-- Unsupported query type.';
  };

  /* -------------------------------------------------- Schema validator - */
  Engines.validateSqlAgainstSchema = function (sql, schema) {
    var issues = [];
    var tableNames = schema.tables.map(function (t) { return t.name; });
    var mentioned = (sql.match(/\b[A-Z_][A-Z0-9_]*\b/g) || []);
    var knownTablesSet = {};
    tableNames.forEach(function (t) { knownTablesSet[t] = true; });
    // Light heuristic only — flags tables referenced after FROM/JOIN that
    // are not in the Active Schema. Not a full SQL parser by design.
    var fromJoinMatches = sql.match(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/g) || [];
    fromJoinMatches.forEach(function (m) {
      var tbl = m.replace(/^(FROM|JOIN)\s+/i, '');
      if (!knownTablesSet[tbl]) issues.push({ severity: 'error', message: 'Table "' + tbl + '" is not present in the Active Schema.' });
    });
    return { valid: issues.filter(function (i) { return i.severity === 'error'; }).length === 0, issues: issues };
  };

  /* -------------------------------------------------------- Error fixer  */
  var ERROR_RULES = [
    { pattern: /ORA-00904|invalid identifier/i, fix: function (sql) {
        return { explanation: 'ORA-00904 (invalid identifier) usually means a column name is misspelled or does not exist on the referenced table. Check the Active Schema for the exact column name and qualify it with its table alias.', whatChanged: ['Verify each column name against the Active Schema.', 'Qualify ambiguous or renamed columns with a table alias.'] };
      } },
    { pattern: /ORA-00942|table or view does not exist/i, fix: function (sql) {
        return { explanation: 'This means the referenced table/view name does not exist (or is misspelled) in the Active Schema, or the object is in a different schema/case. Check Schema Explorer for the exact object name.', whatChanged: ['Confirm the exact table/view name from Schema Explorer.', 'Check for case sensitivity or schema-qualification issues.'] };
      } },
    { pattern: /not a group by expression|ORA-00979/i, fix: function (sql) {
        return { explanation: 'Every non-aggregated column in SELECT must also appear in GROUP BY. Add the missing column(s) to GROUP BY, or wrap them in an aggregate function.', whatChanged: ['Add all non-aggregated SELECT columns to GROUP BY.'] };
      } },
    { pattern: /ambiguous column/i, fix: function (sql) {
        return { explanation: 'More than one joined table has a column with this name. Qualify it with the correct table name or alias everywhere it is used (SELECT, WHERE, GROUP BY, ORDER BY).', whatChanged: ['Qualify the ambiguous column with its table name/alias.'] };
      } }
  ];
  Engines.rectifyError = function (errorText, sql) {
    for (var i = 0; i < ERROR_RULES.length; i++) {
      if (ERROR_RULES[i].pattern.test(errorText)) {
        var r = ERROR_RULES[i].fix(sql);
        return { correctedSql: sql, explanation: r.explanation, whatChanged: r.whatChanged };
      }
    }
    return {
      correctedSql: sql,
      explanation: 'This error message did not match a known pattern in the rule library. General checklist: verify object names and privileges against the Active Schema, confirm every non-aggregated SELECT column is in GROUP BY, qualify ambiguous columns with table aliases, and check for unbalanced quotes/parentheses.',
      whatChanged: ['Manual review recommended — see general checklist in explanation.']
    };
  };

  window.SQLA.Engines = Engines;
})();
