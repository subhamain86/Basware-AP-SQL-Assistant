/* =========================================================================
   SERVICES — crypto/secret vault, M365 Copilot auth+call, NLP orchestrator,
   schema service, GitHub sync (stub), password service.
   ========================================================================= */
(function () {
  'use strict';
  var U = window.SQLA.Utils;
  var Services = {};

  /* ------------------------------------------------------ Crypto (AES) - */
  var CryptoSvc = {};
  CryptoSvc.deriveKey = function (secret, saltBytes) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey'])
      .then(function (keyMaterial) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' },
          keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
      });
  };
  function toBase64(bytes) {
    var binary = '';
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary);
  }
  function fromBase64(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  CryptoSvc.encryptWithSecret = function (secret, plaintext) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return CryptoSvc.deriveKey(secret, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(plaintext));
    }).then(function (cipherBuf) {
      return { salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(cipherBuf)) };
    });
  };
  CryptoSvc.decryptWithSecret = function (secret, blob) {
    var salt = fromBase64(blob.salt);
    var iv = fromBase64(blob.iv);
    var data = fromBase64(blob.data);
    return CryptoSvc.deriveKey(secret, salt).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
    }).then(function (plainBuf) { return new TextDecoder().decode(plainBuf); });
  };
  Services.Crypto = CryptoSvc;

  /* --------------------------------------------------- Secret Vault ---- */
  // Same mechanism already used for the GitHub sync token: one encrypted
  // blob (JSON of key/value fields) protected by the admin password.
  var VAULT_STORAGE_KEY = 'sqla.vault.v16';
  var VaultSvc = { _unlockedSecret: null, _cache: null };
  VaultSvc.isConfigured = function () { return !!U.safeLocalStorageGet(VAULT_STORAGE_KEY); };
  VaultSvc.isUnlocked = function () { return !!VaultSvc._unlockedSecret; };
  VaultSvc.unlock = function (password) {
    var stored = U.safeLocalStorageGet(VAULT_STORAGE_KEY);
    if (!stored) {
      // First-time setup: create an empty vault under this password.
      return CryptoSvc.encryptWithSecret(password, JSON.stringify({})).then(function (blob) {
        U.safeLocalStorageSet(VAULT_STORAGE_KEY, JSON.stringify(blob));
        VaultSvc._unlockedSecret = password;
        VaultSvc._cache = {};
        return { ok: true, created: true };
      });
    }
    var blob = JSON.parse(stored);
    return CryptoSvc.decryptWithSecret(password, blob).then(function (json) {
      VaultSvc._unlockedSecret = password;
      VaultSvc._cache = JSON.parse(json);
      return { ok: true, created: false };
    }).catch(function () { return { ok: false, error: 'Incorrect password.' }; });
  };
  VaultSvc.lock = function () { VaultSvc._unlockedSecret = null; VaultSvc._cache = null; };
  VaultSvc.readField = function (key) {
    if (!VaultSvc._cache) return Promise.resolve(null);
    return Promise.resolve(VaultSvc._cache[key] != null ? JSON.stringify(VaultSvc._cache[key]) : null);
  };
  VaultSvc.writeField = function (key, valueObj) {
    if (!VaultSvc._unlockedSecret) return Promise.resolve({ ok: false, error: 'Vault is locked.' });
    VaultSvc._cache[key] = valueObj;
    return CryptoSvc.encryptWithSecret(VaultSvc._unlockedSecret, JSON.stringify(VaultSvc._cache)).then(function (blob) {
      U.safeLocalStorageSet(VAULT_STORAGE_KEY, JSON.stringify(blob));
      return { ok: true };
    });
  };
  VaultSvc.deleteField = function (key) {
    if (!VaultSvc._unlockedSecret) return Promise.resolve({ ok: false, error: 'Vault is locked.' });
    delete VaultSvc._cache[key];
    return CryptoSvc.encryptWithSecret(VaultSvc._unlockedSecret, JSON.stringify(VaultSvc._cache)).then(function (blob) {
      U.safeLocalStorageSet(VAULT_STORAGE_KEY, JSON.stringify(blob));
      return { ok: true };
    });
  };
  Services.Vault = VaultSvc;

  /* --------------------------------------- M365 Copilot Enterprise auth  */
  // Uses MSAL.js (Microsoft's supported browser auth library) loaded
  // lazily from the Microsoft CDN, ONLY if/when an admin has configured
  // the integration. No credentials are ever hard-coded here.
  var CopilotAuth = {};
  var _msalLoadPromise = null;
  function loadMsal() {
    if (window.msal) return Promise.resolve(window.msal);
    if (_msalLoadPromise) return _msalLoadPromise;
    _msalLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://alcdn.msauth.net/browser/3.x/js/msal-browser.min.js';
      s.onload = function () { resolve(window.msal || null); };
      s.onerror = function () { reject(new Error('Unable to load MSAL browser library (offline or blocked by network policy).')); };
      document.head.appendChild(s);
    }).catch(function (err) { return null; });
    return _msalLoadPromise;
  }
  CopilotAuth.getConfig = function () {
    return VaultSvc.readField('m365CopilotEnterpriseConfig').then(function (raw) {
      if (!raw) return null;
      try {
        var parsed = JSON.parse(raw);
        if (!parsed || !parsed.tenantId || !parsed.clientId || !parsed.copilotEndpoint) return null;
        return parsed;
      } catch (e) { return null; }
    });
  };
  CopilotAuth.acquireToken = function (config) {
    if (config.__devTestMode) {
      // Explicit, clearly-labeled developer test path (see Settings ->
      // Enterprise Integration -> "Developer test mode"). This NEVER
      // contacts Microsoft and NEVER pretends to be a real Copilot
      // response outside of this opt-in, clearly labeled toggle — it
      // exists solely so the online/offline UI states can be verified
      // without a live Entra ID tenant.
      return Promise.resolve({ ok: true, accessToken: 'dev-test-token', devTestMode: true });
    }
    return loadMsal().then(function (msal) {
      if (!msal) return { ok: false, error: 'MSAL browser library unavailable in this environment.' };
      try {
        var app = new msal.PublicClientApplication({
          auth: { clientId: config.clientId, authority: 'https://login.microsoftonline.com/' + config.tenantId },
          cache: { cacheLocation: 'sessionStorage' }
        });
        return app.initialize().then(function () {
          var accounts = app.getAllAccounts();
          var request = { scopes: config.scopes && config.scopes.length ? config.scopes : ['User.Read'], account: accounts[0] };
          return app.acquireTokenSilent(request).then(function (r) {
            return { ok: true, accessToken: r.accessToken };
          }).catch(function () {
            return app.acquireTokenPopup(request).then(function (r) { return { ok: true, accessToken: r.accessToken }; });
          });
        });
      } catch (err) {
        return { ok: false, error: (err && err.message) || 'Enterprise authentication failed.' };
      }
    }).catch(function (err) { return { ok: false, error: (err && err.message) || 'Enterprise authentication failed.' }; });
  };
  Services.CopilotAuth = CopilotAuth;

  /* --------------------------------------- M365 Copilot Enterprise call  */
  var CopilotSvc = {};
  var MAX_TABLES_IN_CONTEXT = 12;
  function scoreTableForContext(table, terms) {
    var hay = (table.name + ' ' + table.description + ' ' + table.columns.map(function (c) { return c.name + ' ' + c.description; }).join(' ')).toLowerCase();
    var score = 0;
    terms.forEach(function (t) { if (hay.indexOf(t) !== -1) score++; });
    return score;
  }
  CopilotSvc.buildMinimalSchemaContext = function (nlText, schema) {
    var terms = U.safeTrim(nlText).toLowerCase().split(/[^a-z0-9_]+/).filter(function (t) { return t.length > 2; });
    var ranked = schema.tables.map(function (t) { return { table: t, score: scoreTableForContext(t, terms) }; })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, MAX_TABLES_IN_CONTEXT).map(function (x) { return x.table; });
    var tableNames = {};
    ranked.forEach(function (t) { tableNames[t.name] = true; });
    var relationships = schema.relationships.filter(function (r) { return tableNames[r.fromTable] || tableNames[r.toTable]; });
    return {
      schemaName: schema.name, schemaVersion: schema.version,
      tables: ranked.map(function (t) {
        return { name: t.name, module: t.module, description: t.description, objectType: t.objectType || 'TABLE',
          columns: t.columns.map(function (c) { return { name: c.name, type: c.type, description: c.description, isPrimaryKey: !!c.isPrimaryKey, isForeignKey: !!c.isForeignKey, references: c.references || null, decode: c.decode || null }; }) };
      }),
      relationships: relationships
    };
  };
  CopilotSvc.callForIntent = function (nlText, schema, accessToken, copilotEndpoint, devTestMode) {
    if (devTestMode) {
      // Deterministic, clearly-labeled local simulation for UI verification
      // only (see CopilotAuth.acquireToken comment above). This performs
      // NO network call at all.
      var terms = U.safeTrim(nlText).toLowerCase();
      var guessTable = schema.tables.filter(function (t) { return terms.indexOf(t.name.toLowerCase()) !== -1 || terms.indexOf(t.description.toLowerCase().split(' ')[0]) !== -1; })[0] || schema.tables[0];
      return Promise.resolve({ ok: true, intent: {
        intentSummary: '[Dev test mode] Simulated interpretation of: ' + nlText,
        candidateTables: [guessTable.name],
        candidateColumns: guessTable.columns.slice(0, 3).map(function (c) { return { table: guessTable.name, column: c.name }; }),
        conditions: [], sort: [], aggregation: null, clarificationNeeded: null
      }});
    }
    var context = CopilotSvc.buildMinimalSchemaContext(nlText, schema);
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 12000);
    return fetch(copilotEndpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: nlText,
        schemaContext: context,
        instructions: 'Interpret this natural-language database query request using ONLY the tables/columns/relationships provided in schemaContext. Do not invent tables or columns. Do not attempt to execute or modify anything. Return only a structured intent (candidateTables, candidateColumns, conditions, sort, aggregation) for a downstream schema-validated SQL generator.'
      }),
      signal: controller.signal
    }).then(function (resp) {
      clearTimeout(timeoutId);
      if (!resp.ok) return { ok: false, error: 'Copilot Enterprise endpoint returned HTTP ' + resp.status + '.' };
      return resp.json().then(function (data) {
        return { ok: true, intent: {
          intentSummary: data.intentSummary || data.intent || '',
          candidateTables: Array.isArray(data.candidateTables) ? data.candidateTables : [],
          candidateColumns: Array.isArray(data.candidateColumns) ? data.candidateColumns : [],
          conditions: Array.isArray(data.conditions) ? data.conditions : [],
          sort: Array.isArray(data.sort) ? data.sort : [],
          aggregation: data.aggregation || null,
          clarificationNeeded: data.clarificationNeeded || null
        }};
      });
    }).catch(function (err) {
      clearTimeout(timeoutId);
      return { ok: false, error: (err && err.name === 'AbortError') ? 'Copilot Enterprise request timed out.' : ((err && err.message) || 'Copilot Enterprise request failed.') };
    });
  };
  Services.Copilot = CopilotSvc;

  /* ---------------------------------------------- NLP Orchestrator (V16) */
  // Implements the required architecture exactly:
  //   Try M365 Copilot Enterprise (if configured) -> always still resolve
  //   via the offline engine against the Active Schema -> SQL generation.
  var Orchestrator = {};
  function buildHintedText(originalText, intent) {
    var hints = [];
    if (intent.candidateTables && intent.candidateTables.length) hints.push('Likely tables: ' + intent.candidateTables.join(', ') + '.');
    if (intent.candidateColumns && intent.candidateColumns.length) hints.push('Likely columns: ' + intent.candidateColumns.map(function (c) { return c.table + '.' + c.column; }).join(', ') + '.');
    if (intent.conditions && intent.conditions.length) hints.push('Likely conditions: ' + intent.conditions.join('; ') + '.');
    if (!hints.length) return originalText;
    return originalText + '\n\n[Enterprise NLP interpretation — advisory only, still validated against Active Schema]\n' + hints.join(' ');
  }
  Orchestrator.run = function (nlText, schema) {
    var engineUsed = 'offline';
    var onlineAttempted = false;
    var onlineError = null;
    var effectiveText = nlText;

    return CopilotAuth.getConfig().then(function (config) {
      if (!config) {
        return finalize();
      }
      onlineAttempted = true;
      return CopilotAuth.acquireToken(config).then(function (auth) {
        if (!auth.ok || !auth.accessToken) {
          onlineError = auth.error;
          return finalize();
        }
        return Services.Copilot.callForIntent(nlText, schema, auth.accessToken, config.copilotEndpoint, config.__devTestMode).then(function (callResult) {
          if (callResult.ok && callResult.intent) {
            effectiveText = buildHintedText(nlText, callResult.intent);
            engineUsed = 'online';
          } else {
            onlineError = callResult.error;
          }
          return finalize();
        });
      });
    }).catch(function (err) {
      onlineError = (err && err.message) || 'Unexpected error contacting M365 Copilot Enterprise.';
      return finalize();
    });

    function finalize() {
      var requirement = window.SQLA.NlpEngine.parseRequirement(effectiveText, schema);
      return { result: requirement, engineUsed: engineUsed, onlineAttempted: onlineAttempted, onlineError: onlineError };
    }
  };
  Services.NlpOrchestrator = Orchestrator;

  /* --------------------------------------------------- Schema service -- */
  var SchemaSvc = {};
  var REGISTRY_KEY = 'sqla.schemaRegistry.v16';
  function loadRegistry() {
    var stored = U.safeLocalStorageGet(REGISTRY_KEY);
    if (stored) { try { return JSON.parse(stored); } catch (e) {} }
    return { schemas: [window.SQLA.CORE_SCHEMA, window.SQLA.EXTENDED_SCHEMA], activeSchemaId: window.SQLA.DEFAULT_ACTIVE_SCHEMA_ID };
  }
  SchemaSvc._registry = loadRegistry();
  SchemaSvc.persist = function () { U.safeLocalStorageSet(REGISTRY_KEY, JSON.stringify(SchemaSvc._registry)); };
  SchemaSvc.getActiveSchema = function () {
    var r = SchemaSvc._registry;
    var found = r.schemas.filter(function (s) { return s.id === r.activeSchemaId; })[0];
    return found || r.schemas[0];
  };
  SchemaSvc.getAllSchemas = function () { return SchemaSvc._registry.schemas; };
  SchemaSvc.switchActiveSchema = function (schemaId) {
    SchemaSvc._registry.schemas.forEach(function (s) { s.status = (s.id === schemaId) ? 'active' : (s.status === 'active' ? 'inactive' : s.status); });
    SchemaSvc._registry.activeSchemaId = schemaId;
    SchemaSvc.persist();
  };
  SchemaSvc.importSchema = function (schemaJson, name) {
    try {
      var parsed = typeof schemaJson === 'string' ? JSON.parse(schemaJson) : schemaJson;
      if (!parsed || !Array.isArray(parsed.tables)) return { ok: false, error: 'Invalid schema file: missing "tables" array.' };
      var id = U.makeId('schema');
      var model = { id: id, name: name || parsed.name || ('Imported Schema ' + id), version: parsed.version || '1.0', status: 'inactive', updatedAt: new Date().toISOString(), lastSyncedAt: null, tables: parsed.tables, relationships: parsed.relationships || [] };
      SchemaSvc._registry.schemas.push(model);
      SchemaSvc.persist();
      return { ok: true, schemaId: id };
    } catch (e) { return { ok: false, error: 'Could not parse schema JSON: ' + e.message }; }
  };
  SchemaSvc.exportActiveSchemaJson = function () { return JSON.stringify(SchemaSvc.getActiveSchema(), null, 2); };
  Services.Schema = SchemaSvc;

  /* -------------------------------------------- Password (Settings gate) */
  var PasswordSvc = { DEFAULT_PASSWORD: 'admin' };
  var PW_KEY = 'sqla.settingsPassword.v16';
  PasswordSvc.verify = function (pw) {
    var stored = U.safeLocalStorageGet(PW_KEY);
    if (!stored) return pw === PasswordSvc.DEFAULT_PASSWORD;
    return pw === stored;
  };
  PasswordSvc.setPassword = function (pw) { U.safeLocalStorageSet(PW_KEY, pw); };
  Services.Password = PasswordSvc;

  window.SQLA.Services = Services;
})();
