/* sql-engine.js — Read-only SQL generation engine (SELECT / WITH only).
   Supports: SELECT/DISTINCT, WHERE (via filter-engine), GROUP BY/HAVING, ORDER BY,
   LIMIT/TOP/FETCH, INNER/LEFT/RIGHT/FULL/CROSS JOIN auto-resolved via schema relationships,
   aggregates, CASE/DECODE columns, named CTEs, EXISTS/NOT EXISTS related-table filters,
   correlated related-count columns, recursive hierarchy walks, window functions
   (ROW_NUMBER/RANK/DENSE_RANK OVER PARTITION BY.. ORDER BY..), and UNION/UNION ALL/
   INTERSECT/EXCEPT combination with a second, independently-specified query. */
(function (root) {
  'use strict';

  var FILTER = (typeof module === 'object' && module.exports) ? require('./filter-engine.js') : root.APSQL_FILTER;
  var DECODE = (typeof module === 'object' && module.exports) ? require('./decode-engine.js') : root.APSQL_DECODE;
  var DATATYPE = (typeof module === 'object' && module.exports) ? require('./datatype-engine.js') : root.APSQL_DATATYPE;

  function up(s) { return String(s == null ? '' : s).toUpperCase(); }

  function planJoins(engine, tables, relationshipEngine) {
    // Builds a minimal spanning join path across `tables` using known relationships.
    // Returns { joins: [{left,right,leftCol,rightCol}], unresolved: [tableNames] }
    var eng = relationshipEngine || engine;
    var joins = [];
    var unresolved = [];
    if (tables.length <= 1) return { joins: joins, unresolved: unresolved };
    var placed = [tables[0]];
    var remaining = tables.slice(1);
    var guard = 0;
    while (remaining.length && guard < 100) {
      guard++;
      var progressed = false;
      for (var i = 0; i < remaining.length; i++) {
        var candidate = remaining[i];
        for (var j = 0; j < placed.length; j++) {
          var rel = eng.findRelationship(placed[j], candidate);
          if (rel) {
            joins.push({ left: rel.fromTable, leftCol: rel.fromColumn, right: rel.toTable, rightCol: rel.toColumn, table: candidate });
            placed.push(candidate);
            remaining.splice(i, 1);
            progressed = true;
            break;
          }
        }
        if (progressed) break;
      }
      if (!progressed) break;
    }
    unresolved = remaining;
    return { joins: joins, unresolved: unresolved };
  }

  function colExpr(alias, colName) { return alias + '.' + colName; }

  function buildSelectList(engine, decodeStore, selectedColumns, tableAliases, dialect) {
    if (!selectedColumns || !selectedColumns.length) return { list: '*', warnings: [] };
    var warnings = [];
    var parts = selectedColumns.map(function (sc) {
      var alias = tableAliases[up(sc.table)] || engine.getAlias(sc.table);
      var base = colExpr(alias, sc.column);
      var expr = base;
      if (sc.decode) {
        var resolved = DECODE.resolveDecode(engine, decodeStore, sc.table, sc.column);
        if (resolved) {
          expr = DECODE.buildCaseExpression(base, resolved.def, dialect);
        } else {
          warnings.push('No CASE/DECODE definition found for ' + sc.table + '.' + sc.column + ' — showing raw value.');
        }
      }
      if (sc.aggregate) {
        expr = String(sc.aggregate).toUpperCase() + '(' + expr + ')';
      }
      var outAlias = sc.alias || (sc.aggregate ? (String(sc.aggregate).toLowerCase() + '_' + sc.column) : sc.column);
      return expr + ' AS ' + outAlias;
    });
    return { list: parts.join(', '), warnings: warnings };
  }

  function buildJoinClause(joins, tableAliases, joinType) {
    return joins.map(function (j) {
      var leftAlias = tableAliases[up(j.left)];
      var rightAlias = tableAliases[up(j.table)];
      var jt = (joinType === 'left') ? 'LEFT JOIN' : (joinType === 'right') ? 'RIGHT JOIN' : (joinType === 'full') ? 'FULL OUTER JOIN' : 'INNER JOIN';
      return jt + ' ' + j.table + ' ' + rightAlias + ' ON ' + leftAlias + '.' + j.leftCol + ' = ' + rightAlias + '.' + j.rightCol;
    }).join('\n');
  }

  function assignAliases(engine, tables) {
    var used = {};
    var out = {};
    tables.forEach(function (t) {
      var base = engine.getAlias(t);
      var alias = base, n = 2;
      while (used[alias]) { alias = base + n; n++; }
      used[alias] = true;
      out[up(t)] = alias;
    });
    return out;
  }

  function generateSql(requirement, options, engine, decodeStore, relationshipEngine) {
    options = options || {};
    var dialect = options.dialect || 'Generic';
    var tables = (options.selectedTables || []).slice();
    var errors = [];
    var warnings = [];

    if (!tables.length) return { status: 'error', errors: ['No table selected. Choose at least one table.'] };
    tables.forEach(function (t) { if (!engine.getTable(t)) errors.push('Unknown table: ' + t); });
    if (errors.length) return { status: 'error', errors: errors };

    var tableAliases = assignAliases(engine, tables);
    var joinPlan = planJoins(engine, tables, relationshipEngine);
    if (joinPlan.unresolved.length) {
      errors.push('Could not determine how to join: ' + joinPlan.unresolved.join(', ') + '. Define a relationship in Update Schema or select a manual join.');
    }
    if (errors.length) return { status: 'error', errors: errors };

    var selectResult = buildSelectList(engine, decodeStore, options.selectedColumns, tableAliases, dialect);
    warnings = warnings.concat(selectResult.warnings);

    // Window functions appended to the select list (ranking / partitioning)
    if (options.windowFunctions && options.windowFunctions.length) {
      var winParts = options.windowFunctions.map(function (w) {
        var fn = up(w.fn || 'ROW_NUMBER') + '()';
        var partBy = (w.partitionBy && w.partitionBy.length) ? 'PARTITION BY ' + w.partitionBy.map(function (p) { return (tableAliases[up(p.table)] || p.table) + '.' + p.column; }).join(', ') + ' ' : '';
        var ordBy = (w.orderBy && w.orderBy.length) ? 'ORDER BY ' + w.orderBy.map(function (o) { return (tableAliases[up(o.table)] || o.table) + '.' + o.column + (o.dir === 'desc' ? ' DESC' : ' ASC'); }).join(', ') : '';
        return fn + ' OVER (' + partBy + ordBy + ') AS ' + (w.alias || 'rn');
      });
      selectResult.list = (selectResult.list === '*' ? '*' : selectResult.list) + ', ' + winParts.join(', ');
    }

    var fromTable = tables[0];
    var fromAlias = tableAliases[up(fromTable)];
    var sqlLines = [];
    sqlLines.push('SELECT ' + (options.distinct ? 'DISTINCT ' : '') + selectResult.list);
    sqlLines.push('FROM ' + fromTable + ' ' + fromAlias);
    var joinClause = buildJoinClause(joinPlan.joins, tableAliases, options.joinType);
    if (joinClause) sqlLines.push(joinClause);

    function resolveColExpr(table, column) {
      var alias = tableAliases[up(table)] || engine.getAlias(table);
      return alias + '.' + column;
    }

    var whereParts = [];
    if (options.filterGroup) {
      var w = FILTER.buildFilterGroup(options.filterGroup, resolveColExpr);
      if (w) whereParts.push(w);
    }
    // EXISTS / NOT EXISTS related-table filters
    (options.existsFilters || []).forEach(function (ef) {
      var rel = (relationshipEngine || engine).findRelationship(fromTable, ef.table);
      if (!rel) { warnings.push('Could not resolve relationship for EXISTS filter on ' + ef.table + '; skipped.'); return; }
      var subAlias = engine.getAlias(ef.table) + '_x';
      var linkExpr = (up(rel.fromTable) === up(fromTable))
        ? fromAlias + '.' + rel.fromColumn + ' = ' + subAlias + '.' + rel.toColumn
        : fromAlias + '.' + rel.toColumn + ' = ' + subAlias + '.' + rel.fromColumn;
      var innerWhere = ef.condition ? ' AND ' + FILTER.buildCondition(ef.condition, function (t, c) { return subAlias + '.' + c; }) : '';
      whereParts.push((ef.negate ? 'NOT ' : '') + 'EXISTS (SELECT 1 FROM ' + ef.table + ' ' + subAlias + ' WHERE ' + linkExpr + innerWhere + ')');
    });
    if (whereParts.length) sqlLines.push('WHERE ' + whereParts.join(' AND '));

    if (options.groupBy && options.groupBy.length) {
      sqlLines.push('GROUP BY ' + options.groupBy.map(function (g) { return resolveColExpr(g.table, g.column); }).join(', '));
    }
    if (options.having) {
      sqlLines.push('HAVING ' + options.having);
    }

    // Related count columns require GROUP BY of the outer non-aggregate columns; simpler and
    // safer to express as correlated scalar subqueries appended to the select list instead.
    if (options.relatedCounts && options.relatedCounts.length) {
      var extra = options.relatedCounts.map(function (rc) {
        var rel = (relationshipEngine || engine).findRelationship(fromTable, rc.table);
        if (!rel) { warnings.push('Could not resolve relationship for related count on ' + rc.table + '; skipped.'); return null; }
        var subAlias = engine.getAlias(rc.table) + '_c';
        var linkExpr = (up(rel.fromTable) === up(fromTable))
          ? fromAlias + '.' + rel.fromColumn + ' = ' + subAlias + '.' + rel.toColumn
          : fromAlias + '.' + rel.toColumn + ' = ' + subAlias + '.' + rel.fromColumn;
        return '(SELECT COUNT(*) FROM ' + rc.table + ' ' + subAlias + ' WHERE ' + linkExpr + ') AS ' + (rc.alias || (rc.table.toLowerCase() + '_count'));
      }).filter(Boolean);
      if (extra.length) sqlLines[0] = sqlLines[0] + ', ' + extra.join(', ');
    }

    if (options.orderBy && options.orderBy.length) {
      sqlLines.push('ORDER BY ' + options.orderBy.map(function (o) { return resolveColExpr(o.table, o.column) + (o.dir === 'desc' ? ' DESC' : ' ASC'); }).join(', '));
    }

    var limitInfo = null;
    if (options.limit) {
      limitInfo = DATATYPE.limitClause(options.limit, dialect);
      if (limitInfo.type === 'limit') sqlLines.push(limitInfo.clause);
    }

    var bodySql = sqlLines.join('\n');
    if (limitInfo && limitInfo.type === 'fetch') {
      // Oracle FETCH FIRST needs an ORDER BY-agnostic placement at the very end
      bodySql += '\n' + limitInfo.clause;
    }
    if (limitInfo && limitInfo.type === 'top') {
      bodySql = bodySql.replace(/^SELECT (DISTINCT )?/, 'SELECT $1' + limitInfo.clause + ' ');
    }

    // Recursive hierarchy walk (self-referencing table)
    if (options.recursiveHierarchy && options.recursiveHierarchy.table) {
      var h = options.recursiveHierarchy;
      var t = h.table, pk = engine.getPrimaryKey(t);
      var parentCol = h.parentColumn, childCol = (pk && pk.name) || h.childColumn || 'ID';
      var cteName = (h.cteName || (t.toLowerCase() + '_hierarchy'));
      var withKw = (dialect === 'PostgreSQL' || dialect === 'MySQL' || dialect === 'SQL Server') ? 'WITH RECURSIVE ' : 'WITH ';
      if (dialect === 'SQL Server' || dialect === 'Generic' || dialect === 'Oracle') withKw = 'WITH ';
      var recursiveCte = withKw + cteName + ' AS (\n' +
        '  SELECT * FROM ' + t + ' WHERE ' + parentCol + ' IS NULL\n' +
        '  UNION ALL\n' +
        '  SELECT c.* FROM ' + t + ' c INNER JOIN ' + cteName + ' p ON c.' + parentCol + ' = p.' + childCol + '\n' +
        ')\n' + 'SELECT * FROM ' + cteName;
      bodySql = recursiveCte;
    } else if (options.cteName) {
      bodySql = 'WITH ' + options.cteName + ' AS (\n' + bodySql.split('\n').map(function (l) { return '  ' + l; }).join('\n') + '\n)\nSELECT * FROM ' + options.cteName;
    }

    if (options.setOperation && options.setOperation.type && options.setOperation.querySql) {
      var opKw = { union: 'UNION', unionall: 'UNION ALL', intersect: 'INTERSECT', except: (dialect === 'Oracle' ? 'MINUS' : 'EXCEPT') }[options.setOperation.type];
      if (opKw) bodySql = bodySql + '\n' + opKw + '\n' + options.setOperation.querySql;
      else warnings.push('Unknown set operation type: ' + options.setOperation.type);
    }

    if (!/;\s*$/.test(bodySql)) bodySql += ';';

    return { status: 'ok', sql: bodySql, warnings: warnings, tablesUsed: tables, joins: joinPlan.joins };
  }

  var API = { generateSql: generateSql, planJoins: planJoins, assignAliases: assignAliases };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SQL = API;
})(typeof window !== 'undefined' ? window : this);
