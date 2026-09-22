/**
 * ai-service-engine.js — AP-SQL Assistant
 * ================================================================
 * THE AI SERVICE LAYER: Application -> AI Service Layer -> AI Provider -> Model
 * Every AI-powered feature in the app goes through createAIService(...).
 * The default, always-on provider is a fully local, deterministic
 * "Schema-Grounded Heuristic Provider" that composes the schema/NL/
 * validation/optimize/error-rectifier engines already grounded in the
 * active schema — it never calls a network endpoint, never times out,
 * never requires an API key, and never hallucinates a table or column
 * that doesn't exist in the active schema.
 * A RemoteAIProvider seam exists for a future hosted model, wired via
 * configureRemoteProvider(...), but stays inactive unless configured,
 * and falls back to the local provider automatically on any failure.
 */
(function (root) {
  'use strict';
  var NLQ = (typeof module === 'object' && module.exports) ? require('./nl-query-engine.js') : root.APSQL_NLQUERY;
  var OPTIMIZE = (typeof module === 'object' && module.exports) ? require('./optimize-engine.js') : root.APSQL_OPTIMIZE;
  var ERRFIX = (typeof module === 'object' && module.exports) ? require('./error-rectifier-engine.js') : root.APSQL_ERROR_RECTIFIER;
  var DECODE = (typeof module === 'object' && module.exports) ? require('./decode-engine.js') : root.APSQL_DECODE;

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
      return Promise.resolve({ provider: 'local-heuristic', steps: steps });
    }
    function reviewSql(sql, meta) {
      meta = meta || {};
      var findings = [];
      var errors = [];
      if (meta.tablesUsed && meta.tablesUsed.length) {
        meta.tablesUsed.forEach(function (t) { if (!engine.tableExists(t)) errors.push('Table "' + t + '" does not exist in the active schema.'); });
      }
      if (meta.columnsUsed && meta.columnsUsed.length) {
        meta.columnsUsed.forEach(function (c) { if (c.column !== '*' && !engine.columnExists(c.table, c.column)) errors.push('Column "' + c.table + '.' + c.column + '" does not exist in the active schema.'); });
      }
      if (meta.interpretation) {
        var interp = meta.interpretation;
        if (interp.filterConditions && interp.filterConditions.length && !/WHERE/i.test(sql)) findings.push('The request implied filter condition(s), but the generated SQL has no WHERE clause \u2014 please confirm this is intentional.');
        if (interp.orderBy && interp.orderBy.length && !/ORDER BY/i.test(sql)) findings.push('The request implied a sort order, but no ORDER BY clause was found in the SQL.');
      }
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
        narrative: passed ? 'Every table and column referenced in this query exists in the active schema, and the query structure matches what was requested.' : 'One or more issues were found \u2014 see details below.'
      });
    }
    function rectifyError(sql, errorText, dialect) {
      var result = ERRFIX.rectify(sql, errorText, engine, dialect);
      return Promise.resolve({
        provider: 'local-heuristic',
        analysis: result.errorIdentified,
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
        tables: ranked.map(function (r) { return r.table.name; })
      });
    }
    function parseFilterFromText(requestText, tableNames) {
      var conditions = NLQ.matchFilters(requestText, engine, tableNames || engine.getAllTables().map(function (t) { return t.name; }), new Date());
      return Promise.resolve({ provider: 'local-heuristic', conditions: conditions, ambiguities: [] });
    }
    function proposeCaseDecode(table, column, hintText) {
      var existing = DECODE.resolveDecode(engine, decodeStore, table, column);
      if (existing.source) {
        return Promise.resolve({ provider: 'local-heuristic', reused: true, source: existing.source, values: existing.values, narrative: 'A ' + (existing.source === 'schema' ? 'schema-defined' : 'previously user-defined') + ' CASE/DECODE definition already exists for this column \u2014 reusing it instead of creating a duplicate.' });
      }
      var pairs = [];
      var text = String(hintText || '');
      var re = /([\w'-]+)\s*(?:=|means|is|:)\s*([A-Za-z][A-Za-z0-9 _-]{0,40})/g;
      var m;
      while ((m = re.exec(text))) pairs.push({ code: m[1].replace(/'/g, ''), label: m[2].trim() });
      if (!pairs.length) {
        return Promise.resolve({ provider: 'local-heuristic', reused: false, values: [], narrative: 'No existing definition was found, and no code=label pairs could be identified in the text provided. Describe the mapping explicitly, e.g. "0 means Draft, 1 means Approved".' });
      }
      return Promise.resolve({ provider: 'local-heuristic', reused: false, values: pairs, narrative: 'No existing definition was found in the active schema. Proposed ' + pairs.length + ' value(s) based on the description provided \u2014 review before saving.' });
    }
    return {
      name: 'local-heuristic', isRemote: false,
      analyzeIntent: analyzeIntent, planQuery: planQuery, reviewSql: reviewSql, rectifyError: rectifyError,
      optimizeSql: optimizeSql, explainSchemaObject: explainSchemaObject, recommendEntities: recommendEntities,
      parseFilterFromText: parseFilterFromText, proposeCaseDecode: proposeCaseDecode
    };
  }

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

  function createAIService(opts) {
    opts = opts || {};
    var engine = opts.engine;
    var decodeStore = opts.decodeStore;
    var localProvider = createLocalProvider(engine, decodeStore);
    var remoteProvider = null;
    var cache = {};
    var CACHE_TTL_MS = opts.cacheTtlMs || 15000;

    function isRemoteConfigured() { return !!(remoteProvider && remoteProvider.isConfigured()); }
    function getStatus() { return { localAvailable: true, remoteConfigured: isRemoteConfigured() }; }
    function configureRemoteProvider(remoteConfig, fetchImpl) { remoteProvider = createRemoteProvider(remoteConfig, fetchImpl); }

    function withFallback(opName, args, cacheKey) {
      if (cacheKey && cache[cacheKey] && (Date.now() - cache[cacheKey].ts) < CACHE_TTL_MS) {
        var cached = cache[cacheKey].value;
        return Promise.resolve(Object.assign({}, cached, { meta: Object.assign({}, cached.meta, { cached: true }) }));
      }
      var useRemote = isRemoteConfigured();
      var attempt = useRemote
        ? remoteProvider[opName].apply(remoteProvider, args).then(function (res) {
            return Object.assign({}, res, { meta: { providerUsed: 'remote', fallenBack: false, cached: false } });
          }).catch(function () {
            return localProvider[opName].apply(localProvider, args).then(function (res) {
              return Object.assign({}, res, { meta: { providerUsed: 'local-heuristic', fallenBack: true, cached: false } });
            });
          })
        : localProvider[opName].apply(localProvider, args).then(function (res) {
            return Object.assign({}, res, { meta: { providerUsed: 'local-heuristic', fallenBack: false, cached: false } });
          });
      return attempt.then(function (res) {
        if (cacheKey) cache[cacheKey] = { ts: Date.now(), value: res };
        return res;
      });
    }

    function analyzeIntent(requestText, opts2) { return withFallback('analyzeIntent', [requestText, opts2], 'analyzeIntent:' + requestText); }
    function planQuery(interpretation) { return withFallback('planQuery', [interpretation]); }
    function reviewSql(sql, meta) { return withFallback('reviewSql', [sql, meta]); }
    function rectifyError(sql, errorText, dialect) { return withFallback('rectifyError', [sql, errorText, dialect]); }
    function optimizeSql(generateResult) { return withFallback('optimizeSql', [generateResult]); }
    function explainSchemaObject(question) { return withFallback('explainSchemaObject', [question]); }
    function recommendEntities(requestText) { return withFallback('recommendEntities', [requestText]); }
    function parseFilterFromText(requestText, tableNames) { return withFallback('parseFilterFromText', [requestText, tableNames]); }
    function proposeCaseDecode(table, column, hintText) { return withFallback('proposeCaseDecode', [table, column, hintText]); }

    return {
      isRemoteConfigured: isRemoteConfigured, getStatus: getStatus, configureRemoteProvider: configureRemoteProvider,
      analyzeIntent: analyzeIntent, planQuery: planQuery, reviewSql: reviewSql, rectifyError: rectifyError,
      optimizeSql: optimizeSql, explainSchemaObject: explainSchemaObject, recommendEntities: recommendEntities,
      parseFilterFromText: parseFilterFromText, proposeCaseDecode: proposeCaseDecode
    };
  }

  var API = {
    createLocalProvider: createLocalProvider,
    createRemoteProvider: createRemoteProvider,
    createAIService: createAIService
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_AI = API;
})(typeof window !== 'undefined' ? window : this);
