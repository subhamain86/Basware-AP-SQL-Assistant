(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var LEGACY_SCHEMA_STORAGE_KEY = 'ap_sql_active_schema_v1';
  var schemaStore = APSQL_SCHEMA_STORE.createStore();
  (function migrateOrSeed() {
    if (schemaStore.count() > 0) return;
    var legacySchema = null;
    try {
      var raw = localStorage.getItem(LEGACY_SCHEMA_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tables) && window.APSQL_SCHEMA_TOOLS.validateSchema(parsed.tables).valid) legacySchema = parsed;
      }
    } catch (e) {}
    if (legacySchema) {
      schemaStore.importLegacySingleSchema(legacySchema, legacySchema.schema_name || 'Migrated Schema');
    } else {
      schemaStore.addEntry({ name: window.__AP_SCHEMA__.schema_name || 'Default Schema', schema: window.__AP_SCHEMA__, source: 'embedded' });
    }
  })();
  var relationshipStore = APSQL_RELATIONSHIPS.createRelationshipStore();
  var engine;
  function currentSchema() { return schemaStore.getActiveSchema() || { tables: [] }; }
  function setActiveSchemaObject(schemaObj) {
    var entry = schemaStore.getActiveEntry();
    if (entry) schemaStore.updateEntry(entry.id, { schema: schemaObj });
  }
  function rebuildEngine() { engine = APSQL_RELATIONSHIPS.createEffectiveEngine(APSQL.createEngine(currentSchema()), relationshipStore); rebuildAiService(); }
  var decodeStore = APSQL_DECODE.createDecodeStore();
  var aiService = null;
  function rebuildAiService() { aiService = APSQL_AI.createAIService({ engine: engine, decodeStore: decodeStore }); }
  rebuildEngine();
  var sharedSchemaChecked = false, sharedSchemaFound = false, sharedSchemaError = null;
  var SHARED_SCHEMA_PATH = APSQL_SHARED_SCHEMA.DEFAULT_SHARED_SCHEMA_PATH;
  function renderSharedSchemaStrip(elId) {
    var el = $(elId); if (!el) return;
    var state = { checked: sharedSchemaChecked, found: sharedSchemaFound, error: sharedSchemaError, path: SHARED_SCHEMA_PATH };
    var status = APSQL_SHARED_SCHEMA.describeSharedSchemaStatus(state);
    el.className = 'shared-schema-strip level-' + status.level;
    var icon = status.level === 'live' ? '<span class="shared-schema-pulse"></span>' : '<i class="bi ' + (status.level === 'checking' ? 'bi-hourglass-split' : status.level === 'error' ? 'bi-exclamation-triangle-fill' : 'bi-hdd-fill') + '"></i>';
    el.innerHTML = icon + '<span class="shared-schema-text">' + esc(status.text) + '</span>';
  }
  function renderAllSharedSchemaStrips() {
    renderSharedSchemaStrip('sharedSchemaStripQuickstart');
    renderSharedSchemaStrip('sharedSchemaStripBuilder');
    renderSharedSchemaStrip('sharedSchemaStripCr');
    renderSharedSchemaStrip('sharedSchemaStripUsedSchema');
    var adminEl = $('sharedSchemaStatusBodyAdmin');
    if (adminEl) {
      var state = { checked: sharedSchemaChecked, found: sharedSchemaFound, error: sharedSchemaError, path: SHARED_SCHEMA_PATH };
      var status = APSQL_SHARED_SCHEMA.describeSharedSchemaStatus(state);
      adminEl.innerHTML = '<div class="shared-schema-strip level-' + status.level + '">' +
        (status.level === 'live' ? '<span class="shared-schema-pulse"></span>' : '<i class="bi ' + (status.level === 'checking' ? 'bi-hourglass-split' : status.level === 'error' ? 'bi-exclamation-triangle-fill' : 'bi-hdd-fill') + '"></i>') +
        '<span class="shared-schema-text">' + esc(status.text) + '</span></div>';
    }
    var pathDisplay = $('sharedSchemaPathDisplay'); if (pathDisplay) pathDisplay.textContent = SHARED_SCHEMA_PATH;
  }
  function checkSharedSchema(isManualCheck) {
    return APSQL_SHARED_SCHEMA.fetchSharedSchema(SHARED_SCHEMA_PATH).then(function (result) {
      sharedSchemaChecked = true; sharedSchemaError = null;
      if (!result.found) { sharedSchemaFound = false; renderAllSharedSchemaStrips(); return; }
      var tablesToValidate = Array.isArray(result.schema) ? result.schema : result.schema.tables;
      var validation = window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate);
      if (!validation.valid) { sharedSchemaFound = false; sharedSchemaError = 'The published shared schema failed validation, so it was ignored.'; renderAllSharedSchemaStrips(); return; }
      sharedSchemaFound = true;
      setActiveSchemaObject(result.schema); rebuildEngine();
      refreshAllViewsAfterSchemaChange();
      renderSchemaPersistenceStatus();
      renderAllSharedSchemaStrips();
    }).catch(function (err) {
      sharedSchemaChecked = true; sharedSchemaFound = false;
      sharedSchemaError = isManualCheck ? err.message : null;
      renderAllSharedSchemaStrips();
    });
  }
  renderAllSharedSchemaStrips();
  checkSharedSchema(false);
  var syncSupported = APSQL_SYNC.isFileSystemAccessSupported(window);
  var syncHandleStore = syncSupported ? APSQL_SYNC.createHandleStore() : null;
  var linkedHandle = null, linkedFileName = null, lastKnownFileModified = null;
  var syncNeedsReconnect = false, syncError = null, syncLastCheckedAt = null;
  var pendingSaveRelationshipDraft = null;
  function currentSyncState() { return { supported: syncSupported, linked: !!linkedHandle, fileName: linkedFileName, needsReconnect: syncNeedsReconnect, error: syncError }; }
  function renderSyncStatus(transientNote) {
    var statusBody = $('schemaSyncStatusBody'); var actionsBody = $('schemaSyncActionsBody'); var lastCheckEl = $('schemaSyncLastCheck');
    if (!statusBody || !actionsBody) return;
    var status = APSQL_SYNC.describeSyncStatus(currentSyncState());
    statusBody.innerHTML = '<div class="schema-sync-status-line level-' + status.level + '">' +
      (status.level === 'linked' ? '<span class="schema-sync-pulse"></span>' : '<i class="bi ' + (status.level === 'unsupported' ? 'bi-info-circle' : status.level === 'error' ? 'bi-exclamation-triangle-fill' : status.level === 'reconnect' ? 'bi-plug-fill' : 'bi-cloud-slash') + '"></i>') +
      '<span>' + esc(transientNote || status.text) + '</span></div>';
    actionsBody.innerHTML = '';
    if (!syncSupported) { lastCheckEl.textContent = ''; return; }
    function addBtn(label, iconClass, cls, handler) { var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-sm ' + cls; btn.innerHTML = '<i class="bi ' + iconClass + ' me-1"></i>' + label; btn.addEventListener('click', handler); actionsBody.appendChild(btn); }
    if (syncNeedsReconnect) { addBtn('Reconnect to Shared File', 'bi-plug-fill', 'btn-outline-warning', reconnectSharedFile); addBtn('Unlink', 'bi-x-circle', 'btn-outline-secondary', unlinkSharedFile); }
    else if (linkedHandle) { addBtn('Check Now', 'bi-arrow-clockwise', 'btn-outline-primary', function () { checkLinkedFileForUpdates(true); }); addBtn('Unlink', 'bi-x-circle', 'btn-outline-secondary', unlinkSharedFile); }
    else { addBtn('Create New Shared File', 'bi-file-earmark-plus', 'btn-outline-success', linkNewSharedFile); addBtn('Link Existing Shared File', 'bi-folder2-open', 'btn-outline-primary', linkExistingSharedFile); }
    lastCheckEl.textContent = syncLastCheckedAt ? ('Last checked: ' + syncLastCheckedAt.toLocaleTimeString()) : '';
  }
  function checkLinkedFileForUpdates(isManualCheck) {
    if (!linkedHandle) return Promise.resolve();
    return APSQL_SYNC.verifyPermissionSilent(linkedHandle, 'read').then(function (granted) {
      if (!granted) { syncNeedsReconnect = true; renderSyncStatus(); return; }
      syncNeedsReconnect = false;
      return APSQL_SYNC.readSchemaFromHandle(linkedHandle).then(function (result) {
        syncLastCheckedAt = new Date();
        if (lastKnownFileModified !== null && result.lastModified === lastKnownFileModified) { syncError = null; renderSyncStatus(); return; }
        var tablesToValidate = Array.isArray(result.schema) ? result.schema : result.schema.tables;
        var validation = window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate);
        if (!validation.valid) { renderSyncStatus(); return; }
        setActiveSchemaObject(result.schema); rebuildEngine();
        lastKnownFileModified = result.lastModified;
        refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus();
        syncError = null;
        renderSyncStatus(isManualCheck ? 'Checked the shared file just now.' : 'Schema synced from the shared file (it was updated elsewhere).');
      });
    }).catch(function (err) { if (isManualCheck) { syncError = 'Could not check the shared file: ' + err.message; renderSyncStatus(); } });
  }
  function syncWriteCurrentSchemaIfLinked() {
    if (!linkedHandle) return;
    APSQL_SYNC.verifyPermissionSilent(linkedHandle, 'readwrite').then(function (granted) {
      if (!granted) { syncNeedsReconnect = true; renderSyncStatus(); return; }
      return APSQL_SYNC.writeSchemaToHandle(linkedHandle, currentSchema()).then(function () { return APSQL_SYNC.readSchemaFromHandle(linkedHandle).then(function (result) { lastKnownFileModified = result.lastModified; }); }).then(function () { syncError = null; renderSyncStatus(); });
    }).catch(function (err) { syncError = 'Could not write to the linked shared file: ' + err.message; renderSyncStatus(); });
  }
  function linkNewSharedFile() {
    if (!window.showSaveFilePicker) return;
    window.showSaveFilePicker({ suggestedName: 'ap-sql-assistant-schema.json', types: [{ description: 'AP-SQL Assistant Schema', accept: { 'application/json': ['.json'] } }] })
      .then(function (handle) { linkedHandle = handle; linkedFileName = handle.name; syncNeedsReconnect = false; return APSQL_SYNC.writeSchemaToHandle(handle, currentSchema()).then(function () { return APSQL_SYNC.readSchemaFromHandle(handle); }).then(function (result) { lastKnownFileModified = result.lastModified; return syncHandleStore.saveHandle(handle); }); })
      .then(function () { syncError = null; syncLastCheckedAt = new Date(); renderSyncStatus('Created and linked the shared schema file.'); })
      .catch(function (err) { if (err && err.name === 'AbortError') return; syncError = 'Could not create the shared schema file: ' + err.message; renderSyncStatus(); });
  }
  function linkExistingSharedFile() {
    if (!window.showOpenFilePicker) return;
    window.showOpenFilePicker({ types: [{ description: 'AP-SQL Assistant Schema', accept: { 'application/json': ['.json'] } }] })
      .then(function (handles) {
        var handle = handles[0];
        return APSQL_SYNC.verifyPermission(handle, 'readwrite').then(function (granted) {
          if (!granted) throw new Error('Permission to read/write this file was not granted.');
          return APSQL_SYNC.readSchemaFromHandle(handle).then(function (result) {
            var tablesToValidate = Array.isArray(result.schema) ? result.schema : result.schema.tables;
            var validation = window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate);
            if (!validation.valid) throw new Error('That file does not contain a valid AP-SQL Assistant schema.');
            linkedHandle = handle; linkedFileName = handle.name; syncNeedsReconnect = false;
            setActiveSchemaObject(result.schema); rebuildEngine();
            lastKnownFileModified = result.lastModified;
            return syncHandleStore.saveHandle(handle);
          });
        });
      })
      .then(function () { syncError = null; syncLastCheckedAt = new Date(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderSyncStatus('Linked to the existing shared schema file.'); })
      .catch(function (err) { if (err && err.name === 'AbortError') return; syncError = 'Could not link that shared schema file: ' + err.message; renderSyncStatus(); });
  }
  function unlinkSharedFile() { linkedHandle = null; linkedFileName = null; lastKnownFileModified = null; syncError = null; syncNeedsReconnect = false; syncLastCheckedAt = null; (syncHandleStore ? syncHandleStore.clearHandle() : Promise.resolve()).then(function () { renderSyncStatus(); }).catch(function () { renderSyncStatus(); }); }
  function reconnectSharedFile() { if (!linkedHandle) return; APSQL_SYNC.verifyPermission(linkedHandle, 'readwrite').then(function (granted) { if (!granted) { syncError = 'Permission was not granted, so syncing remains paused for this file.'; renderSyncStatus(); return; } syncNeedsReconnect = false; syncError = null; return checkLinkedFileForUpdates(true); }).catch(function (err) { syncError = 'Could not reconnect: ' + err.message; renderSyncStatus(); }); }
  if (syncSupported && syncHandleStore) {
    syncHandleStore.loadHandle().then(function (handle) {
      if (!handle) { renderSyncStatus(); return; }
      linkedHandle = handle; linkedFileName = handle.name;
      return APSQL_SYNC.verifyPermissionSilent(handle, 'read').then(function (granted) { if (!granted) { syncNeedsReconnect = true; renderSyncStatus(); return; } return checkLinkedFileForUpdates(false).then(function () { renderSyncStatus(); }); });
    }).catch(function () { renderSyncStatus(); });
  } else { renderSyncStatus(); }
  var githubConfigStore = APSQL_GITHUB_SYNC.createConfigStore();
  var githubConfig = null, githubLastSha = null, githubError = null, githubConflict = false, githubLastCheckedAt = null;
  function renderGithubSyncStatus(transientNote) {
    var statusBody = $('githubSyncStatusBody'); var actionsBody = $('githubSyncActionsBody'); var lastCheckEl = $('githubSyncLastCheck'); var configForm = $('githubSyncConfigForm'); var tokenWarningBox = $('githubTokenWarningBox');
    if (!statusBody || !actionsBody) return;
    tokenWarningBox.classList.remove('d-none');
    var state = { configured: !!githubConfig, conflict: githubConflict, error: githubError, owner: githubConfig && githubConfig.owner, repo: githubConfig && githubConfig.repo, path: githubConfig && githubConfig.path, branch: githubConfig && githubConfig.branch };
    var status = APSQL_GITHUB_SYNC.describeGitHubSyncStatus(state);
    statusBody.innerHTML = '<div class="github-sync-status-line level-' + status.level + '">' + (status.level === 'connected' ? '<span class="github-sync-pulse"></span>' : '<i class="bi ' + (status.level === 'unconfigured' ? 'bi-github' : status.level === 'error' ? 'bi-exclamation-triangle-fill' : 'bi-arrow-repeat') + '"></i>') + '<span>' + esc(transientNote || status.text) + '</span></div>';
    configForm.classList.toggle('d-none', !!githubConfig);
    actionsBody.innerHTML = '';
    function addBtn(label, iconClass, cls, handler) { var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-sm ' + cls; btn.innerHTML = '<i class="bi ' + iconClass + ' me-1"></i>' + label; btn.addEventListener('click', handler); actionsBody.appendChild(btn); }
    if (!githubConfig) addBtn('Connect & Sync Now', 'bi-plug-fill', 'btn-outline-success', connectGithub);
    else { addBtn('Sync Now', 'bi-arrow-clockwise', 'btn-outline-primary', function () { checkGithubForUpdates(true); }); addBtn('Disconnect', 'bi-x-circle', 'btn-outline-secondary', disconnectGithub); }
    lastCheckEl.textContent = githubLastCheckedAt ? ('Last checked: ' + githubLastCheckedAt.toLocaleTimeString()) : '';
    refreshVaultControlAvailability();
  }
  function connectGithub() {
    var config = { owner: ($('githubOwnerInput').value || '').trim(), repo: ($('githubRepoInput').value || '').trim(), branch: ($('githubBranchInput').value || '').trim() || 'main', path: ($('githubPathInput').value || '').trim(), token: ($('githubTokenInput').value || '').trim() };
    if (!APSQL_GITHUB_SYNC.isConfigComplete(config)) { githubError = 'Please fill in the repository owner, name, file path, and a Personal Access Token before connecting.'; renderGithubSyncStatus(); return; }
    APSQL_GITHUB_SYNC.fetchRemoteSchema(config).then(function (result) {
      if (result.exists) {
        var tablesToValidate = Array.isArray(result.schema) ? result.schema : result.schema.tables;
        var validation = window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate);
        if (!validation.valid) throw new Error('That file does not contain a valid AP-SQL Assistant schema.');
        githubConfig = config; githubLastSha = result.sha;
        setActiveSchemaObject(result.schema); rebuildEngine();
        refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus();
        return null;
      }
      githubConfig = config;
      return APSQL_GITHUB_SYNC.pushSchemaToGitHub(config, currentSchema(), null).then(function (pushResult) { githubLastSha = pushResult.sha; });
    }).then(function () { githubConfigStore.saveConfig(config); githubError = null; githubConflict = false; githubLastCheckedAt = new Date(); renderGithubSyncStatus('Connected to GitHub and synced.'); })
      .catch(function (err) { githubConfig = null; githubError = err.message; renderGithubSyncStatus(); });
  }
  function disconnectGithub() { githubConfig = null; githubLastSha = null; githubError = null; githubConflict = false; githubLastCheckedAt = null; githubConfigStore.clearConfig(); renderGithubSyncStatus(); }
  function checkGithubForUpdates(isManualCheck) {
    if (!githubConfig) return Promise.resolve();
    return APSQL_GITHUB_SYNC.fetchRemoteSchema(githubConfig).then(function (result) {
      githubLastCheckedAt = new Date();
      if (!result.exists) { githubError = null; githubLastSha = null; renderGithubSyncStatus(isManualCheck ? 'Checked GitHub just now \u2014 no shared file found there yet.' : undefined); return; }
      if (githubLastSha !== null && result.sha === githubLastSha) { githubError = null; renderGithubSyncStatus(isManualCheck ? 'Checked GitHub just now.' : undefined); return; }
      var tablesToValidate = Array.isArray(result.schema) ? result.schema : result.schema.tables;
      var validation = window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate);
      if (!validation.valid) { renderGithubSyncStatus(); return; }
      setActiveSchemaObject(result.schema); rebuildEngine();
      githubLastSha = result.sha;
      refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus();
      githubError = null; githubConflict = false;
      renderGithubSyncStatus(isManualCheck ? 'Checked GitHub just now.' : 'Schema synced from GitHub (it was updated elsewhere).');
    }).catch(function (err) { if (isManualCheck) { githubError = err.message; renderGithubSyncStatus(); } });
  }
  function pushToGithubIfConfigured() {
    if (!githubConfig) return;
    APSQL_GITHUB_SYNC.pushSchemaToGitHub(githubConfig, currentSchema(), githubLastSha).then(function (result) { githubLastSha = result.sha; githubError = null; githubConflict = false; renderGithubSyncStatus(); })
      .catch(function (err) {
        if (!err.conflict) { githubError = err.message; renderGithubSyncStatus(); return; }
        return APSQL_GITHUB_SYNC.fetchRemoteSchema(githubConfig).then(function (remote) { githubLastSha = remote.exists ? remote.sha : null; return APSQL_GITHUB_SYNC.pushSchemaToGitHub(githubConfig, currentSchema(), githubLastSha); }).then(function (result2) { githubLastSha = result2.sha; githubError = null; githubConflict = false; renderGithubSyncStatus(); })
          .catch(function (err2) { githubConflict = !!err2.conflict; githubError = err2.conflict ? 'Someone else updated the shared schema file on GitHub again just now. Click "Sync Now" to fetch the latest version, then try your change again.' : err2.message; renderGithubSyncStatus(); });
      });
  }
  (function initGithubSyncFromStorage() {
    var saved = githubConfigStore.loadConfig();
    if (!saved) { renderGithubSyncStatus(); return; }
    $('githubOwnerInput').value = saved.owner || ''; $('githubRepoInput').value = saved.repo || ''; $('githubBranchInput').value = saved.branch || 'main'; $('githubPathInput').value = saved.path || SHARED_SCHEMA_PATH; $('githubTokenInput').value = saved.token || '';
    githubConfig = saved;
    checkGithubForUpdates(false).then(function () { renderGithubSyncStatus(); });
  })();
  (function defaultGithubPathToSharedPath() { var pathInput = $('githubPathInput'); if (pathInput && !pathInput.value) pathInput.value = SHARED_SCHEMA_PATH; })();
  var syncScheduleSelectedId = APSQL_SYNC_SCHEDULE.loadSelectedOptionId();
  var syncIntervalHandle = null;
  function runAllAutomaticSyncChecks() {
    if (typeof document.hidden !== 'undefined' && document.hidden) return;
    checkSharedSchema(false);
    checkLinkedFileForUpdates(false);
    checkGithubForUpdates(false);
  }
  function applySyncScheduleInterval() {
    if (syncIntervalHandle) { clearInterval(syncIntervalHandle); syncIntervalHandle = null; }
    var ms = APSQL_SYNC_SCHEDULE.toIntervalMs(syncScheduleSelectedId);
    if (ms != null) syncIntervalHandle = setInterval(runAllAutomaticSyncChecks, ms);
  }
  applySyncScheduleInterval();
  if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', function () { if (!document.hidden) runAllAutomaticSyncChecks(); });
  function renderSyncScheduleSelect() {
    var sel = $('syncScheduleSelect'); if (!sel) return;
    sel.innerHTML = APSQL_SYNC_SCHEDULE.OPTIONS.map(function (o) { return '<option value="' + o.id + '">' + esc(o.label) + '</option>'; }).join('');
    sel.value = syncScheduleSelectedId;
    var note = $('syncScheduleCurrentNote');
    if (note) note.textContent = 'Currently synchronizing: ' + APSQL_SYNC_SCHEDULE.getOption(syncScheduleSelectedId).label + '.';
  }
  renderSyncScheduleSelect();
  $('syncScheduleSelect').addEventListener('change', function () {
    syncScheduleSelectedId = $('syncScheduleSelect').value;
    APSQL_SYNC_SCHEDULE.saveSelectedOptionId(null, syncScheduleSelectedId);
    applySyncScheduleInterval();
    renderSyncScheduleSelect();
  });
  function renderVaultStatus(transientNote, level) {
    var box = $('vaultStatusBody'); if (!box) return;
    var lvl = level || 'unset';
    var text = transientNote || (APSQL_VAULT.isSupported() ? 'No vault has been published in this session yet. Fill in the GitHub connection above, enter a passphrase, and click "Encrypt & Publish Vault".' : 'This browser does not support the Web Crypto API required for the secure credential vault.');
    box.innerHTML = '<div class="vault-status-line level-' + lvl + '"><i class="bi ' + (lvl === 'published' ? 'bi-shield-check' : lvl === 'error' ? 'bi-exclamation-triangle-fill' : 'bi-shield-lock') + '"></i><span>' + esc(text) + '</span></div>';
  }
  function refreshVaultControlAvailability() {
    var unsupportedNote = $('vaultUnsupportedNote'); var controls = $('vaultControls');
    if (!unsupportedNote || !controls) return;
    var supported = APSQL_VAULT.isSupported();
    unsupportedNote.classList.toggle('d-none', supported);
    if (!supported) unsupportedNote.textContent = 'This browser does not support the Web Crypto API (SubtleCrypto) required to encrypt or decrypt the credential vault. Try a modern version of Chrome, Edge, Firefox, or Safari.';
    controls.classList.toggle('d-none', !supported);
    $('publishVaultBtn').disabled = !githubConfig;
  }
  renderVaultStatus(); refreshVaultControlAvailability();
  $('publishVaultBtn').addEventListener('click', function () {
    var passphrase = $('vaultPassphraseInput').value;
    var resultBox = $('vaultResultBox');
    if (!githubConfig) { resultBox.innerHTML = '<div class="alert alert-warning py-2 mb-0 small">Connect GitHub-Hosted Schema Sync above first, so there is a connection to encrypt.</div>'; return; }
    if (!passphrase) { resultBox.innerHTML = '<div class="alert alert-warning py-2 mb-0 small">Please enter a vault passphrase.</div>'; return; }
    resultBox.innerHTML = '<div class="alert alert-secondary py-2 mb-0 small"><i class="bi bi-hourglass-split me-1"></i>Encrypting and publishing the vault\u2026</div>';
    APSQL_VAULT.buildVaultBlob(githubConfig, passphrase).then(function (blobText) {
      var vaultPath = githubConfig.path.replace(/(\.[^./]+)?$/, '') + '.vault.json';
      var vaultGithubConfig = Object.assign({}, githubConfig, { path: vaultPath });
      return APSQL_GITHUB_SYNC.fetchRawJsonFile(vaultGithubConfig).then(function (existing) {
        return APSQL_GITHUB_SYNC.pushSchemaToGitHub(vaultGithubConfig, JSON.parse(blobText), existing.exists ? existing.sha : null);
      }).then(function () {
        renderVaultStatus('Vault published to ' + vaultGithubConfig.path + '. Share the passphrase with authorized users out-of-band \u2014 it is never stored in the vault itself.', 'published');
        resultBox.innerHTML = '<div class="alert alert-success py-2 mb-0 small"><i class="bi bi-check-circle-fill me-1"></i>Vault encrypted and published successfully. The token was never sent or stored in plain text.</div>';
        $('vaultPassphraseInput').value = '';
      });
    }).catch(function (err) {
      renderVaultStatus('Could not publish the vault: ' + err.message, 'error');
      resultBox.innerHTML = '<div class="alert alert-danger py-2 mb-0 small"><i class="bi bi-exclamation-triangle-fill me-1"></i>' + esc(err.message) + '</div>';
    });
  });
  $('unlockVaultBtn').addEventListener('click', function () {
    var passphrase = $('vaultUnlockPassphraseInput').value;
    var resultBox = $('vaultResultBox');
    var pathInput = ($('githubPathInput').value || SHARED_SCHEMA_PATH).trim();
    var vaultPath = pathInput.replace(/(\.[^./]+)?$/, '') + '.vault.json';
    var owner = ($('githubOwnerInput').value || '').trim();
    var repo = ($('githubRepoInput').value || '').trim();
    var branch = ($('githubBranchInput').value || 'main').trim() || 'main';
    var typedToken = ($('githubTokenInput').value || '').trim();
    if (!owner || !repo) { resultBox.innerHTML = '<div class="alert alert-warning py-2 mb-0 small">Please fill in at least the repository owner and name above, so the vault file can be located.</div>'; return; }
    if (!passphrase) { resultBox.innerHTML = '<div class="alert alert-warning py-2 mb-0 small">Please enter the vault passphrase to unlock.</div>'; return; }
    resultBox.innerHTML = '<div class="alert alert-secondary py-2 mb-0 small"><i class="bi bi-hourglass-split me-1"></i>Fetching and unlocking the vault\u2026</div>';
    var lookupConfig = { owner: owner, repo: repo, branch: branch, path: vaultPath };
    if (typedToken) lookupConfig.token = typedToken;
    APSQL_GITHUB_SYNC.fetchRawJsonFile(lookupConfig).then(function (result) {
      if (!result.exists) throw new Error('No vault file was found at ' + vaultPath + '. Ask an administrator to publish one first.');
      return APSQL_VAULT.decryptConfig(result.content, passphrase);
    }).then(function (decryptedConfig) {
      $('githubOwnerInput').value = decryptedConfig.owner || ''; $('githubRepoInput').value = decryptedConfig.repo || ''; $('githubBranchInput').value = decryptedConfig.branch || 'main'; $('githubPathInput').value = decryptedConfig.path || ''; $('githubTokenInput').value = decryptedConfig.token || '';
      resultBox.innerHTML = '<div class="alert alert-success py-2 mb-0 small"><i class="bi bi-check-circle-fill me-1"></i>Vault unlocked. The GitHub connection fields above have been filled in \u2014 click "Connect &amp; Sync Now" to activate this connection on this machine.</div>';
      $('vaultUnlockPassphraseInput').value = '';
    }).catch(function (err) {
      resultBox.innerHTML = '<div class="alert alert-danger py-2 mb-0 small"><i class="bi bi-exclamation-triangle-fill me-1"></i>' + esc(err.message) + '</div>';
    });
  });
  var passwordManager = APSQL_PASSWORD_MANAGER.createPasswordManager();
  function renderPasswordCustomNote() {
    var note = $('passwordCustomStatusNote'); if (!note) return;
    note.textContent = passwordManager.isCustomPasswordSet() ? 'A custom password is currently set in this browser.' : 'Currently using the default password for this browser. Change the password required to unlock this Update Schema section, in this browser.';
  }
  renderPasswordCustomNote();
  $('changePasswordBtn').addEventListener('click', function () {
    var current = $('currentPasswordInput').value, next = $('newPasswordInput').value, confirmNext = $('confirmNewPasswordInput').value;
    var resultBox = $('passwordChangeResultBox');
    passwordManager.changePassword(current, next, confirmNext).then(function (result) {
      if (!result.ok) { resultBox.innerHTML = '<div class="alert alert-danger py-2 mb-0 small">' + esc(result.error) + '</div>'; return; }
      resultBox.innerHTML = '<div class="alert alert-success py-2 mb-0 small"><i class="bi bi-check-circle-fill me-1"></i>The operational password has been changed successfully in this browser.</div>';
      $('currentPasswordInput').value = ''; $('newPasswordInput').value = ''; $('confirmNewPasswordInput').value = '';
      renderPasswordCustomNote();
    });
  });
  var forgotPwBtn = $('forgotPasswordBtn');
  if (forgotPwBtn) forgotPwBtn.addEventListener('click', function () {
    passwordManager.resetToDefault();
    renderPasswordCustomNote();
    var resultBox = $('passwordChangeResultBox');
    if (resultBox) resultBox.innerHTML = '<div class="alert alert-success py-2 mb-0 small"><i class="bi bi-check-circle-fill me-1"></i>The operational password has been reset to the documented default for this browser. No stored schema was affected.</div>';
  });
  function persistCurrentSchema() { schemaStore.persist(); syncWriteCurrentSchemaIfLinked(); pushToGithubIfConfigured(); }
  function renderSchemaPersistenceStatus() {
    var el = $('schemaPersistenceStatus'); if (!el) return;
    var entry = schemaStore.getActiveEntry();
    el.innerHTML = '<i class="bi bi-hdd-fill"></i><span>Currently working with <strong>' + esc(entry ? entry.name : 'an unnamed schema') + '</strong> (' + schemaStore.count() + ' schema' + (schemaStore.count() === 1 ? '' : 's') + ' stored in this browser). Applying an update or deleting content is saved automatically from now on.</span>';
  }
  renderSchemaPersistenceStatus();
  function syncStatusBadgeClass(status) { return 'status-' + (status || 'idle'); }
  function schemaStateBadgeHtml(state) { return '<span class="badge schema-state-badge state-' + state + ' text-uppercase">' + state + '</span>'; }
  function renderSchemaStoreList() {
    var box = $('schemaStoreList'); if (!box) return;
    box.innerHTML = '';
    var entries = schemaStore.listEntries();
    if (!entries.length) { var empty = document.createElement('div'); empty.className = 'schema-store-empty'; empty.textContent = 'No schemas stored yet. Add one under Update Schema.'; box.appendChild(empty); return; }
    var activeId = schemaStore.getActiveId();
    entries.forEach(function (e) {
      var st = APSQL.createEngine(e.schema).getStatus();
      var isActive = e.id === activeId;
      var schemaState = schemaStore.getSchemaState(e.id);
      var item = document.createElement('div'); item.className = 'schema-store-item' + (schemaStore.isDefault(e.id) ? ' active default' : ''); item.setAttribute('data-entry-id', e.id);
      var main = document.createElement('div'); main.className = 'schema-store-item-main';
      var nameLine = document.createElement('div'); nameLine.className = 'schema-store-item-name';
      nameLine.innerHTML = '<i class="bi bi-database"></i> ' + esc(e.name) + ' ' + schemaStateBadgeHtml(schemaState);
      var metaLine = document.createElement('div'); metaLine.className = 'schema-store-item-meta';
      metaLine.innerHTML = '<span>Version: ' + esc(st.schemaVersion || '\u2014') + '</span><span>Source: ' + esc(e.source) + '</span><span>Tables: ' + st.tableCount + '</span><span>Last sync: ' + (e.lastSyncAt ? new Date(e.lastSyncAt).toLocaleString() : 'never') + '</span><span class="schema-store-sync-badge ' + syncStatusBadgeClass(e.lastSyncStatus) + '">Sync status: ' + esc(e.lastSyncStatus) + (e.lastSyncError ? ' (' + esc(e.lastSyncError) + ')' : '') + '</span>';
      main.appendChild(nameLine); main.appendChild(metaLine);
      var actions = document.createElement('div'); actions.className = 'schema-store-item-actions';
      var activeToggleWrap = document.createElement('div'); activeToggleWrap.className = 'form-check form-switch schema-store-active-toggle';
      var activeToggle = document.createElement('input'); activeToggle.type = 'checkbox'; activeToggle.className = 'form-check-input'; activeToggle.checked = schemaStore.isActive(e.id); activeToggle.disabled = schemaStore.isDefault(e.id);
      var activeToggleLabel = document.createElement('label'); activeToggleLabel.className = 'form-check-label small'; activeToggleLabel.textContent = 'Active';
      activeToggle.addEventListener('change', function () { schemaStore.setEntryActive(e.id, activeToggle.checked); rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaStoreList(); });
      activeToggleWrap.appendChild(activeToggle); activeToggleWrap.appendChild(activeToggleLabel);
      actions.appendChild(activeToggleWrap);
      if (!isActive) {
        var selectBtn = document.createElement('button'); selectBtn.type = 'button'; selectBtn.className = 'btn btn-outline-primary btn-sm'; selectBtn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Set Active';
        selectBtn.addEventListener('click', function () { schemaStore.setActiveId(e.id); rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderSchemaStoreList(); });
        actions.appendChild(selectBtn);
      }
      item.appendChild(main); item.appendChild(actions);
      box.appendChild(item);
    });
  }
  var targetSchemaId = null;
  function renderTargetSchemaSelect() {
    var sel = $('targetSchemaSelect'); if (!sel) return;
    var entries = schemaStore.listEntries();
    if (!targetSchemaId || !entries.some(function (e) { return e.id === targetSchemaId; })) targetSchemaId = schemaStore.getActiveId();
    sel.innerHTML = entries.map(function (e) { return '<option value="' + e.id + '">' + esc(e.name) + (e.id === schemaStore.getActiveId() ? ' (active)' : '') + '</option>'; }).join('');
    sel.value = targetSchemaId;
  }
  $('targetSchemaSelect').addEventListener('change', function () { targetSchemaId = $('targetSchemaSelect').value; });
  function targetSchemaEntry() { return schemaStore.getEntry(targetSchemaId) || schemaStore.getActiveEntry(); }
  $('showAddSchemaFormBtn').addEventListener('click', function () { $('addSchemaFormBox').classList.remove('d-none'); $('newSchemaNameInput').value = ''; $('newSchemaNameInput').focus(); });
  $('cancelAddSchemaBtn').addEventListener('click', function () { $('addSchemaFormBox').classList.add('d-none'); });
  $('confirmAddSchemaBtn').addEventListener('click', function () {
    var name = ($('newSchemaNameInput').value || '').trim();
    if (!name) { $('newSchemaNameInput').focus(); return; }
    var entry = schemaStore.addEntry({ name: name, schema: { schema_name: name, schema_version: '0.0', tables: [] }, source: 'upload' });
    targetSchemaId = entry.id;
    $('addSchemaFormBox').classList.add('d-none');
    renderTargetSchemaSelect(); renderSchemaStoreList(); renderDefaultActiveSchemaChoices();
  });
  $('deleteTargetSchemaBtn').addEventListener('click', function () {
    if (schemaStore.count() <= 1) { alert('At least one schema must remain stored. Add another schema before removing this one.'); return; }
    $('deleteStoredSchemaPasswordInput').value = ''; $('deleteStoredSchemaPasswordError').classList.add('d-none');
    if (deleteStoredSchemaModal) deleteStoredSchemaModal.show();
  });
  var deleteStoredSchemaModalEl = $('deleteStoredSchemaModal'); var deleteStoredSchemaModal = window.bootstrap ? new window.bootstrap.Modal(deleteStoredSchemaModalEl) : null;
  $('confirmDeleteStoredSchemaBtn').addEventListener('click', function () {
    var pw = $('deleteStoredSchemaPasswordInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (!ok) { $('deleteStoredSchemaPasswordError').classList.remove('d-none'); return; }
      schemaStore.removeEntry(targetSchemaId);
      targetSchemaId = schemaStore.getActiveId();
      rebuildEngine();
      refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderSchemaStoreList(); renderTargetSchemaSelect(); renderDefaultActiveSchemaChoices();
      if (deleteStoredSchemaModal) deleteStoredSchemaModal.hide();
    });
  });
  function renderDefaultActiveSchemaChoices() {
    var defaultBox = $('defaultSchemaChoices'); var activeBox = $('activeSchemaChoices');
    if (!defaultBox || !activeBox) return;
    var entries = schemaStore.listEntries();
    defaultBox.innerHTML = entries.map(function (e) {
      return '<div class="form-check"><input class="form-check-input" type="radio" name="defaultSchemaRadio" value="' + e.id + '" id="defRadio_' + e.id + '" ' + (schemaStore.isDefault(e.id) ? 'checked' : '') + '><label class="form-check-label small" for="defRadio_' + e.id + '">' + esc(e.name) + '</label></div>';
    }).join('') || '<p class="text-body-secondary small mb-0">No schemas stored yet.</p>';
    defaultBox.querySelectorAll('input[name="defaultSchemaRadio"]').forEach(function (r) {
      r.addEventListener('change', function () { schemaStore.setDefaultId(r.value); rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderSchemaStoreList(); renderDefaultActiveSchemaChoices(); });
    });
    activeBox.innerHTML = entries.map(function (e) {
      return '<div class="form-check"><input class="form-check-input" type="checkbox" value="' + e.id + '" id="actChk_' + e.id + '" ' + (schemaStore.isActive(e.id) ? 'checked' : '') + ' ' + (schemaStore.isDefault(e.id) ? 'disabled' : '') + '><label class="form-check-label small" for="actChk_' + e.id + '">' + esc(e.name) + (schemaStore.isDefault(e.id) ? ' (Default — always Active)' : '') + '</label></div>';
    }).join('') || '<p class="text-body-secondary small mb-0">No schemas stored yet.</p>';
  }
  renderDefaultActiveSchemaChoices();
  var saveActiveSelBtn = $('saveActiveSchemaSelectionBtn');
  if (saveActiveSelBtn) saveActiveSelBtn.addEventListener('click', function () {
    var activeBox = $('activeSchemaChoices'); if (!activeBox) return;
    activeBox.querySelectorAll('input[type=checkbox]').forEach(function (cb) { schemaStore.setEntryActive(cb.value, cb.checked); });
    rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaStoreList(); renderDefaultActiveSchemaChoices();
    var resultEl = $('activeSchemaSaveResult');
    if (resultEl) { resultEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>Active schema selection saved.</span>'; setTimeout(function () { resultEl.innerHTML = ''; }, 2500); }
  });
  function moduleLabels() { return engine.getModuleLabels(); }
  function allTables() { return engine.getAllTables().slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }); }
  var THEME_KEY = 'ap_sql_theme';
  function systemPrefersDark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
  function applyTheme(choice) { document.documentElement.setAttribute('data-bs-theme', choice === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : choice); }
  function setTheme(choice) { try { localStorage.setItem(THEME_KEY, choice); } catch (e) {} applyTheme(choice); }
  (function initTheme() { var saved = 'auto'; try { saved = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) {} applyTheme(saved); if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { var current = 'auto'; try { current = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) {} if (current === 'auto') applyTheme('auto'); }); })();
  document.querySelectorAll('[data-theme]').forEach(function (btn) { btn.addEventListener('click', function () { setTheme(btn.getAttribute('data-theme')); }); });
  var offcanvasEl = $('mainMenu'); var offcanvasInstance = window.bootstrap ? new window.bootstrap.Offcanvas(offcanvasEl) : null;
  function closeMenu() { if (offcanvasInstance) offcanvasInstance.hide(); }
  var currentView = 'quickstart';
  function showView(view) {
    document.querySelectorAll('[data-view]').forEach(function (b) { if (b.hasAttribute('data-view')) b.classList.toggle('active', b.getAttribute('data-view') === view); });
    document.querySelectorAll('.app-view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    window.scrollTo(0, 0);
    currentView = view;
    if (view === 'usedschema') { renderUsedSchema(); renderSchemaStoreList(); }
  }
  document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); showView(b.getAttribute('data-view')); closeMenu(); }); });
  function makeCollapsible(toggleId, submenuId) { var toggle = $(toggleId), submenu = $(submenuId); toggle.addEventListener('click', function () { toggle.classList.toggle('open'); submenu.classList.toggle('open'); }); }
  makeCollapsible('queryBuilderMenuToggle', 'queryBuilderSubmenu'); makeCollapsible('schemaMenuToggle', 'schemaSubmenu'); makeCollapsible('themeMenuToggle', 'themeSubmenu');
  document.querySelectorAll('#manualTabs .nav-link').forEach(function (t) { t.addEventListener('click', function () { var name = t.getAttribute('data-tab'); document.querySelectorAll('#manualTabs .nav-link').forEach(function (x) { x.classList.toggle('active', x === t); }); document.querySelectorAll('.tab-pane-manual').forEach(function (p) { var show = p.id === 'pane-' + name; p.classList.toggle('d-none', !show); p.classList.toggle('active', show); }); if (name === 'requirements') renderRequirementsSummary(); }); });
  var QS_BADGE_COLORS = ['badge-teal', 'badge-indigo', 'badge-orange', 'badge-purple', 'badge-pink', 'badge-blue'];
  var QUICK_EXAMPLES = [
    { ic: '&#128100;', title: 'Users whose login is allowed', desc: 'A simple single-table filter — resolved automatically.', text: 'Show all users whose login is allowed.' },
    { ic: '&#9989;', title: 'Active users, group & exclusion', desc: 'Multi-table join, filter, exclusion, and sort — all automatic.', text: 'Show all active users with their email address and user group, exclude Basware users, and sort by login account.' },
    { ic: '&#127974;', title: 'Active suppliers', desc: 'Table + columns + filter, identified from plain language.', text: 'Show supplier name and supplier code for active suppliers.' },
    { ic: '&#128176;', title: 'Total invoiced per supplier', desc: 'Aggregation (SUM) with an automatic GROUP BY and join.', text: 'Show the total gross amount grouped by supplier.' },
    { ic: '&#128231;', title: 'Supplier email addresses', desc: 'Maps everyday wording to the right schema column.', text: 'Show the supplier email address.' },
    { ic: '&#127760;', title: 'Supervisor chain (recursive)', desc: 'Walk the whole reporting hierarchy in one query.', hierarchy: 'ADM_USER_DATA' }
  ];
  (function initQuickStart() {
    var grid = $('qsExampleGrid');
    grid.innerHTML = QUICK_EXAMPLES.map(function (q, i) { return '<div class="col"><div class="card qs-example-card h-100" data-i="' + i + '"><div class="card-body"><div class="qs-icon-badge ' + QS_BADGE_COLORS[i % QS_BADGE_COLORS.length] + ' mb-2">' + q.ic + '</div><h3 class="h6">' + esc(q.title) + '</h3><p class="text-body-secondary small mb-0">' + esc(q.desc) + '</p></div></div></div>'; }).join('');
    grid.querySelectorAll('.qs-example-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var q = QUICK_EXAMPLES[+card.getAttribute('data-i')];
        showView('builder');
        if (q.hierarchy) { resetQueryState(false); $('optHierarchy').value = q.hierarchy; selectedTables = [q.hierarchy]; columnState = {}; refreshTablesColumnsUI(); runGenerate(); }
        else { resetQueryState(false); $('promptInput').value = q.text; runGenerate(); }
      });
    });
    refreshModuleChips();
  })();
  function refreshModuleChips() {
    var counts = {}; allTables().forEach(function (t) { counts[t.module] = (counts[t.module] || 0) + 1; });
    var labels = moduleLabels();
    $('qsModuleChips').innerHTML = Object.keys(counts).sort().map(function (m) { return '<span class="badge text-bg-light border module-chip">' + esc(labels[m] || m) + ' &middot; ' + counts[m] + '</span>'; }).join('');
  }
  var selectedTables = []; var columnState = {};
  function refreshModuleDropdown() { var sel = $('moduleFilterSel'); var labels = moduleLabels(); var counts = {}; allTables().forEach(function (t) { counts[t.module] = (counts[t.module] || 0) + 1; }); sel.innerHTML = '<option value="">Select Module &#9662;</option>' + Object.keys(counts).sort().map(function (m) { return '<option value="' + m + '">' + esc(labels[m] || m) + ' (' + counts[m] + ')</option>'; }).join(''); }
  function renderTableList() {
    var moduleFilter = $('moduleFilterSel').value; var searchFilter = ($('tableSearchInput').value || '').toLowerCase();
    var grid = $('tableListGrid'); grid.innerHTML = '';
    allTables().forEach(function (t) {
      if (moduleFilter && t.module !== moduleFilter) return;
      if (searchFilter && (t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(searchFilter) === -1) return;
      var col = document.createElement('div'); col.className = 'col';
      var checked = selectedTables.indexOf(t.name) !== -1;
      col.innerHTML = '<div class="form-check"><input class="form-check-input" type="checkbox" id="tbl_' + t.name + '" ' + (checked ? 'checked' : '') + '><label class="form-check-label small" for="tbl_' + t.name + '"><code>' + t.name + '</code> <span class="text-body-secondary">(' + t.module + ')</span></label></div>';
      col.querySelector('input').addEventListener('change', function (e) { toggleTable(t.name, e.target.checked); });
      grid.appendChild(col);
    });
  }
  function visibleTableNames() { var moduleFilter = $('moduleFilterSel').value; var searchFilter = ($('tableSearchInput').value || '').toLowerCase(); return allTables().filter(function (t) { if (moduleFilter && t.module !== moduleFilter) return false; if (searchFilter && (t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(searchFilter) === -1) return false; return true; }).map(function (t) { return t.name; }); }
  function toggleTable(name, on) { var idx = selectedTables.indexOf(name); if (on && idx === -1) selectedTables.push(name); if (!on && idx !== -1) { selectedTables.splice(idx, 1); delete columnState[name]; } refreshTableSelCount(); refreshSelectedTableDropdown(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); }
  function refreshTableSelCount() { $('tableSelCount').textContent = selectedTables.length + ' table' + (selectedTables.length === 1 ? '' : 's') + ' selected'; }
  $('moduleFilterSel').addEventListener('change', renderTableList); $('tableSearchInput').addEventListener('input', renderTableList);
  $('tableSelectAllBtn').addEventListener('click', function () { visibleTableNames().forEach(function (n) { if (selectedTables.indexOf(n) === -1) selectedTables.push(n); }); refreshTableSelCount(); refreshSelectedTableDropdown(); renderTableList(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); });
  $('tableUnselectAllBtn').addEventListener('click', function () { selectedTables = []; columnState = {}; refreshTableSelCount(); refreshSelectedTableDropdown(); renderTableList(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); });
  function refreshSelectedTableDropdown() { var sel = $('selectedTableDropdown'); var current = sel.value; sel.innerHTML = '<option value="">Selected Table &#9662;</option>' + selectedTables.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join(''); if (selectedTables.indexOf(current) !== -1) sel.value = current; else if (selectedTables.length) sel.value = selectedTables[0]; }
  $('selectedTableDropdown').addEventListener('change', renderColumnList);
  function ensureColState(tname) { if (!columnState[tname]) columnState[tname] = {}; return columnState[tname]; }
  function buildDecodeInlineEditor(tname, col, decodeCb, panelParent) {
    var wrap = document.createElement('span'); wrap.className = 'd-inline-flex align-items-center gap-1';
    var badge = document.createElement('span'); badge.className = 'badge text-bg-light border decode-source-badge d-none';
    var toggleBtn = document.createElement('button'); toggleBtn.type = 'button'; toggleBtn.className = 'btn btn-link btn-sm p-0 small';
    var panel = null;
    function syncLabel() {
      var resolved = APSQL_DECODE.resolveDecode(engine, decodeStore, tname, col.name);
      if (resolved.source === 'schema') { badge.textContent = 'Schema Defined'; badge.classList.remove('d-none'); toggleBtn.classList.add('d-none'); decodeCb.disabled = !decodeCb._rowChecked; }
      else if (resolved.source === 'user') { badge.textContent = 'User Defined'; badge.classList.remove('d-none'); toggleBtn.textContent = 'Edit Decode'; toggleBtn.classList.remove('d-none'); decodeCb.disabled = !decodeCb._rowChecked; }
      else { badge.classList.add('d-none'); toggleBtn.textContent = '+ Add Decode'; toggleBtn.classList.remove('d-none'); decodeCb.disabled = true; }
    }
    toggleBtn.addEventListener('click', function (ev) { ev.stopPropagation(); if (!panel) { panel = openManualDecodeEditor(tname, col.name, syncLabel); (panelParent || wrap).appendChild(panel); } else panel.classList.toggle('d-none'); });
    wrap.appendChild(badge); wrap.appendChild(toggleBtn); syncLabel(); wrap._syncLabel = syncLabel;
    return wrap;
  }
  function openManualDecodeEditor(tname, colName, onValuesChanged) {
    var existing = decodeStore.getManualDecode(tname, colName) || [];
    var container = document.createElement('div'); container.className = 'decode-editor-box mt-2';
    function render() {
      container.innerHTML = '<div class="fw-semibold small mb-2">Manual decode for ' + esc(colName) + '</div><div class="mb-2"><button type="button" class="btn btn-outline-primary btn-sm ai-propose-decode-btn"><span class="ai-badge me-1"><span class="ai-badge-dot"></span>AI</span>Propose from description</button></div>';
      var aiPropose = container.querySelector('.ai-propose-decode-btn');
      aiPropose.addEventListener('click', function () {
        var hint = prompt('Describe the mapping in plain language (e.g. "0 means Draft, 1 means Approved"):', '');
        if (!hint) return;
        aiPropose.disabled = true; aiPropose.innerHTML = '<span class="ai-spinner me-1" style="display:inline-block;width:12px;height:12px;"></span>Thinking\u2026';
        aiService.proposeCaseDecode(tname, colName, hint).then(function (res) {
          aiPropose.disabled = false; aiPropose.innerHTML = '<span class="ai-badge me-1"><span class="ai-badge-dot"></span>AI</span>Propose from description';
          if (res.reused) { alert('A definition already exists for this column (' + res.source + ') — reusing it instead of creating a duplicate.'); return; }
          if (res.values && res.values.length) { res.values.forEach(function (v) { existing.push(v); }); decodeStore.setManualDecode(tname, colName, existing); render(); if (onValuesChanged) onValuesChanged(); }
          else alert(res.narrative || 'No values could be proposed from that description.');
        });
      });
      var list = document.createElement('div');
      existing.forEach(function (pair, idx) {
        var row = document.createElement('div'); row.className = 'decode-value-row';
        row.innerHTML = '<input class="form-control form-control-sm dv-code" placeholder="Stored Value" value="' + esc(pair.code) + '"><input class="form-control form-control-sm dv-label" placeholder="Display Value" value="' + esc(pair.label) + '"><button class="btn btn-outline-danger btn-sm" type="button">&times;</button>';
        row.querySelector('.dv-code').addEventListener('input', function (e) { existing[idx].code = e.target.value; decodeStore.setManualDecode(tname, colName, existing); });
        row.querySelector('.dv-label').addEventListener('input', function (e) { existing[idx].label = e.target.value; decodeStore.setManualDecode(tname, colName, existing); });
        row.querySelector('button').addEventListener('click', function () { existing.splice(idx, 1); decodeStore.setManualDecode(tname, colName, existing); render(); if (onValuesChanged) onValuesChanged(); });
        list.appendChild(row);
      });
      container.appendChild(list);
      var addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn btn-outline-primary btn-sm mt-1'; addBtn.textContent = '+ Add Value';
      addBtn.addEventListener('click', function () { existing.push({ code: '', label: '' }); decodeStore.setManualDecode(tname, colName, existing); render(); if (onValuesChanged) onValuesChanged(); });
      container.appendChild(addBtn);
      var clearBtn = document.createElement('button'); clearBtn.type = 'button'; clearBtn.className = 'btn btn-outline-secondary btn-sm mt-1 ms-2'; clearBtn.textContent = 'Clear manually added values';
      clearBtn.addEventListener('click', function () { existing = []; decodeStore.clearManualDecode(tname, colName); render(); if (onValuesChanged) onValuesChanged(); });
      container.appendChild(clearBtn);
    }
    render(); container.classList.add('d-none');
    return container;
  }
  function buildDataTypeElseModePanel(tname, colName, state) {
    var box = document.createElement('div'); box.className = 'decode-datatype-box';
    var schemaCol = engine.getColumn(tname, colName); var dataType = schemaCol ? schemaCol.type : null;
    if (!dataType) { box.innerHTML = '<span class="decode-datatype-unavailable"><i class="bi bi-info-circle me-1"></i>Data type not available in the active schema for this column — the original value will be used in the ELSE branch, as before.</span>'; return box; }
    var needsConv = window.APSQL_DATATYPE ? window.APSQL_DATATYPE.needsConversion(dataType) : false;
    var header = document.createElement('div'); header.innerHTML = '<span class="decode-datatype-label">Data Type:</span> <code>' + esc(dataType) + '</code>'; box.appendChild(header);
    if (!needsConv) { var note = document.createElement('div'); note.className = 'small text-body-secondary mt-1'; note.textContent = 'This column is already text-compatible, so no ELSE conversion is needed.'; box.appendChild(note); return box; }
    var row = document.createElement('div'); row.className = 'decode-else-mode-row';
    var uid = tname + '_' + colName; var convertId = 'elseConvert_' + uid, keepId = 'elseKeep_' + uid;
    row.innerHTML = '<div class="form-check"><input class="form-check-input" type="radio" name="elseMode_' + uid + '" id="' + convertId + '" ' + (state.elseMode !== 'keep' ? 'checked' : '') + '><label class="form-check-label small" for="' + convertId + '">Convert to compatible text</label></div><div class="form-check"><input class="form-check-input" type="radio" name="elseMode_' + uid + '" id="' + keepId + '" ' + (state.elseMode === 'keep' ? 'checked' : '') + '><label class="form-check-label small" for="' + keepId + '">Keep original value</label></div>';
    row.querySelector('#' + convertId).addEventListener('change', function () { state.elseMode = 'convert'; });
    row.querySelector('#' + keepId).addEventListener('change', function () { state.elseMode = 'keep'; });
    box.appendChild(row); return box;
  }
  function buildColumnRow(tname, col) {
    var state = ensureColState(tname);
    if (!state[col.name]) state[col.name] = { checked: false, alias: col.alias || '', decode: false, elseMode: 'convert' };
    var s = state[col.name]; if (s.elseMode === undefined) s.elseMode = 'convert';
    var row = document.createElement('div'); row.id = 'colrow_' + tname + '_' + col.name; row.className = 'column-row-grid' + (s.checked ? ' on' : '');
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input col-check'; cb.checked = s.checked;
    var nameWrap = document.createElement('div'); nameWrap.className = 'col-name';
    var badgeText = col.primary_key ? 'PK' : (col.foreign_key ? 'FK' : (col.type || '').split('(')[0]);
    nameWrap.innerHTML = '<code>' + col.name + '</code> <span class="text-body-secondary small">' + esc(badgeText) + '</span>' + (col.description ? '<div class="text-body-secondary" style="font-size:.72rem;">' + esc(col.description) + '</div>' : '');
    var aliasInput = document.createElement('input'); aliasInput.type = 'text'; aliasInput.className = 'form-control form-control-sm col-alias'; aliasInput.placeholder = 'rename (optional)'; aliasInput.value = s.alias; aliasInput.disabled = !s.checked;
    var decodeWrap = document.createElement('div'); decodeWrap.className = 'd-flex flex-column gap-1 col-decode-check col-decode' + (!s.checked ? ' disabled' : '');
    var decodeControlsRow = document.createElement('div'); decodeControlsRow.className = 'd-flex align-items-center gap-1';
    var decodeCb = document.createElement('input'); decodeCb.type = 'checkbox'; decodeCb.className = 'form-check-input mt-0'; decodeCb.checked = s.decode; decodeCb._rowChecked = s.checked;
    var decodeInline = buildDecodeInlineEditor(tname, col, decodeCb, decodeWrap);
    decodeControlsRow.appendChild(decodeCb); decodeControlsRow.appendChild(decodeInline); decodeWrap.appendChild(decodeControlsRow);
    var dataTypePanel = null;
    function refreshDataTypePanel() { if (dataTypePanel) { dataTypePanel.remove(); dataTypePanel = null; } if (s.decode && s.checked) { dataTypePanel = buildDataTypeElseModePanel(tname, col.name, s); decodeWrap.appendChild(dataTypePanel); } }
    function refreshAccess() { row.classList.toggle('on', cb.checked); aliasInput.disabled = !cb.checked; decodeWrap.classList.toggle('disabled', !cb.checked); decodeCb._rowChecked = cb.checked; if (decodeInline._syncLabel) decodeInline._syncLabel(); if (!cb.checked) decodeCb.disabled = true; refreshDataTypePanel(); }
    cb.addEventListener('change', function () { s.checked = cb.checked; if (!cb.checked) { s.decode = false; decodeCb.checked = false; } refreshAccess(); refreshFilterColumnOptions(); });
    aliasInput.addEventListener('input', function () { s.alias = aliasInput.value.trim(); });
    decodeCb.addEventListener('change', function () { s.decode = decodeCb.checked; refreshDataTypePanel(); });
    row.appendChild(cb); row.appendChild(nameWrap); row.appendChild(aliasInput); row.appendChild(decodeWrap);
    refreshAccess(); return row;
  }
  function renderColumnList() {
    var body = $('columnListBody'); body.innerHTML = '';
    var tname = $('selectedTableDropdown').value;
    if (selectedTables.length === 0) { $('columnListEmpty').textContent = 'Select one or more tables above, then pick a table to view its columns.'; return; }
    if (!tname) { $('columnListEmpty').textContent = 'Pick a selected table above to view and choose its columns.'; return; }
    $('columnListEmpty').textContent = '';
    var table = engine.getTable(tname); if (!table) return;
    var term = ($('columnSearchInput').value || '').toLowerCase().trim();
    var cols = table.columns.filter(function (c) { return !term || (c.name + ' ' + (c.alias || '') + ' ' + (c.description || '')).toLowerCase().indexOf(term) !== -1; });
    var heading = document.createElement('div'); heading.className = 'col-group-heading'; heading.textContent = tname; body.appendChild(heading);
    cols.forEach(function (c) { body.appendChild(buildColumnRow(tname, c)); });
  }
  $('columnSearchInput').addEventListener('input', renderColumnList);
  $('columnSelectAllBtn').addEventListener('click', function () { var tname = $('selectedTableDropdown').value; if (!tname) return; var table = engine.getTable(tname); var state = ensureColState(tname); table.columns.forEach(function (c) { if (!state[c.name]) state[c.name] = { checked: false, alias: c.alias || '', decode: false, elseMode: 'convert' }; state[c.name].checked = true; }); renderColumnList(); refreshFilterColumnOptions(); });
  $('columnUnselectAllBtn').addEventListener('click', function () { var tname = $('selectedTableDropdown').value; if (!tname) return; var state = ensureColState(tname); Object.keys(state).forEach(function (k) { state[k].checked = false; state[k].decode = false; }); renderColumnList(); refreshFilterColumnOptions(); });
  function refreshTablesColumnsUI() { refreshModuleDropdown(); renderTableList(); refreshTableSelCount(); refreshSelectedTableDropdown(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); renderExistsRows(); renderScalarRows(); }
  function refreshHierarchyOptions() { var sel = $('optHierarchy'); var current = sel.value; var opts = ['<option value="">&mdash; none &mdash;</option>']; allTables().forEach(function (t) { if (engine.getSelfReferencingEdges(t.name).length > 0) opts.push('<option value="' + t.name + '">' + t.name + '</option>'); }); sel.innerHTML = opts.join(''); if (allTables().some(function (t) { return t.name === current; })) sel.value = current; }
  function columnOptionsForTables(tableNames) { var opts = []; (tableNames && tableNames.length ? tableNames : allTables().map(function (t) { return t.name; })).forEach(function (tname) { var t = engine.getTable(tname); if (!t) return; t.columns.forEach(function (c) { opts.push({ table: tname, column: c.name }); }); }); return opts; }
  function renderFilterGroup(containerEl, filterGroup, availableTables, onChange) {
    containerEl.innerHTML = '';
    var colOptions = columnOptionsForTables(availableTables);
    filterGroup.conditions.forEach(function (cond, idx) {
      var row = document.createElement('div'); row.className = 'filter-condition-row d-flex flex-wrap gap-2 align-items-center mb-2';
      var joinSel = document.createElement('select'); joinSel.className = 'form-select form-select-sm join-select'; joinSel.style.maxWidth = '80px'; joinSel.innerHTML = '<option value="AND">AND</option><option value="OR">OR</option>'; joinSel.value = cond.join || 'AND';
      joinSel.addEventListener('change', function () { cond.join = joinSel.value; onChange(); });
      var colSel = document.createElement('select'); colSel.className = 'form-select form-select-sm filter-col-select';
      colSel.innerHTML = colOptions.map(function (o) { var val = o.table + '.' + o.column; return '<option value="' + val + '">' + o.table + '.' + o.column + '</option>'; }).join('');
      colSel.value = (cond.table ? cond.table + '.' : '') + cond.column;
      colSel.addEventListener('change', function () { var parts = colSel.value.split('.'); cond.table = parts[0]; cond.column = parts[1]; onChange(); });
      var opSel = document.createElement('select'); opSel.className = 'form-select form-select-sm filter-op-select';
      opSel.innerHTML = APSQL_FILTER.OPERATORS.map(function (o) { return '<option value="' + o.id + '">' + o.label + '</option>'; }).join(''); opSel.value = cond.operator;
      var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm filter-value-input'; valInput.placeholder = 'Value'; valInput.value = cond.value || '';
      var val2Input = document.createElement('input'); val2Input.className = 'form-control form-control-sm filter-value2-input'; val2Input.placeholder = 'and...'; val2Input.value = cond.value2 || '';
      function refreshArity() { var op = APSQL_FILTER.getOperator(opSel.value); valInput.style.display = op.arity >= 1 ? '' : 'none'; val2Input.style.display = op.arity === 2 ? '' : 'none'; var isMulti = !!op.multi; valInput.placeholder = isMulti ? 'value1, value2, value3, ...' : 'Value'; }
      opSel.addEventListener('change', function () { cond.operator = opSel.value; refreshArity(); onChange(); });
      valInput.addEventListener('input', function () { cond.value = valInput.value; });
      val2Input.addEventListener('input', function () { cond.value2 = val2Input.value; });
      refreshArity();
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm'; rmBtn.textContent = '\u00d7';
      rmBtn.addEventListener('click', function () { filterGroup.conditions.splice(idx, 1); onChange(); renderFilterGroup(containerEl, filterGroup, availableTables, onChange); });
      row.appendChild(joinSel); row.appendChild(colSel); row.appendChild(opSel); row.appendChild(valInput); row.appendChild(val2Input); row.appendChild(rmBtn);
      containerEl.appendChild(row);
    });
    if (!colOptions.length) containerEl.innerHTML = '<p class="text-body-secondary small mb-0">Select at least one table first to build filter conditions.</p>';
  }
  var readOnlyFilterGroup = { conditions: [] };
  function refreshFilterColumnOptions() { renderFilterGroup($('readOnlyFilterGroup'), readOnlyFilterGroup, selectedTables, function () {}); }
  $('readOnlyAddFilterBtn').addEventListener('click', function () { var firstTable = selectedTables[0]; var firstCol = firstTable ? engine.getTable(firstTable).columns[0].name : ''; readOnlyFilterGroup.conditions.push(APSQL_FILTER.newCondition({ table: firstTable, column: firstCol })); refreshFilterColumnOptions(); });
  $('readOnlyClearFiltersBtn').addEventListener('click', function () { readOnlyFilterGroup.conditions = []; refreshFilterColumnOptions(); });
  function updateJoinCardVisibility() { var card = $('joinOptionCard'); if (!card) return; if (selectedTables.length < 2) { card.classList.add('d-none'); $('optJoinInner').checked = true; syncJoinChoiceHighlight(); } else card.classList.remove('d-none'); }
  function syncJoinChoiceHighlight() { $('optJoinInnerLabel').classList.toggle('selected', $('optJoinInner').checked); $('optJoinLeftLabel').classList.toggle('selected', $('optJoinLeft').checked); }
  document.querySelectorAll('input[name="joinType"]').forEach(function (r) { r.addEventListener('change', syncJoinChoiceHighlight); });
  $('joinResetBtn').addEventListener('click', function () { $('optJoinInner').checked = true; syncJoinChoiceHighlight(); });
  syncJoinChoiceHighlight();
  var relationshipDrafts = {};
  function ensureRelationshipDraft(tableName, candidatePartners) { if (!relationshipDrafts[tableName]) { var partner = candidatePartners[0] || ''; var partnerTbl = engine.getTable(partner); var thisTbl = engine.getTable(tableName); relationshipDrafts[tableName] = { partnerTable: partner, thisColumn: thisTbl && thisTbl.columns[0] ? thisTbl.columns[0].name : '', partnerColumn: partnerTbl && partnerTbl.columns[0] ? partnerTbl.columns[0].name : '' }; } return relationshipDrafts[tableName]; }
  function renderJoinPreview() {
    updateJoinCardVisibility();
    var previewBox = $('joinPreviewBox'); var defineBox = $('defineRelationshipContainer');
    if (!previewBox || !defineBox) return;
    if (selectedTables.length < 2) { previewBox.innerHTML = '<p class="multi-row-empty">Select two or more tables on the Tables &amp; Columns tab to see how they\u2019ll be connected.</p>'; defineBox.innerHTML = ''; return; }
    var plan = APSQL_ENGINE.buildJoinPlan(engine, selectedTables);
    var lines = plan.joins.map(function (j) { return '<li><code>' + j.on.fromTable + '</code> \u2192 <code>' + j.on.toTable + '</code> using <code>' + j.on.fromColumn + ' = ' + j.on.toColumn + '</code></li>'; });
    if (!lines.length) lines.push('<li class="text-body-secondary">No connections established yet.</li>');
    previewBox.innerHTML = '<ul class="mb-0 small">' + lines.join('') + '</ul>';
    defineBox.innerHTML = '';
    plan.unresolved.forEach(function (tname) { var candidatePartners = selectedTables.filter(function (t) { return t !== tname; }); var draft = ensureRelationshipDraft(tname, candidatePartners); defineBox.appendChild(buildDefineRelationshipPanel(tname, candidatePartners, draft)); });
  }
  function buildDefineRelationshipPanel(tableName, candidatePartners, draft) {
    var box = document.createElement('div'); box.className = 'define-relationship-box';
    var title = document.createElement('div'); title.className = 'define-relationship-title'; title.innerHTML = '<i class="bi bi-exclamation-triangle-fill text-warning"></i> Could not automatically connect: <code>' + tableName + '</code>'; box.appendChild(title);
    var explain = document.createElement('p'); explain.className = 'small text-body-secondary mb-2'; explain.textContent = 'Pick which table it connects to, and which column on each side matches.'; box.appendChild(explain);
    var row = document.createElement('div'); row.className = 'define-relationship-row';
    var partnerSel = document.createElement('select'); partnerSel.className = 'form-select form-select-sm'; partnerSel.innerHTML = candidatePartners.map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join(''); partnerSel.value = draft.partnerTable;
    var thisColSel = document.createElement('select'); thisColSel.className = 'form-select form-select-sm';
    var partnerColSel = document.createElement('select'); partnerColSel.className = 'form-select form-select-sm';
    function refreshColumnSelects() {
      var thisTbl = engine.getTable(tableName);
      thisColSel.innerHTML = (thisTbl ? thisTbl.columns : []).map(function (c) { return '<option value="' + c.name + '">' + c.name + '</option>'; }).join('');
      if (thisTbl && thisTbl.columns.some(function (c) { return c.name === draft.thisColumn; })) thisColSel.value = draft.thisColumn;
      var partnerTbl = engine.getTable(partnerSel.value);
      partnerColSel.innerHTML = (partnerTbl ? partnerTbl.columns : []).map(function (c) { return '<option value="' + c.name + '">' + c.name + '</option>'; }).join('');
      if (partnerTbl && partnerTbl.columns.some(function (c) { return c.name === draft.partnerColumn; })) partnerColSel.value = draft.partnerColumn; else if (partnerTbl && partnerTbl.columns[0]) draft.partnerColumn = partnerTbl.columns[0].name;
    }
    refreshColumnSelects();
    partnerSel.addEventListener('change', function () { draft.partnerTable = partnerSel.value; refreshColumnSelects(); });
    thisColSel.addEventListener('change', function () { draft.thisColumn = thisColSel.value; });
    partnerColSel.addEventListener('change', function () { draft.partnerColumn = partnerColSel.value; });
    var connectLabel = document.createElement('span'); connectLabel.className = 'small text-body-secondary'; connectLabel.textContent = 'connects to';
    var colLabel1 = document.createElement('span'); colLabel1.className = 'small text-body-secondary'; colLabel1.textContent = tableName + '.';
    var colLabel2 = document.createElement('span'); colLabel2.className = 'small text-body-secondary'; colLabel2.textContent = 'on column';
    row.appendChild(connectLabel); row.appendChild(partnerSel); row.appendChild(colLabel2); row.appendChild(colLabel1); row.appendChild(thisColSel);
    var eqLabel = document.createElement('span'); eqLabel.className = 'small text-body-secondary'; eqLabel.textContent = '='; row.appendChild(eqLabel); row.appendChild(partnerColSel);
    box.appendChild(row);
    var activeBadge = document.createElement('span'); activeBadge.className = 'badge text-bg-success relationship-active-badge d-none'; activeBadge.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Active for this session';
    if (relationshipStore.hasManualRelationship(tableName, draft.partnerTable)) activeBadge.classList.remove('d-none');
    var actions = document.createElement('div'); actions.className = 'define-relationship-actions mt-2';
    var useBtn = document.createElement('button'); useBtn.type = 'button'; useBtn.className = 'btn btn-outline-primary btn-sm'; useBtn.innerHTML = '<i class="bi bi-link me-1"></i>Use for this query';
    useBtn.addEventListener('click', function () { relationshipStore.setManualRelationship(tableName, thisColSel.value, partnerSel.value, partnerColSel.value); renderJoinPreview(); });
    var saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'btn btn-outline-success btn-sm'; saveBtn.innerHTML = '<i class="bi bi-shield-lock-fill me-1"></i>Save relationship to schema';
    saveBtn.addEventListener('click', function () { pendingSaveRelationshipDraft = { fromTable: tableName, fromColumn: thisColSel.value, toTable: partnerSel.value, toColumn: partnerColSel.value }; $('saveRelationshipSummary').innerHTML = '<code>' + tableName + '.' + thisColSel.value + '</code> &rarr; <code>' + partnerSel.value + '.' + partnerColSel.value + '</code>'; $('saveRelationshipPasswordInput').value = ''; $('saveRelationshipPasswordError').classList.add('d-none'); if (saveRelationshipModal) saveRelationshipModal.show(); });
    actions.appendChild(useBtn); actions.appendChild(saveBtn); actions.appendChild(activeBadge); box.appendChild(actions); return box;
  }
  var sortRows = [];
  function renderSortRows() {
    var container = $('sortRowsContainer'); if (!container) return; container.innerHTML = '';
    var colOptions = columnOptionsForTables(selectedTables);
    if (!colOptions.length) { container.innerHTML = '<p class="multi-row-empty">Select at least one table on the Tables &amp; Columns tab first.</p>'; return; }
    if (!sortRows.length) { container.innerHTML = '<p class="multi-row-empty">No sort columns added yet \u2014 results will be shown in default order.</p>'; return; }
    sortRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row d-flex gap-2 align-items-center mb-2';
      var colSel = document.createElement('select'); colSel.className = 'form-select form-select-sm filter-col-select';
      colSel.innerHTML = colOptions.map(function (o) { var val = o.table + '.' + o.column; return '<option value="' + val + '">' + o.table + '.' + o.column + '</option>'; }).join('');
      colSel.value = (row.table ? row.table + '.' : '') + row.column;
      colSel.addEventListener('change', function () { var parts = colSel.value.split('.'); row.table = parts[0]; row.column = parts[1]; });
      var dirSel = document.createElement('select'); dirSel.className = 'form-select form-select-sm filter-op-select';
      dirSel.innerHTML = '<option value="ASC">Smallest / earliest first</option><option value="DESC">Largest / latest first</option>'; dirSel.value = row.direction || 'ASC';
      dirSel.addEventListener('change', function () { row.direction = dirSel.value; });
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm'; rmBtn.textContent = '\u00d7';
      rmBtn.addEventListener('click', function () { sortRows.splice(idx, 1); renderSortRows(); });
      rowEl.appendChild(colSel); rowEl.appendChild(dirSel); rowEl.appendChild(rmBtn); container.appendChild(rowEl);
    });
  }
  $('addSortRowBtn').addEventListener('click', function () { if (!selectedTables.length) return; var t = selectedTables[0]; var tbl = engine.getTable(t); sortRows.push({ table: t, column: tbl ? tbl.columns[0].name : '', direction: 'ASC' }); renderSortRows(); });
  $('clearSortBtn').addEventListener('click', function () { sortRows = []; renderSortRows(); });
  var existsRows = [];
  function renderExistsRows() {
    var container = $('existsRowsContainer'); if (!container) return; container.innerHTML = '';
    var tbls = allTables();
    if (!existsRows.length) { container.innerHTML = '<p class="multi-row-empty">No related-table checks added yet.</p>'; return; }
    existsRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row d-flex gap-2 align-items-center mb-2';
      var tblSel = document.createElement('select'); tblSel.className = 'form-select form-select-sm filter-col-select';
      tblSel.innerHTML = tbls.map(function (t) { return '<option value="' + t.name + '">' + t.name + '</option>'; }).join(''); tblSel.value = row.relatedTable || (tbls[0] ? tbls[0].name : '');
      tblSel.addEventListener('change', function () { row.relatedTable = tblSel.value; });
      var negWrap = document.createElement('div'); negWrap.className = 'form-check d-flex align-items-center gap-1';
      var negCb = document.createElement('input'); negCb.type = 'checkbox'; negCb.className = 'form-check-input mt-0'; negCb.checked = !!row.negate;
      negCb.addEventListener('change', function () { row.negate = negCb.checked; });
      var negLabel = document.createElement('label'); negLabel.className = 'form-check-label multi-row-remove-label'; negLabel.textContent = 'Opposite (no match)';
      negWrap.appendChild(negCb); negWrap.appendChild(negLabel);
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm'; rmBtn.textContent = '\u00d7';
      rmBtn.addEventListener('click', function () { existsRows.splice(idx, 1); renderExistsRows(); });
      rowEl.appendChild(tblSel); rowEl.appendChild(negWrap); rowEl.appendChild(rmBtn); container.appendChild(rowEl);
    });
  }
  $('addExistsRowBtn').addEventListener('click', function () { var tbls = allTables(); if (!tbls.length) return; existsRows.push({ relatedTable: tbls[0].name, negate: false }); renderExistsRows(); });
  $('clearExistsBtn').addEventListener('click', function () { existsRows = []; renderExistsRows(); });
  var scalarRows = [];
  function renderScalarRows() {
    var container = $('scalarRowsContainer'); if (!container) return; container.innerHTML = '';
    var tbls = allTables();
    if (!scalarRows.length) { container.innerHTML = '<p class="multi-row-empty">No related counts added yet.</p>'; return; }
    scalarRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row d-flex gap-2 align-items-center mb-2';
      var tblSel = document.createElement('select'); tblSel.className = 'form-select form-select-sm filter-col-select';
      tblSel.innerHTML = tbls.map(function (t) { return '<option value="' + t.name + '">' + t.name + '</option>'; }).join(''); tblSel.value = row.relatedTable || (tbls[0] ? tbls[0].name : '');
      tblSel.addEventListener('change', function () { row.relatedTable = tblSel.value; });
      var label = document.createElement('span'); label.className = 'small text-body-secondary'; label.textContent = 'Count of matching records';
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm'; rmBtn.textContent = '\u00d7';
      rmBtn.addEventListener('click', function () { scalarRows.splice(idx, 1); renderScalarRows(); });
      rowEl.appendChild(tblSel); rowEl.appendChild(label); rowEl.appendChild(rmBtn); container.appendChild(rowEl);
    });
  }
  $('addScalarRowBtn').addEventListener('click', function () { var tbls = allTables(); if (!tbls.length) return; scalarRows.push({ relatedTable: tbls[0].name }); renderScalarRows(); });
  $('clearScalarBtn').addEventListener('click', function () { scalarRows = []; renderScalarRows(); });
  $('optLimitClearBtn').addEventListener('click', function () { $('optLimit').value = ''; });
  $('optViewClearBtn').addEventListener('click', function () { $('optView').value = ''; });
  $('optHavingClearBtn').addEventListener('click', function () { $('optHaving').value = ''; });
  $('optHierarchyClearBtn').addEventListener('click', function () { $('optHierarchy').value = ''; });
  var KW = /\b(SELECT|FROM|WHERE|JOIN|LEFT|INNER|ON|AND|OR|GROUP BY|ORDER BY|HAVING|DISTINCT|AS|TOP|FETCH FIRST|ROWS ONLY|BETWEEN|IN|LIMIT|CASE|WHEN|THEN|ELSE|END|WITH|RECURSIVE|EXISTS|NOT|LIKE|IS NULL|IS NOT NULL|COUNT|SUM|AVG|MIN|MAX)\b/g;
  function highlight(sql) { var e = esc(sql); e = e.replace(/'([^']*)'/g, "<span class='sql-str'>'$1'</span>"); e = e.replace(KW, "<span class='sql-kw'>$1</span>"); return e; }
  function renderSuggestedFixes(message) { var suggestions = APSQL_SUGGEST.buildSuggestions(message); return '<div class="alert alert-info py-2 mb-0 suggested-fixes-box"><strong><i class="bi bi-lightbulb-fill me-1"></i>Suggested fixes:</strong><ul class="mt-1">' + suggestions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>'; }
  function renderOptimizeReport(containerId, opt) {
    var box = $(containerId); if (!box) return; var parts = [];
    if (opt.changesApplied.length) parts.push('<div><strong><i class="bi bi-magic me-1"></i>Changes applied:</strong><ul class="mt-1">' + opt.changesApplied.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>');
    if (opt.recommendations.length) parts.push('<div><strong><i class="bi bi-lightbulb-fill me-1"></i>Recommendations:</strong><ul class="mt-1">' + opt.recommendations.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>');
    if (!parts.length) parts.push('<div class="text-body-secondary">No further optimizations detected \u2014 this query already looks efficient.</div>');
    box.innerHTML = '<div class="alert alert-secondary py-2 mb-0 small">' + parts.join('') + '</div>';
  }
  var lastResult = null;
  function renderResult(res) {
    lastResult = res; var body = $('resultBody');
    if (res.status === 'rejected' || res.status === 'clarification_needed') {
      var titleText = res.status === 'rejected' ? 'Could not build this query.' : 'One more detail needed.';
      var alertClass = res.status === 'rejected' ? 'alert-danger' : 'alert-warning';
      body.innerHTML = '<div class="alert ' + alertClass + ' mb-2"><strong>' + titleText + '</strong><br>' + esc(res.message) + '</div>' + renderSuggestedFixes(res.message);
      $('copyBtn').classList.add('d-none'); $('optimizeBtn').classList.add('d-none'); $('optimizeReportBox').innerHTML = '';
      $('explainBtn').classList.add('d-none'); $('explanationReportBox').innerHTML = ''; $('explanationReportBox').classList.add('d-none');
      $('aiReviewBtn').classList.add('d-none'); $('aiReviewReportBox').innerHTML = '';
      return;
    }
    var tables = (res.tablesUsed || []).map(function (t) { return '<span class="badge text-bg-light border me-1">' + t + '</span>'; }).join('');
    var cols = (res.columnsUsed || []).map(function (c) { return '<span class="badge text-bg-light border me-1">' + c.table + '.' + c.column + (c.alias ? ' as ' + c.alias : '') + '</span>'; }).join('');
    var filters = (res.filtersApplied || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') || '<li class="text-body-secondary">None</li>';
    var assumptions = (res.assumptions || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    body.innerHTML = '<div class="alert alert-success py-2 mb-2"><small>&#9989; Query validated against active schema (' + esc(res.dialect || '') + ', read-only)</small></div><pre class="sql-output mb-3">' + highlight(res.sql) + '</pre><div class="small mb-2"><strong>Tables Used:</strong><br>' + (tables || '<span class="text-body-secondary">None</span>') + '</div><div class="small mb-2"><strong>Columns Used:</strong><br>' + (cols || '<span class="text-body-secondary">None (aggregated query)</span>') + '</div><div class="small mb-2"><strong>Filters Applied:</strong><ul class="mb-0">' + filters + '</ul></div><div class="small"><strong>Assumptions:</strong><ul class="mb-0">' + assumptions + '</ul></div>';
    $('copyBtn').classList.remove('d-none'); $('optimizeBtn').classList.remove('d-none'); $('optimizeReportBox').innerHTML = ''; $('explainBtn').classList.remove('d-none'); $('aiReviewBtn').classList.remove('d-none'); $('aiReviewReportBox').innerHTML = '';
  }
  $('copyBtn').addEventListener('click', function () { if (lastResult && lastResult.status === 'ok') { navigator.clipboard && navigator.clipboard.writeText(lastResult.sql); var old = $('copyBtn').innerHTML; $('copyBtn').innerHTML = '&#9989; Copied'; setTimeout(function () { $('copyBtn').innerHTML = old; }, 1300); } });
  $('optimizeBtn').addEventListener('click', function () {
    if (!lastResult || lastResult.status !== 'ok') return;
    aiService.optimizeSql(lastResult).then(function (aiRes) {
      if (aiRes.hasChanges) { lastResult = Object.assign({}, lastResult, { sql: aiRes.optimizedSql }); renderResult(lastResult); }
      renderOptimizeReport('optimizeReportBox', { changesApplied: aiRes.changesApplied, recommendations: aiRes.recommendations });
    });
  });
  var lastInterpretation = null;
  $('explainBtn').addEventListener('click', function () {
    var box = $('explanationReportBox'); var isHidden = box.classList.contains('d-none');
    if (!isHidden) { box.classList.add('d-none'); return; }
    var lines = lastInterpretation ? APSQL_NLQUERY.explainInterpretation(lastInterpretation) : [];
    if (!lines.length) box.innerHTML = '<div class="alert alert-secondary py-2 mb-0 small">This query was built manually (or nothing to explain yet). Describe your requirement above and click Build Query to see a plain-language explanation here.</div>';
    else box.innerHTML = '<div class="alert alert-secondary py-2 mb-0 small"><strong><i class="bi bi-lightbulb-fill me-1"></i>This query:</strong><ul class="mt-1 mb-0">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div>';
    box.classList.remove('d-none');
  });
  $('aiReviewBtn').addEventListener('click', function () {
    if (!lastResult || lastResult.status !== 'ok') return;
    $('aiReviewLoadingLine').classList.remove('d-none'); $('aiReviewReportBox').innerHTML = '';
    var meta = { tablesUsed: lastResult.tablesUsed, columnsUsed: lastResult.columnsUsed, interpretation: lastInterpretation, unresolvedTables: (lastInterpretation && lastInterpretation.unresolvedJoins) || [] };
    aiService.optimizeSql(lastResult).then(function (optRes) {
      meta.optimizeResult = { recommendations: optRes.recommendations };
      return aiService.reviewSql(lastResult.sql, meta);
    }).then(function (review) {
      $('aiReviewLoadingLine').classList.add('d-none');
      var items = [
        { ok: review.schemaCorrect, label: 'Schema correctness' },
        { ok: review.relationshipCorrect, label: 'Relationship correctness' },
        { ok: !(review.logicFindings && review.logicFindings.length), label: 'Logic matches request' },
        { ok: true, label: 'Dialect: ' + ($('dialectSel').value || 'Generic') }
      ];
      var html = '<div class="ai-review-box"><div class="ai-review-heading"><span class="ai-badge"><span class="ai-badge-dot"></span>AI Self-Review</span></div>';
      html += '<ul class="ai-review-check-list">' + items.map(function (it) { return '<li class="' + (it.ok ? 'ok' : 'warn') + '"><i class="bi ' + (it.ok ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill') + '"></i>' + esc(it.label) + '</li>'; }).join('') + '</ul>';
      var allNotes = (review.errors || []).concat(review.logicFindings || []).concat(review.performanceFindings || []);
      if (allNotes.length) html += '<ul class="mt-2 mb-0 small">' + allNotes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
      else html += '<div class="mt-2 small text-body-secondary">' + esc(review.narrative) + '</div>';
      html += '</div>';
      $('aiReviewReportBox').innerHTML = html;
    }).catch(function () {
      $('aiReviewLoadingLine').classList.add('d-none');
      $('aiReviewReportBox').innerHTML = '<div class="alert alert-warning py-2 mb-0 small">AI review is temporarily unavailable. The generated SQL above was already validated against the active schema at generation time.</div>';
    });
  });
  function renderConfidenceChecklist(interpretation) {
    var box = $('confidenceChecklistBox');
    if (!interpretation || (!interpretation.tables.length && !interpretation.warnings.length)) { box.innerHTML = ''; return; }
    var c = interpretation.confidence || {};
    var items = [{ ok: c.tableIdentified, label: 'Table identified' }, { ok: c.columnsIdentified, label: 'Columns identified' }, { ok: c.relationshipsIdentified, label: 'Relationships identified' }, { ok: !c.hasAmbiguities, label: c.hasAmbiguities ? 'Some terms need clarification' : 'Filters identified' }];
    var html = '<ul>' + items.map(function (it) { return '<li class="' + (it.ok ? 'ok' : 'warn') + '"><i class="bi ' + (it.ok ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill') + '"></i>' + esc(it.label) + '</li>'; }).join('') + '</ul>';
    if (c.unresolvedJoins && c.unresolvedJoins.length) html += '<div class="text-body-secondary mt-1">&#9888;&#65039; Unable to automatically connect: ' + esc(c.unresolvedJoins.join(', ')) + '. You can connect these manually in Advanced Options.</div>';
    box.innerHTML = html;
  }
  function renderAmbiguityBox(interpretation) {
    var box = $('ambiguityBox');
    if (!interpretation || !interpretation.ambiguities || !interpretation.ambiguities.length) { box.classList.add('d-none'); box.innerHTML = ''; return; }
    var html = '<div class="fw-semibold small mb-2"><i class="bi bi-question-circle-fill me-1"></i>A few terms in your description could mean more than one thing. Please choose the intended condition:</div>';
    interpretation.ambiguities.forEach(function (amb, ai) {
      html += '<div class="ambiguity-term-title">&#8220;' + esc(amb.term) + '&#8221; could refer to:</div><div class="ambiguity-option-row" data-amb="' + ai + '">';
      amb.options.forEach(function (opt, oi) { html += '<button type="button" class="btn btn-outline-primary btn-sm ambiguity-option-btn" data-amb="' + ai + '" data-opt="' + oi + '">' + esc(opt.table + '.' + opt.column) + (opt.description ? '<span class="opt-desc">' + esc(opt.description) + '</span>' : '') + '</button>'; });
      html += '</div>';
    });
    box.innerHTML = html; box.classList.remove('d-none');
    box.querySelectorAll('.ambiguity-option-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ai = +btn.getAttribute('data-amb'), oi = +btn.getAttribute('data-opt');
        var amb = interpretation.ambiguities[ai]; var opt = amb.options[oi];
        readOnlyFilterGroup.conditions.push(APSQL_FILTER.newCondition({ table: opt.table, column: opt.column, operator: 'eq', value: '1' }));
        if (selectedTables.indexOf(opt.table) === -1) selectedTables.push(opt.table);
        box.classList.add('d-none'); box.innerHTML = ''; refreshTablesColumnsUI(); runGenerate();
      });
    });
  }
  function describeAdvancedOptions() {
    var lines = [];
    if ($('optJoinLeft').checked) lines.push('Also show records without a match in other tables');
    if (sortRows.length) lines.push('Sort by: ' + sortRows.map(function (r) { return r.table + '.' + r.column + ' (' + (r.direction === 'DESC' ? 'largest/latest first' : 'smallest/earliest first') + ')'; }).join(', '));
    var limit = $('optLimit').value.trim(); if (limit) lines.push('Only show the first ' + limit + ' rows');
    var view = $('optView').value.trim(); if (view) lines.push('Save as a named view: ' + view);
    if (existsRows.length) lines.push('Only show rows connected to: ' + existsRows.map(function (r) { return r.relatedTable + (r.negate ? ' (opposite: no match)' : ''); }).join(', '));
    if (scalarRows.length) lines.push('Add related counts from: ' + scalarRows.map(function (r) { return r.relatedTable; }).join(', '));
    var having = $('optHaving').value.trim(); if (having) lines.push('Filter on totals: ' + having);
    var hier = $('optHierarchy').value; if (hier) lines.push('Show full hierarchy for: ' + hier);
    if (nlAggregates.length) lines.push('Calculated from your description: ' + nlAggregates.map(function (a) { return a.aggregate + '(' + (a.column === '*' ? '*' : (a.table + '.' + a.column)) + ')'; }).join(', '));
    if (nlGroupBy.length) lines.push('Grouped by (from your description): ' + nlGroupBy.map(function (g) { return g.table + '.' + g.column; }).join(', '));
    if (nlHaving) lines.push('Having (from your description): ' + nlHaving);
    return lines;
  }
  function renderRequirementsSummary() {
    var box = $('requirementsSummaryBody'); var promptText = $('promptInput').value.trim(); var parts = [];
    parts.push('<h3 class="h6">Describe What You Need</h3>');
    parts.push(promptText ? '<p><em>' + esc(promptText) + '</em></p>' : '<p class="text-body-secondary">No natural-language requirement provided.</p>');
    parts.push('<h3 class="h6 mt-3">Selected Tables</h3>');
    parts.push(selectedTables.length ? '<p>' + selectedTables.map(esc).join('<br>') + '</p>' : '<p class="text-body-secondary">No tables selected yet.</p>');
    parts.push('<h3 class="h6 mt-3">Selected Columns</h3>');
    var anyCols = false, colsHtml = '';
    Object.keys(columnState).forEach(function (tname) { var checkedCols = Object.keys(columnState[tname]).filter(function (c) { return columnState[tname][c].checked; }); if (!checkedCols.length) return; anyCols = true; colsHtml += '<div class="mb-1"><code>' + tname + '</code><br>' + checkedCols.map(function (c) { var s = columnState[tname][c]; var extras = []; if (s.alias) extras.push('alias: ' + esc(s.alias)); if (s.decode) extras.push('decode: on (' + (s.elseMode === 'keep' ? 'keep original' : 'convert to text') + ')'); return '&#9500;&#9472; ' + c + (extras.length ? ' <span class="text-body-secondary small">(' + extras.join(', ') + ')</span>' : ''); }).join('<br>') + '</div>'; });
    parts.push(anyCols ? colsHtml : '<p class="text-body-secondary">No columns selected yet.</p>');
    parts.push('<h3 class="h6 mt-3">Filters</h3>');
    var builtFilters = APSQL_FILTER.buildWhereSql(readOnlyFilterGroup, $('dialectSel').value);
    parts.push(builtFilters.plainEnglish ? '<p><code>' + esc(builtFilters.plainEnglish) + '</code></p>' : '<p class="text-body-secondary">No filters added yet.</p>');
    parts.push('<h3 class="h6 mt-3">Advanced Options</h3>');
    var advLines = describeAdvancedOptions();
    parts.push(advLines.length ? '<p>' + advLines.map(esc).join('<br>') + '</p>' : '<p class="text-body-secondary">No advanced options enabled.</p>');
    box.innerHTML = parts.join('');
  }
  function collectSelectedColumns() { var out = []; Object.keys(columnState).forEach(function (tname) { Object.keys(columnState[tname]).forEach(function (cname) { var s = columnState[tname][cname]; if (s.checked) { var entry = { table: tname, column: cname }; if (s.alias) entry.alias = s.alias; if (s.decode) { entry.decode = true; entry.elseMode = s.elseMode || 'convert'; } out.push(entry); } }); }); return out; }
  var nlAggregates = []; var nlGroupBy = []; var nlHaving = null;
  function buildOptions() {
    var opts = { dialect: $('dialectSel').value };
    if (selectedTables.length) opts.selectedTables = selectedTables.slice();
    var cols = collectSelectedColumns(); nlAggregates.forEach(function (a) { cols.push({ table: a.table, column: a.column, aggregate: a.aggregate, alias: a.alias }); });
    if (cols.length) opts.selectedColumns = cols;
    if (readOnlyFilterGroup.conditions.length) opts.filterGroup = readOnlyFilterGroup;
    if ($('optDistinct2').checked) opts.distinct = true;
    opts.join = $('optJoinLeft').checked ? 'LEFT' : 'INNER';
    var limit = $('optLimit').value.trim(); if (/^\d+$/.test(limit)) opts.limit = parseInt(limit, 10);
    if (sortRows.length) opts.orderBy = sortRows.map(function (r) { return r.table + '.' + r.column + ' ' + r.direction; }).join(', ');
    var view = $('optView').value.trim(); if (view) opts.viewName = view;
    var hier = $('optHierarchy').value; if (hier) opts.recursiveHierarchy = { table: hier };
    if (existsRows.length) opts.existsFilters = existsRows.map(function (r) { return { relatedTable: r.relatedTable, negate: r.negate }; });
    if (scalarRows.length) opts.scalarSubqueries = scalarRows.map(function (r) { return { relatedTable: r.relatedTable }; });
    var groupByStrings = nlGroupBy.map(function (g) { return g.table + '.' + g.column; }); if (groupByStrings.length) opts.groupBy = groupByStrings;
    var having = $('optHaving').value.trim(); if (having) opts.having = having; else if (nlHaving) opts.having = nlHaving;
    return opts;
  }
  function applyDescriptionToSelection() {
    var text = $('promptInput').value.trim();
    if (!text) { $('descriptionInterpretationBox').innerHTML = ''; $('confidenceChecklistBox').innerHTML = ''; $('ambiguityBox').classList.add('d-none'); lastInterpretation = null; return; }
    var interpretation = APSQL_NLQUERY.interpretRequirement(text, engine, {});
    lastInterpretation = interpretation;
    selectedTables = APSQL_NLQUERY.mergeTableLists(selectedTables, interpretation.tables);
    var manualColsFlat = collectSelectedColumns();
    var mergedCols = APSQL_NLQUERY.mergeColumnLists(manualColsFlat, interpretation.columns);
    mergedCols.forEach(function (c) { var state = ensureColState(c.table); if (!state[c.column]) state[c.column] = { checked: true, alias: c.alias || '', decode: !!c.decode, elseMode: 'convert' }; else { state[c.column].checked = true; if (c.decode) state[c.column].decode = true; } });
    interpretation.columns.forEach(function (c) { if (!c.decode) return; var state = ensureColState(c.table); if (state[c.column]) state[c.column].decode = true; });
    readOnlyFilterGroup.conditions = APSQL_NLQUERY.mergeFilterConditions(readOnlyFilterGroup.conditions, interpretation.filterConditions).map(function (c) { return c.id ? c : APSQL_FILTER.newCondition(c); });
    if (!sortRows.length && interpretation.orderBy && interpretation.orderBy.length) interpretation.orderBy.forEach(function (o) { sortRows.push({ table: o.table, column: o.column, direction: o.direction || 'ASC' }); });
    if (!$('optLimit').value.trim() && interpretation.limit) $('optLimit').value = String(interpretation.limit);
    if (interpretation.distinct) $('optDistinct2').checked = true;
    if (!$('optHierarchy').value && interpretation.hierarchyTable) $('optHierarchy').value = interpretation.hierarchyTable;
    nlAggregates = APSQL_NLQUERY.mergeAggregates(nlAggregates, interpretation.aggregates);
    nlGroupBy = APSQL_NLQUERY.mergeGroupBy(nlGroupBy, interpretation.groupBy);
    if (interpretation.having && !nlHaving) nlHaving = interpretation.having;
    refreshTablesColumnsUI();
    renderDescriptionInterpretationBox(interpretation);
    renderConfidenceChecklist(interpretation);
    renderAmbiguityBox(interpretation);
  }
  function renderDescriptionInterpretationBox(interpretation) {
    var box = $('descriptionInterpretationBox'); if (!box) return;
    var hasMatched = interpretation.matched && interpretation.matched.length;
    var hasWarnings = interpretation.warnings && interpretation.warnings.length;
    if (!hasMatched && !hasWarnings) { box.innerHTML = ''; return; }
    var parts = [];
    if (hasMatched) parts.push('<strong><i class="bi bi-chat-left-text-fill me-1"></i>I understood your request as:</strong><ul class="mt-1 mb-0">' + interpretation.matched.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>');
    if (hasWarnings) parts.push('<div class="' + (hasMatched ? 'mt-2 ' : '') + 'text-body-secondary small">' + interpretation.warnings.map(esc).join('<br>') + '</div>');
    box.innerHTML = '<div class="alert alert-info py-2 mb-0 small">' + parts.join('') + '</div>';
  }
  function runGenerate() {
    var promptText = $('promptInput').value.trim();
    var showLoading = !!promptText;
    if (showLoading) $('aiIntentLoadingLine').classList.remove('d-none');
    applyDescriptionToSelection();
    if (showLoading) $('aiIntentLoadingLine').classList.add('d-none');
    var opts = buildOptions();
    var res = APSQL_ENGINE.generateSql(promptText, opts, engine, decodeStore);
    renderResult(res);
    if (lastInterpretation && lastInterpretation.confidence) lastInterpretation.confidence.sqlValidated = (res.status === 'ok');
    showView('builder');
    $('resultBody').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('generateBtn').addEventListener('click', runGenerate);
  $('generateFromDescriptionBtn').addEventListener('click', runGenerate);
  $('promptInput').addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runGenerate(); });
  function resetQueryState(alsoClearPrompt) {
    if (alsoClearPrompt !== false) $('promptInput').value = '';
    selectedTables = []; columnState = {}; readOnlyFilterGroup.conditions = []; sortRows = []; existsRows = []; scalarRows = [];
    nlAggregates = []; nlGroupBy = []; nlHaving = null;
    $('optJoinInner').checked = true; syncJoinChoiceHighlight();
    $('optLimit').value = ''; $('optView').value = ''; $('optHaving').value = ''; $('optHierarchy').value = ''; $('optDistinct2').checked = false;
    lastInterpretation = null; lastResult = null;
    $('descriptionInterpretationBox').innerHTML = ''; $('confidenceChecklistBox').innerHTML = '';
    $('ambiguityBox').classList.add('d-none'); $('ambiguityBox').innerHTML = '';
    $('explanationReportBox').classList.add('d-none'); $('explanationReportBox').innerHTML = ''; $('optimizeReportBox').innerHTML = ''; $('aiReviewReportBox').innerHTML = '';
    $('copyBtn').classList.add('d-none'); $('optimizeBtn').classList.add('d-none'); $('explainBtn').classList.add('d-none'); $('aiReviewBtn').classList.add('d-none');
    $('resultBody').innerHTML = '<p class="text-body-secondary small mb-0">Your generated SQL will appear here as soon as you click Build Query.</p>';
    refreshTablesColumnsUI();
  }
  $('resetQueryBtn').addEventListener('click', function () { resetQueryState(true); });
  refreshTablesColumnsUI(); refreshHierarchyOptions();
  var crCommand = 'INSERT'; var crTable = ''; var crInsertColumns = {}; var crUpdateColumns = {}; var crFilterGroup = { conditions: [] }; var crLastResult = null;
  function crRefreshTableOptions() { var sel = $('crTableSelect'); var current = sel.value; sel.innerHTML = allTables().map(function (t) { return '<option value="' + t.name + '">' + t.name + '</option>'; }).join(''); if (allTables().some(function (t) { return t.name === current; })) sel.value = current; else sel.value = allTables()[0] ? allTables()[0].name : ''; crTable = sel.value; }
  $('crTableSelect').addEventListener('change', function () { crTable = $('crTableSelect').value; crInsertColumns = {}; crUpdateColumns = {}; crFilterGroup = { conditions: [] }; crRenderAll(); });
  document.querySelectorAll('.cr-command-option').forEach(function (opt) { opt.addEventListener('click', function () { document.querySelectorAll('.cr-command-option').forEach(function (o) { o.classList.remove('active'); }); opt.classList.add('active'); crCommand = opt.getAttribute('data-command'); crRenderAll(); }); });
  function crRenderInsertPanel() { var table = engine.getTable(crTable); var body = $('crInsertColumnsBody'); body.innerHTML = ''; if (!table) return; table.columns.forEach(function (c) { if (!crInsertColumns[c.name]) crInsertColumns[c.name] = { checked: false, value: '' }; var s = crInsertColumns[c.name]; var row = document.createElement('div'); row.className = 'cr-value-row'; var label = document.createElement('div'); var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input me-2'; cb.checked = s.checked; var span = document.createElement('span'); span.innerHTML = '<code>' + c.name + '</code> <span class="text-body-secondary small">' + esc((c.type || '')) + '</span>'; label.appendChild(cb); label.appendChild(span); var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm'; valInput.placeholder = 'Value'; valInput.value = s.value; valInput.disabled = !s.checked; cb.addEventListener('change', function () { s.checked = cb.checked; valInput.disabled = !cb.checked; }); valInput.addEventListener('input', function () { s.value = valInput.value; }); row.appendChild(label); row.appendChild(valInput); body.appendChild(row); }); }
  function crRenderUpdatePanel() { var table = engine.getTable(crTable); var body = $('crUpdateColumnsBody'); body.innerHTML = ''; if (!table) return; table.columns.forEach(function (c) { if (!crUpdateColumns[c.name]) crUpdateColumns[c.name] = { checked: false, value: '' }; var s = crUpdateColumns[c.name]; var row = document.createElement('div'); row.className = 'cr-value-row'; var label = document.createElement('div'); var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input me-2'; cb.checked = s.checked; var span = document.createElement('span'); span.innerHTML = '<code>' + c.name + '</code> <span class="text-body-secondary small">' + esc((c.type || '')) + '</span>'; label.appendChild(cb); label.appendChild(span); var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm'; valInput.placeholder = 'New Value'; valInput.value = s.value; valInput.disabled = !s.checked; cb.addEventListener('change', function () { s.checked = cb.checked; valInput.disabled = !cb.checked; crRenderDecodePanel(); }); valInput.addEventListener('input', function () { s.value = valInput.value; }); row.appendChild(label); row.appendChild(valInput); body.appendChild(row); }); }
  function crRenderWherePanel() { var showWhere = crCommand === 'UPDATE' || crCommand === 'DELETE' || crCommand === 'SELECT'; $('crWherePanel').classList.toggle('d-none', !showWhere); var note = $('crFiltersNaNote'); if (note) note.classList.toggle('d-none', showWhere); if (showWhere) renderFilterGroup($('crFilterGroup'), crFilterGroup, [crTable], function () {}); }
  $('crAddFilterBtn').addEventListener('click', function () { var firstCol = crTable && engine.getTable(crTable) ? engine.getTable(crTable).columns[0].name : ''; crFilterGroup.conditions.push(APSQL_FILTER.newCondition({ table: crTable, column: firstCol })); renderFilterGroup($('crFilterGroup'), crFilterGroup, [crTable], function () {}); });
  $('crClearFiltersBtn').addEventListener('click', function () { crFilterGroup.conditions = []; renderFilterGroup($('crFilterGroup'), crFilterGroup, [crTable], function () {}); });
  function crRenderDecodePanel() {
    var body = $('crDecodeBody'); var table = engine.getTable(crTable); if (!table) { body.innerHTML = ''; return; }
    var relevantCols = (crCommand === 'INSERT' ? Object.keys(crInsertColumns) : Object.keys(crUpdateColumns)).filter(function (name) { var s = crCommand === 'INSERT' ? crInsertColumns[name] : crUpdateColumns[name]; return s && s.checked; });
    if (!relevantCols.length) { body.innerHTML = '<p class="text-body-secondary small mb-0">Select a column above to configure or view its decode.</p>'; return; }
    body.innerHTML = '';
    relevantCols.forEach(function (colName) {
      var resolved = APSQL_DECODE.resolveDecode(engine, decodeStore, crTable, colName);
      var box = document.createElement('div'); box.className = 'mb-3';
      var header = document.createElement('div'); header.className = 'd-flex align-items-center gap-2 mb-1'; header.innerHTML = '<code>' + colName + '</code>';
      if (resolved.source) header.innerHTML += '<span class="badge text-bg-light border decode-source-badge">' + (resolved.source === 'schema' ? 'Schema Defined' : 'User Defined') + '</span>';
      var schemaCol = engine.getColumn(crTable, colName);
      if (schemaCol && schemaCol.type) header.innerHTML += '<span class="text-body-secondary small">Data Type: <code>' + esc(schemaCol.type) + '</code></span>';
      box.appendChild(header);
      if (resolved.values && resolved.values.length) { var list = document.createElement('div'); list.className = 'small text-body-secondary'; list.innerHTML = resolved.values.map(function (p) { return esc(p.code) + ' = ' + esc(p.label); }).join('<br>'); box.appendChild(list); }
      else { var noneMsg = document.createElement('div'); noneMsg.className = 'small text-body-secondary mb-1'; noneMsg.textContent = 'No predefined decode available.'; box.appendChild(noneMsg); var addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn btn-outline-primary btn-sm'; addBtn.textContent = '+ Add Decode'; addBtn.addEventListener('click', function () { var panel = openManualDecodeEditor(crTable, colName, function () {}); panel.classList.remove('d-none'); box.appendChild(panel); }); box.appendChild(addBtn); }
      body.appendChild(box);
    });
  }
  function crRenderRequirementsSummary() {
    var box = $('crRequirementsSummaryBody'); var parts = [];
    var descText = $('crDescriptionInput').value.trim();
    parts.push('<h3 class="h6">Describe What You Need</h3>');
    parts.push(descText ? '<p><em>' + esc(descText) + '</em></p>' : '<p class="text-body-secondary">No description provided.</p>');
    parts.push('<div class="mt-2"><strong>Query Type:</strong> ' + esc(crCommand) + '</div>');
    parts.push('<div><strong>Table:</strong> ' + esc(crTable) + '</div>');
    if (crCommand === 'INSERT') { var insCols = Object.keys(crInsertColumns).filter(function (n) { return crInsertColumns[n].checked; }); parts.push('<div class="mt-2"><strong>Columns:</strong><br>' + (insCols.join('<br>') || '<span class="text-body-secondary">None selected</span>') + '</div>'); parts.push('<div class="mt-2"><strong>Values:</strong><br>' + insCols.map(function (n) { return n + ' &rarr; ' + esc(crInsertColumns[n].value || ''); }).join('<br>') + '</div>'); }
    else if (crCommand === 'UPDATE') { var updCols = Object.keys(crUpdateColumns).filter(function (n) { return crUpdateColumns[n].checked; }); parts.push('<div class="mt-2"><strong>Columns to Update:</strong><br>' + (updCols.join('<br>') || '<span class="text-body-secondary">None selected</span>') + '</div>'); parts.push('<div class="mt-2"><strong>Values:</strong><br>' + updCols.map(function (n) { return n + ' &rarr; ' + esc(crUpdateColumns[n].value || ''); }).join('<br>') + '</div>'); }
    if (crCommand === 'UPDATE' || crCommand === 'DELETE' || crCommand === 'SELECT') { var built = APSQL_FILTER.buildWhereSql(crFilterGroup, $('crDialectSel').value); parts.push('<div class="mt-2"><strong>WHERE:</strong><br>' + (built.plainEnglish ? esc(built.plainEnglish) : '<span class="text-body-secondary">None</span>') + '</div>'); }
    box.innerHTML = parts.join('');
  }
  function crRenderAll() { $('crInsertPanel').classList.toggle('d-none', crCommand !== 'INSERT'); $('crUpdatePanel').classList.toggle('d-none', crCommand !== 'UPDATE'); if (crCommand === 'INSERT') crRenderInsertPanel(); if (crCommand === 'UPDATE') crRenderUpdatePanel(); crRenderWherePanel(); crRenderDecodePanel(); crRenderRequirementsSummary(); }
  function crRenderResult(res) {
    crLastResult = res; var body = $('crResultBody');
    if (res.status === 'rejected') { body.innerHTML = '<div class="alert alert-danger mb-2"><strong>Could not build this query.</strong><br>' + esc(res.message) + '</div>' + renderSuggestedFixes(res.message); $('crCopyBtn').classList.add('d-none'); $('crOptimizeBtn').classList.add('d-none'); $('crOptimizeReportBox').innerHTML = ''; $('crWhereRequiredWarning').classList.toggle('d-none', !res.requiresWhereConfirmation); return; }
    $('crWhereRequiredWarning').classList.add('d-none');
    var warnings = (res.warnings || []).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
    body.innerHTML = '<div class="d-flex align-items-center gap-2 mb-2"><span class="badge text-bg-secondary cr-query-type-badge">Query Type: ' + esc(res.command) + '</span>' + (res.isPreview ? '' : '<span class="badge text-bg-warning-subtle text-warning-emphasis">&#9888;&#65039; Change Request Query</span>') + '</div><pre class="sql-output mb-2">' + highlight(res.sql) + '</pre>' + (warnings ? '<div class="alert alert-warning py-2 small mb-2"><ul class="mb-0">' + warnings + '</ul></div>' : '') + '<div class="small text-body-secondary">Generated SQL only \u2013 this application does not execute database changes.</div>';
    $('crCopyBtn').classList.remove('d-none'); $('crOptimizeBtn').classList.remove('d-none'); $('crOptimizeReportBox').innerHTML = '';
  }
  $('crCopyBtn').addEventListener('click', function () { if (crLastResult && crLastResult.status === 'ok') { navigator.clipboard && navigator.clipboard.writeText(crLastResult.sql); var old = $('crCopyBtn').innerHTML; $('crCopyBtn').innerHTML = '&#9989; Copied'; setTimeout(function () { $('crCopyBtn').innerHTML = old; }, 1300); } });
  $('crOptimizeBtn').addEventListener('click', function () {
    if (!crLastResult || crLastResult.status !== 'ok') return;
    aiService.optimizeSql(crLastResult).then(function (aiRes) {
      if (aiRes.hasChanges) { crLastResult = Object.assign({}, crLastResult, { sql: aiRes.optimizedSql }); crRenderResult(crLastResult); }
      renderOptimizeReport('crOptimizeReportBox', { changesApplied: aiRes.changesApplied, recommendations: aiRes.recommendations });
    });
  });
  function crApplyDescriptionToSelection() {
    var text = $('crDescriptionInput').value.trim();
    if (!text) { $('crDescriptionInterpretationBox').innerHTML = ''; return; }
    var interpretation = APSQL_NLQUERY.interpretCrRequirement(text, engine, {});
    if (interpretation.command) { crCommand = interpretation.command; document.querySelectorAll('.cr-command-option').forEach(function (o) { o.classList.toggle('active', o.getAttribute('data-command') === crCommand); }); }
    if (interpretation.table && engine.getTable(interpretation.table) && interpretation.table !== crTable) { crTable = interpretation.table; $('crTableSelect').value = crTable; crInsertColumns = {}; crUpdateColumns = {}; crFilterGroup = { conditions: [] }; }
    if (crCommand === 'INSERT' && interpretation.insertColumns && interpretation.insertColumns.length) interpretation.insertColumns.forEach(function (c) { if (!engine.columnExists(crTable, c.name)) return; if (!crInsertColumns[c.name]) crInsertColumns[c.name] = { checked: false, value: '' }; crInsertColumns[c.name].checked = true; if (!crInsertColumns[c.name].value) crInsertColumns[c.name].value = c.value; });
    if (crCommand === 'UPDATE' && interpretation.updateColumns && interpretation.updateColumns.length) interpretation.updateColumns.forEach(function (c) { if (!engine.columnExists(crTable, c.column)) return; if (!crUpdateColumns[c.column]) crUpdateColumns[c.column] = { checked: false, value: '' }; crUpdateColumns[c.column].checked = true; if (!crUpdateColumns[c.column].value) crUpdateColumns[c.column].value = c.value; });
    if ((crCommand === 'UPDATE' || crCommand === 'DELETE') && interpretation.filterConditions && interpretation.filterConditions.length) crFilterGroup.conditions = APSQL_NLQUERY.mergeFilterConditions(crFilterGroup.conditions, interpretation.filterConditions).map(function (c) { return c.id ? c : APSQL_FILTER.newCondition(c); });
    crRenderAll();
    renderCrDescriptionInterpretationBox(interpretation);
  }
  function renderCrDescriptionInterpretationBox(interpretation) {
    var box = $('crDescriptionInterpretationBox'); if (!box) return;
    var hasMatched = interpretation.matched && interpretation.matched.length; var hasWarnings = interpretation.warnings && interpretation.warnings.length;
    if (!hasMatched && !hasWarnings) { box.innerHTML = ''; return; }
    var parts = [];
    if (hasMatched) parts.push('<strong><i class="bi bi-chat-left-text-fill me-1"></i>Interpreted from your description:</strong><ul class="mt-1 mb-0">' + interpretation.matched.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>');
    if (hasWarnings) parts.push('<div class="' + (hasMatched ? 'mt-2 ' : '') + 'text-body-secondary small">' + interpretation.warnings.map(esc).join('<br>') + '</div>');
    box.innerHTML = '<div class="alert alert-info py-2 mb-0 small">' + parts.join('') + '</div>';
  }
  function runCrBuild() {
    crApplyDescriptionToSelection();
    var request = { command: crCommand, table: crTable, allowNoWhere: $('crAllowNoWhere').checked };
    if (crCommand === 'INSERT') request.columns = Object.keys(crInsertColumns).filter(function (n) { return crInsertColumns[n].checked; }).map(function (n) { return { name: n, value: crInsertColumns[n].value }; });
    else if (crCommand === 'UPDATE') { request.updates = Object.keys(crUpdateColumns).filter(function (n) { return crUpdateColumns[n].checked; }).map(function (n) { return { column: n, value: crUpdateColumns[n].value }; }); request.filterGroup = crFilterGroup; }
    else if (crCommand === 'DELETE' || crCommand === 'SELECT') request.filterGroup = crFilterGroup;
    var res = APSQL_CR.buildCrQuery(engine, request, $('crDialectSel').value);
    crRenderResult(res);
  }
  $('crBuildBtn').addEventListener('click', runCrBuild); $('crGenerateFromDescriptionBtn').addEventListener('click', runCrBuild);
  crRefreshTableOptions(); crRenderAll();
  document.querySelectorAll('#crManualTabs .nav-link').forEach(function (t) { t.addEventListener('click', function () { var name = t.getAttribute('data-cr-tab'); document.querySelectorAll('#crManualTabs .nav-link').forEach(function (x) { x.classList.toggle('active', x === t); }); document.querySelectorAll('.tab-pane-cr').forEach(function (p) { var show = p.id === 'cr-pane-' + name; p.classList.toggle('d-none', !show); p.classList.toggle('active', show); }); if (name === 'requirements') crRenderRequirementsSummary(); }); });
  var schemaSearchTerm = '';
  function highlightMatch(text, term) { if (!term) return esc(text); var escText = esc(text); var escTerm = esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (!escTerm) return escText; return escText.replace(new RegExp('(' + escTerm + ')', 'ig'), '<mark>$1</mark>'); }
  function tableMatchesSearch(t, term) { if (!term) return true; if ((t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(term) !== -1) return true; return t.columns.some(function (c) { return columnMatchesSearch(c, term); }); }
  function columnMatchesSearch(c, term) { if (!term) return true; return (c.name + ' ' + (c.alias || '') + ' ' + (c.description || '') + ' ' + (c.type || '')).toLowerCase().indexOf(term) !== -1; }
  function renderUsedSchema() {
    var st = engine.getStatus();
    $('usedSchemaSummary').innerHTML = [['Schema', st.schemaName], ['Version', st.schemaVersion], ['Status', '&#9989; Valid / Active'], ['Modules', st.moduleCount], ['Tables', st.tableCount], ['Columns', st.columnCount], ['Last Updated', st.lastUpdated]].map(function (row) { return '<div class="col-6 col-md-4 col-lg-3"><div class="text-body-secondary small">' + row[0] + '</div><div class="fw-semibold">' + row[1] + '</div></div>'; }).join('');
    if (!allTables().length) { $('schemaTree').innerHTML = '<div class="alert alert-secondary py-2 mb-0">The active schema currently has no tables. Upload a schema file under Schema &rarr; Update Schema to get started.</div>'; $('schemaSearchNoResults').classList.remove('show'); $('schemaSearchResultCount').textContent = ''; $('schemaSearchClearBtn').classList.add('d-none'); return; }
    var labels = moduleLabels(); var term = schemaSearchTerm.toLowerCase().trim(); var byModule = {};
    allTables().forEach(function (t) { (byModule[t.module] = byModule[t.module] || []).push(t); });
    var matchedTableCount = 0, matchedColumnCount = 0; var parts = [];
    Object.keys(byModule).sort().forEach(function (mod) {
      var allInModule = byModule[mod]; var matching = term ? allInModule.filter(function (t) { return tableMatchesSearch(t, term); }) : allInModule;
      if (term && !matching.length) return;
      var totalCols = allInModule.reduce(function (s, t) { return s + t.columns.length; }, 0);
      var tablesHtml = matching.map(function (t) { matchedTableCount++; var colsToShow = term ? t.columns.filter(function (c) { return columnMatchesSearch(c, term); }) : t.columns; matchedColumnCount += colsToShow.length; var colsHtml = colsToShow.map(function (c) { var badge = c.primary_key ? '<span class="badge text-bg-warning">PK</span>' : (c.foreign_key ? '<span class="badge text-bg-info">FK &rarr; ' + c.foreign_key.table + '.' + c.foreign_key.column + '</span>' : ''); return '<div class="col-item"><code>' + highlightMatch(c.name, term) + '</code> <span class="text-body-secondary">' + esc(c.type) + '</span> ' + badge + '<span class="col-desc">' + highlightMatch(c.description || '', term) + '</span></div>'; }).join(''); return '<div><div class="schema-tree-table-row" data-table="' + t.name + '"><span><code>' + highlightMatch(t.name, term) + '</code> <span class="text-body-secondary small">(' + colsToShow.length + ' columns)</span></span><span>&#9662;</span></div><div class="schema-tree-columns' + (term ? ' open' : '') + '" id="cols-' + t.name + '">' + colsHtml + '</div></div>'; }).join('');
      parts.push('<div class="schema-tree-module"><div class="schema-tree-module-header" data-module="' + mod + '"><span>' + highlightMatch(labels[mod] || mod, term) + ' <span class="text-body-secondary small fw-normal">(' + matching.length + ' tables, ' + totalCols + ' columns)</span></span><span>&#9662;</span></div><div class="schema-tree-tables' + (term ? ' open' : '') + '" id="tables-' + mod + '">' + tablesHtml + '</div></div>');
    });
    $('schemaTree').innerHTML = parts.join('');
    $('schemaTree').querySelectorAll('.schema-tree-module-header').forEach(function (h) { h.addEventListener('click', function () { $('tables-' + h.getAttribute('data-module')).classList.toggle('open'); }); });
    $('schemaTree').querySelectorAll('.schema-tree-table-row').forEach(function (r) { r.addEventListener('click', function () { $('cols-' + r.getAttribute('data-table')).classList.toggle('open'); }); });
    $('schemaSearchNoResults').classList.toggle('show', !!(term && matchedTableCount === 0));
    $('schemaSearchResultCount').textContent = term && matchedTableCount ? (matchedTableCount + ' tables and ' + matchedColumnCount + ' columns match "' + schemaSearchTerm + '".') : '';
    $('schemaSearchClearBtn').classList.toggle('d-none', !term);
  }
  $('schemaSearchInput').addEventListener('input', function (e) { schemaSearchTerm = e.target.value; renderUsedSchema(); });
  $('schemaSearchClearBtn').addEventListener('click', function () { $('schemaSearchInput').value = ''; schemaSearchTerm = ''; renderUsedSchema(); });
  function renderAiFactTable(facts) {
    return '<table class="ai-fact-table"><tbody>' + facts.map(function (f) { return '<tr><td>' + esc(f.fact) + '</td><td>' + esc(f.value) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function askSchemaAssistant() {
    var q = ($('schemaAssistantInput').value || '').trim();
    if (!q) return;
    $('schemaAssistantLoadingLine').classList.remove('d-none'); $('schemaAssistantAnswerBox').classList.add('d-none');
    aiService.explainSchemaObject(q).then(function (answer) {
      $('schemaAssistantLoadingLine').classList.add('d-none');
      var box = $('schemaAssistantAnswerBox'); box.classList.remove('d-none');
      var sourceTag = answer.groundedInSchema ? '<span class="ai-source-tag from-schema">From schema</span>' : '<span class="ai-source-tag from-ai">AI interpretation</span>';
      var html = '<div class="d-flex align-items-center gap-2 mb-1"><strong>' + esc(answer.subject || 'Answer') + '</strong>' + sourceTag + '</div>';
      html += '<div class="ai-assistant-answer mb-2">' + esc(answer.narrative) + '</div>';
      if (answer.facts && answer.facts.length) html += renderAiFactTable(answer.facts);
      box.innerHTML = html;
    }).catch(function () {
      $('schemaAssistantLoadingLine').classList.add('d-none');
      var box = $('schemaAssistantAnswerBox'); box.classList.remove('d-none');
      box.innerHTML = '<div class="alert alert-warning py-2 mb-0 small">The AI Schema Assistant is temporarily unavailable. Browse the schema tree below instead.</div>';
    });
  }
  $('schemaAssistantAskBtn').addEventListener('click', askSchemaAssistant);
  $('schemaAssistantInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') askSchemaAssistant(); });
  var aboutModalEl = $('aboutModal'); var aboutModal = window.bootstrap ? new window.bootstrap.Modal(aboutModalEl) : null;
  $('aboutMenuBtn').addEventListener('click', function () {
    var st = engine.getStatus();
    $('aboutList').innerHTML = [['Application name', 'AP-SQL Assistant'], ['Application version', '11.8.1'], ['Purpose', 'Version 11.8.1 is a Query Builder UI/UX refinement release: Describe What You Need and Generated SQL now sit side by side, followed by a single Manual Selectors card (Tables & Columns / Advanced Options / Selected-Described Requirements), and Tables & Columns splits cleanly into Select Tables / Select Columns / Filters — all on a compact, Bootstrap-based, responsive grid. Every underlying engine (SQL generation, AI service layer, schema management, CASE/DECODE, Error Rectifier, authentication) is completely unchanged from V11.8; only the surrounding layout and styling were reorganized.'], ['Active schema version', st.schemaVersion], ['Schema last updated', st.lastUpdated], ['Security', 'The Read Only Query Builder only ever emits read-only SELECT statements. The CR builder and Error Rectifier only ever produce SQL text for review and never execute it. AI recommendations are always reviewable and are never saved to the schema without the operational password. The credential vault uses AES-256-GCM encryption with a PBKDF2-derived key. The operational password is stored only as a SHA-256 hash, never in plain text, and changing it requires the current password (or use Forgot Password to reset to the documented default without ever displaying it).']].map(function (row) { return '<li class="list-group-item"><span class="text-body-secondary d-block small">' + row[0] + '</span>' + esc(row[1]) + '</li>'; }).join('');
    closeMenu(); if (aboutModal) aboutModal.show(); else aboutModalEl.classList.add('show');
  });
  var WORKFLOW_STEPS = ['Upload Document', 'Read Document', 'Detect Format', 'Detect Modules', 'Detect Tables', 'Detect Columns', 'Extract Metadata', 'Normalize Schema', 'Validate Schema', 'Show Preview', 'User Reviews Changes', 'Generate JSON', 'Validate JSON', 'Apply Schema Update'];
  function renderWorkflowSteps(activeIdx) { $('workflowStepList').innerHTML = WORKFLOW_STEPS.map(function (s, i) { var cls = i < activeIdx ? 'text-bg-success' : (i === activeIdx ? 'text-bg-primary' : 'text-bg-light border'); return '<span class="badge ' + cls + '">' + (i + 1) + '. ' + s + '</span>'; }).join(''); }
  renderWorkflowSteps(0);
  $('updateSchemaPasswordBtn').addEventListener('click', function () {
    var pw = $('updateSchemaPasswordInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (ok) { $('updateSchemaPasswordStep').classList.add('d-none'); $('updateSchemaWorkArea').classList.remove('d-none'); renderWorkflowSteps(1); renderSyncStatus(); renderGithubSyncStatus(); renderAllSharedSchemaStrips(); renderTargetSchemaSelect(); renderSchemaStoreList(); renderDefaultActiveSchemaChoices(); }
      else $('updateSchemaPasswordError').classList.remove('d-none');
    });
  });
  $('sharedSchemaRefreshBtn').addEventListener('click', function () { checkSharedSchema(true); });
  function triggerDownload(blob, filename) { var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); }
  $('downloadCurrentJsonBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaJsonBlob(currentSchema()), 'current-schema.json'); });
  $('downloadCurrentCsvBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaCsvBlob(currentSchema()), 'current-schema.csv'); });
  $('downloadCurrentDocxBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaDocxBlob(currentSchema()), 'current-schema.docx'); });
  $('downloadCurrentXlsxBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaXlsxBlob(currentSchema()), 'current-schema.xlsx'); });
  $('downloadCurrentDocBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaDocBlob(currentSchema()), 'current-schema.doc'); });
  $('downloadJsonSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleJsonBlob(), 'sample-schema.json'); });
  $('downloadCsvSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleCsvBlob(), 'sample-schema.csv'); });
  $('downloadDocxSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleDocxBlob(), 'sample-schema.docx'); });
  $('downloadXlsxSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleXlsxBlob(), 'sample-schema.xlsx'); });
  $('downloadDocSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleDocBlob(), 'sample-schema.doc'); });
  $('toggleExpectedStructureBtn').addEventListener('click', function () { var box = $('expectedStructureBox'); box.classList.toggle('d-none'); });
  var pendingIncomingTables = null;
  $('updateSchemaFileInput').addEventListener('change', function () { $('unsupportedFormatError').classList.add('d-none'); var file = $('updateSchemaFileInput').files && $('updateSchemaFileInput').files[0]; if (!file) return; if (!window.APSQL_SCHEMA_TOOLS.detectFormat(file.name)) { $('unsupportedFormatError').textContent = 'Unsupported file format. Please upload a .json or .csv file.'; $('unsupportedFormatError').classList.remove('d-none'); $('updateSchemaFileInput').value = ''; } });
  $('updateSchemaProcessBtn').addEventListener('click', function () {
    var file = $('updateSchemaFileInput').files && $('updateSchemaFileInput').files[0];
    var resultBox = $('updateSchemaResult'); resultBox.innerHTML = ''; $('unsupportedFormatError').classList.add('d-none');
    if (!file) { resultBox.innerHTML = '<div class="alert alert-warning py-2 mb-0">Please choose a file first.</div>'; return; }
    if (!window.APSQL_SCHEMA_TOOLS.detectFormat(file.name)) { $('unsupportedFormatError').textContent = 'Unsupported file format. Please upload a .json or .csv file.'; $('unsupportedFormatError').classList.remove('d-none'); return; }
    renderWorkflowSteps(3);
    window.APSQL_SCHEMA_TOOLS.fileToTables(file).then(function (tables) {
      renderWorkflowSteps(8);
      var validation = window.APSQL_SCHEMA_TOOLS.validateSchema(tables);
      $('validationResultBox').innerHTML = validation.valid ? '<div class="alert alert-success py-2 mb-0">&#9989; Schema validated: no duplicate tables/columns, no missing names detected.</div>' : '<div class="alert alert-danger py-2 mb-0"><strong>The schema could not be activated because validation failed. The existing schema has not been changed.</strong><ul class="mb-0 mt-1">' + validation.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
      if (!validation.valid) { $('updateSchemaPreviewCard').classList.remove('d-none'); return; }
      pendingIncomingTables = tables; renderWorkflowSteps(9);
      var targetSchema = targetSchemaEntry().schema;
      var diff = window.APSQL_SCHEMA_TOOLS.computeDiff(targetSchema, tables);
      $('previewCurrentBox').innerHTML = 'Version: ' + esc(targetSchema.schema_version) + '<br>Tables: ' + diff.currentTableCount + '<br>Columns: ' + diff.currentColumnCount;
      $('previewNewBox').innerHTML = 'Version: ' + esc(diff.newVersion) + '<br>Tables: ' + diff.newTableCount + '<br>Columns: ' + diff.newColumnCount;
      $('previewChangesBox').innerHTML = '<span class="diff-added">+ ' + diff.addedTableCount + ' New Tables</span><br><span class="diff-added">+ ' + diff.addedColumnCount + ' New Columns</span><br><span class="diff-updated">~ ' + diff.updatedTableCount + ' Updated Tables</span>';
      $('updateSchemaPreviewCard').classList.remove('d-none'); $('updateSchemaPreviewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) { resultBox.innerHTML = '<div class="alert alert-danger py-2 mb-0">' + esc(err.message) + '</div>'; renderWorkflowSteps(1); });
  });
  function refreshAllViewsAfterSchemaChange() { refreshTablesColumnsUI(); refreshHierarchyOptions(); refreshModuleChips(); crRefreshTableOptions(); crRenderAll(); if (currentView === 'usedschema') { renderUsedSchema(); renderSchemaStoreList(); } }
  function performApplySchemaUpdate() {
    if (!pendingIncomingTables) return;
    var targetEntry = targetSchemaEntry();
    var mergeResult = window.APSQL_SCHEMA_TOOLS.mergeSchemas(targetEntry.schema, pendingIncomingTables, $('updateSchemaFileInput').files[0].name);
    schemaStore.updateEntry(targetEntry.id, { schema: mergeResult.schema });
    if (schemaStore.isActive(targetEntry.id)) rebuildEngine();
    persistCurrentSchema(); renderSchemaPersistenceStatus();
    renderWorkflowSteps(13);
    refreshAllViewsAfterSchemaChange(); renderSchemaStoreList(); renderTargetSchemaSelect();
    $('updateSchemaResult').innerHTML = '<div class="alert alert-success py-2"><div><strong>' + mergeResult.addedTables.length + '</strong> new table(s), <strong>' + mergeResult.addedColumns.length + '</strong> new column(s) added to \u201c' + esc(targetEntry.name) + '\u201d.</div><div class="mt-2"><code>Schema Version: ' + esc(mergeResult.schema.schema_version) + '</code></div><div class="mt-2">Other stored schemas were not affected.</div></div>';
    $('updateSchemaPreviewCard').classList.add('d-none'); pendingIncomingTables = null;
  }
  var reauthApplyModalEl = $('reauthApplyModal'); var reauthApplyModal = window.bootstrap ? new window.bootstrap.Modal(reauthApplyModalEl) : null;
  $('activateSchemaBtn').addEventListener('click', function () { if (!pendingIncomingTables) return; $('reauthApplyPasswordInput').value = ''; $('reauthApplyPasswordError').classList.add('d-none'); if (reauthApplyModal) reauthApplyModal.show(); });
  $('confirmReauthApplyBtn').addEventListener('click', function () { var pw = $('reauthApplyPasswordInput').value; passwordManager.verifyCurrentPassword(pw).then(function (ok) { if (!ok) { $('reauthApplyPasswordError').classList.remove('d-none'); return; } if (reauthApplyModal) reauthApplyModal.hide(); performApplySchemaUpdate(); }); });
  $('cancelPreviewBtn').addEventListener('click', function () { $('updateSchemaPreviewCard').classList.add('d-none'); pendingIncomingTables = null; renderWorkflowSteps(1); $('updateSchemaResult').innerHTML = '<div class="alert alert-secondary py-2 mb-0">Update cancelled. No schema was changed.</div>'; });
  var deleteSchemaModalEl = $('deleteSchemaModal'); var deleteSchemaModal = window.bootstrap ? new window.bootstrap.Modal(deleteSchemaModalEl) : null;
  $('deleteSchemaBtn').addEventListener('click', function () { $('deleteSchemaPasswordInput').value = ''; $('deleteSchemaPasswordError').classList.add('d-none'); if (deleteSchemaModal) deleteSchemaModal.show(); });
  $('confirmDeleteSchemaBtn').addEventListener('click', function () {
    var pw = $('deleteSchemaPasswordInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (!ok) { $('deleteSchemaPasswordError').classList.remove('d-none'); return; }
      var targetEntry = targetSchemaEntry();
      triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaJsonBlob(targetEntry.schema), 'schema-backup-before-delete.json');
      var emptied = window.APSQL_SCHEMA_TOOLS.buildEmptySchema(targetEntry.schema);
      schemaStore.updateEntry(targetEntry.id, { schema: emptied });
      if (schemaStore.isActive(targetEntry.id)) { relationshipStore.clearAll(); relationshipDrafts = {}; rebuildEngine(); resetQueryState(true); }
      persistCurrentSchema(); renderSchemaPersistenceStatus();
      crInsertColumns = {}; crUpdateColumns = {}; crFilterGroup.conditions = []; $('crDescriptionInput').value = ''; $('crDescriptionInterpretationBox').innerHTML = '';
      refreshAllViewsAfterSchemaChange(); renderSchemaStoreList(); renderTargetSchemaSelect();
      if (deleteSchemaModal) deleteSchemaModal.hide();
      $('updateSchemaResult').innerHTML = '<div class="alert alert-warning py-2"><strong>\u201c' + esc(targetEntry.name) + '\u201d has been emptied.</strong> A backup was automatically downloaded. Other stored schemas were not affected.</div>';
    });
  });
  var saveRelationshipModalEl = $('saveRelationshipModal'); var saveRelationshipModal = window.bootstrap ? new window.bootstrap.Modal(saveRelationshipModalEl) : null;
  $('confirmSaveRelationshipBtn').addEventListener('click', function () {
    if (!pendingSaveRelationshipDraft) return;
    var pw = $('saveRelationshipPasswordInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (!ok) { $('saveRelationshipPasswordError').classList.remove('d-none'); return; }
      var d = pendingSaveRelationshipDraft;
      var updatedSchema;
      try { updatedSchema = window.APSQL_SCHEMA_TOOLS.saveRelationshipToSchema(currentSchema(), d.fromTable, d.fromColumn, d.toTable, d.toColumn); }
      catch (err) { $('saveRelationshipPasswordError').classList.remove('d-none'); $('saveRelationshipPasswordError').textContent = err.message; return; }
      setActiveSchemaObject(updatedSchema);
      relationshipStore.clearManualRelationship(d.fromTable, d.toTable); delete relationshipDrafts[d.fromTable];
      rebuildEngine();
      persistCurrentSchema(); renderSchemaPersistenceStatus();
      refreshAllViewsAfterSchemaChange(); renderJoinPreview();
      if (saveRelationshipModal) saveRelationshipModal.hide();
      pendingSaveRelationshipDraft = null;
    });
  });
  var errLastResult = null;
  function renderErrorRectifierResult(result) {
    errLastResult = result;
    $('errAiAnalysisBody').innerHTML = '<p class="mb-0">' + esc(result.analysis || result.errorIdentified || '') + '</p>';
    $('errRectifiedSqlBody').innerHTML = '<pre class="sql-output mb-0">' + highlight(result.correctedSql) + '</pre>';
    $('errCopySqlBtn').classList.remove('d-none');
    $('errExplanationBody').innerHTML = '<p class="mb-0">' + esc(result.explanation || result.correctionApplied || '') + '</p>';
    $('errCopyExplanationBtn').classList.remove('d-none');
    var changedCard = $('errWhatChangedCard'); var changedBody = $('errWhatChangedBody');
    if (result.changed && result.changes && result.changes.length) { changedCard.classList.remove('d-none'); changedBody.innerHTML = result.changes.map(function (c) { return '<div class="change-row"><code class="change-from">' + esc(c.from) + '</code><span class="change-arrow">&rarr;</span><code class="change-to">' + esc(c.to) + '</code></div>'; }).join(''); }
    else { changedCard.classList.add('d-none'); changedBody.innerHTML = ''; }
  }
  $('errRectifyBtn').addEventListener('click', function () {
    var errorText = $('errErrorInput').value; var sqlText = $('errSqlInput').value;
    var detected = window.APSQL_ERROR_RECTIFIER.detectDialectFromError(errorText); if (detected) $('errDialectSel').value = detected;
    var dialect = $('errDialectSel').value;
    $('errRectifyLoadingLine').classList.remove('d-none');
    aiService.rectifyError(sqlText, errorText, dialect).then(function (result) {
      $('errRectifyLoadingLine').classList.add('d-none');
      renderErrorRectifierResult(result);
    }).catch(function () {
      $('errRectifyLoadingLine').classList.add('d-none');
      var fallback = window.APSQL_ERROR_RECTIFIER.rectify(sqlText, errorText, engine, dialect);
      renderErrorRectifierResult({ analysis: fallback.errorIdentified, correctedSql: fallback.correctedSql, changed: fallback.changed, explanation: fallback.correctionApplied, changes: fallback.changes });
    });
  });
  $('errCopySqlBtn').addEventListener('click', function () { if (!errLastResult) return; navigator.clipboard && navigator.clipboard.writeText(errLastResult.correctedSql); var old = $('errCopySqlBtn').innerHTML; $('errCopySqlBtn').innerHTML = '&#9989; Copied'; setTimeout(function () { $('errCopySqlBtn').innerHTML = old; }, 1300); });
  $('errCopyExplanationBtn').addEventListener('click', function () { if (!errLastResult) return; var text = 'AI Analysis: ' + (errLastResult.analysis || '') + '\n\nExplanation: ' + (errLastResult.explanation || ''); navigator.clipboard && navigator.clipboard.writeText(text); var old = $('errCopyExplanationBtn').innerHTML; $('errCopyExplanationBtn').innerHTML = '&#9989; Copied'; setTimeout(function () { $('errCopyExplanationBtn').innerHTML = old; }, 1300); });
  var TOURS = {
    quickstart: [{ sel: '[data-tour="hamburger"]', place: 'bottom', title: 'What this application does', body: '<p>Store multiple schemas, describe requirements in plain language, and build queries safely — with AI assistance grounded in your active schema throughout.</p>' }],
    builder: [
      { sel: '[data-tour="prompt"]', place: 'bottom', title: 'Describe What You Need', body: '<p>Type a plain-English request and click Build Query. This step uses AI intent understanding to identify tables, columns, and filters automatically. Generated SQL appears right beside it.</p>' },
      { sel: '#resultBody', place: 'top', title: 'Generated SQL', body: '<p>Your validated SQL appears here. Use AI Self-Review to have the AI check schema correctness, relationships, and logic.</p>' },
      { sel: '#manualTabs', place: 'top', title: 'Manual Selectors', body: '<p>Tables & Columns, Advanced Options, and Selected/Described Requirements are organized into compact tabs below.</p>' }
    ],
    crbuilder: [{ sel: '#crCommandSelector', place: 'bottom', title: 'Query Type', body: '<p>Choose INSERT, UPDATE, or DELETE. AI can help draft these from a description, but the WHERE-condition safeguard always applies.</p>' }],
    usedschema: [
      { sel: '#usedSchemaSummary', place: 'bottom', title: 'The currently active schema', body: '<p>Switch between stored schemas above.</p>' },
      { sel: '#schemaAssistantInput', place: 'bottom', title: 'AI Schema Assistant', body: '<p>Ask about any table, column, or relationship — answers are grounded strictly in your schema\u2019s own metadata.</p>' }
    ],
    updateschema: [{ sel: '#schemaPersistenceStatus', place: 'bottom', title: 'Multiple schemas', body: '<p>Add, update, or delete individual schemas without affecting others. Synchronization options are further below.</p>' }],
    errorrectifier: [{ sel: '#errErrorInput', place: 'bottom', title: 'AI Error Rectifier', body: '<p>Paste the error and SQL — AI analyzes the likely cause against your active schema, corrects it, and explains the change.</p>' }],
    about: []
  };
  var TOUR = TOURS.quickstart; var tourIdx = 0, tourOpen = false;
  var overlay = $('tourOverlay'), spotlight = $('tourSpotlight'), popup = $('tourPopup');
  function clampToViewport(top, left, popW, popH) { var vw = window.innerWidth, vh = window.innerHeight, margin = 12; return { top: Math.min(Math.max(margin, top), Math.max(margin, vh - popH - margin)), left: Math.min(Math.max(margin, left), Math.max(margin, vw - popW - margin)) }; }
  function positionTour() {
    var step = TOUR[tourIdx]; var target = document.querySelector(step.sel); if (!target) { endTour(); return; }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () {
      var r = target.getBoundingClientRect(); var pad = 8;
      spotlight.style.top = (r.top - pad) + 'px'; spotlight.style.left = (r.left - pad) + 'px'; spotlight.style.width = (r.width + pad * 2) + 'px'; spotlight.style.height = (r.height + pad * 2) + 'px';
      var popW = Math.min(popup.offsetWidth || 340, window.innerWidth - 24); var popH = Math.min(popup.offsetHeight || 190, window.innerHeight - 24); var vh = window.innerHeight;
      var place = step.place || 'bottom';
      if (place === 'bottom' && r.bottom + popH + 20 > vh) place = 'top';
      if (place === 'top' && r.top - popH - 20 < 0) place = 'bottom';
      var rawTop, rawLeft;
      if (place === 'bottom') { rawTop = r.bottom + 14; rawLeft = r.left; } else if (place === 'top') { rawTop = r.top - popH - 14; rawLeft = r.left; } else if (place === 'left') { rawLeft = r.left - popW - 14; rawTop = r.top; } else { rawLeft = r.right + 14; rawTop = r.top; }
      var clamped = clampToViewport(rawTop, rawLeft, popW, popH); popup.style.top = clamped.top + 'px'; popup.style.left = clamped.left + 'px';
      $('tourStepLabel').textContent = 'Step ' + (tourIdx + 1) + ' of ' + TOUR.length + ' \u2014 ' + currentView;
      $('tourTitle').textContent = step.title; $('tourBody').innerHTML = step.body;
      $('tourDots').innerHTML = TOUR.map(function (_, i) { return '<i class="' + (i === tourIdx ? 'on' : '') + '"></i>'; }).join('');
      $('tourPrev').disabled = tourIdx === 0; $('tourNext').textContent = tourIdx === TOUR.length - 1 ? 'Done' : 'Next';
    }, 260);
  }
  function startTour() { TOUR = TOURS[currentView] && TOURS[currentView].length ? TOURS[currentView] : TOURS.quickstart; tourIdx = 0; tourOpen = true; overlay.classList.add('show'); positionTour(); }
  function endTour() { tourOpen = false; overlay.classList.remove('show'); }
  function nextTour() { if (tourIdx < TOUR.length - 1) { tourIdx++; positionTour(); } else endTour(); }
  function prevTour() { if (tourIdx > 0) { tourIdx--; positionTour(); } }
  $('tourBtn').addEventListener('click', startTour); $('tourNext').addEventListener('click', nextTour); $('tourPrev').addEventListener('click', prevTour); $('tourSkip').addEventListener('click', endTour);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) endTour(); });
  document.addEventListener('keydown', function (e) { if (!tourOpen) return; if (e.key === 'Escape') endTour(); else if (e.key === 'ArrowRight') nextTour(); else if (e.key === 'ArrowLeft') prevTour(); });
  window.addEventListener('resize', function () { if (tourOpen) positionTour(); });
})();
