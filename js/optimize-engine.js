/* optimize-engine.js — plain-language query explanation + light optimization hints. */
(function (root) {
  'use strict';

  function explainQuery(genResult, engine) {
    if (!genResult || genResult.status !== 'ok') return '';
    var parts = [];
    var tables = genResult.tablesUsed || [];
    if (tables.length === 1) parts.push('Reads from ' + tables[0] + '.');
    else if (tables.length > 1) parts.push('Combines ' + tables.join(', ') + ' using ' + (genResult.joins || []).length + ' join(s).');
    if (/DISTINCT/.test(genResult.sql)) parts.push('Removes duplicate rows.');
    if (/GROUP BY/.test(genResult.sql)) parts.push('Groups results and aggregates values per group.');
    if (/CASE/.test(genResult.sql)) parts.push('Translates coded values into readable labels.');
    if (/ORDER BY/.test(genResult.sql)) parts.push('Sorts the result set.');
    if (/LIMIT|TOP|FETCH FIRST/.test(genResult.sql)) parts.push('Limits the number of rows returned.');
    if (/EXISTS/.test(genResult.sql)) parts.push('Filters based on related records in another table.');
    if ((genResult.warnings || []).length) parts.push('Note: ' + genResult.warnings.join(' '));
    return parts.join(' ');
  }

  function optimizationHints(sql) {
    var hints = [];
    if (/SELECT DISTINCT \*/i.test(sql)) hints.push('Selecting DISTINCT * across a join can be expensive; consider selecting only the columns you need.');
    if (/SELECT \*/i.test(sql) && /JOIN/i.test(sql)) hints.push('SELECT * across joined tables returns every column from every table — list only the columns you need for clearer, faster results.');
    var whereMissing = !/WHERE/i.test(sql) && /JOIN|FROM/i.test(sql);
    if (whereMissing) hints.push('No WHERE clause was used — this returns every row. Add a filter if you only need a subset.');
    return hints;
  }

  var API = { explainQuery: explainQuery, optimizationHints: optimizationHints };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_OPTIMIZE = API;
})(typeof window !== 'undefined' ? window : this);
