/* nl-query-engine.js — Natural Language -> Schema Understanding -> Query Plan.
   Implements the pipeline described in the V11.5 spec (section 13):
     Intent Detection -> Entity Identification -> Active Schema Analysis ->
     Table/Column Resolution -> Relationship Resolution -> Filter Resolution ->
     Aggregation/Grouping Resolution -> Query Plan
   The engine never invents tables/columns/relationships that are not in the
   active schema; anything it cannot resolve is reported in plan.missingInfo. */
(function (root) {
  'use strict';

  function up(s) { return String(s == null ? '' : s).toUpperCase(); }
  function words(s) { return String(s || '').toLowerCase().match(/[a-z0-9_%]+/g) || []; }

  var STOPWORDS = ['the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'with', 'and', 'or', 'by', 'is', 'are', 'that', 'show', 'find', 'get', 'me', 'all', 'please', 'list'];

  // ---- Step 1: Intent detection ----
  function detectIntent(text) {
    var t = text.toLowerCase();
    if (/\bduplicate/.test(t)) return 'find_duplicates';
    if (/\btop\s+\d+/.test(t) || /\bhighest\b|\blargest\b/.test(t)) return 'top_n';
    if (/\bcount\b|\bhow many\b/.test(t)) return 'aggregate_count';
    if (/\bsum\b|\btotal\b/.test(t)) return 'aggregate_sum';
    if (/\baverage\b|\bavg\b/.test(t)) return 'aggregate_avg';
    if (/\bmissing\b|\bnull\b|\bnot set\b|\bblank\b/.test(t)) return 'find_missing';
    if (/\bstuck\b|\bpending\b|\bopen\b/.test(t)) return 'status_filter';
    return 'list_records';
  }

  // ---- Step 2 & 3: entity identification against the active schema ----
  function singularize(w) {
    w = up(w);
    if (w.length > 3 && /IES$/.test(w)) return w.slice(0, -3) + 'Y';
    if (w.length > 3 && /SES$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /S$/.test(w) && !/SS$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function scoreTableMatch(term, table) {
    var n = up(table.name);
    var termU = up(term);
    var termSing = singularize(term);
    var score = 0;
    if (n === termU || n === termSing) score += 10;
    if (n.indexOf(termU) !== -1 || n.indexOf(termSing) !== -1) score += 4;
    if (up(table.notes || '').indexOf(termU) !== -1) score += 2;
    var nameParts = n.split('_');
    nameParts.forEach(function (p) {
      if (p === termU || p === termSing || singularize(p) === termSing) score += 3;
    });
    return score;
  }

  function findCandidateTables(engine, tokens) {
    var tables = engine.getAllTables();
    var scored = {};
    tokens.forEach(function (tok) {
      tables.forEach(function (t) {
        var s = scoreTableMatch(tok, t);
        if (s > 0) scored[t.name] = (scored[t.name] || 0) + s;
      });
    });
    return Object.keys(scored).sort(function (a, b) { return scored[b] - scored[a]; });
  }

  function findCandidateColumns(engine, tokens, tableNames) {
    var out = [];
    tableNames.forEach(function (tn) {
      var t = engine.getTable(tn);
      if (!t) return;
      (t.columns || []).forEach(function (c) {
        var hay = up(c.name) + ' ' + up(c.description || '') + ' ' + up(c.alias || '');
        var hit = tokens.some(function (tok) { return hay.indexOf(up(tok)) !== -1; });
        if (hit) out.push({ table: t.name, column: c.name, type: c.type });
      });
    });
    return out;
  }

  // ---- Step 6/7: filter resolution ----
  function extractDateFilters(text, tables, engine) {
    var conds = [];
    var m;
    if ((m = /last\s+(\d+)\s+day/.exec(text))) {
      var dateCol = findBestDateColumn(engine, tables);
      if (dateCol) conds.push({ table: dateCol.table, column: dateCol.column, operator: 'gte', value: '__DAYS_AGO_' + m[1], columnType: dateCol.type });
    }
    if ((m = /last\s+(\d+)\s+month/.exec(text))) {
      var dateCol2 = findBestDateColumn(engine, tables);
      if (dateCol2) conds.push({ table: dateCol2.table, column: dateCol2.column, operator: 'gte', value: '__MONTHS_AGO_' + m[1], columnType: dateCol2.type });
    }
    return conds;
  }

  function findBestDateColumn(engine, tables) {
    for (var i = 0; i < tables.length; i++) {
      var t = engine.getTable(tables[i]);
      if (!t) continue;
      var dc = (t.columns || []).filter(function (c) { return /DATE|TIME/i.test(c.type || ''); })[0];
      if (dc) return { table: t.name, column: dc.name, type: dc.type };
    }
    return null;
  }

  function extractNumericThreshold(text) {
    var m = /more than\s+(\d+)/.exec(text) || /greater than\s+(\d+)/.exec(text) || /over\s+(\d+)/.exec(text);
    if (m) return { operator: 'gt', value: m[1] };
    m = /less than\s+(\d+)/.exec(text) || /fewer than\s+(\d+)/.exec(text);
    if (m) return { operator: 'lt', value: m[1] };
    return null;
  }

  function extractTopN(text) {
    var m = /top\s+(\d+)/.exec(text);
    return m ? parseInt(m[1], 10) : null;
  }

  // ---- Main entry point ----
  function interpretRequirement(text, engine, context) {
    context = context || {};
    var missingInfo = [];
    var warnings = [];
    var tokens = words(text).filter(function (w) { return STOPWORDS.indexOf(w) === -1; });
    var intent = detectIntent(text);

    var candidateTableNames = findCandidateTables(engine, tokens);
    if (!candidateTableNames.length && context.previousPlan) {
      candidateTableNames = context.previousPlan.tables.slice();
    }
    if (!candidateTableNames.length) {
      missingInfo.push('Could not identify which table(s) this request refers to. Try mentioning a table or business term from the active schema (e.g. "invoices", "suppliers").');
      return { intent: intent, tables: [], columns: [], filterConditions: [], groupBy: [], orderBy: [], aggregations: [], distinct: false, limit: null, missingInfo: missingInfo, warnings: warnings };
    }
    var tables = candidateTableNames.slice(0, 4); // cap breadth; relationship resolution will connect them

    var candidateColumns = findCandidateColumns(engine, tokens, tables);
    var columns = candidateColumns.slice(0, 12);

    // Relationship resolution — verify every extra table can actually be joined
    var unresolved = [];
    if (tables.length > 1) {
      for (var i = 1; i < tables.length; i++) {
        var rel = engine.findRelationship(tables[0], tables[i]);
        if (!rel) unresolved.push(tables[i]);
      }
      if (unresolved.length) {
        warnings.push('No documented relationship between ' + tables[0] + ' and ' + unresolved.join(', ') + '; these were excluded to avoid an incorrect join. Define a relationship in Update Schema to include them.');
        tables = tables.filter(function (t) { return unresolved.indexOf(t) === -1; });
      }
    }

    var filterConditions = [];
    filterConditions = filterConditions.concat(extractDateFilters(text, tables, engine));

    var threshold = extractNumericThreshold(text);
    if (threshold) {
      // attach to the first numeric-looking candidate column, else flag as missing
      var numCol = columns.filter(function (c) { return /INTEGER|NUMBER|DECIMAL|FLOAT/i.test(c.type || ''); })[0];
      if (numCol) filterConditions.push({ table: numCol.table, column: numCol.column, operator: threshold.operator, value: threshold.value, columnType: numCol.type });
      else missingInfo.push('A numeric comparison ("' + threshold.operator + ' ' + threshold.value + '") was mentioned, but no matching numeric column was identified.');
    }

    if (intent === 'find_missing') {
      var target = columns[0];
      if (target) filterConditions.push({ table: target.table, column: target.column, operator: 'isnull' });
      else missingInfo.push('Could not identify which column is "missing" — mention the field by name (e.g. "payment date").');
    }

    // Aggregation / grouping resolution
    var aggregations = [];
    var groupBy = [];
    if (intent === 'aggregate_count' || intent === 'aggregate_sum' || intent === 'aggregate_avg') {
      var aggFn = intent === 'aggregate_count' ? 'COUNT' : intent === 'aggregate_sum' ? 'SUM' : 'AVG';
      var target2 = columns[0];
      if (target2) {
        aggregations.push({ table: target2.table, column: target2.column, fn: aggFn });
        // non-aggregated selected columns become the GROUP BY
        groupBy = columns.slice(1).map(function (c) { return { table: c.table, column: c.column }; });
      } else if (aggFn === 'COUNT') {
        aggregations.push({ table: tables[0], column: '*', fn: 'COUNT' });
      }
    }

    var orderBy = [];
    var topN = extractTopN(text);
    if (topN || intent === 'top_n') {
      var sortCol = columns.filter(function (c) { return /INTEGER|NUMBER|DECIMAL|FLOAT/i.test(c.type || ''); })[0] || columns[0];
      if (sortCol) orderBy.push({ table: sortCol.table, column: sortCol.column, dir: 'desc' });
    }
    if (/sort by highest|highest amount|highest first|descending/.test(text.toLowerCase()) && !orderBy.length) {
      var sc2 = columns[0];
      if (sc2) orderBy.push({ table: sc2.table, column: sc2.column, dir: 'desc' });
    }

    var distinct = intent === 'find_duplicates' ? false : /\bdistinct\b|\bunique\b/i.test(text);

    return {
      intent: intent, tables: tables, columns: columns, filterConditions: filterConditions,
      groupBy: groupBy, aggregations: aggregations, orderBy: orderBy, distinct: distinct,
      limit: topN, missingInfo: missingInfo, warnings: warnings, rawText: text
    };
  }

  // ---- Conversational refinement: merge a follow-up instruction into a previous plan ----
  function refinePlan(previousPlan, followUpText, engine) {
    var t = followUpText.toLowerCase();
    var plan = JSON.parse(JSON.stringify(previousPlan));
    var m;
    if ((m = /last\s+(\d+)\s+month/.exec(t))) {
      var dateCol = findBestDateColumn(engine, plan.tables);
      if (dateCol) {
        plan.filterConditions = (plan.filterConditions || []).filter(function (c) { return !/DATE|TIME/i.test(c.columnType || ''); });
        plan.filterConditions.push({ table: dateCol.table, column: dateCol.column, operator: 'gte', value: '__MONTHS_AGO_' + m[1], columnType: dateCol.type });
      }
    }
    if (/add\s+(.+?)(\s+name)?$/.test(t) || /include\s+/.test(t)) {
      var tokens = words(t);
      var newCols = findCandidateColumns(engine, tokens, plan.tables);
      newCols.forEach(function (nc) {
        var exists = plan.columns.some(function (c) { return c.table === nc.table && c.column === nc.column; });
        if (!exists) plan.columns.push(nc);
      });
    }
    if (/sort by highest|highest first|descending|largest first/.test(t)) {
      var sortTarget = plan.columns[plan.columns.length - 1] || plan.columns[0];
      if (sortTarget) plan.orderBy = [{ table: sortTarget.table, column: sortTarget.column, dir: 'desc' }];
    }
    if (/sort by lowest|lowest first|ascending|smallest first/.test(t)) {
      var sortTarget2 = plan.columns[plan.columns.length - 1] || plan.columns[0];
      if (sortTarget2) plan.orderBy = [{ table: sortTarget2.table, column: sortTarget2.column, dir: 'asc' }];
    }
    plan.rawText = (previousPlan.rawText || '') + ' | ' + followUpText;
    return plan;
  }

  // Resolves the special relative-date placeholders produced above into real literal values
  // at generation time (kept separate so the plan stays serializable/testable).
  function resolveRelativeDates(value) {
    var m;
    if ((m = /^__DAYS_AGO_(\d+)$/.exec(value))) {
      var d = new Date(); d.setDate(d.getDate() - parseInt(m[1], 10));
      return d.toISOString().slice(0, 10);
    }
    if ((m = /^__MONTHS_AGO_(\d+)$/.exec(value))) {
      var d2 = new Date(); d2.setMonth(d2.getMonth() - parseInt(m[1], 10));
      return d2.toISOString().slice(0, 10);
    }
    return value;
  }

  var API = {
    detectIntent: detectIntent, interpretRequirement: interpretRequirement, refinePlan: refinePlan,
    resolveRelativeDates: resolveRelativeDates, findCandidateTables: findCandidateTables, findCandidateColumns: findCandidateColumns
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_NLQ = API;
})(typeof window !== 'undefined' ? window : this);
