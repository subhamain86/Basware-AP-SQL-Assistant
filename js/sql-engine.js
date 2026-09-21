(function (root) {
  'use strict';
  var FILTER = (typeof module === 'object' && module.exports) ? require('./filter-engine.js') : root.APSQL_FILTER;
  var DECODE = (typeof module === 'object' && module.exports) ? require('./decode-engine.js') : root.APSQL_DECODE;
  var VALIDATE = (typeof module === 'object' && module.exports) ? require('./validation-engine.js') : root.APSQL_VALIDATE;
  function limitClause(dialect, n) { switch (dialect) { case 'SQL Server': return { top: 'TOP ' + n, tail: '' }; case 'Oracle': return { top: '', tail: 'FETCH FIRST ' + n + ' ROWS ONLY' }; default: return { top: '', tail: 'LIMIT ' + n }; } }
  function buildJoinPlan(engine, tables) {
    var included = [tables[0]]; var remaining = tables.slice(1); var joins = []; var progress = true;
    while (remaining.length && progress) {
      progress = false;
      for (var i = 0; i < remaining.length; i++) {
        var target = remaining[i]; var rel = null;
        for (var j = 0; j < included.length; j++) { rel = engine.findRelationship(included[j], target); if (rel) break; }
        if (rel) { joins.push({ table: target, on: rel }); included.push(target); remaining.splice(i, 1); i--; progress = true; }
      }
    }
    var errors = remaining.map(function (t) { return 'No documented relationship was found to join "' + t + '" with the tables already selected.'; });
    return { joins: joins, errors: errors, unresolved: remaining.slice() };
  }
  function relatedTableSides(engine, baseTable, relatedTable) {
    var rel = engine.findRelationship(baseTable, relatedTable); if (!rel) return null;
    if (String(rel.fromTable).toUpperCase() === String(relatedTable).toUpperCase()) return { related: { table: rel.fromTable, column: rel.fromColumn }, base: { table: rel.toTable, column: rel.toColumn } };
    return { related: { table: rel.toTable, column: rel.toColumn }, base: { table: rel.fromTable, column: rel.fromColumn } };
  }
  // Schema-aware column display: for decode-enabled columns, this ALWAYS re-checks the
  // active schema (via DECODE.resolveDecode -> engine.getValueMap) before falling back to
  // any session-only manual decode, so SQL generation is driven by the governed schema.
  function resolveColumnDisplay(engine, decodeStore, col, dialect) {
    if (col.aggregate) { var target = (col.column === '*' || !col.column) ? '*' : (col.table + '.' + col.column); var expr = col.aggregate + '(' + (col.distinct ? 'DISTINCT ' : '') + target + ')'; return expr + (col.alias ? (' AS ' + col.alias) : ''); }
    var base = col.table + '.' + col.column;
    if (col.decode) {
      var resolved = DECODE.resolveDecode(engine, decodeStore, col.table, col.column);
      if (resolved.values && resolved.values.length) { var schemaCol = engine.getColumn(col.table, col.column); var dataType = schemaCol ? schemaCol.type : null; return DECODE.buildDecodeCaseSql(col.table, col.column, resolved.values, col.alias || col.column, { dataType: dataType, dialect: dialect, elseMode: col.elseMode }); }
    }
    return base + (col.alias ? (' AS ' + col.alias) : '');
  }
  function generateSql(requirement, options, engine, decodeStore) {
    options = options || {};
    var dialect = options.dialect || 'Generic';
    var tables = (options.selectedTables || []).slice();
    var assumptions = [], filtersApplied = [];
    if (tables.length === 0) return { status: 'clarification_needed', message: 'Please select at least one table, or describe your requirement in more detail so tables can be determined automatically.' };
    var validation = VALIDATE.validateSelectRequest(engine, { tables: tables, columns: options.selectedColumns || [], filterGroup: options.filterGroup });
    if (!validation.valid) return { status: 'rejected', message: validation.errors.join(' ') };
    if (options.recursiveHierarchy && options.recursiveHierarchy.table) return buildRecursiveHierarchySql(engine, options.recursiveHierarchy.table, dialect);
    var joinPlan = buildJoinPlan(engine, tables);
    if (joinPlan.errors.length) return { status: 'rejected', message: joinPlan.errors.join(' '), unresolvedTables: joinPlan.unresolved };
    var columns = options.selectedColumns && options.selectedColumns.length ? options.selectedColumns : tables.map(function (t) { var tbl = engine.getTable(t); return { table: t, column: tbl.columns[0].name, alias: '' }; });
    var selectList = columns.map(function (c) { return resolveColumnDisplay(engine, decodeStore, c, dialect); });
    var lines = []; var distinctKw = options.distinct ? 'DISTINCT ' : '';
    var limitInfo = options.limit ? limitClause(dialect, options.limit) : { top: '', tail: '' };
    lines.push('SELECT ' + (limitInfo.top ? limitInfo.top + ' ' : '') + distinctKw + selectList.join(', '));
    lines.push('FROM ' + tables[0]);
    joinPlan.joins.forEach(function (j) { var kw = (options.join === 'LEFT') ? 'LEFT JOIN' : 'INNER JOIN'; lines.push(kw + ' ' + j.table + ' ON ' + j.on.fromTable + '.' + j.on.fromColumn + ' = ' + j.on.toTable + '.' + j.on.toColumn); filtersApplied.push('Join: ' + j.on.fromTable + '.' + j.on.fromColumn + ' = ' + j.on.toTable + '.' + j.on.toColumn); });
    var whereParts = [];
    if (options.filterGroup && options.filterGroup.conditions && options.filterGroup.conditions.length) { var built = FILTER.buildWhereSql(options.filterGroup, dialect); if (built.errors.length) return { status: 'rejected', message: built.errors.join(' ') }; if (built.sql) { whereParts.push(built.sql); filtersApplied.push('Filter: ' + built.plainEnglish); } }
    function addExistsFilter(ex) {
      var sides = relatedTableSides(engine, tables[0], ex.relatedTable);
      if (!sides) return 'No relationship was found between "' + tables[0] + '" and "' + ex.relatedTable + '" for the EXISTS filter.';
      var kwExists = ex.negate ? 'NOT EXISTS' : 'EXISTS';
      whereParts.push(kwExists + ' (SELECT 1 FROM ' + sides.related.table + ' WHERE ' + sides.related.table + '.' + sides.related.column + ' = ' + sides.base.table + '.' + sides.base.column + ')');
      filtersApplied.push((ex.negate ? 'Only rows without a match in ' : 'Only rows with a match in ') + ex.relatedTable);
      return null;
    }
    if (Array.isArray(options.existsFilters)) { for (var ei = 0; ei < options.existsFilters.length; ei++) { var e2 = addExistsFilter(options.existsFilters[ei]); if (e2) return { status: 'rejected', message: e2 }; } }
    if (whereParts.length) lines.push('WHERE ' + whereParts.join(' AND '));
    if (options.groupBy && options.groupBy.length) { lines.push('GROUP BY ' + options.groupBy.join(', ')); filtersApplied.push('Grouped by ' + options.groupBy.join(', ')); if (options.having) { lines.push('HAVING ' + options.having); filtersApplied.push('Having: ' + options.having); } }
    if (options.orderBy) { lines.push('ORDER BY ' + options.orderBy); filtersApplied.push('Sorted by ' + options.orderBy); }
    if (limitInfo.tail) lines.push(limitInfo.tail);
    var bodySql = lines.join('\n'); var finalSql = bodySql;
    if (options.viewName) { finalSql = 'WITH ' + options.viewName + ' AS (\n' + bodySql.split('\n').map(function (l) { return '  ' + l; }).join('\n') + '\n)\nSELECT * FROM ' + options.viewName; assumptions.push('Wrapped as a named view "' + options.viewName + '" using WITH.'); }
    if (requirement) assumptions.push('Interpreted from: "' + requirement + '"');
    return { status: 'ok', sql: finalSql, dialect: dialect, tablesUsed: tables, columnsUsed: columns.map(function (c) { return { table: c.table, column: c.column, alias: c.alias || '' }; }), filtersApplied: filtersApplied, assumptions: assumptions };
  }
  function buildRecursiveHierarchySql(engine, tableName, dialect) {
    var edges = engine.getSelfReferencingEdges(tableName);
    if (!edges.length) return { status: 'rejected', message: 'Table "' + tableName + '" has no self-referencing relationship to walk as a hierarchy.' };
    var edge = edges[0]; var table = engine.getTable(tableName);
    var pk = table.columns.filter(function (c) { return c.primary_key; })[0];
    if (!pk) return { status: 'rejected', message: 'Table "' + tableName + '" has no primary key documented, which is required to build a hierarchy walk.' };
    var sql = 'WITH RECURSIVE hierarchy AS (\n  SELECT ' + tableName + '.*, 0 AS hierarchy_level\n  FROM ' + tableName + '\n  WHERE ' + tableName + '.' + edge.fromColumn + ' IS NULL\n  UNION ALL\n  SELECT ' + tableName + '.*, hierarchy.hierarchy_level + 1\n  FROM ' + tableName + '\n  INNER JOIN hierarchy ON ' + tableName + '.' + edge.fromColumn + ' = hierarchy.' + pk.name + '\n)\nSELECT * FROM hierarchy\nORDER BY hierarchy_level';
    return { status: 'ok', sql: sql, dialect: dialect, tablesUsed: [tableName], columnsUsed: [], filtersApplied: ['Recursive hierarchy walk on ' + tableName], assumptions: ['Walks the full ' + tableName + ' hierarchy from the top down using ' + edge.fromColumn + ' -> ' + edge.toColumn + '.'] };
  }
  var API = { generateSql: generateSql, buildJoinPlan: buildJoinPlan, limitClause: limitClause, resolveColumnDisplay: resolveColumnDisplay };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_ENGINE = API;
})(typeof window !== 'undefined' ? window : this);
