(function (root) {
  'use strict';

  function isSelectLike(result) {
    return !result.command || result.command === 'SELECT';
  }

  function isHierarchyWalk(result) {
    return (result.assumptions || []).some(function (a) { return /hierarchy/i.test(a); });
  }

  function tryRemoveRedundantDistinct(engine, result) {
    var sql = result.sql || '';
    if (!isSelectLike(result)) return null;
    if (!/\bDISTINCT\b/i.test(sql)) return null;
    if (!result.tablesUsed || !result.tablesUsed.length) return null;
    var baseTable = result.tablesUsed[0];
    var hasBasePk = (result.columnsUsed || []).some(function (c) {
      if (String(c.table).toUpperCase() !== String(baseTable).toUpperCase()) return false;
      var col = engine.getColumn(c.table, c.column);
      return !!(col && col.primary_key);
    });
    if (!hasBasePk) return null;
    var rewritten = sql.replace(/(SELECT\s+(?:TOP\s+\d+\s+)?)DISTINCT\s+/i, '$1');
    if (rewritten === sql) return null;
    return {
      sql: rewritten,
      note: 'Removed DISTINCT \u2014 the primary key of ' + baseTable + ' is already included in the result, so every row is already guaranteed to be unique.'
    };
  }

  function collectIndexCandidates(engine, result) {
    var found = {};
    (result.filtersApplied || []).forEach(function (line) {
      var re = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
      var m;
      while ((m = re.exec(line))) {
        var t = m[1], c = m[2];
        var col = engine.getColumn(t, c);
        if (col && !col.primary_key) found[t + '.' + c] = true;
      }
    });
    return Object.keys(found);
  }

  function optimizeSql(engine, result) {
    var optimizedSql = result.sql || '';
    var changesApplied = [];
    var recommendations = [];

    var distinctFix = tryRemoveRedundantDistinct(engine, result);
    if (distinctFix) { optimizedSql = distinctFix.sql; changesApplied.push(distinctFix.note); }

    var selectLike = isSelectLike(result);
    var hierarchy = isHierarchyWalk(result);
    var hasWhere = /\bWHERE\b/i.test(optimizedSql);
    var hasLimit = /\b(TOP\s+\d+|LIMIT\s+\d+|FETCH FIRST\s+\d+)/i.test(optimizedSql);
    var hasGroupBy = /\bGROUP BY\b/i.test(optimizedSql);

    if (selectLike && !hierarchy && !hasWhere && !hasGroupBy) {
      recommendations.push('This query has no WHERE condition, so it will return every row in ' + (result.tablesUsed ? result.tablesUsed.join(', ') : 'the table') + '. Consider adding a filter if you only need a subset of records.');
    }

    if (/LIKE\s+'%[^']/i.test(optimizedSql)) {
      recommendations.push('One or more "Contains"/"Ends with" filters use a leading wildcard (LIKE \'%...\'), which usually cannot use a database index efficiently. Use "Starts with" instead if possible.');
    }

    if (selectLike && !hierarchy && !hasLimit && !hasGroupBy && !hasWhere) {
      recommendations.push('No result limit is set on this broad query. Consider adding a Result Limit in Advanced Options, especially while testing.');
    }

    var indexCandidates = collectIndexCandidates(engine, result);
    if (indexCandidates.length) {
      recommendations.push('For best performance, confirm these columns are indexed in the database: ' + indexCandidates.join(', ') + '.');
    }

    return { optimizedSql: optimizedSql, changesApplied: changesApplied, recommendations: recommendations, hasChanges: changesApplied.length > 0 };
  }

  var API = { optimizeSql: optimizeSql };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_OPTIMIZE = API;
})(typeof window !== 'undefined' ? window : this);
