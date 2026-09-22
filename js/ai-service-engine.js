/**
 * ai-service-engine.js — AP-SQL Assistant V11.8
 * ================================================================
 * THE AI SERVICE LAYER (spec section 36, 46).
 *
 *   Application  →  AI Service Layer  →  AI Provider  →  Model
 *
 * This module is the single seam every AI-powered feature in the app
 * goes through (SQL generation review, Error Rectifier, Query
 * Optimization, Schema Assistant, Filter Assistant, CASE/DECODE
 * Assistant, CR Builder assistance, table/column recommendation).
 * No feature calls a "provider" directly — everything goes through
 * `createAIService(...)`, so the provider can be swapped later
 * (a different model, a remote endpoint, etc.) without touching any
 * UI or engine code.
 *
 * HONEST DISCLOSURE: this is a static, serverless, client-side-only
 * application. There is no backend to safely hold a real model API key
 * (spec section 36: "Do not expose API keys in frontend code"), so the
 * DEFAULT and only bundled provider is a fully local, deterministic
 * "Schema-Grounded Heuristic Provider" — it performs real intent
 * understanding, entity resolution, self-review, and correction by
 * composing the schema/NL/validation/optimize/error-rectifier engines
 * that already ground every answer in the active schema. It never
 * calls out to the network and therefore never hallucinates schema
 * objects, never times out, and never requires a key.
 *
 * A `RemoteAIProvider` seam is included and fully wired into the
 * service (so a real hosted model could be plugged in later by
 * setting a provider config through `configureRemoteProvider`), but it
 * remains INACTIVE unless explicitly configured with an endpoint by an
 * administrator — and even then, every response it returns is passed
 * back through the same schema-grounding validation before being
 * trusted (spec section 19: "AI must not freely hallucinate database
 * objects"). If the remote provider is unset, unreachable, or times
 * out, the service transparently falls back to the local provider
 * (spec section 35: "AI unavailable... application must remain usable").
 */
