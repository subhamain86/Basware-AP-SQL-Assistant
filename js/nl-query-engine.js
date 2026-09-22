(function (root) {
  'use strict';
  var DATATYPE = (typeof module === 'object' && module.exports) ? require('./datatype-engine.js') : root.APSQL_DATATYPE;
  function normalizeSpaces(s) { return String(s || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function containsPhrase(haystackLower, phrase) { if (!phrase) return false; return haystackLower.indexOf(phrase) !== -1; }
  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function cleanValue(raw) {
    if (raw == null) return '';
    var v = String(raw).trim();
    if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) v = v.slice(1, -1);
    v = v.replace(/[.,;]+$/, '');
    return v;
  }
  function bareTableName(tableName) {
    var idx = tableName.indexOf('_');
    var withoutModule = idx !== -1 ? tableName.slice(idx + 1) : tableName;
    return normalizeSpaces(withoutModule);
  }
  var VALUE_RE = '("[^"]*"|\'[^\']*\'|-?\\d+\\.\\d+|-?\\d+|[A-Za-z][A-Za-z0-9_\\-]*)';
  var MULTI_VALUE_LIST_RE = '((?:"[^"]*"|\'[^\']*\'|[A-Za-z0-9_\\-\\.]+)(?:\\s*,\\s*(?:"[^"]*"|\'[^\']*\'|[A-Za-z0-9_\\-\\.]+))*)';
  function scoreAllTables(text, engine) {
    var textLower = String(text || '').toLowerCase();
    var labels = engine.getModuleLabels();
    return engine.getAllTables().map(function (t) {
      var score = 0;
      var bare = bareTableName(t.name);
      if (bare && containsPhrase(textLower, bare)) score += 4;
      var rawPhrase = normalizeSpaces(t.name);
      if (rawPhrase && containsPhrase(textLower, rawPhrase)) score += 5;
      var moduleLabel = labels[t.module];
      if (moduleLabel && containsPhrase(textLower, normalizeSpaces(moduleLabel))) score += 1;
      return { table: t, score: score };
    }).sort(function (a, b) { return b.score - a.score; });
  }
  function matchColumns(text, engine, tableNames, opts) {
    opts = opts || {};
    var threshold = opts.threshold != null ? opts.threshold : 2.5;
    var maxPerTable = opts.maxPerTable != null ? opts.maxPerTable : 8;
    var textLower = String(text || '').toLowerCase();
    var out = [];
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table) return;
      var scored = table.columns.map(function (c) {
        var score = 0;
        var namePhrase = normalizeSpaces(c.name);
        if (namePhrase && containsPhrase(textLower, namePhrase)) score += 5;
        if (c.alias) { var aliasPhrase = normalizeSpaces(c.alias); if (aliasPhrase && containsPhrase(textLower, aliasPhrase)) score += 4; }
        return { col: c, score: score };
      });
      scored.sort(function (a, b) { return b.score - a.score; });
      scored.filter(function (s) { return s.score >= threshold; }).slice(0, maxPerTable).forEach(function (s) {
        var entry = { table: tname, column: s.col.name };
        if (s.col.alias) entry.alias = s.col.alias;
        out.push(entry);
      });
    });
    return out;
  }
  var OPERATOR_DEFS = [
    { operator: 'not_in', arity: 'multi', re: '(?:is not one of|is not any of|not one of)\\s+' + MULTI_VALUE_LIST_RE },
    { operator: 'in', arity: 'multi', re: '(?:is one of|is any of|one of)\\s+' + MULTI_VALUE_LIST_RE },
    { operator: 'between', arity: 2, re: 'between\\s+' + VALUE_RE + '\\s+and\\s+' + VALUE_RE },
    { operator: 'gte', arity: 1, re: '(?:greater than or equal to|at least)\\s+' + VALUE_RE },
    { operator: 'lte', arity: 1, re: '(?:less than or equal to|at most)\\s+' + VALUE_RE },
    { operator: 'gt', arity: 1, re: '(?:greater than|more than|over|above)\\s+' + VALUE_RE },
    { operator: 'lt', arity: 1, re: '(?:less than|under|below)\\s+' + VALUE_RE },
    { operator: 'not_contains', arity: 1, re: '(?:does not contain|not containing|not contain)\\s+' + VALUE_RE },
    { operator: 'contains', arity: 1, re: '(?:contains|containing)\\s+' + VALUE_RE },
    { operator: 'starts_with', arity: 1, re: 'starts?\\s+with\\s+' + VALUE_RE },
    { operator: 'ends_with', arity: 1, re: 'ends?\\s+with\\s+' + VALUE_RE },
    { operator: 'neq', arity: 1, re: '(?:is not|not equal to)\\s+' + VALUE_RE },
    { operator: 'eq', arity: 1, re: '(?:is|equals?|=)\\s+' + VALUE_RE }
  ];
  function findBestDateColumn(engine, tableNames, usedColumns) {
    var candidates = [];
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table) return;
      table.columns.forEach(function (col) {
        var key = tname + '.' + col.name;
        if (usedColumns[key]) return;
        var category = DATATYPE ? DATATYPE.classify(col.type) : 'unknown';
        if (category === 'date' || category === 'timestamp') candidates.push({ table: tname, column: col.name, name: col.name });
      });
    });
    if (!candidates.length) return null;
    var withDateWord = candidates.filter(function (c) { return /date/i.test(c.name); });
    return withDateWord[0] || candidates[0];
  }
  function matchFilters(text, engine, tableNames, now) {
    text = String(text || '');
    var textLower = text.toLowerCase();
    var conditions = [];
    var usedColumns = {};
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table) return;
      table.columns.forEach(function (col) {
        var key = tname + '.' + col.name;
        if (usedColumns[key]) return;
        var phrases = [normalizeSpaces(col.name)];
        if (col.alias) phrases.push(normalizeSpaces(col.alias));
        for (var p = 0; p < phrases.length; p++) {
          var phrase = phrases[p];
          if (!phrase) continue;
          var found = false;
          for (var i = 0; i < OPERATOR_DEFS.length; i++) {
            var def = OPERATOR_DEFS[i];
            var fullRe = new RegExp(escapeRegExp(phrase).replace(/ /g, '\\s+') + '\\s+' + def.re, 'i');
            var m = text.match(fullRe);
            if (m) {
              var cond = { table: tname, column: col.name, operator: def.operator };
              if (def.arity === 2) { cond.value = cleanValue(m[1]); cond.value2 = cleanValue(m[2]); }
              else if (def.arity === 'multi') { cond.value = m[1].trim(); }
              else { cond.value = cleanValue(m[1]); }
              conditions.push(cond);
              usedColumns[key] = true;
              found = true;
              break;
            }
          }
          if (found) break;
        }
      });
    });
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table) return;
      table.columns.forEach(function (col) {
        var key = tname + '.' + col.name;
        if (usedColumns[key] || !Array.isArray(col.decode)) return;
        for (var i = 0; i < col.decode.length; i++) {
          var pair = col.decode[i];
          var labelPhrase = normalizeSpaces(pair.label);
          if (labelPhrase.length > 2 && textLower.indexOf(labelPhrase) !== -1) {
            conditions.push({ table: tname, column: col.name, operator: 'eq', value: pair.code });
            usedColumns[key] = true;
            break;
          }
        }
      });
    });
    var lastDaysMatch = textLower.match(/last\s+(\d+)\s+days?/);
    if (lastDaysMatch && DATATYPE) {
      var n = parseInt(lastDaysMatch[1], 10);
      var dateCol = findBestDateColumn(engine, tableNames, usedColumns);
      if (dateCol) {
        var nowDate = now || new Date();
        var cutoff = new Date(nowDate.getTime() - n * 24 * 60 * 60 * 1000);
        var iso = cutoff.toISOString().slice(0, 10);
        conditions.push({ table: dateCol.table, column: dateCol.column, operator: 'gte', value: iso });
        usedColumns[dateCol.table + '.' + dateCol.column] = true;
      }
    }
    return conditions;
  }
  function findColumnByPhrase(engine, tableNames, phrase) {
    var best = null;
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table || best) return;
      table.columns.forEach(function (col) {
        if (best) return;
        var namePhrase = normalizeSpaces(col.name);
        var aliasPhrase = col.alias ? normalizeSpaces(col.alias) : '';
        if (namePhrase === phrase || aliasPhrase === phrase) best = { table: tname, column: col.name };
      });
    });
    if (best) return best;
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table || best) return;
      table.columns.forEach(function (col) {
        if (best) return;
        var namePhrase = normalizeSpaces(col.name);
        var aliasPhrase = col.alias ? normalizeSpaces(col.alias) : '';
        if ((namePhrase && phrase.indexOf(namePhrase) !== -1) || (aliasPhrase && phrase.indexOf(aliasPhrase) !== -1)) best = { table: tname, column: col.name };
      });
    });
    return best;
  }
  function matchSort(text, engine, tableNames) {
    var textLower = String(text || '').toLowerCase();
    var re = /(?:sorted by|order(?:ed)? by|sort by)\s+([a-z0-9 _]+?)(?=(?:\s*,|\s+and\b|\s+ascending|\s+asc\b|\s+descending|\s+desc\b|\s+newest|\s+oldest|\s+highest|\s+lowest|\s+largest|\s+smallest|[.;]|$))/g;
    var out = []; var m;
    while ((m = re.exec(textLower))) {
      var phrase = normalizeSpaces(m[1]);
      var col = findColumnByPhrase(engine, tableNames, phrase);
      if (!col) continue;
      var tail = textLower.slice(m.index, m.index + m[0].length + 24);
      var direction = /descending|desc\b|newest|highest|largest|most recent/.test(tail) ? 'DESC' : 'ASC';
      out.push({ table: col.table, column: col.column, direction: direction });
    }
    return out;
  }
  function matchLimit(text) {
    var m = String(text || '').toLowerCase().match(/\b(?:top|first|only)\s+(\d+)\b/);
    return m ? parseInt(m[1], 10) : null;
  }
  function matchDistinct(text) {
    return /\b(distinct|unique|no duplicates|without duplicates|remove duplicates|deduplicated?)\b/i.test(String(text || ''));
  }
  function matchHierarchy(text, engine, candidateTableNames) {
    if (!/\b(hierarchy|org chart|organi[sz]ation chart|reporting chain|manager chain|supervisor chain|chain of command)\b/i.test(String(text || ''))) return null;
    var selfRefTables = engine.getAllTables().filter(function (t) { return engine.getSelfReferencingEdges(t.name).length > 0; }).map(function (t) { return t.name; });
    if (!selfRefTables.length) return null;
    if (selfRefTables.length === 1) return selfRefTables[0];
    var inCandidates = selfRefTables.filter(function (t) { return candidateTableNames.indexOf(t) !== -1; });
    if (inCandidates.length === 1) return inCandidates[0];
    var textLower = String(text || '').toLowerCase();
    var scored = selfRefTables.map(function (t) {
      var bareWords = bareTableName(t).split(' ').filter(Boolean);
      var overlap = bareWords.filter(function (w) { return textLower.indexOf(w) !== -1; }).length;
      return { table: t, overlap: overlap };
    }).sort(function (a, b) { return b.overlap - a.overlap; });
    if (scored[0].overlap > 0 && (scored.length === 1 || scored[0].overlap > scored[1].overlap)) return scored[0].table;
    return null;
  }
  function describeOperatorForDisplay(c) {
    switch (c.operator) {
      case 'eq': return '= ' + c.value;
      case 'neq': return '<> ' + c.value;
      case 'gt': return '> ' + c.value;
      case 'lt': return '< ' + c.value;
      case 'gte': return '>= ' + c.value;
      case 'lte': return '<= ' + c.value;
      case 'contains': return 'contains "' + c.value + '"';
      case 'not_contains': return 'does not contain "' + c.value + '"';
      case 'starts_with': return 'starts with "' + c.value + '"';
      case 'ends_with': return 'ends with "' + c.value + '"';
      case 'between': return 'between ' + c.value + ' and ' + c.value2;
      case 'in': return 'is one of (' + c.value + ')';
      case 'not_in': return 'is not one of (' + c.value + ')';
      default: return String(c.operator);
    }
  }
  function detectCrCommand(text) {
    var textLower = String(text || '').toLowerCase();
    var patterns = [
      { re: /\b(delete|remove|get rid of)\b/, command: 'DELETE' },
      { re: /\b(update|change|modify|correct)\b/, command: 'UPDATE' },
      { re: /\b(insert|add|create)\b/, command: 'INSERT' }
    ];
    var best = null, bestIdx = Infinity;
    patterns.forEach(function (p) { var m = textLower.match(p.re); if (m && m.index < bestIdx) { bestIdx = m.index; best = p.command; } });
    return best;
  }
  function matchColumnValueAssignments(searchText, engine, tableName) {
    var table = engine.getTable(tableName); if (!table) return [];
    var out = []; var used = {};
    table.columns.forEach(function (col) {
      if (used[col.name]) return;
      var phrases = [normalizeSpaces(col.name)];
      if (col.alias) phrases.push(normalizeSpaces(col.alias));
      for (var p = 0; p < phrases.length; p++) {
        var phrase = phrases[p]; if (!phrase) continue;
        var patterns = [
          'set\\s+' + escapeRegExp(phrase).replace(/ /g, '\\s+') + '\\s+to\\s+' + VALUE_RE,
          escapeRegExp(phrase).replace(/ /g, '\\s+') + '\\s+to\\s+' + VALUE_RE,
          escapeRegExp(phrase).replace(/ /g, '\\s+') + '\\s*=\\s*' + VALUE_RE,
          escapeRegExp(phrase).replace(/ /g, '\\s+') + '\\s+is\\s+' + VALUE_RE
        ];
        var matchedHere = false;
        for (var i = 0; i < patterns.length; i++) {
          var m = searchText.match(new RegExp(patterns[i], 'i'));
          if (m) { out.push({ name: col.name, column: col.name, value: cleanValue(m[1]) }); used[col.name] = true; matchedHere = true; break; }
        }
        if (matchedHere) break;
      }
    });
    return out;
  }
  function interpretCrDescription(text, engine, opts) {
    opts = opts || {};
    text = String(text || '');
    if (!text.trim()) return { command: null, table: null, insertColumns: [], updateColumns: [], filterConditions: [], matched: [], warnings: [] };
    var command = detectCrCommand(text);
    var ranked = scoreAllTables(text, engine).filter(function (s) { return s.score >= 1; });
    var table = ranked.length ? ranked[0].table.name : null;
    var whereMatch = text.match(/\bwhere\b/i);
    var assignmentText = whereMatch ? text.slice(0, whereMatch.index) : text;
    var filterText = whereMatch ? text.slice(whereMatch.index) : text;
    var matched = [];
    if (command) matched.push('Query Type: ' + command);
    if (table) matched.push('Table: ' + table);
    var insertColumns = [], updateColumns = [], filterConditions = [];
    if (table && command === 'INSERT') {
      insertColumns = matchColumnValueAssignments(assignmentText, engine, table).map(function (c) { return { name: c.name, value: c.value }; });
      insertColumns.forEach(function (c) { matched.push('Value: ' + c.name + ' = ' + c.value); });
    } else if (table && command === 'UPDATE') {
      updateColumns = matchColumnValueAssignments(assignmentText, engine, table).map(function (c) { return { column: c.column, value: c.value }; });
      updateColumns.forEach(function (c) { matched.push('Set: ' + c.column + ' = ' + c.value); });
    }
    if (table && (command === 'UPDATE' || command === 'DELETE')) {
      filterConditions = matchFilters(filterText, engine, [table], opts.now);
      filterConditions.forEach(function (c) { matched.push('Filter: ' + c.table + '.' + c.column + ' ' + describeOperatorForDisplay(c)); });
    }
    return { command: command, table: table, insertColumns: insertColumns, updateColumns: updateColumns, filterConditions: filterConditions, matched: matched, warnings: [] };
  }
  function mergeFilterConditions(manualConditions, nlConditions) {
    function keyOf(c) { return [c.table, c.column, c.operator, c.value, c.value2].map(function (x) { return String(x == null ? '' : x).toUpperCase(); }).join('|'); }
    var existing = {}; (manualConditions || []).forEach(function (c) { existing[keyOf(c)] = true; });
    var additions = (nlConditions || []).filter(function (c) { var k = keyOf(c); if (existing[k]) return false; existing[k] = true; return true; });
    return (manualConditions || []).concat(additions);
  }
  var STOPWORDS = { a: 1, all: 1, an: 1, and: 1, are: 1, as: 1, at: 1, be: 1, by: 1, for: 1, from: 1, in: 1, into: 1, is: 1, it: 1, of: 1, on: 1, or: 1, our: 1, show: 1, that: 1, the: 1, their: 1, them: 1, then: 1, this: 1, to: 1, was: 1, were: 1, where: 1, which: 1, who: 1, whose: 1, with: 1, please: 1, also: 1, only: 1, its: 1 };
  function tokenize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); }
  function contentTokens(s) { return tokenize(s).filter(function (w) { return w.length >= 3 && !STOPWORDS[w]; }); }
  function uniqueWords(arr) { var seen = {}; var out = []; (arr || []).forEach(function (w) { if (!seen[w]) { seen[w] = true; out.push(w); } }); return out; }
  function singularize(word) {
    if (word.length > 4 && word.slice(-3) === 'ies') return word.slice(0, -3) + 'y';
    if (word.length > 3 && word.slice(-2) === 'es' && /[sxz]es$|[cs]hes$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && word.slice(-1) === 's' && word.slice(-2) !== 'ss') return word.slice(0, -1);
    return word;
  }
  function normalizeWordSet(words) { return uniqueWords((words || []).map(singularize)); }
  function normalizeThousandsSeparators(text) {
    return String(text || '').replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, function (m) { return m.replace(/,/g, ''); });
  }
  function scoreAllTablesEnhanced(text, engine) {
    var base = scoreAllTables(text, engine);
    var textContentWords = normalizeWordSet(contentTokens(text));
    return base.map(function (entry) {
      var t = entry.table;
      var score = entry.score;
      var bareWords = normalizeWordSet(tokenize(bareTableName(t.name)));
      var nameOverlap = bareWords.filter(function (w) { return textContentWords.indexOf(w) !== -1; }).length;
      if (nameOverlap > 0) score += nameOverlap * 3;
      // Column-name overlap: a strong, low-noise signal that a table is the
      // intended subject (unlike free-text notes, which can accidentally
      // mention words belonging to a *different* table's own name). Words
      // are collected into a single de-duplicated set across all columns
      // first, so a repeated prefix (e.g. every SUPPLIER_* column) doesn't
      // inflate the score once per column.
      var allColWords = {};
      t.columns.forEach(function (c) {
        normalizeWordSet(tokenize(c.name)).forEach(function (w) {
          if (w.length >= 4 && w !== bareTableName(t.name).replace(/ /g, '')) allColWords[w] = true;
        });
      });
      var colOverlap = Object.keys(allColWords).filter(function (w) { return textContentWords.indexOf(w) !== -1; }).length;
      if (colOverlap > 0) score += colOverlap * 0.8;
      return { table: t, score: score };
    }).sort(function (a, b) { return b.score - a.score; });
  }
  function matchColumnsEnhanced(text, engine, tableNames) {
    var base = matchColumns(text, engine, tableNames, {});
    var existingKeys = {};
    base.forEach(function (c) { existingKeys[c.table + '.' + c.column] = true; });
    var textWords = normalizeWordSet(contentTokens(text));
    tableNames.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table) return;
      table.columns.forEach(function (col) {
        var key = tname + '.' + col.name;
        if (existingKeys[key]) return;
        if (!col.description) return;
        var descWords = normalizeWordSet(tokenize(col.description).filter(function (w) { return w.length > 2 && !STOPWORDS[w]; }));
        if (!descWords.length) return;
        var overlap = textWords.filter(function (w) { return descWords.indexOf(w) !== -1; }).length;
        if (overlap >= 3) {
          var entry = { table: tname, column: col.name };
          if (col.alias) entry.alias = col.alias;
          base.push(entry);
          existingKeys[key] = true;
        }
      });
    });
    return base;
  }
  function buildAdjacency(engine) {
    var tables = engine.getAllTables();
    var adj = {};
    tables.forEach(function (t) { adj[t.name.toUpperCase()] = adj[t.name.toUpperCase()] || {}; });
    tables.forEach(function (t) {
      t.columns.forEach(function (c) {
        if (c.foreign_key && c.foreign_key.table) {
          var a = t.name.toUpperCase(), b = String(c.foreign_key.table).toUpperCase();
          adj[a] = adj[a] || {}; adj[b] = adj[b] || {};
          adj[a][b] = true; adj[b][a] = true;
        }
      });
    });
    return adj;
  }
  function shortestPath(adj, start, goal) {
    if (start === goal) return [start];
    if (!adj[start]) return null;
    var visited = {}; visited[start] = true;
    var queue = [[start]];
    while (queue.length) {
      var path = queue.shift();
      var node = path[path.length - 1];
      var neighbors = Object.keys(adj[node] || {});
      for (var i = 0; i < neighbors.length; i++) {
        var nb = neighbors[i];
        if (nb === goal) return path.concat([nb]);
        if (!visited[nb]) { visited[nb] = true; queue.push(path.concat([nb])); }
      }
    }
    return null;
  }
  function resolveJoinClosure(engine, requiredTableNames) {
    var required = requiredTableNames.map(function (t) { return String(t).toUpperCase(); });
    if (required.length <= 1) return { tables: requiredTableNames.slice(), bridgeTables: [], unresolved: [] };
    var adj = buildAdjacency(engine);
    var finalSet = {}; required.forEach(function (t) { finalSet[t] = true; });
    var bridgeTablesUpper = [];
    var connected = [required[0]];
    var remaining = required.slice(1);
    var guard = 0;
    while (remaining.length && guard < 100) {
      guard++;
      var progressed = false;
      for (var i = 0; i < remaining.length; i++) {
        var target = remaining[i];
        var bestPath = null;
        for (var j = 0; j < connected.length; j++) {
          var p = shortestPath(adj, connected[j], target);
          if (p && (!bestPath || p.length < bestPath.length)) bestPath = p;
        }
        if (bestPath) {
          bestPath.forEach(function (node) { if (!finalSet[node]) { finalSet[node] = true; bridgeTablesUpper.push(node); } if (connected.indexOf(node) === -1) connected.push(node); });
          remaining.splice(i, 1); i--; progressed = true;
        }
      }
      if (!progressed) break;
    }
    var unresolvedUpper = remaining.slice();
    var orderedTables = []; var seen = {};
    requiredTableNames.forEach(function (t) { var u = String(t).toUpperCase(); var tbl = engine.getTable(u); if (tbl && finalSet[u] && !seen[u]) { orderedTables.push(tbl.name); seen[u] = true; } });
    bridgeTablesUpper.forEach(function (u) { if (!seen[u]) { var tbl = engine.getTable(u); if (tbl) { orderedTables.push(tbl.name); seen[u] = true; } } });
    var bridgeTables = bridgeTablesUpper.map(function (u) { var tbl = engine.getTable(u); return tbl ? tbl.name : u; });
    var unresolved = unresolvedUpper.map(function (u) { var tbl = engine.getTable(u); return tbl ? tbl.name : u; });
    return { tables: orderedTables, bridgeTables: bridgeTables, unresolved: unresolved };
  }
  function computeConfidence(finalTables, finalColumns, unresolvedJoins, ambiguities) {
    return {
      tableIdentified: finalTables.length > 0,
      columnsIdentified: finalTables.length > 0,
      relationshipsIdentified: (unresolvedJoins || []).length === 0,
      hasAmbiguities: (ambiguities || []).length > 0,
      unresolvedJoins: unresolvedJoins || [],
      sqlValidated: false
    };
  }
  function buildMatchedSummary(tables, columns, filters, orderBy, groupBy, aggregates, limit, distinct, bridgeTables) {
    var matched = [];
    tables.forEach(function (t) { matched.push('Table: ' + t + (bridgeTables && bridgeTables.indexOf(t) !== -1 ? ' (connected automatically)' : '')); });
    columns.forEach(function (c) { matched.push('Column: ' + c.table + '.' + c.column + (c.alias ? (' (as ' + c.alias + ')') : '')); });
    filters.forEach(function (c) { matched.push('Filter: ' + c.table + '.' + c.column + ' ' + describeOperatorForDisplay(c)); });
    (groupBy || []).forEach(function (g) { matched.push('Grouped by: ' + g.table + '.' + g.column); });
    orderBy.forEach(function (o) { matched.push('Sort: ' + o.table + '.' + o.column); });
    if (limit) matched.push('Limit: ' + limit);
    if (distinct) matched.push('Remove duplicates: yes');
    return matched;
  }
  function explainInterpretation(interpretation) {
    var lines = [];
    if (!interpretation || !interpretation.tables || !interpretation.tables.length) return lines;
    if (interpretation.tables.length === 1) lines.push('Retrieves data from ' + interpretation.tables[0] + '.');
    else lines.push('Retrieves data from ' + interpretation.tables[0] + ', joined with ' + interpretation.tables.slice(1).join(', ') + '.');
    (interpretation.filterConditions || []).forEach(function (f) { lines.push('Filters where ' + f.table + '.' + f.column + ' ' + describeOperatorForDisplay(f) + '.'); });
    if (interpretation.orderBy && interpretation.orderBy.length) lines.push('Sorts the results by ' + interpretation.orderBy.map(function (o) { return o.table + '.' + o.column; }).join(', ') + '.');
    if (interpretation.distinct) lines.push('Removes duplicate rows from the result.');
    if (interpretation.limit) lines.push('Limits the result to the first ' + interpretation.limit + ' rows.');
    return lines;
  }
  function dedupeFilterConditions(conditions) {
    var seen = {}; var out = [];
    conditions.forEach(function (c) {
      if (!c) return;
      var key = [c.table, c.column, c.operator, c.value, c.value2].map(function (x) { return String(x == null ? '' : x).toUpperCase(); }).join('|');
      if (seen[key]) return; seen[key] = true; out.push(c);
    });
    return out;
  }
  function emptyRichInterpretation(warnings) {
    return {
      tables: [], columns: [], filterConditions: [], orderBy: [], limit: null, distinct: false, hierarchyTable: null,
      aggregates: [], groupBy: [], having: null, bridgeTables: [], unresolvedJoins: [], ambiguities: [],
      confidence: computeConfidence([], [], [], []), matched: [], warnings: warnings || []
    };
  }
  function interpretRequirement(text, engine, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var normalizedText = normalizeThousandsSeparators(String(text || ''));
    if (!normalizedText.trim()) return emptyRichInterpretation();
    var preliminaryRanked = scoreAllTablesEnhanced(normalizedText, engine).filter(function (s) { return s.score >= 1; });
    var preliminaryNames = preliminaryRanked.map(function (s) { return s.table.name; });
    var hierarchyTable = matchHierarchy(normalizedText, engine, preliminaryNames);
    if (hierarchyTable) {
      var hInterp = emptyRichInterpretation();
      hInterp.tables = [hierarchyTable]; hInterp.hierarchyTable = hierarchyTable; hInterp.matched = ['Hierarchy: ' + hierarchyTable];
      hInterp.confidence = computeConfidence([hierarchyTable], [], [], []);
      return hInterp;
    }
    var ranked = preliminaryRanked;
    var candidateNames = preliminaryNames;
    if (!ranked.length) return emptyRichInterpretation(['Could not identify any tables mentioned in your description. Try naming a specific concept from your data (e.g. "invoices", "suppliers", "users"), or select tables manually below.']);
    var columns = matchColumnsEnhanced(normalizedText, engine, candidateNames);
    var opFilters = matchFilters(normalizedText, engine, candidateNames, now);
    var filterConditions = dedupeFilterConditions(opFilters);
    var orderBy = matchSort(normalizedText, engine, candidateNames);
    var limit = matchLimit(normalizedText);
    var distinct = matchDistinct(normalizedText);
    var tablesWithPurpose = {};
    columns.forEach(function (c) { tablesWithPurpose[c.table] = true; });
    filterConditions.forEach(function (c) { tablesWithPurpose[c.table] = true; });
    orderBy.forEach(function (o) { tablesWithPurpose[o.table] = true; });
    tablesWithPurpose[ranked[0].table.name] = true;
    var requiredTables = candidateNames.filter(function (t) { return tablesWithPurpose[t]; });
    var closure = resolveJoinClosure(engine, requiredTables);
    var finalTables = closure.tables;
    var finalColumns = columns.filter(function (c) { return finalTables.indexOf(c.table) !== -1; });
    var finalFilters = filterConditions.filter(function (c) { return finalTables.indexOf(c.table) !== -1; });
    var finalOrderBy = orderBy.filter(function (o) { return finalTables.indexOf(o.table) !== -1; });
    var matched = buildMatchedSummary(finalTables, finalColumns, finalFilters, finalOrderBy, [], [], limit, distinct, closure.bridgeTables);
    var confidence = computeConfidence(finalTables, finalColumns, closure.unresolved, []);
    var warnings = [];
    if (closure.unresolved.length) warnings.push('Could not automatically connect: ' + closure.unresolved.join(', ') + '. You can connect these manually in Advanced Options.');
    return {
      tables: finalTables, columns: finalColumns, filterConditions: finalFilters, orderBy: finalOrderBy,
      limit: limit, distinct: distinct, hierarchyTable: null,
      aggregates: [], groupBy: [], having: null,
      bridgeTables: closure.bridgeTables, unresolvedJoins: closure.unresolved,
      ambiguities: [], confidence: confidence, matched: matched, warnings: warnings
    };
  }
  function interpretCrRequirement(text, engine, opts) {
    return interpretCrDescription(normalizeThousandsSeparators(String(text || '')), engine, opts || {});
  }
  var API = {
    scoreAllTables: scoreAllTables, matchColumns: matchColumns, matchFilters: matchFilters,
    matchSort: matchSort, matchLimit: matchLimit, matchDistinct: matchDistinct, matchHierarchy: matchHierarchy,
    detectCrCommand: detectCrCommand, matchColumnValueAssignments: matchColumnValueAssignments, interpretCrDescription: interpretCrDescription,
    mergeFilterConditions: mergeFilterConditions,
    bareTableName: bareTableName, normalizeSpaces: normalizeSpaces,
    normalizeThousandsSeparators: normalizeThousandsSeparators,
    scoreAllTablesEnhanced: scoreAllTablesEnhanced, matchColumnsEnhanced: matchColumnsEnhanced,
    buildAdjacency: buildAdjacency, shortestPath: shortestPath, resolveJoinClosure: resolveJoinClosure,
    computeConfidence: computeConfidence, explainInterpretation: explainInterpretation,
    interpretRequirement: interpretRequirement, interpretCrRequirement: interpretCrRequirement,
    dedupeFilterConditions: dedupeFilterConditions,
    describeOperatorForDisplay: describeOperatorForDisplay
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_NLQUERY = API;
})(typeof window !== 'undefined' ? window : this);
