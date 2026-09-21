(function (root) {
  'use strict';
  function normalizeSpaces(s) { return String(s || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function containsPhrase(haystackLower, phrase) { if (!phrase) return false; return haystackLower.indexOf(phrase) !== -1; }
  function bareTableName(tableName) { var idx = tableName.indexOf('_'); var withoutModule = idx !== -1 ? tableName.slice(idx + 1) : tableName; return normalizeSpaces(withoutModule); }
  function scoreAllTables(text, engine) {
    var textLower = String(text || '').toLowerCase(); var labels = engine.getModuleLabels();
    return engine.getAllTables().map(function (t) {
      var score = 0; var bare = bareTableName(t.name);
      if (bare && containsPhrase(textLower, bare)) score += 4;
      var rawPhrase = normalizeSpaces(t.name); if (rawPhrase && containsPhrase(textLower, rawPhrase)) score += 5;
      var moduleLabel = labels[t.module]; if (moduleLabel && containsPhrase(textLower, normalizeSpaces(moduleLabel))) score += 1;
      return { table: t, score: score };
    }).sort(function (a, b) { return b.score - a.score; });
  }
  function matchColumns(text, engine, tableNames) {
    var textLower = String(text || '').toLowerCase(); var out = [];
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table) return;
      table.columns.forEach(function (c) {
        var phrases = [normalizeSpaces(c.name)]; if (c.alias) phrases.push(normalizeSpaces(c.alias));
        for (var p = 0; p < phrases.length; p++) { if (phrases[p] && containsPhrase(textLower, phrases[p])) { out.push({ table: tname, column: c.name }); break; } }
      });
    });
    return out;
  }
  var VALUE_RE = '([\\w .,\\-\\/]+?)';
  function cleanValue(v) {
    v = String(v || '').trim();
    if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) v = v.slice(1, -1);
    return v.replace(/[.,;]+$/, '');
  }
  var OPERATOR_DEFS = [
    { operator: 'gte', arity: 1, re: '(?:greater than or equal to|at least)\\s+' + VALUE_RE },
    { operator: 'lte', arity: 1, re: '(?:less than or equal to|at most)\\s+' + VALUE_RE },
    { operator: 'gt', arity: 1, re: '(?:greater than|more than|over|above)\\s+' + VALUE_RE },
    { operator: 'lt', arity: 1, re: '(?:less than|under|below)\\s+' + VALUE_RE },
    { operator: 'not_contains', arity: 1, re: '(?:does not contain|not containing|not contain)\\s+' + VALUE_RE },
    { operator: 'contains', arity: 1, re: '(?:contains|containing)\\s+' + VALUE_RE },
    { operator: 'neq', arity: 1, re: '(?:is not|not equal to)\\s+' + VALUE_RE },
    { operator: 'eq', arity: 1, re: '(?:is|equals?|=)\\s+' + VALUE_RE }
  ];
  function matchFilters(text, engine, tableNames) {
    text = String(text || ''); var conditions = []; var usedColumns = {};
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table) return;
      table.columns.forEach(function (col) {
        var key = tname + '.' + col.name; if (usedColumns[key]) return;
        var phrases = [normalizeSpaces(col.name)]; if (col.alias) phrases.push(normalizeSpaces(col.alias));
        for (var p = 0; p < phrases.length; p++) {
          var phrase = phrases[p]; if (!phrase) continue; var found = false;
          for (var i = 0; i < OPERATOR_DEFS.length; i++) {
            var def = OPERATOR_DEFS[i]; var fullRe = new RegExp(phrase.replace(/ /g, '\\s+') + '\\s+' + def.re, 'i'); var m = text.match(fullRe);
            if (m) { conditions.push({ table: tname, column: col.name, operator: def.operator, value: cleanValue(m[1]) }); usedColumns[key] = true; found = true; break; }
          }
          if (found) break;
        }
      });
    });
    // Decode-label based filters, e.g. "active suppliers" -> IS_ACTIVE = 1
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table) return;
      table.columns.forEach(function (col) {
        var key = tname + '.' + col.name; if (usedColumns[key] || !Array.isArray(col.decode)) return;
        for (var i = 0; i < col.decode.length; i++) { var pair = col.decode[i]; var labelPhrase = normalizeSpaces(pair.label); if (labelPhrase.length > 2 && text.toLowerCase().indexOf(labelPhrase) !== -1) { conditions.push({ table: tname, column: col.name, operator: 'eq', value: pair.code }); usedColumns[key] = true; break; } }
      });
    });
    return conditions;
  }
  function matchSort(text, engine, tableNames) {
    var textLower = String(text || '').toLowerCase();
    var re = /(?:sorted by|order(?:ed)? by|sort by)\s+([a-z0-9 _]+?)(?=(?:\s*,|\s+and\b|\s+ascending|\s+asc\b|\s+descending|\s+desc\b|[.;]|$))/g;
    var out = []; var m;
    while ((m = re.exec(textLower))) { var phrase = normalizeSpaces(m[1]); var col = findColumnByPhrase(engine, tableNames, phrase); if (!col) continue; var tail = textLower.slice(m.index, m.index + m[0].length + 24); var direction = /descending|desc\b|newest|highest|largest|most recent/.test(tail) ? 'DESC' : 'ASC'; out.push({ table: col.table, column: col.column, direction: direction }); }
    return out;
  }
  function findColumnByPhrase(engine, tableNames, phrase) {
    for (var i = 0; i < tableNames.length; i++) {
      var table = engine.getTable(tableNames[i]); if (!table) continue;
      for (var j = 0; j < table.columns.length; j++) {
        var c = table.columns[j]; var phrases = [normalizeSpaces(c.name)]; if (c.alias) phrases.push(normalizeSpaces(c.alias));
        if (phrases.indexOf(phrase) !== -1) return { table: tableNames[i], column: c.name };
      }
    }
    return null;
  }
  function matchLimit(text) { var m = String(text || '').toLowerCase().match(/\b(?:top|first|only)\s+(\d+)\b/); return m ? parseInt(m[1], 10) : null; }
  function matchDistinct(text) { return /\b(distinct|unique|no duplicates|without duplicates|remove duplicates|deduplicated?)\b/i.test(String(text || '')); }
  function matchExclusion(text, engine, tableNames) {
    var out = []; var re = /\b(?:exclude|excluding|without|except)\s+([a-z][a-z0-9 _\-]{1,40}?)\s+(?:users?|suppliers?|records?|invoices?|rows?|entries?|orders?|customers?)\b/ig; var m;
    while ((m = re.exec(text))) {
      var descriptor = normalizeSpaces(m[1]); if (!descriptor) continue;
      tableNames.forEach(function (tname) { var table = engine.getTable(tname); if (!table) return; table.columns.forEach(function (col) { if (/email/i.test(col.name)) out.push({ table: tname, column: col.name, operator: 'not_contains', value: descriptor }); }); });
    }
    return out;
  }
  function matchHierarchy(text, engine) {
    if (!/\b(hierarchy|org chart|organi[sz]ation chart|reporting chain|manager chain|supervisor chain|chain of command)\b/i.test(String(text || ''))) return null;
    var selfRefTables = engine.getAllTables().filter(function (t) { return engine.getSelfReferencingEdges(t.name).length > 0; }).map(function (t) { return t.name; });
    return selfRefTables[0] || null;
  }
  function explainInterpretation(interpretation) {
    if (!interpretation) return [];
    var lines = [];
    if (interpretation.tables && interpretation.tables.length) lines.push('Uses table(s): ' + interpretation.tables.join(', ') + '.');
    if (interpretation.columns && interpretation.columns.length) lines.push('Selects column(s): ' + interpretation.columns.map(function (c) { return c.table + '.' + c.column; }).join(', ') + '.');
    if (interpretation.filterConditions && interpretation.filterConditions.length) lines.push('Filters on ' + interpretation.filterConditions.length + ' condition(s).');
    if (interpretation.orderBy && interpretation.orderBy.length) lines.push('Sorted by ' + interpretation.orderBy.map(function (o) { return o.table + '.' + o.column; }).join(', ') + '.');
    if (interpretation.limit) lines.push('Limited to the first ' + interpretation.limit + ' row(s).');
    if (interpretation.hierarchyTable) lines.push('Walks the full hierarchy of ' + interpretation.hierarchyTable + '.');
    return lines;
  }
  function interpretRequirement(text, engine) {
    text = String(text || '');
    if (!text.trim()) return { tables: [], columns: [], filterConditions: [], orderBy: [], limit: null, distinct: false, hierarchyTable: null, matched: [], warnings: [] };
    var hierarchyTable = matchHierarchy(text, engine);
    if (hierarchyTable) return { tables: [hierarchyTable], columns: [], filterConditions: [], orderBy: [], limit: null, distinct: false, hierarchyTable: hierarchyTable, matched: ['Hierarchy: ' + hierarchyTable], warnings: [] };
    var ranked = scoreAllTables(text, engine).filter(function (s) { return s.score >= 1; });
    if (!ranked.length) return { tables: [], columns: [], filterConditions: [], orderBy: [], limit: null, distinct: false, hierarchyTable: null, matched: [], warnings: ['Could not identify any tables mentioned in your description. Try naming a specific concept (e.g. "invoices", "suppliers", "users"), or select tables manually below.'] };
    var candidateNames = ranked.map(function (s) { return s.table.name; }).slice(0, 4);
    var columns = matchColumns(text, engine, candidateNames);
    var filterConditions = matchFilters(text, engine, candidateNames).concat(matchExclusion(text, engine, candidateNames));
    var orderBy = matchSort(text, engine, candidateNames);
    var limit = matchLimit(text); var distinct = matchDistinct(text);
    var tablesWithPurpose = {}; columns.forEach(function (c) { tablesWithPurpose[c.table] = true; }); filterConditions.forEach(function (c) { tablesWithPurpose[c.table] = true; }); orderBy.forEach(function (o) { tablesWithPurpose[o.table] = true; }); tablesWithPurpose[candidateNames[0]] = true;
    var finalTables = candidateNames.filter(function (t) { return tablesWithPurpose[t]; });
    return { tables: finalTables, columns: columns.filter(function (c) { return finalTables.indexOf(c.table) !== -1; }), filterConditions: filterConditions.filter(function (c) { return finalTables.indexOf(c.table) !== -1; }), orderBy: orderBy.filter(function (o) { return finalTables.indexOf(o.table) !== -1; }), limit: limit, distinct: distinct, hierarchyTable: null, matched: ['Table(s): ' + finalTables.join(', ')], warnings: [] };
  }
  function mergeTableLists(a, b) { var seen = {}; var out = []; (a || []).concat(b || []).forEach(function (t) { var k = String(t).toUpperCase(); if (!seen[k]) { seen[k] = true; out.push(t); } }); return out; }
  function mergeColumnLists(a, b) {
    var existing = {}; (a || []).forEach(function (c) { existing[String(c.table).toUpperCase() + '.' + String(c.column).toUpperCase()] = true; });
    var additions = (b || []).filter(function (c) { var k = String(c.table).toUpperCase() + '.' + String(c.column).toUpperCase(); if (existing[k]) return false; existing[k] = true; return true; });
    return (a || []).concat(additions);
  }
  function mergeFilterConditions(a, b) {
    function keyOf(c) { return [c.table, c.column, c.operator, c.value, c.value2].map(function (x) { return String(x == null ? '' : x).toUpperCase(); }).join('|'); }
    var existing = {}; (a || []).forEach(function (c) { existing[keyOf(c)] = true; });
    var additions = (b || []).filter(function (c) { var k = keyOf(c); if (existing[k]) return false; existing[k] = true; return true; });
    return (a || []).concat(additions);
  }
  var API = { interpretRequirement: interpretRequirement, mergeTableLists: mergeTableLists, mergeColumnLists: mergeColumnLists, mergeFilterConditions: mergeFilterConditions, explainInterpretation: explainInterpretation, scoreAllTables: scoreAllTables };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_NLQUERY = API;
})(typeof window !== 'undefined' ? window : this);
