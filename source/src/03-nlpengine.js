/* =========================================================================
   OFFLINE NLP ENGINE — schema-grounded natural-language -> QueryRequirement
   This is the "existing offline NLP engine" referenced throughout the
   V16.0 spec: it ALWAYS runs, ALWAYS resolves strictly against the Active
   Schema, and is the sole authority for final SQL structure regardless of
   whether M365 Copilot Enterprise contributed advisory hints beforehand.
   ========================================================================= */
(function () {
  'use strict';
  var U = window.SQLA.Utils;
  var NlpEngine = {};

  var STOPWORDS = { 'show': 1, 'list': 1, 'all': 1, 'the': 1, 'a': 1, 'an': 1, 'for': 1, 'with': 1, 'and': 1, 'of': 1, 'in': 1, 'by': 1, 'their': 1, 'that': 1, 'are': 1, 'is': 1, 'to': 1, 'from': 1, 'each': 1, 'me': 1 };

  function tokenize(text) {
    return U.safeTrim(text).toLowerCase().split(/[^a-z0-9_]+/).filter(function (t) { return t.length > 1 && !STOPWORDS[t]; });
  }

  function scoreTable(table, terms) {
    var hay = (table.name + ' ' + table.description).toLowerCase();
    var score = 0;
    terms.forEach(function (t) { if (hay.indexOf(t) !== -1) score += 2; if (table.name.toLowerCase().indexOf(t) !== -1) score += 3; });
    return score;
  }
  function scoreColumn(col, terms) {
    var hay = (col.name + ' ' + col.description + ' ' + (col.decode || []).map(function (d) { return d.label; }).join(' ')).toLowerCase();
    var score = 0;
    terms.forEach(function (t) { if (hay.indexOf(t) !== -1) score += 2; });
    return score;
  }

  var AGG_WORDS = [
    { re: /\btotal\b|\bsum\b/, fn: 'SUM' },
    { re: /\bcount\b|\bnumber of\b|\bhow many\b/, fn: 'COUNT' },
    { re: /\baverage\b|\bavg\b/, fn: 'AVG' },
    { re: /\bminimum\b|\bmin\b|\blowest\b/, fn: 'MIN' },
    { re: /\bmaximum\b|\bmax\b|\bhighest\b/, fn: 'MAX' }
  ];

  function detectAggregation(textLower) {
    for (var i = 0; i < AGG_WORDS.length; i++) {
      if (AGG_WORDS[i].re.test(textLower)) return AGG_WORDS[i].fn;
    }
    return null;
  }

  function detectSortAndLimit(textLower) {
    var direction = null;
    if (/\bdesc(ending)?\b/.test(textLower)) direction = 'DESC';
    else if (/\basc(ending)?\b/.test(textLower)) direction = 'ASC';
    var limit = null;
    var topMatch = textLower.match(/\btop\s+(\d+)\b/);
    var limitMatch = textLower.match(/\blimit\s+(\d+)\b/);
    if (topMatch) limit = parseInt(topMatch[1], 10);
    else if (limitMatch) limit = parseInt(limitMatch[1], 10);
    return { direction: direction, limit: limit };
  }

  // Very small decode-aware condition extraction: for each candidate table's
  // decoded columns, if the request text mentions a decode LABEL (e.g.
  // "pending", "approved", "paid", "active"), turn it into an equality
  // filter on the underlying coded column.
  function detectDecodeConditions(schema, candidateTables, textLower) {
    var found = [];
    candidateTables.forEach(function (tableName) {
      var table = schema.tables.filter(function (t) { return t.name === tableName; })[0];
      if (!table) return;
      table.columns.forEach(function (col) {
        if (!col.decode) return;
        col.decode.forEach(function (d) {
          var label = d.label.toLowerCase();
          if (textLower.indexOf(label) !== -1) {
            var negated = new RegExp('(excluding|exclude|not|except)\\s+([a-z\\s]*)?' + label).test(textLower);
            found.push({ table: tableName, column: col.name, operator: negated ? '!=' : '=', value: d.rawValue, label: label });
          }
        });
      });
    });
    return found;
  }

  function detectHints(intentHintsText) {
    // Parses the "[Enterprise NLP interpretation — advisory only...]" block
    // appended by nlpOrchestrator.js, if present, into structured hints.
    var hints = { tables: [], columns: [] };
    var m = intentHintsText.match(/Likely tables:\s*([^.]+)\./i);
    if (m) hints.tables = m[1].split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
    var m2 = intentHintsText.match(/Likely columns:\s*([^.]+)\./i);
    if (m2) hints.columns = m2[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return hints;
  }

  /**
   * parseRequirement(text, schema) -> QueryRequirement
   * This is the ONLY function that ever decides final table/column/join
   * structure. Copilot hints (if present in `text`, appended as an advisory
   * block by nlpOrchestrator) are treated as extra search terms only — if
   * they name something not present in the Active Schema, they simply
   * won't match anything here, so nothing not in the Active Schema can
   * ever reach the generated SQL.
   */
  NlpEngine.parseRequirement = function (text, schema) {
    var rawText = text || '';
    var hintBlockMatch = rawText.match(/\[Enterprise NLP interpretation[\s\S]*$/i);
    var hints = hintBlockMatch ? detectHints(hintBlockMatch[0]) : { tables: [], columns: [] };
    var mainText = hintBlockMatch ? rawText.slice(0, hintBlockMatch.index) : rawText;
    var textLower = rawText.toLowerCase();
    var terms = tokenize(mainText);

    var tableScores = schema.tables.map(function (t) {
      var s = scoreTable(t, terms);
      if (hints.tables.indexOf(t.name) !== -1) s += 5; // Copilot hint boost, still schema-gated
      return { table: t, score: s };
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; });

    var matchedTables = tableScores.slice(0, 4).map(function (x) { return x.table.name; });
    if (!matchedTables.length && schema.tables.length) matchedTables = [schema.tables[0].name];

    var matchedColumns = [];
    matchedTables.forEach(function (tableName) {
      var table = schema.tables.filter(function (t) { return t.name === tableName; })[0];
      if (!table) return;
      var colScores = table.columns.map(function (c) { return { col: c, score: scoreColumn(c, terms) }; })
        .filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; });
      colScores.slice(0, 6).forEach(function (x) {
        matchedColumns.push({ table: tableName, column: x.col.name, displayMode: (x.col.decode && x.col.decode.length && /status|action|description/.test(textLower)) ? 'schema-decode' : 'plain' });
      });
    });

    var aggregation = detectAggregation(textLower);
    var matchedAggregates = [];
    var matchedGroupBy = [];
    if (aggregation && matchedColumns.length) {
      // naive heuristic: aggregate the first numeric-looking column, group by the rest
      var numericCol = matchedColumns[0];
      matchedAggregates.push({ fn: aggregation, table: numericCol.table, column: numericCol.column });
      matchedColumns.slice(1).forEach(function (c) { matchedGroupBy.push(c.table + '.' + c.column); });
    }

    var decodeConditions = detectDecodeConditions(schema, matchedTables, textLower);
    var matchedFilters = decodeConditions.map(function (d) {
      return { table: d.table, column: d.column, operator: d.operator, value: d.value, combinator: 'AND' };
    });

    var sortInfo = detectSortAndLimit(textLower);
    var matchedSorts = [];
    if (sortInfo.direction && matchedColumns.length) {
      var sortTarget = matchedAggregates.length
        ? { ref: matchedAggregates[0].fn + '(' + matchedAggregates[0].table + '.' + matchedAggregates[0].column + ')' }
        : { ref: matchedColumns[0].table + '.' + matchedColumns[0].column };
      matchedSorts.push({ ref: sortTarget.ref, direction: sortInfo.direction });
    }

    var havingMatch = textLower.match(/(?:over|above|greater than|more than)\s+([\d,]+)/);
    var matchedHaving = null;
    if (havingMatch && matchedAggregates.length) {
      var n = havingMatch[1].replace(/,/g, '');
      matchedHaving = { clause: matchedAggregates[0].fn + '(' + matchedAggregates[0].table + '.' + matchedAggregates[0].column + ') > ' + n };
    }

    var confidence = Math.min(1, (matchedTables.length ? 0.4 : 0) + (matchedColumns.length ? 0.3 : 0) + (matchedFilters.length ? 0.15 : 0) + (aggregation ? 0.15 : 0));
    var notes = [];
    if (hints.tables.length) notes.push('Enterprise NLP interpretation contributed advisory hints; final structure resolved against the Active Schema only.');
    if (!tableScores.length) notes.push('No strong table match found — defaulted to the first table in the Active Schema; consider rephrasing with more specific business terms.');

    var clarifications = [];
    // Ambiguity example: a bare status word matching decode labels across
    // more than one candidate table triggers a clarification instead of a
    // silent guess, per the "ambiguity handling" requirement.
    var ambiguousLabelTables = {};
    decodeConditions.forEach(function (d) {
      ambiguousLabelTables[d.label] = ambiguousLabelTables[d.label] || [];
      ambiguousLabelTables[d.label].push(d.table);
    });
    Object.keys(ambiguousLabelTables).forEach(function (label) {
      var tbls = ambiguousLabelTables[label];
      if (tbls.length > 1) {
        clarifications.push('The term "' + label + '" matches a status on more than one table (' + tbls.join(', ') + '). Please confirm which one you mean.');
      }
    });

    return {
      rawText: rawText,
      matchedTables: matchedTables,
      matchedColumns: matchedColumns,
      matchedFilters: matchedFilters,
      matchedSorts: matchedSorts,
      limit: sortInfo.limit,
      distinct: /\bdistinct\b|\bunique\b/.test(textLower),
      confidence: confidence,
      notes: notes,
      queryPlan: ['Natural Language Understanding', 'Schema Analysis', 'Table Identification', 'Column Identification', 'Relationship/Join Identification', 'Filter Identification', 'SQL Construction', 'SQL Validation'],
      clarifications: clarifications,
      unresolvedTerms: [],
      matchedAggregates: matchedAggregates,
      matchedGroupBy: matchedGroupBy,
      matchedHaving: matchedHaving,
      matchedRelatedConditions: []
    };
  };

  /** Converts a QueryRequirement into the ReadOnlyQueryState shape the SQL engine expects. */
  NlpEngine.requirementToState = function (req, dialect) {
    var selectedColumns = req.matchedColumns.map(function (c) {
      return { table: c.table, column: c.column, displayMode: c.displayMode, alias: null };
    });
    if (req.matchedAggregates.length) {
      req.matchedAggregates.forEach(function (a) {
        selectedColumns.unshift({ table: a.table, column: a.column, aggregate: a.fn, alias: (a.fn + '_' + a.column).toUpperCase() });
      });
    }
    return {
      dialect: dialect || 'Oracle',
      naturalLanguageText: req.rawText,
      selectedTables: req.matchedTables,
      selectedColumns: selectedColumns,
      joins: [],
      filters: req.matchedFilters,
      sorts: req.matchedSorts,
      advanced: {
        distinct: req.distinct,
        groupByColumns: req.matchedGroupBy,
        havingClause: req.matchedHaving ? req.matchedHaving.clause : '',
        limit: req.limit,
        ctes: [],
        relatedFilters: [],
        relatedCounts: []
      }
    };
  };

  /** Plain-language "Explain This Query" restatement (V16.0 section 4/10.6 carryover). */
  NlpEngine.explainQuery = function (req) {
    var parts = [];
    parts.push('This query looks at ' + (req.matchedTables.join(', ') || 'the selected table(s)') + '.');
    if (req.matchedAggregates.length) {
      parts.push('It calculates ' + req.matchedAggregates.map(function (a) { return a.fn + ' of ' + a.column; }).join(', ') + '.');
    }
    if (req.matchedFilters.length) {
      parts.push('It only includes rows where ' + req.matchedFilters.map(function (f) { return f.column + ' ' + f.operator + ' ' + f.value; }).join(' and ') + '.');
    }
    if (req.matchedGroupBy.length) parts.push('Results are grouped by ' + req.matchedGroupBy.join(', ') + '.');
    if (req.matchedHaving) parts.push('Only groups matching "' + req.matchedHaving.clause + '" are kept.');
    if (req.matchedSorts.length) parts.push('Results are sorted by ' + req.matchedSorts.map(function (s) { return s.ref + ' ' + s.direction; }).join(', ') + '.');
    if (req.limit) parts.push('Only the top ' + req.limit + ' rows are returned.');
    return parts.join(' ');
  };

  window.SQLA.NlpEngine = NlpEngine;
})();