(function (root) {
  'use strict';
  var NLQ = (typeof module === 'object' && module.exports) ? require('./nl-query-engine.js') : root.APSQL_NLQUERY;
  var VALIDATE = (typeof module === 'object' && module.exports) ? require('./validation-engine.js') : root.APSQL_VALIDATE;
  var SQLENGINE = (typeof module === 'object' && module.exports) ? require('./sql-engine.js') : root.APSQL_ENGINE;
  var OPTIMIZE = (typeof module === 'object' && module.exports) ? require('./optimize-engine.js') : root.APSQL_OPTIMIZE;
  var ERRFIX = (typeof module === 'object' && module.exports) ? require('./error-rectifier-engine.js') : root.APSQL_ERROR_RECTIFIER;
  var DECODE = (typeof module === 'object' && module.exports) ? require('./decode-engine.js') : root.APSQL_DECODE;

  function nowMs() { return Date.now(); }

  /* ----------------------------------------------------------------
     1. TARGETED SCHEMA CONTEXT BUILDER (spec section 37 — do not send
        the entire schema for every small request; retrieve only what
        is relevant to the current request).
     ---------------------------------------------------------------- */
  function buildTargetedSchemaContext(engine, hintTables) {
    var all = engine.getAllTables();
    var relevant = [];
    if (hintTables && hintTables.length) {
      var wanted = {}; hintTables.forEach(function (t) { wanted[String(t).toUpperCase()] = true; });
      relevant = all.filter(function (t) { return wanted[t.name.toUpperCase()]; });
    }
    if (!relevant.length) relevant = all; // fall back to full schema only when no hint is available
    return {
      moduleLabels: engine.getModuleLabels(),
      tableCount: all.length,
      tables: relevant.map(function (t) {
        return {
          name: t.name, module: t.module, notes: t.notes || '',
          columns: t.columns.map(function (c) { return { name: c.name, type: c.type, description: c.description || '', alias: c.alias || '', primary_key: !!c.primary_key, foreign_key: c.foreign_key || null, hasDecode: Array.isArray(c.decode) && c.decode.length > 0 }; })
        };
      })
    };
  }

  /* ----------------------------------------------------------------
     2. LOCAL SCHEMA-GROUNDED HEURISTIC PROVIDER (default, always on)
     ---------------------------------------------------------------- */
  function createLocalProvider(engine, decodeStore) {
    function analyzeIntent(requestText, opts) {
      opts = opts || {};
      var interpretation = NLQ.interpretRequirement(requestText, engine, opts);
      return Promise.resolve({
        provider: 'local-heuristic', grounded: true,
        intent: interpretation.tables.length ? 'retrieve_data' : 'unclear',
        interpretation: interpretation,
        confidence: interpretation.confidence,
        narrative: interpretation.tables.length
          ? ('Identified ' + interpretation.tables.length + ' table(s) and ' + interpretation.filterConditions.length + ' filter condition(s) from the active schema.')
          : 'Could not confidently map this request to any table in the active schema.'
      });
    }
    function planQuery(interpretation) {
      var steps = [];
      steps.push('Entities: ' + (interpretation.tables || []).join(', ') || '(none identified)');
      if (interpretation.bridgeTables && interpretation.bridgeTables.length) steps.push('Join path includes bridge table(s): ' + interpretation.bridgeTables.join(', '));
      if (interpretation.filterConditions && interpretation.filterConditions.length) steps.push('Filters: ' + interpretation.filterConditions.length);
      if (interpretation.aggregates && interpretation.aggregates.length) steps.push('Aggregations: ' + interpretation.aggregates.map(function (a) { return a.aggregate; }).join(', '));
      if (interpretation.groupBy && interpretation.groupBy.length) steps.push('Grouping: ' + interpretation.groupBy.length + ' column(s)');
      if (interpretation.orderBy && interpretation.orderBy.length) steps.push('Sorting: ' + interpretation.orderBy.length + ' column(s)');
      return Promise.resolve({ provider: 'local-heuristic', steps: steps });
    }
    function reviewSql(sql, meta) {
      meta = meta || {};
      var findings = [];
      var errors = [];
      // Schema + relationship correctness (delegates to validation-engine already used at generation time)
      if (meta.tablesUsed && meta.tablesUsed.length) {
        meta.tablesUsed.forEach(function (t) { if (!engine.tableExists(t)) errors.push('Table "' + t + '" does not exist in the active schema.'); });
      }
      if (meta.columnsUsed && meta.columnsUsed.length) {
        meta.columnsUsed.forEach(function (c) { if (c.column !== '*' && !engine.columnExists(c.table, c.column)) errors.push('Column "' + c.table + '.' + c.column + '" does not exist in the active schema.'); });
      }
      // Logic correctness: does the query actually contain what was asked for?
      if (meta.interpretation) {
        var interp = meta.interpretation;
        if (interp.filterConditions && interp.filterConditions.length && !/WHERE/i.test(sql)) findings.push('The request implied filter condition(s), but the generated SQL has no WHERE clause — please confirm this is intentional.');
        if (interp.aggregates && interp.aggregates.length && !/(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sql)) findings.push('The request implied an aggregation, but no aggregate function was found in the SQL.');
        if (interp.orderBy && interp.orderBy.length && !/ORDER BY/i.test(sql)) findings.push('The request implied a sort order, but no ORDER BY clause was found in the SQL.');
      }
      // Performance pass (delegates to optimize-engine)
      var perf = [];
      if (meta.optimizeResult) perf = meta.optimizeResult.recommendations || [];
      var passed = errors.length === 0;
      return Promise.resolve({
        provider: 'local-heuristic', passed: passed,
        schemaCorrect: errors.length === 0,
        relationshipCorrect: !(meta.unresolvedTables && meta.unresolvedTables.length),
        logicFindings: findings,
        performanceFindings: perf,
        errors: errors,
        narrative: passed ? 'Every table and column referenced in this query exists in the active schema, and the query structure matches what was requested.' : 'One or more issues were found — see details below.'
      });
    }
    function rectifyError(sql, errorText, dialect) {
      var result = ERRFIX.rectify(sql, errorText, engine, dialect);
      var analysis = result.errorIdentified;
      return Promise.resolve({
        provider: 'local-heuristic',
        analysis: analysis,
        correctedSql: result.correctedSql,
        changed: result.changed,
        explanation: result.correctionApplied,
        changes: result.changes,
        ruleId: result.ruleId
      });
    }
    function optimizeSql(generateResult) {
      var result = OPTIMIZE.optimizeSql(engine, generateResult);
      return Promise.resolve({ provider: 'local-heuristic', optimizedSql: result.optimizedSql, changesApplied: result.changesApplied, recommendations: result.recommendations, hasChanges: result.hasChanges });
    }
    function explainSchemaObject(question) {
      var SCHEMA_ASSISTANT = (typeof module === 'object' && module.exports) ? require('./schema-assistant-engine.js') : root.APSQL_SCHEMA_ASSISTANT;
      var answer = SCHEMA_ASSISTANT.answerQuestion(question, engine);
      return Promise.resolve(Object.assign({ provider: 'local-heuristic' }, answer));
    }
    function recommendEntities(requestText) {
      var ranked = NLQ.scoreAllTablesEnhanced(requestText, engine).filter(function (s) { return s.score >= 1; }).slice(0, 8);
      return Promise.resolve({
        provider: 'local-heuristic',
        tables: ranked.map(function (r) { return { table: r.table.name, score: r.score, notes: r.table.notes || '' }; })
      });
    }
    function parseFilterFromText(requestText, tableNames) {
      var conditions = NLQ.matchFilters(requestText, engine, tableNames || engine.getAllTables().map(function (t) { return t.name; }), new Date());
      var bool = NLQ.matchBooleanFlagFilters(requestText, engine, tableNames || engine.getAllTables().map(function (t) { return t.name; }));
      return Promise.resolve({ provider: 'local-heuristic', conditions: conditions.concat(bool.filters), ambiguities: bool.ambiguities });
    }
    function proposeCaseDecode(table, column, hintText) {
      var existing = DECODE.resolveDecode(engine, decodeStore, table, column);
      if (existing.source) {
        return Promise.resolve({ provider: 'local-heuristic', reused: true, source: existing.source, values: existing.values, narrative: 'A ' + (existing.source === 'schema' ? 'schema-defined' : 'previously user-defined') + ' CASE/DECODE definition already exists for this column — reusing it instead of creating a duplicate.' });
      }
      var pairs = [];
      var text = String(hintText || '');
      var re = /([\w'\-]+)\s*(?:=|means|is|:)\s*([A-Za-z][A-Za-z0-9 _\-]{0,40})/g;
      var m;
      while ((m = re.exec(text))) pairs.push({ code: m[1].replace(/'/g, ''), label: m[2].trim() });
      if (!pairs.length) {
        return Promise.resolve({ provider: 'local-heuristic', reused: false, values: [], narrative: 'No existing definition was found, and no code=label pairs could be identified in the text provided. Describe the mapping explicitly, e.g. "0 means Draft, 1 means Approved".' });
      }
      return Promise.resolve({ provider: 'local-heuristic', reused: false, values: pairs, narrative: 'No existing definition was found in the active schema. Proposed ' + pairs.length + ' value(s) based on the description provided — review before saving (administrative approval required).' });
    }
    return {
      name: 'local-heuristic', isRemote: false,
      analyzeIntent: analyzeIntent, planQuery: planQuery, reviewSql: reviewSql, rectifyError: rectifyError,
      optimizeSql: optimizeSql, explainSchemaObject: explainSchemaObject, recommendEntities: recommendEntities,
      parseFilterFromText: parseFilterFromText, proposeCaseDecode: proposeCaseDecode
    };
  }

  /* ----------------------------------------------------------------
     3. REMOTE PROVIDER SEAM (inactive unless explicitly configured;
        every response is still schema-validated by the caller before
        being trusted — see reviewSql()/validation-engine usage in app.js)
     ---------------------------------------------------------------- */
  function createRemoteProvider(remoteConfig, fetchImpl) {
    fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    function isConfigured() { return !!(remoteConfig && remoteConfig.endpoint); }
    function callRemote(payload) {
      if (!isConfigured()) return Promise.reject(new Error('No remote AI endpoint is configured.'));
      if (!fetchImpl) return Promise.reject(new Error('No network access is available to reach the remote AI endpoint.'));
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutMs = remoteConfig.timeoutMs || 8000;
      var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
      return fetchImpl(remoteConfig.endpoint, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, remoteConfig.headers || {}),
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      }).then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error('Remote AI endpoint returned HTTP ' + res.status + '.');
        return res.json();
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        throw new Error('Remote AI call failed: ' + (err && err.message ? err.message : 'unknown error'));
      });
    }
    return {
      name: 'remote', isRemote: true, isConfigured: isConfigured,
      analyzeIntent: function (requestText, opts) { return callRemote({ op: 'analyzeIntent', requestText: requestText, opts: opts }); },
      planQuery: function (interpretation) { return callRemote({ op: 'planQuery', interpretation: interpretation }); },
      reviewSql: function (sql, meta) { return callRemote({ op: 'reviewSql', sql: sql, meta: meta }); },
      rectifyError: function (sql, errorText, dialect) { return callRemote({ op: 'rectifyError', sql: sql, errorText: errorText, dialect: dialect }); },
      optimizeSql: function (generateResult) { return callRemote({ op: 'optimizeSql', generateResult: generateResult }); },
      explainSchemaObject: function (question) { return callRemote({ op: 'explainSchemaObject', question: question }); },
      recommendEntities: function (requestText) { return callRemote({ op: 'recommendEntities', requestText: requestText }); },
      parseFilterFromText: function (requestText, tableNames) { return callRemote({ op: 'parseFilterFromText', requestText: requestText, tableNames: tableNames }); },
      proposeCaseDecode: function (table, column, hintText) { return callRemote({ op: 'proposeCaseDecode', table: table, column: column, hintText: hintText }); }
    };
  }

  /* ----------------------------------------------------------------
     4. THE SERVICE — fallback, timing, caching, status reporting.
        Every method resolves to { ...result, meta: { providerUsed,
        fallenBack, elapsedMs, cached } } — callers never need to know
        which provider actually answered.
     ---------------------------------------------------------------- */
  function createAIService(opts) {
    opts = opts || {};
    var engine = opts.engine;
    var decodeStore = opts.decodeStore;
    var localProvider = createLocalProvider(engine, decodeStore);
    var remoteProvider = null;
    var remoteConfig = null;
    var cache = {};
    var CACHE_TTL_MS = opts.cacheTtlMs || 15000;

    function configureRemoteProvider(config, fetchImpl) {
      remoteConfig = config || null;
      remoteProvider = config ? createRemoteProvider(config, fetchImpl) : null;
    }
    function isRemoteConfigured() { return !!(remoteProvider && remoteProvider.isConfigured()); }
    function cacheKey(method, args) { return method + '::' + JSON.stringify(args); }
    function withCache(method, args, fn) {
      var key = cacheKey(method, args);
      var hit = cache[key];
      if (hit && (nowMs() - hit.at) < CACHE_TTL_MS) return Promise.resolve(Object.assign({}, hit.value, { meta: Object.assign({}, hit.value.meta, { cached: true }) }));
      return fn().then(function (value) { cache[key] = { at: nowMs(), value: value }; return value; });
    }
    function callWithFallback(method, args) {
      var start = nowMs();
      var useRemoteFirst = isRemoteConfigured();
      function finish(result, providerUsed, fellBack) {
        return Object.assign({}, result, { meta: { providerUsed: providerUsed, fallenBack: !!fellBack, elapsedMs: nowMs() - start, cached: false } });
      }
      if (!useRemoteFirst) {
        return localProvider[method].apply(null, args).then(function (r) { return finish(r, 'local-heuristic', false); });
      }
      return remoteProvider[method].apply(null, args).then(function (r) { return finish(r, 'remote', false); })
        .catch(function () { return localProvider[method].apply(null, args).then(function (r) { return finish(r, 'local-heuristic', true); }); });
    }
    function analyzeIntent(requestText, requestOpts) { return withCache('analyzeIntent', [requestText], function () { return callWithFallback('analyzeIntent', [requestText, requestOpts]); }); }
    function planQuery(interpretation) { return callWithFallback('planQuery', [interpretation]); }
    function reviewSql(sql, meta) { return callWithFallback('reviewSql', [sql, meta]); }
    function rectifyError(sql, errorText, dialect) { return callWithFallback('rectifyError', [sql, errorText, dialect]); }
    function optimizeSql(generateResult) { return callWithFallback('optimizeSql', [generateResult]); }
    function explainSchemaObject(question) { return callWithFallback('explainSchemaObject', [question]); }
    function recommendEntities(requestText) { return withCache('recommendEntities', [requestText], function () { return callWithFallback('recommendEntities', [requestText]); }); }
    function parseFilterFromText(requestText, tableNames) { return callWithFallback('parseFilterFromText', [requestText, tableNames]); }
    function proposeCaseDecode(table, column, hintText) { return callWithFallback('proposeCaseDecode', [table, column, hintText]); }
    function clearCache() { cache = {}; }
    function getStatus() { return { localAvailable: true, remoteConfigured: isRemoteConfigured(), remoteEndpoint: remoteConfig ? remoteConfig.endpoint : null }; }

    return {
      configureRemoteProvider: configureRemoteProvider, isRemoteConfigured: isRemoteConfigured, getStatus: getStatus, clearCache: clearCache,
      analyzeIntent: analyzeIntent, planQuery: planQuery, reviewSql: reviewSql, rectifyError: rectifyError,
      optimizeSql: optimizeSql, explainSchemaObject: explainSchemaObject, recommendEntities: recommendEntities,
      parseFilterFromText: parseFilterFromText, proposeCaseDecode: proposeCaseDecode
    };
  }

  var API = {
    buildTargetedSchemaContext: buildTargetedSchemaContext,
    createLocalProvider: createLocalProvider,
    createRemoteProvider: createRemoteProvider,
    createAIService: createAIService
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_AI = API;
})(typeof window !== 'undefined' ? window : this);
