(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

  /* ------------------------------------------------------------------ *
   * Schema store bootstrap
   * ------------------------------------------------------------------ */
  var LEGACY_SCHEMA_STORAGE_KEY = 'ap_sql_active_schema_v1';
  var schemaStore = APSQL_SCHEMA_STORE.createStore();
  (function migrateOrSeed() {
    if (schemaStore.count() > 0) return;
    var legacySchema = null;
    try {
      var raw = localStorage.getItem(LEGACY_SCHEMA_STORAGE_KEY);
      if (raw) { var parsed = JSON.parse(raw); if (parsed && Array.isArray(parsed.tables) && window.APSQL_SCHEMA_TOOLS.validateSchema(parsed.tables).valid) legacySchema = parsed; }
    } catch (e) {}
    if (legacySchema) schemaStore.importLegacySingleSchema(legacySchema, legacySchema.schema_name || 'Migrated Schema');
    else schemaStore.addEntry({ name: window.__AP_SCHEMA__.schema_name || 'Default Schema', schema: window.__AP_SCHEMA__, source: 'embedded' });
  })();
  var relationshipStore = APSQL_RELATIONSHIPS.createRelationshipStore();
  var engine;
  function currentSchema() { return schemaStore.getActiveSchema() || { tables: [] }; }
  function setActiveSchemaObject(schemaObj) { var entry = schemaStore.getActiveEntry(); if (entry) schemaStore.updateEntry(entry.id, { schema: schemaObj }); }
  function rebuildEngine() { engine = APSQL_RELATIONSHIPS.createEffectiveEngine(APSQL.createEngine(currentSchema()), relationshipStore); }
  rebuildEngine();
  var decodeStore = APSQL_DECODE.createDecodeStore();

  /* ------------------------------------------------------------------ *
   * Shared schema (Live Shared Schema) status strip
   * ------------------------------------------------------------------ */
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
    ['sharedSchemaStripQuickstart', 'sharedSchemaStripBuilder', 'sharedSchemaStripCr', 'sharedSchemaStripUsedSchema'].forEach(renderSharedSchemaStrip);
    var adminEl = $('sharedSchemaStatusBodyAdmin');
    if (adminEl) {
      var state = { checked: sharedSchemaChecked, found: sharedSchemaFound, error: sharedSchemaError, path: SHARED_SCHEMA_PATH };
      var status = APSQL_SHARED_SCHEMA.describeSharedSchemaStatus(state);
      adminEl.innerHTML = '<div class="shared-schema-strip level-' + status.level + '">' + (status.level === 'live' ? '<span class="shared-schema-pulse"></span>' : '<i class="bi bi-hdd-fill"></i>') + '<span class="shared-schema-text">' + esc(status.text) + '</span></div>';
    }
    var pathDisplay = $('sharedSchemaPathDisplay'); if (pathDisplay) pathDisplay.textContent = SHARED_SCHEMA_PATH;
  }
  function checkSharedSchema() {
    return APSQL_SHARED_SCHEMA.fetchSharedSchema(SHARED_SCHEMA_PATH).then(function (result) {
      sharedSchemaChecked = true; sharedSchemaError = null;
      if (!result.found) { sharedSchemaFound = false; renderAllSharedSchemaStrips(); return; }
      var tablesToValidate = Array.isArray(result.schema) ? result.schema : result.schema.tables;
      var validation = window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate);
      if (!validation.valid) { sharedSchemaFound = false; sharedSchemaError = 'The published shared schema failed validation, so it was ignored.'; renderAllSharedSchemaStrips(); return; }
      sharedSchemaFound = true; setActiveSchemaObject(result.schema); rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderAllSharedSchemaStrips();
    }).catch(function () { sharedSchemaChecked = true; sharedSchemaFound = false; renderAllSharedSchemaStrips(); });
  }
  renderAllSharedSchemaStrips();
  checkSharedSchema();
  var sharedSchemaRefreshBtn = $('sharedSchemaRefreshBtn'); if (sharedSchemaRefreshBtn) sharedSchemaRefreshBtn.addEventListener('click', checkSharedSchema);

  /* ------------------------------------------------------------------ *
   * Cross-device sync (File System Access API)
   * ------------------------------------------------------------------ */
  var syncSupported = APSQL_SYNC.isFileSystemAccessSupported(window);
  var syncHandleStore = syncSupported ? APSQL_SYNC.createHandleStore() : null;
  var linkedHandle = null, lastKnownFileModified = null, syncNeedsReconnect = false, syncError = null, syncLastCheckedAt = null;
  function currentSyncState() { return { supported: syncSupported, linked: !!linkedHandle, fileName: linkedHandle ? linkedHandle.name : null, needsReconnect: syncNeedsReconnect, error: syncError }; }
  function renderSyncStatus(transientNote) {
    var statusBody = $('schemaSyncStatusBody'), actionsBody = $('schemaSyncActionsBody'), lastCheckEl = $('schemaSyncLastCheck');
    if (!statusBody || !actionsBody) return;
    var status = APSQL_SYNC.describeSyncStatus(currentSyncState());
    statusBody.innerHTML = '<div class="shared-schema-strip">' + esc(transientNote || status.text) + '</div>';
    actionsBody.innerHTML = '';
    if (!syncSupported) { lastCheckEl.textContent = 'File System Access is not supported in this browser.'; return; }
    function addBtn(label, cls, handler) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + cls; b.textContent = label; b.addEventListener('click', handler); actionsBody.appendChild(b); }
    if (syncNeedsReconnect) { addBtn('Reconnect to Shared File', 'btn-outline-warning', reconnectSharedFile); addBtn('Unlink', 'btn-outline-secondary', unlinkSharedFile); }
    else if (linkedHandle) { addBtn('Check Now', 'btn-outline-primary', function () { checkLinkedFileForUpdates(true); }); addBtn('Unlink', 'btn-outline-secondary', unlinkSharedFile); }
    else { addBtn('Create New Shared File', 'btn-outline-success', linkNewSharedFile); addBtn('Link Existing Shared File', 'btn-outline-primary', linkExistingSharedFile); }
    lastCheckEl.textContent = syncLastCheckedAt ? ('Last checked: ' + syncLastCheckedAt.toLocaleTimeString()) : '';
  }
  function checkLinkedFileForUpdates(isManual) {
    if (!linkedHandle) return Promise.resolve();
    return APSQL_SYNC.verifyPermissionSilent(linkedHandle, 'read').then(function (granted) {
      if (!granted) { syncNeedsReconnect = true; renderSyncStatus(); return; }
      syncNeedsReconnect = false;
      return APSQL_SYNC.readSchemaFromHandle(linkedHandle).then(function (result) {
        syncLastCheckedAt = new Date();
        if (lastKnownFileModified !== null && result.lastModified === lastKnownFileModified) { renderSyncStatus(isManual ? 'Checked just now.' : undefined); return; }
        var tablesToValidate = Array.isArray(result.schema) ? result.schema : result.schema.tables;
        if (!window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate).valid) { renderSyncStatus(); return; }
        setActiveSchemaObject(result.schema); rebuildEngine(); lastKnownFileModified = result.lastModified;
        refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus();
        renderSyncStatus(isManual ? 'Checked the shared file just now.' : 'Schema synced from the shared file.');
      });
    }).catch(function (err) { if (isManual) { syncError = err.message; renderSyncStatus(); } });
  }
  function syncWriteCurrentSchemaIfLinked() {
    if (!linkedHandle) return;
    APSQL_SYNC.verifyPermissionSilent(linkedHandle, 'readwrite').then(function (granted) {
      if (!granted) { syncNeedsReconnect = true; renderSyncStatus(); return; }
      return APSQL_SYNC.writeSchemaToHandle(linkedHandle, currentSchema()).then(function () { return APSQL_SYNC.readSchemaFromHandle(linkedHandle); }).then(function (result) { lastKnownFileModified = result.lastModified; renderSyncStatus(); });
    }).catch(function (err) { syncError = 'Could not write to the linked shared file: ' + err.message; renderSyncStatus(); });
  }
  function linkNewSharedFile() {
    if (!window.showSaveFilePicker) return;
    window.showSaveFilePicker({ suggestedName: 'ap-sql-assistant-schema.json', types: [{ description: 'AP-SQL Assistant Schema', accept: { 'application/json': ['.json'] } }] })
      .then(function (handle) { linkedHandle = handle; syncNeedsReconnect = false; return APSQL_SYNC.writeSchemaToHandle(handle, currentSchema()).then(function () { return APSQL_SYNC.readSchemaFromHandle(handle); }).then(function (r) { lastKnownFileModified = r.lastModified; return syncHandleStore.saveHandle(handle); }); })
      .then(function () { syncLastCheckedAt = new Date(); renderSyncStatus('Created and linked the shared schema file.'); })
      .catch(function (err) { if (err && err.name === 'AbortError') return; syncError = err.message; renderSyncStatus(); });
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
            if (!window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate).valid) throw new Error('That file does not contain a valid AP-SQL Assistant schema.');
            linkedHandle = handle; syncNeedsReconnect = false; setActiveSchemaObject(result.schema); rebuildEngine(); lastKnownFileModified = result.lastModified; return syncHandleStore.saveHandle(handle);
          });
        });
      })
      .then(function () { syncLastCheckedAt = new Date(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderSyncStatus('Linked to the existing shared schema file.'); })
      .catch(function (err) { if (err && err.name === 'AbortError') return; syncError = err.message; renderSyncStatus(); });
  }
  function unlinkSharedFile() {
    linkedHandle = null; lastKnownFileModified = null; syncError = null; syncNeedsReconnect = false; syncLastCheckedAt = null;
    (syncHandleStore ? syncHandleStore.clearHandle() : Promise.resolve()).then(renderSyncStatus).catch(renderSyncStatus);
  }
  function reconnectSharedFile() {
    if (!linkedHandle) return;
    APSQL_SYNC.verifyPermission(linkedHandle, 'readwrite').then(function (granted) {
      if (!granted) { syncError = 'Permission was not granted.'; renderSyncStatus(); return; }
      syncNeedsReconnect = false; syncError = null; return checkLinkedFileForUpdates(true);
    }).catch(function (err) { syncError = err.message; renderSyncStatus(); });
  }
  if (syncSupported && syncHandleStore) {
    syncHandleStore.loadHandle().then(function (handle) {
      if (!handle) { renderSyncStatus(); return; }
      linkedHandle = handle;
      return APSQL_SYNC.verifyPermissionSilent(handle, 'read').then(function (granted) {
        if (!granted) { syncNeedsReconnect = true; renderSyncStatus(); return; }
        return checkLinkedFileForUpdates(false).then(renderSyncStatus);
      });
    }).catch(renderSyncStatus);
  } else renderSyncStatus();

  /* ------------------------------------------------------------------ *
   * GitHub-hosted schema sync (includes the V10.7.1 anonymous-read fix
   * for the credential vault lookup — see github-sync-engine.js)
   * ------------------------------------------------------------------ */
  var githubConfigStore = APSQL_GITHUB_SYNC.createConfigStore();
  var githubConfig = null, githubLastSha = null, githubError = null, githubConflict = false, githubLastCheckedAt = null;
  function renderGithubSyncStatus(transientNote) {
    var statusBody = $('githubSyncStatusBody'), actionsBody = $('githubSyncActionsBody'), lastCheckEl = $('githubSyncLastCheck'), configForm = $('githubSyncConfigForm'), tokenWarningBox = $('githubTokenWarningBox');
    if (!statusBody || !actionsBody) return;
    if (tokenWarningBox) tokenWarningBox.classList.remove('d-none');
    var state = { configured: !!githubConfig, conflict: githubConflict, error: githubError, owner: githubConfig && githubConfig.owner, repo: githubConfig && githubConfig.repo, path: githubConfig && githubConfig.path, branch: githubConfig && githubConfig.branch };
    var status = APSQL_GITHUB_SYNC.describeGitHubSyncStatus(state);
    statusBody.innerHTML = '<div class="shared-schema-strip">' + esc(transientNote || status.text) + '</div>';
    if (configForm) configForm.classList.toggle('d-none', !!githubConfig);
    actionsBody.innerHTML = '';
    function addBtn(label, cls, handler) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + cls; b.textContent = label; b.addEventListener('click', handler); actionsBody.appendChild(b); }
    if (!githubConfig) addBtn('Connect & Sync Now', 'btn-outline-success', connectGithub);
    else { addBtn('Sync Now', 'btn-outline-primary', function () { checkGithubForUpdates(true); }); addBtn('Disconnect', 'btn-outline-secondary', disconnectGithub); }
    if (lastCheckEl) lastCheckEl.textContent = githubLastCheckedAt ? ('Last checked: ' + githubLastCheckedAt.toLocaleTimeString()) : '';
    refreshVaultControlAvailability();
  }
  function connectGithub() {
    var config = { owner: ($('githubOwnerInput').value || '').trim(), repo: ($('githubRepoInput').value || '').trim(), branch: ($('githubBranchInput').value || '').trim() || 'main', path: ($('githubPathInput').value || '').trim(), token: ($('githubTokenInput').value || '').trim() };
    if (!APSQL_GITHUB_SYNC.isConfigComplete(config)) { githubError = 'Please fill in the repository owner, name, file path, and a Personal Access Token before connecting.'; renderGithubSyncStatus(); return; }
    APSQL_GITHUB_SYNC.fetchRemoteSchema(config).then(function (result) {
      if (result.exists) {
        var tablesToValidate = Array.isArray(result.schema) ? result.schema : result.schema.tables;
        if (!window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate).valid) throw new Error('That file does not contain a valid AP-SQL Assistant schema.');
        githubConfig = config; githubLastSha = result.sha; setActiveSchemaObject(result.schema); rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); return null;
      }
      githubConfig = config;
      return APSQL_GITHUB_SYNC.pushSchemaToGitHub(config, currentSchema(), null).then(function (pushResult) { githubLastSha = pushResult.sha; });
    }).then(function () { githubConfigStore.saveConfig(config); githubError = null; githubConflict = false; githubLastCheckedAt = new Date(); renderGithubSyncStatus('Connected to GitHub and synced.'); })
      .catch(function (err) { githubConfig = null; githubError = err.message; renderGithubSyncStatus(); });
  }
  function disconnectGithub() { githubConfig = null; githubLastSha = null; githubError = null; githubConflict = false; githubLastCheckedAt = null; githubConfigStore.clearConfig(); renderGithubSyncStatus(); }
  function checkGithubForUpdates(isManual) {
    if (!githubConfig) return Promise.resolve();
    return APSQL_GITHUB_SYNC.fetchRemoteSchema(githubConfig).then(function (result) {
      githubLastCheckedAt = new Date();
      if (!result.exists) { githubError = null; githubLastSha = null; renderGithubSyncStatus(isManual ? 'Checked GitHub — no shared file found yet.' : undefined); return; }
      if (githubLastSha !== null && result.sha === githubLastSha) { renderGithubSyncStatus(isManual ? 'Checked GitHub just now.' : undefined); return; }
      var tablesToValidate = Array.isArray(result.schema) ? result.schema : result.schema.tables;
      if (!window.APSQL_SCHEMA_TOOLS.validateSchema(tablesToValidate).valid) { renderGithubSyncStatus(); return; }
      setActiveSchemaObject(result.schema); rebuildEngine(); githubLastSha = result.sha; refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); githubError = null; githubConflict = false;
      renderGithubSyncStatus(isManual ? 'Checked GitHub just now.' : 'Schema synced from GitHub.');
    }).catch(function (err) { if (isManual) { githubError = err.message; renderGithubSyncStatus(); } });
  }
  function pushToGithubIfConfigured() {
    if (!githubConfig) return;
    APSQL_GITHUB_SYNC.pushSchemaToGitHub(githubConfig, currentSchema(), githubLastSha).then(function (result) { githubLastSha = result.sha; githubError = null; githubConflict = false; renderGithubSyncStatus(); })
      .catch(function (err) {
        if (!err.conflict) { githubError = err.message; renderGithubSyncStatus(); return; }
        return APSQL_GITHUB_SYNC.fetchRemoteSchema(githubConfig).then(function (remote) { githubLastSha = remote.exists ? remote.sha : null; return APSQL_GITHUB_SYNC.pushSchemaToGitHub(githubConfig, currentSchema(), githubLastSha); })
          .then(function (result2) { githubLastSha = result2.sha; githubError = null; githubConflict = false; renderGithubSyncStatus(); })
          .catch(function (err2) { githubConflict = !!err2.conflict; githubError = err2.conflict ? 'Someone else updated the shared schema file again just now. Click "Sync Now" to fetch the latest version.' : err2.message; renderGithubSyncStatus(); });
      });
  }
  (function initGithubSyncFromStorage() {
    var saved = githubConfigStore.loadConfig();
    if (!saved) { renderGithubSyncStatus(); return; }
    $('githubOwnerInput').value = saved.owner || ''; $('githubRepoInput').value = saved.repo || ''; $('githubBranchInput').value = saved.branch || 'main'; $('githubPathInput').value = saved.path || SHARED_SCHEMA_PATH; $('githubTokenInput').value = saved.token || '';
    githubConfig = saved; checkGithubForUpdates(false).then(function () { renderGithubSyncStatus(); });
  })();
  (function defaultGithubPathToSharedPath() { var pathInput = $('githubPathInput'); if (pathInput && !pathInput.value) pathInput.value = SHARED_SCHEMA_PATH; })();

  /* ------------------------------------------------------------------ *
   * Sync schedule
   * ------------------------------------------------------------------ */
  var syncScheduleSelectedId = APSQL_SYNC_SCHEDULE.loadSelectedOptionId();
  var syncIntervalHandle = null;
  function runAllAutomaticSyncChecks() { if (document.hidden) return; checkSharedSchema(); checkLinkedFileForUpdates(false); checkGithubForUpdates(false); }
  function applySyncScheduleInterval() {
    if (syncIntervalHandle) { clearInterval(syncIntervalHandle); syncIntervalHandle = null; }
    var ms = APSQL_SYNC_SCHEDULE.toIntervalMs(syncScheduleSelectedId); if (ms != null) syncIntervalHandle = setInterval(runAllAutomaticSyncChecks, ms);
  }
  applySyncScheduleInterval();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) runAllAutomaticSyncChecks(); });
  function renderSyncScheduleSelect() {
    var sel = $('syncScheduleSelect'); if (!sel) return;
    sel.innerHTML = APSQL_SYNC_SCHEDULE.OPTIONS.map(function (o) { return '<option value="' + o.id + '">' + esc(o.label) + '</option>'; }).join('');
    sel.value = syncScheduleSelectedId;
    var note = $('syncScheduleCurrentNote'); if (note) note.textContent = 'Currently synchronizing: ' + APSQL_SYNC_SCHEDULE.getOption(syncScheduleSelectedId).label + '.';
  }
  renderSyncScheduleSelect();
  if ($('syncScheduleSelect')) $('syncScheduleSelect').addEventListener('change', function () { syncScheduleSelectedId = $('syncScheduleSelect').value; APSQL_SYNC_SCHEDULE.saveSelectedOptionId(null, syncScheduleSelectedId); applySyncScheduleInterval(); renderSyncScheduleSelect(); });

  /* ------------------------------------------------------------------ *
   * Secure vault
   * ------------------------------------------------------------------ */
  function renderVaultStatus(transientNote) {
    var box = $('vaultStatusBody'); if (!box) return;
    var text = transientNote || (APSQL_VAULT.isSupported() ? 'No vault has been published in this session yet. Fill in the GitHub connection above, enter a passphrase, and click "Encrypt & Publish Vault".' : 'This browser does not support the Web Crypto API required for the secure credential vault.');
    box.innerHTML = '<div class="shared-schema-strip">' + esc(text) + '</div>';
  }
  function refreshVaultControlAvailability() {
    var unsupportedNote = $('vaultUnsupportedNote'), controls = $('vaultControls'); if (!unsupportedNote || !controls) return;
    var supported = APSQL_VAULT.isSupported();
    unsupportedNote.classList.toggle('d-none', supported);
    if (!supported) unsupportedNote.textContent = 'This browser does not support the Web Crypto API (SubtleCrypto) required to encrypt or decrypt the credential vault.';
    controls.classList.toggle('d-none', !supported);
    if ($('publishVaultBtn')) $('publishVaultBtn').disabled = !githubConfig;
  }
  renderVaultStatus(); refreshVaultControlAvailability();
  if ($('publishVaultBtn')) $('publishVaultBtn').addEventListener('click', function () {
    var passphrase = $('vaultPassphraseInput').value, resultBox = $('vaultResultBox');
    if (!githubConfig) { resultBox.innerHTML = '<div class="alert alert-warning small">Connect GitHub-Hosted Schema Sync above first.</div>'; return; }
    if (!passphrase) { resultBox.innerHTML = '<div class="alert alert-warning small">Please enter a vault passphrase.</div>'; return; }
    resultBox.innerHTML = '<div class="text-body-secondary small">Encrypting and publishing the vault…</div>';
    APSQL_VAULT.buildVaultBlob(githubConfig, passphrase).then(function (blobText) {
      var vaultPath = githubConfig.path.replace(/(\.[^./]+)?$/, '') + '.vault.json';
      var vaultGithubConfig = Object.assign({}, githubConfig, { path: vaultPath });
      return APSQL_GITHUB_SYNC.fetchRawJsonFile(vaultGithubConfig).then(function (existing) { return APSQL_GITHUB_SYNC.pushSchemaToGitHub(vaultGithubConfig, JSON.parse(blobText), existing.exists ? existing.sha : null); })
        .then(function () { renderVaultStatus('Vault published to ' + vaultGithubConfig.path + '. Share the passphrase with authorized users out-of-band.'); resultBox.innerHTML = '<div class="alert alert-success small">Vault encrypted and published successfully.</div>'; $('vaultPassphraseInput').value = ''; });
    }).catch(function (err) { renderVaultStatus('Could not publish the vault: ' + err.message); resultBox.innerHTML = '<div class="alert alert-danger small">' + esc(err.message) + '</div>'; });
  });
  if ($('unlockVaultBtn')) $('unlockVaultBtn').addEventListener('click', function () {
    var passphrase = $('vaultUnlockPassphraseInput').value, resultBox = $('vaultResultBox');
    var pathInput = ($('githubPathInput').value || SHARED_SCHEMA_PATH).trim();
    var vaultPath = pathInput.replace(/(\.[^./]+)?$/, '') + '.vault.json';
    var owner = ($('githubOwnerInput').value || '').trim(), repo = ($('githubRepoInput').value || '').trim(), branch = ($('githubBranchInput').value || 'main').trim() || 'main';
    /* V10.7.1 fix retained: send whatever real token is typed (if any); an
       empty token performs an anonymous GitHub read instead of a fabricated
       placeholder credential. */
    var typedToken = ($('githubTokenInput').value || '').trim();
    if (!owner || !repo) { resultBox.innerHTML = '<div class="alert alert-warning small">Please fill in at least the repository owner and name above.</div>'; return; }
    if (!passphrase) { resultBox.innerHTML = '<div class="alert alert-warning small">Please enter the vault passphrase to unlock.</div>'; return; }
    resultBox.innerHTML = '<div class="text-body-secondary small">Fetching and unlocking the vault…</div>';
    var lookupConfig = { owner: owner, repo: repo, branch: branch, path: vaultPath }; if (typedToken) lookupConfig.token = typedToken;
    APSQL_GITHUB_SYNC.fetchRawJsonFile(lookupConfig).then(function (result) {
      if (!result.exists) throw new Error('No vault file was found at ' + vaultPath + '. Ask an administrator to publish one first.');
      return APSQL_VAULT.decryptConfig(result.content, passphrase);
    }).then(function (decryptedConfig) {
      $('githubOwnerInput').value = decryptedConfig.owner || ''; $('githubRepoInput').value = decryptedConfig.repo || ''; $('githubBranchInput').value = decryptedConfig.branch || 'main'; $('githubPathInput').value = decryptedConfig.path || ''; $('githubTokenInput').value = decryptedConfig.token || '';
      resultBox.innerHTML = '<div class="alert alert-success small">Vault unlocked. Click "Connect &amp; Sync Now" above to activate this connection.</div>';
      $('vaultUnlockPassphraseInput').value = '';
    }).catch(function (err) { resultBox.innerHTML = '<div class="alert alert-danger small">' + esc(err.message) + '</div>'; });
  });

  /* ------------------------------------------------------------------ *
   * Operational password
   * ------------------------------------------------------------------ */
  var passwordManager = APSQL_PASSWORD_MANAGER.createPasswordManager();
  function renderPasswordCustomNote() { var note = $('passwordCustomStatusNote'); if (!note) return; note.textContent = passwordManager.isCustomPasswordSet() ? '(A custom password is currently set in this browser.)' : '(Currently using the default password for this browser.)'; }
  renderPasswordCustomNote();
  if ($('changePasswordBtn')) $('changePasswordBtn').addEventListener('click', function () {
    var current = $('currentPasswordInput').value, next = $('newPasswordInput').value, confirmNext = $('confirmNewPasswordInput').value, resultBox = $('passwordChangeResultBox');
    passwordManager.changePassword(current, next, confirmNext).then(function (result) {
      if (!result.ok) { resultBox.innerHTML = '<div class="alert alert-danger small">' + esc(result.error) + '</div>'; return; }
      resultBox.innerHTML = '<div class="alert alert-success small">The operational password has been changed successfully in this browser.</div>';
      $('currentPasswordInput').value = ''; $('newPasswordInput').value = ''; $('confirmNewPasswordInput').value = ''; renderPasswordCustomNote();
    });
  });

  /* ------------------------------------------------------------------ *
   * Schema persistence status + stored-schema list
   * ------------------------------------------------------------------ */
  function persistCurrentSchema() { schemaStore.persist(); syncWriteCurrentSchemaIfLinked(); pushToGithubIfConfigured(); }
  function renderSchemaPersistenceStatus() {
    var el = $('schemaPersistenceStatus'); if (!el) return;
    var entry = schemaStore.getActiveEntry();
    el.innerHTML = 'Currently working with <strong>' + esc(entry ? entry.name : 'an unnamed schema') + '</strong> (' + schemaStore.count() + ' schema' + (schemaStore.count() === 1 ? '' : 's') + ' stored in this browser). Changes are saved automatically.';
  }
  renderSchemaPersistenceStatus();

  function renderSchemaStoreList() {
    var box = $('schemaStoreList'); if (!box) return; box.innerHTML = '';
    var entries = schemaStore.listEntries();
    if (!entries.length) { box.innerHTML = '<div class="text-body-secondary small">No schemas stored yet. Add one under Update Schema.</div>'; return; }
    var activeId = schemaStore.getActiveId();
    entries.forEach(function (e) {
      var st = APSQL.createEngine(e.schema).getStatus();
      var isActive = e.id === activeId;
      var item = document.createElement('div'); item.className = 'd-flex flex-wrap align-items-center justify-content-between gap-2 border rounded p-2 mb-2' + (isActive ? ' border-primary' : '');
      var main = document.createElement('div');
      main.innerHTML = '<div class="fw-semibold">' + esc(e.name) + (isActive ? ' <span class="badge text-bg-primary">Active</span>' : '') + '</div><div class="small text-body-secondary">Version: ' + esc(st.schemaVersion || '—') + ' · Tables: ' + st.tableCount + ' · Source: ' + esc(e.source) + '</div>';
      item.appendChild(main);
      if (!isActive) {
        var selectBtn = document.createElement('button'); selectBtn.type = 'button'; selectBtn.className = 'btn btn-outline-primary btn-sm schema-store-select-btn'; selectBtn.textContent = 'Set Active';
        selectBtn.addEventListener('click', function () { schemaStore.setActiveId(e.id); rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderSchemaStoreList(); });
        item.appendChild(selectBtn);
      }
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
  if ($('targetSchemaSelect')) $('targetSchemaSelect').addEventListener('change', function () { targetSchemaId = $('targetSchemaSelect').value; });
  function targetSchemaEntry() { return schemaStore.getEntry(targetSchemaId) || schemaStore.getActiveEntry(); }
  if ($('showAddSchemaFormBtn')) $('showAddSchemaFormBtn').addEventListener('click', function () { $('addSchemaFormBox').classList.remove('d-none'); $('newSchemaNameInput').value = ''; $('newSchemaNameInput').focus(); });
  if ($('cancelAddSchemaBtn')) $('cancelAddSchemaBtn').addEventListener('click', function () { $('addSchemaFormBox').classList.add('d-none'); });
  if ($('confirmAddSchemaBtn')) $('confirmAddSchemaBtn').addEventListener('click', function () {
    var name = ($('newSchemaNameInput').value || '').trim(); if (!name) { $('newSchemaNameInput').focus(); return; }
    var entry = schemaStore.addEntry({ name: name, schema: { schema_name: name, schema_version: '0.0', tables: [] }, source: 'upload' });
    targetSchemaId = entry.id; $('addSchemaFormBox').classList.add('d-none'); renderTargetSchemaSelect(); renderSchemaStoreList();
  });
  if ($('deleteTargetSchemaBtn')) $('deleteTargetSchemaBtn').addEventListener('click', function () {
    if (schemaStore.count() <= 1) { alert('At least one schema must remain stored. Add another schema before removing this one.'); return; }
    $('deleteStoredSchemaPasswordInput').value = ''; $('deleteStoredSchemaPasswordError').classList.add('d-none');
    if (deleteStoredSchemaModal) deleteStoredSchemaModal.show();
  });
  var deleteStoredSchemaModalEl = $('deleteStoredSchemaModal');
  var deleteStoredSchemaModal = window.bootstrap ? new window.bootstrap.Modal(deleteStoredSchemaModalEl) : null;
  if ($('confirmDeleteStoredSchemaBtn')) $('confirmDeleteStoredSchemaBtn').addEventListener('click', function () {
    passwordManager.verifyCurrentPassword($('deleteStoredSchemaPasswordInput').value).then(function (ok) {
      if (!ok) { $('deleteStoredSchemaPasswordError').classList.remove('d-none'); return; }
      schemaStore.removeEntry(targetSchemaId); targetSchemaId = schemaStore.getActiveId(); rebuildEngine();
      refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderSchemaStoreList(); renderTargetSchemaSelect();
      if (deleteStoredSchemaModal) deleteStoredSchemaModal.hide();
    });
  });

  /* ------------------------------------------------------------------ *
   * Navbar height / theme / navigation
   * ------------------------------------------------------------------ */
  function moduleLabels() { return engine.getModuleLabels(); }
  function allTables() { return engine.getAllTables().slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }); }
  function syncNavbarOffset() { var navbar = $('mainNavbar'); if (!navbar) return; document.documentElement.style.setProperty('--navbar-h', navbar.offsetHeight + 'px'); }
  syncNavbarOffset(); window.addEventListener('resize', syncNavbarOffset); window.addEventListener('load', syncNavbarOffset);

  var THEME_KEY = 'ap_sql_theme';
  function systemPrefersDark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
  function applyTheme(choice) { document.documentElement.setAttribute('data-bs-theme', choice === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : choice); }
  function setTheme(choice) { try { localStorage.setItem(THEME_KEY, choice); } catch (e) {} applyTheme(choice); }
  (function initTheme() {
    var saved = 'auto'; try { saved = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) {}
    applyTheme(saved);
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { var current = 'auto'; try { current = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) {} if (current === 'auto') applyTheme('auto'); });
  })();
  document.querySelectorAll('[data-theme]').forEach(function (btn) { btn.addEventListener('click', function () { setTheme(btn.getAttribute('data-theme')); }); });

  var offcanvasEl = $('mainMenu'); var offcanvasInstance = window.bootstrap ? new window.bootstrap.Offcanvas(offcanvasEl) : null;
  function closeMenu() { if (offcanvasInstance) offcanvasInstance.hide(); }
  var currentView = 'quickstart';
  function showView(view) {
    document.querySelectorAll('.offcanvas-body > button.nav-link, .menu-submenu .nav-link').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    document.querySelectorAll('.app-view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    window.scrollTo(0, 0); currentView = view;
    if (view === 'usedschema') { renderUsedSchema(); renderSchemaStoreList(); }
    if (window.APSQL_TOUR && APSQL_TOUR.hasTour(view) && !APSQL_TOUR.hasSeen(view)) setTimeout(function () { APSQL_TOUR.start(view); }, 350);
  }
  document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function () { showView(b.getAttribute('data-view')); closeMenu(); }); });
  document.querySelectorAll('[data-tour-trigger]').forEach(function (b) { b.addEventListener('click', function () { closeMenu(); if (window.APSQL_TOUR) APSQL_TOUR.start(currentView); }); });

  function makeCollapsible(toggleId, submenuId) { var toggle = $(toggleId), submenu = $(submenuId); if (!toggle || !submenu) return; toggle.addEventListener('click', function () { toggle.classList.toggle('open'); submenu.classList.toggle('open'); }); }
  makeCollapsible('queryBuilderMenuToggle', 'queryBuilderSubmenu'); makeCollapsible('schemaMenuToggle', 'schemaSubmenu'); makeCollapsible('themeMenuToggle', 'themeSubmenu');

  document.querySelectorAll('#manualTabs .nav-link').forEach(function (t) {
    t.addEventListener('click', function () {
      var name = t.getAttribute('data-tab');
      document.querySelectorAll('#manualTabs .nav-link').forEach(function (x) { x.classList.toggle('active', x === t); });
      document.querySelectorAll('.tab-pane-manual').forEach(function (p) { var show = p.id === 'pane-' + name; p.classList.toggle('d-none', !show); p.classList.toggle('active', show); });
      if (name === 'requirements') renderRequirementsSummary();
    });
  });

  /* ------------------------------------------------------------------ *
   * Quick start
   * ------------------------------------------------------------------ */
  var QUICK_EXAMPLES = [
    { ic: '👤', title: 'Users whose login is allowed', desc: 'A simple single-table filter — resolved automatically.', text: 'Show all users whose login is allowed.' },
    { ic: '✅', title: 'Active users, group & exclusion', desc: 'Multi-table join, filter, exclusion, and sort — all automatic.', text: 'Show all active users with their email address and user group, exclude Basware users, and sort by login account.' },
    { ic: '🏦', title: 'Active suppliers', desc: 'Table + columns + filter, identified from plain language.', text: 'Show supplier name and supplier code for active suppliers.' },
    { ic: '💰', title: 'Total invoiced per supplier', desc: 'Aggregation (SUM) with an automatic GROUP BY and join.', text: 'Show the total gross amount grouped by supplier.' },
    { ic: '📧', title: 'Supplier email addresses', desc: 'Maps everyday wording to the right schema column.', text: 'Show the supplier email address.' },
    { ic: '🌐', title: 'Supervisor chain (recursive)', desc: 'Walk the whole reporting hierarchy in one query.', hierarchy: 'ADM_USER_DATA' }
  ];
  (function initQuickStart() {
    var grid = $('qsExampleGrid'); if (!grid) return;
    grid.innerHTML = QUICK_EXAMPLES.map(function (q, i) {
      return '<div class="col"><div class="card qs-example-card h-100" data-i="' + i + '"><div class="card-body">' +
        '<div class="qs-icon-badge icon-badge badge-blue mb-2">' + q.ic + '</div>' +
        '<h3 class="h6">' + esc(q.title) + '</h3><p class="small text-body-secondary mb-0">' + esc(q.desc) + '</p>' +
        '</div></div></div>';
    }).join('');
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
    var el = $('qsModuleChips'); if (!el) return;
    var counts = {}; allTables().forEach(function (t) { counts[t.module] = (counts[t.module] || 0) + 1; });
    var labels = moduleLabels();
    el.innerHTML = Object.keys(counts).sort().map(function (m) { return '<span class="badge module-chip text-bg-light border">' + esc(labels[m] || m) + ' · ' + counts[m] + '</span>'; }).join('');
  }

  /* ------------------------------------------------------------------ *
   * Read Only Query Builder — Tables & Columns
   * ------------------------------------------------------------------ */
  var selectedTables = [];
  var columnState = {};
  function refreshModuleDropdown() {
    var sel = $('moduleFilterSel'); var labels = moduleLabels(); var counts = {};
    allTables().forEach(function (t) { counts[t.module] = (counts[t.module] || 0) + 1; });
    sel.innerHTML = '<option value="">All Modules</option>' + Object.keys(counts).sort().map(function (m) { return '<option value="' + m + '">' + esc(labels[m] || m) + ' (' + counts[m] + ')</option>'; }).join('');
  }
  function visibleTableNames() {
    var moduleFilter = $('moduleFilterSel').value; var searchFilter = ($('tableSearchInput').value || '').toLowerCase();
    return allTables().filter(function (t) { if (moduleFilter && t.module !== moduleFilter) return false; if (searchFilter && (t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(searchFilter) === -1) return false; return true; }).map(function (t) { return t.name; });
  }
  function renderTableList() {
    var moduleFilter = $('moduleFilterSel').value; var searchFilter = ($('tableSearchInput').value || '').toLowerCase();
    var grid = $('tableListGrid'); grid.innerHTML = '';
    allTables().forEach(function (t) {
      if (moduleFilter && t.module !== moduleFilter) return;
      if (searchFilter && (t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(searchFilter) === -1) return;
      var col = document.createElement('div'); col.className = 'form-check';
      var checked = selectedTables.indexOf(t.name) !== -1;
      col.innerHTML = '<input class="form-check-input" type="checkbox" id="tblchk_' + t.name + '" ' + (checked ? 'checked' : '') + '><label class="form-check-label" for="tblchk_' + t.name + '"><code>' + t.name + '</code> <span class="text-body-secondary small">(' + t.module + ')</span></label>';
      col.querySelector('input').addEventListener('change', function (e) { toggleTable(t.name, e.target.checked); });
      grid.appendChild(col);
    });
  }
  function toggleTable(name, on) {
    var idx = selectedTables.indexOf(name);
    if (on && idx === -1) selectedTables.push(name);
    if (!on && idx !== -1) { selectedTables.splice(idx, 1); delete columnState[name]; }
    refreshTableSelCount(); refreshSelectedTableDropdown(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows();
  }
  function refreshTableSelCount() { $('tableSelCount').textContent = selectedTables.length + ' table' + (selectedTables.length === 1 ? '' : 's') + ' selected'; }
  $('moduleFilterSel').addEventListener('change', renderTableList);
  $('tableSearchInput').addEventListener('input', renderTableList);
  $('tableSelectAllBtn').addEventListener('click', function () { visibleTableNames().forEach(function (n) { if (selectedTables.indexOf(n) === -1) selectedTables.push(n); }); refreshTableSelCount(); refreshSelectedTableDropdown(); renderTableList(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); });
  $('tableUnselectAllBtn').addEventListener('click', function () { selectedTables = []; columnState = {}; refreshTableSelCount(); refreshSelectedTableDropdown(); renderTableList(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); });
  function refreshSelectedTableDropdown() {
    var sel = $('selectedTableDropdown'); var current = sel.value;
    sel.innerHTML = '<option value="">Selected Table ▾</option>' + selectedTables.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
    if (selectedTables.indexOf(current) !== -1) sel.value = current; else if (selectedTables.length) sel.value = selectedTables[0];
  }
  $('selectedTableDropdown').addEventListener('change', renderColumnList);
  function ensureColState(tname) { if (!columnState[tname]) columnState[tname] = {}; return columnState[tname]; }
  function buildColumnRow(tname, col) {
    var state = ensureColState(tname);
    if (!state[col.name]) state[col.name] = { checked: false, alias: col.alias || '', decode: false, elseMode: 'convert' };
    var s = state[col.name];
    var row = document.createElement('div'); row.className = 'column-row-grid' + (s.checked ? ' on' : '');
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input col-check'; cb.checked = s.checked;
    var nameWrap = document.createElement('div'); nameWrap.className = 'col-name';
    var badgeText = col.primary_key ? 'PK' : (col.foreign_key ? 'FK' : (col.type || '').split('(')[0]);
    nameWrap.innerHTML = '<code>' + col.name + '</code> <span class="badge text-bg-light border">' + esc(badgeText) + '</span>' + (col.description ? '<div class="small text-body-secondary">' + esc(col.description) + '</div>' : '');
    var aliasInput = document.createElement('input'); aliasInput.type = 'text'; aliasInput.className = 'form-control form-control-sm col-alias'; aliasInput.placeholder = 'rename (optional)'; aliasInput.value = s.alias; aliasInput.disabled = !s.checked;
    var decodeWrap = document.createElement('div'); decodeWrap.className = 'd-flex align-items-center gap-1 col-decode' + (!s.checked ? ' disabled' : '');
    var decodeCb = document.createElement('input'); decodeCb.type = 'checkbox'; decodeCb.className = 'form-check-input mt-0'; decodeCb.checked = s.decode; decodeCb.disabled = !s.checked;
    var decodeLabel = document.createElement('span'); decodeLabel.className = 'small text-body-secondary'; decodeLabel.textContent = 'Decode';
    decodeWrap.appendChild(decodeCb); decodeWrap.appendChild(decodeLabel);
    function refreshAccess() { row.classList.toggle('on', cb.checked); aliasInput.disabled = !cb.checked; decodeCb.disabled = !cb.checked; decodeWrap.classList.toggle('disabled', !cb.checked); }
    cb.addEventListener('change', function () { s.checked = cb.checked; if (!cb.checked) { s.decode = false; decodeCb.checked = false; } refreshAccess(); refreshFilterColumnOptions(); });
    aliasInput.addEventListener('input', function () { s.alias = aliasInput.value.trim(); });
    decodeCb.addEventListener('change', function () { s.decode = decodeCb.checked; });
    row.appendChild(cb); row.appendChild(nameWrap); row.appendChild(aliasInput); row.appendChild(decodeWrap);
    refreshAccess();
    return row;
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
    cols.forEach(function (c) { body.appendChild(buildColumnRow(tname, c)); });
  }
  $('columnSearchInput').addEventListener('input', renderColumnList);
  $('columnSelectAllBtn').addEventListener('click', function () { var tname = $('selectedTableDropdown').value; if (!tname) return; var table = engine.getTable(tname); var state = ensureColState(tname); table.columns.forEach(function (c) { if (!state[c.name]) state[c.name] = { checked: false, alias: c.alias || '', decode: false, elseMode: 'convert' }; state[c.name].checked = true; }); renderColumnList(); refreshFilterColumnOptions(); });
  $('columnUnselectAllBtn').addEventListener('click', function () { var tname = $('selectedTableDropdown').value; if (!tname) return; var state = ensureColState(tname); Object.keys(state).forEach(function (k) { state[k].checked = false; state[k].decode = false; }); renderColumnList(); refreshFilterColumnOptions(); });

  function refreshTablesColumnsUI() { refreshModuleDropdown(); renderTableList(); refreshTableSelCount(); refreshSelectedTableDropdown(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); renderExistsRows(); renderScalarRows(); }
  function refreshHierarchyOptions() {
    var sel = $('optHierarchy'); var current = sel.value; var opts = ['<option value="">— none —</option>'];
    allTables().forEach(function (t) { if (engine.getSelfReferencingEdges(t.name).length > 0) opts.push('<option value="' + t.name + '">' + t.name + '</option>'); });
    sel.innerHTML = opts.join(''); if (allTables().some(function (t) { return t.name === current; })) sel.value = current;
  }
  function columnOptionsForTables(tableNames) {
    var opts = [];
    (tableNames && tableNames.length ? tableNames : allTables().map(function (t) { return t.name; })).forEach(function (tname) { var t = engine.getTable(tname); if (!t) return; t.columns.forEach(function (c) { opts.push({ table: tname, column: c.name }); }); });
    return opts;
  }

  /* ------------------------------------------------------------------ *
   * Filter group renderer (shared between Read-Only and CR builders)
   * ------------------------------------------------------------------ */
  function renderFilterGroup(containerEl, filterGroup, availableTables, onChange) {
    containerEl.innerHTML = '';
    var colOptions = columnOptionsForTables(availableTables);
    if (!colOptions.length) { containerEl.innerHTML = '<div class="text-body-secondary small">Select at least one table first to build filter conditions.</div>'; return; }
    filterGroup.conditions.forEach(function (cond, idx) {
      var row = document.createElement('div'); row.className = 'filter-condition-row';
      var joinSel = document.createElement('select'); joinSel.className = 'form-select form-select-sm'; joinSel.style.maxWidth = '80px';
      joinSel.innerHTML = '<option value="AND">AND</option><option value="OR">OR</option>'; joinSel.value = cond.join || 'AND'; joinSel.style.visibility = idx === 0 ? 'hidden' : 'visible';
      joinSel.addEventListener('change', function () { cond.join = joinSel.value; onChange(); });
      var colSel = document.createElement('select'); colSel.className = 'form-select form-select-sm';
      colSel.innerHTML = colOptions.map(function (o) { var val = o.table + '.' + o.column; return '<option value="' + val + '">' + o.table + '.' + o.column + '</option>'; }).join('');
      colSel.value = (cond.table ? cond.table + '.' : '') + cond.column;
      colSel.addEventListener('change', function () { var parts = colSel.value.split('.'); cond.table = parts[0]; cond.column = parts[1]; onChange(); });
      var opSel = document.createElement('select'); opSel.className = 'form-select form-select-sm';
      opSel.innerHTML = APSQL_FILTER.OPERATORS.map(function (o) { return '<option value="' + o.id + '">' + o.label + '</option>'; }).join(''); opSel.value = cond.operator;
      var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm'; valInput.placeholder = 'Value'; valInput.value = cond.value || '';
      var val2Input = document.createElement('input'); val2Input.className = 'form-control form-control-sm'; val2Input.placeholder = 'and...'; val2Input.value = cond.value2 || '';
      function refreshArity() { var op = APSQL_FILTER.getOperator(opSel.value); valInput.style.display = op.arity >= 1 ? '' : 'none'; val2Input.style.display = op.arity === 2 ? '' : 'none'; valInput.placeholder = op.multi ? 'value1, value2, ...' : 'Value'; }
      opSel.addEventListener('change', function () { cond.operator = opSel.value; refreshArity(); onChange(); });
      valInput.addEventListener('input', function () { cond.value = valInput.value; });
      val2Input.addEventListener('input', function () { cond.value2 = val2Input.value; });
      refreshArity();
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm filter-remove-btn'; rmBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
      rmBtn.addEventListener('click', function () { filterGroup.conditions.splice(idx, 1); onChange(); renderFilterGroup(containerEl, filterGroup, availableTables, onChange); });
      row.appendChild(joinSel); row.appendChild(colSel); row.appendChild(opSel); row.appendChild(valInput); row.appendChild(val2Input); row.appendChild(rmBtn);
      containerEl.appendChild(row);
    });
  }
  var readOnlyFilterGroup = { conditions: [] };
  function refreshFilterColumnOptions() { renderFilterGroup($('readOnlyFilterGroup'), readOnlyFilterGroup, selectedTables, function () {}); }
  $('readOnlyAddFilterBtn').addEventListener('click', function () { var firstTable = selectedTables[0]; var firstCol = firstTable ? engine.getTable(firstTable).columns[0].name : ''; readOnlyFilterGroup.conditions.push(APSQL_FILTER.newCondition({ table: firstTable, column: firstCol })); refreshFilterColumnOptions(); });
  $('readOnlyClearFiltersBtn').addEventListener('click', function () { readOnlyFilterGroup.conditions = []; refreshFilterColumnOptions(); });

  /* ------------------------------------------------------------------ *
   * Join preview / relationship definition
   * ------------------------------------------------------------------ */
  function updateJoinCardVisibility() { var card = $('joinOptionCard'); if (!card) return; if (selectedTables.length < 2) { card.classList.add('d-none'); $('optJoinInner').checked = true; syncJoinChoiceHighlight(); } else card.classList.remove('d-none'); }
  function syncJoinChoiceHighlight() { $('optJoinInnerLabel').classList.toggle('active', $('optJoinInner').checked); $('optJoinLeftLabel').classList.toggle('active', $('optJoinLeft').checked); }
  document.querySelectorAll('input[name="joinType"]').forEach(function (r) { r.addEventListener('change', syncJoinChoiceHighlight); });
  $('joinResetBtn').addEventListener('click', function () { $('optJoinInner').checked = true; syncJoinChoiceHighlight(); });
  syncJoinChoiceHighlight();
  var relationshipDrafts = {};
  function ensureRelationshipDraft(tableName, candidatePartners) {
    if (!relationshipDrafts[tableName]) { var partner = candidatePartners[0] || ''; var partnerTbl = engine.getTable(partner); var thisTbl = engine.getTable(tableName); relationshipDrafts[tableName] = { partnerTable: partner, thisColumn: thisTbl && thisTbl.columns[0] ? thisTbl.columns[0].name : '', partnerColumn: partnerTbl && partnerTbl.columns[0] ? partnerTbl.columns[0].name : '' }; }
    return relationshipDrafts[tableName];
  }
  function renderJoinPreview() {
    updateJoinCardVisibility();
    var previewBox = $('joinPreviewBox'), defineBox = $('defineRelationshipContainer'); if (!previewBox || !defineBox) return;
    if (selectedTables.length < 2) { previewBox.innerHTML = '<span class="text-body-secondary">Select two or more tables to see how they\u2019ll be connected.</span>'; defineBox.innerHTML = ''; return; }
    var plan = APSQL_ENGINE.buildJoinPlan(engine, selectedTables);
    var lines = plan.joins.map(function (j) { return '<div>✅ <code>' + j.on.fromTable + '</code> → <code>' + j.on.toTable + '</code> using <code>' + j.on.fromColumn + ' = ' + j.on.toColumn + '</code></div>'; });
    if (!lines.length) lines.push('<div class="text-body-secondary">No connections established yet.</div>');
    previewBox.innerHTML = lines.join('');
    defineBox.innerHTML = '';
    plan.unresolved.forEach(function (tname) { var candidatePartners = selectedTables.filter(function (t) { return t !== tname; }); var draft = ensureRelationshipDraft(tname, candidatePartners); defineBox.appendChild(buildDefineRelationshipPanel(tname, candidatePartners, draft)); });
  }
  function buildDefineRelationshipPanel(tableName, candidatePartners, draft) {
    var box = document.createElement('div'); box.className = 'border rounded p-2 mt-2';
    box.innerHTML = '<div class="fw-semibold small">⚠️ Could not automatically connect: <code>' + tableName + '</code></div><p class="small text-body-secondary mb-2">Pick which table it connects to, and which column on each side matches.</p>';
    var row = document.createElement('div'); row.className = 'd-flex flex-wrap gap-2 align-items-center';
    var partnerSel = document.createElement('select'); partnerSel.className = 'form-select form-select-sm'; partnerSel.style.maxWidth = '160px';
    partnerSel.innerHTML = candidatePartners.map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join(''); partnerSel.value = draft.partnerTable;
    var thisColSel = document.createElement('select'); thisColSel.className = 'form-select form-select-sm'; thisColSel.style.maxWidth = '160px';
    var partnerColSel = document.createElement('select'); partnerColSel.className = 'form-select form-select-sm'; partnerColSel.style.maxWidth = '160px';
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
    row.appendChild(document.createTextNode('connects to')); row.appendChild(partnerSel); row.appendChild(document.createTextNode('on column ' + tableName + '.')); row.appendChild(thisColSel); row.appendChild(document.createTextNode('=')); row.appendChild(partnerColSel);
    box.appendChild(row);
    var actions = document.createElement('div'); actions.className = 'mt-2 d-flex gap-2 flex-wrap';
    var useBtn = document.createElement('button'); useBtn.type = 'button'; useBtn.className = 'btn btn-outline-primary btn-sm'; useBtn.textContent = 'Use for this query';
    useBtn.addEventListener('click', function () { relationshipStore.setManualRelationship(tableName, thisColSel.value, partnerSel.value, partnerColSel.value); renderJoinPreview(); });
    var saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'btn btn-outline-success btn-sm'; saveBtn.textContent = 'Save relationship to schema';
    saveBtn.addEventListener('click', function () {
      pendingSaveRelationshipDraft = { fromTable: tableName, fromColumn: thisColSel.value, toTable: partnerSel.value, toColumn: partnerColSel.value };
      $('saveRelationshipSummary').innerHTML = '<code>' + tableName + '.' + thisColSel.value + '</code> → <code>' + partnerSel.value + '.' + partnerColSel.value + '</code>';
      $('saveRelationshipPasswordInput').value = ''; $('saveRelationshipPasswordError').classList.add('d-none');
      if (saveRelationshipModal) saveRelationshipModal.show();
    });
    actions.appendChild(useBtn); actions.appendChild(saveBtn); box.appendChild(actions);
    return box;
  }
  var pendingSaveRelationshipDraft = null;
  var saveRelationshipModalEl = $('saveRelationshipModal'); var saveRelationshipModal = window.bootstrap ? new window.bootstrap.Modal(saveRelationshipModalEl) : null;
  $('confirmSaveRelationshipBtn').addEventListener('click', function () {
    if (!pendingSaveRelationshipDraft) return;
    passwordManager.verifyCurrentPassword($('saveRelationshipPasswordInput').value).then(function (ok) {
      if (!ok) { $('saveRelationshipPasswordError').classList.remove('d-none'); return; }
      var d = pendingSaveRelationshipDraft; var updatedSchema;
      try { updatedSchema = window.APSQL_SCHEMA_TOOLS.saveRelationshipToSchema(currentSchema(), d.fromTable, d.fromColumn, d.toTable, d.toColumn); }
      catch (err) { $('saveRelationshipPasswordError').classList.remove('d-none'); $('saveRelationshipPasswordError').textContent = err.message; return; }
      setActiveSchemaObject(updatedSchema); relationshipStore.clearManualRelationship(d.fromTable, d.toTable); delete relationshipDrafts[d.fromTable];
      rebuildEngine(); persistCurrentSchema(); renderSchemaPersistenceStatus(); refreshAllViewsAfterSchemaChange(); renderJoinPreview();
      if (saveRelationshipModal) saveRelationshipModal.hide(); pendingSaveRelationshipDraft = null;
    });
  });

  /* ------------------------------------------------------------------ *
   * Sort / EXISTS / scalar-count rows
   * ------------------------------------------------------------------ */
  var sortRows = [];
  function renderSortRows() {
    var container = $('sortRowsContainer'); if (!container) return; container.innerHTML = '';
    var colOptions = columnOptionsForTables(selectedTables);
    if (!colOptions.length) { container.innerHTML = '<div class="small text-body-secondary">Select at least one table first.</div>'; return; }
    if (!sortRows.length) { container.innerHTML = '<div class="small text-body-secondary">No sort columns added yet.</div>'; return; }
    sortRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row';
      var colSel = document.createElement('select'); colSel.className = 'form-select form-select-sm';
      colSel.innerHTML = colOptions.map(function (o) { var val = o.table + '.' + o.column; return '<option value="' + val + '">' + o.table + '.' + o.column + '</option>'; }).join('');
      colSel.value = (row.table ? row.table + '.' : '') + row.column;
      colSel.addEventListener('change', function () { var parts = colSel.value.split('.'); row.table = parts[0]; row.column = parts[1]; });
      var dirSel = document.createElement('select'); dirSel.className = 'form-select form-select-sm';
      dirSel.innerHTML = '<option value="ASC">Smallest / earliest first</option><option value="DESC">Largest / latest first</option>'; dirSel.value = row.direction || 'ASC';
      dirSel.addEventListener('change', function () { row.direction = dirSel.value; });
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm filter-remove-btn'; rmBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
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
    if (!existsRows.length) { container.innerHTML = '<div class="small text-body-secondary">No related-table checks added yet.</div>'; return; }
    existsRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row';
      var tblSel = document.createElement('select'); tblSel.className = 'form-select form-select-sm';
      tblSel.innerHTML = tbls.map(function (t) { return '<option value="' + t.name + '">' + t.name + '</option>'; }).join(''); tblSel.value = row.relatedTable || (tbls[0] ? tbls[0].name : '');
      tblSel.addEventListener('change', function () { row.relatedTable = tblSel.value; });
      var negWrap = document.createElement('div'); negWrap.className = 'form-check d-flex align-items-center gap-1';
      var negCb = document.createElement('input'); negCb.type = 'checkbox'; negCb.className = 'form-check-input mt-0'; negCb.checked = !!row.negate;
      negCb.addEventListener('change', function () { row.negate = negCb.checked; });
      var negLabel = document.createElement('label'); negLabel.className = 'form-check-label small'; negLabel.textContent = 'Opposite (no match)';
      negWrap.appendChild(negCb); negWrap.appendChild(negLabel);
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm filter-remove-btn'; rmBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
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
    if (!scalarRows.length) { container.innerHTML = '<div class="small text-body-secondary">No related counts added yet.</div>'; return; }
    scalarRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row';
      var tblSel = document.createElement('select'); tblSel.className = 'form-select form-select-sm';
      tblSel.innerHTML = tbls.map(function (t) { return '<option value="' + t.name + '">' + t.name + '</option>'; }).join(''); tblSel.value = row.relatedTable || (tbls[0] ? tbls[0].name : '');
      tblSel.addEventListener('change', function () { row.relatedTable = tblSel.value; });
      var label = document.createElement('span'); label.className = 'small text-body-secondary'; label.textContent = 'Count of matching records';
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm filter-remove-btn'; rmBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
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

  /* ------------------------------------------------------------------ *
   * SQL highlighting + suggestions + optimize report
   * ------------------------------------------------------------------ */
  var KW = /\b(SELECT|FROM|WHERE|JOIN|LEFT|INNER|ON|AND|OR|GROUP BY|ORDER BY|HAVING|DISTINCT|AS|TOP|FETCH FIRST|ROWS ONLY|BETWEEN|IN|LIMIT|CASE|WHEN|THEN|ELSE|END|WITH|RECURSIVE|EXISTS|NOT|LIKE|IS NULL|IS NOT NULL|COUNT|SUM|AVG|MIN|MAX)\b/g;
  function highlight(sql) { var e = esc(sql); e = e.replace(/'([^']*)'/g, '<span class="sql-str">\'$1\'</span>'); e = e.replace(KW, '<span class="sql-kw">$1</span>'); return e; }
  function renderSuggestedFixes(message) { var suggestions = APSQL_SUGGEST.buildSuggestions(message); return '<div class="mt-2"><strong>Suggested fixes:</strong><ul class="small mb-0">' + suggestions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>'; }
  function renderOptimizeReport(containerId, opt) {
    var box = $(containerId); if (!box) return; var parts = [];
    if (opt.changesApplied.length) parts.push('<div><strong>Changes applied:</strong><ul class="small mb-2">' + opt.changesApplied.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>');
    if (opt.recommendations.length) parts.push('<div><strong>Recommendations:</strong><ul class="small mb-0">' + opt.recommendations.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>');
    if (!parts.length) parts.push('<div class="small text-body-secondary">No further optimizations detected — this query already looks efficient.</div>');
    box.innerHTML = '<div class="border rounded p-2">' + parts.join('') + '</div>';
  }

  var lastResult = null;
  function renderResult(res) {
    lastResult = res; var body = $('resultBody');
    if (res.status === 'rejected' || res.status === 'clarification_needed') {
      var titleText = res.status === 'rejected' ? 'Could not build this query.' : 'One more detail needed.';
      var alertClass = res.status === 'rejected' ? 'alert-danger' : 'alert-warning';
      body.innerHTML = '<div class="alert ' + alertClass + ' small"><strong>' + titleText + '</strong><div>' + esc(res.message) + '</div></div>' + renderSuggestedFixes(res.message);
      $('copyBtn').classList.add('d-none'); $('optimizeBtn').classList.add('d-none'); $('optimizeReportBox').innerHTML = ''; $('explainBtn').classList.add('d-none'); $('explanationReportBox').innerHTML = ''; $('explanationReportBox').classList.add('d-none');
      return;
    }
    var tables = (res.tablesUsed || []).map(function (t) { return '<span class="badge text-bg-light border me-1">' + t + '</span>'; }).join('');
    var cols = (res.columnsUsed || []).map(function (c) { return '<span class="badge text-bg-light border me-1">' + c.table + '.' + c.column + (c.alias ? ' as ' + c.alias : '') + '</span>'; }).join('');
    var filters = (res.filtersApplied || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') || '<li>None</li>';
    var assumptions = (res.assumptions || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    body.innerHTML = '<div class="alert alert-success small mb-2">✅ Query validated against active schema (' + esc(res.dialect || '') + ', read-only)</div>' +
      '<pre class="sql-output">' + highlight(res.sql) + '</pre>' +
      '<div class="small mt-2"><strong>Tables Used:</strong> ' + (tables || 'None') + '</div>' +
      '<div class="small mt-1"><strong>Columns Used:</strong> ' + (cols || 'None (aggregated query)') + '</div>' +
      '<div class="small mt-1"><strong>Filters Applied:</strong><ul class="mb-1">' + filters + '</ul></div>' +
      (assumptions ? '<div class="small"><strong>Assumptions:</strong><ul class="mb-0">' + assumptions + '</ul></div>' : '');
    $('copyBtn').classList.remove('d-none'); $('optimizeBtn').classList.remove('d-none'); $('optimizeReportBox').innerHTML = ''; $('explainBtn').classList.remove('d-none');
  }
  $('copyBtn').addEventListener('click', function () { if (lastResult && lastResult.status === 'ok') { navigator.clipboard && navigator.clipboard.writeText(lastResult.sql); var old = $('copyBtn').innerHTML; $('copyBtn').innerHTML = '✅ Copied'; setTimeout(function () { $('copyBtn').innerHTML = old; }, 1300); } });
  $('optimizeBtn').addEventListener('click', function () { if (!lastResult || lastResult.status !== 'ok') return; var opt = APSQL_OPTIMIZE.optimizeSql(engine, lastResult); if (opt.hasChanges) { lastResult = Object.assign({}, lastResult, { sql: opt.optimizedSql }); renderResult(lastResult); } renderOptimizeReport('optimizeReportBox', opt); });
  var lastInterpretation = null;
  $('explainBtn').addEventListener('click', function () {
    var box = $('explanationReportBox'); var isHidden = box.classList.contains('d-none');
    if (!isHidden) { box.classList.add('d-none'); return; }
    var lines = lastInterpretation ? APSQL_NLQUERY.explainInterpretation(lastInterpretation) : [];
    box.innerHTML = !lines.length ? '<div class="small text-body-secondary">This query was built manually. Describe your requirement above and click Build Query to see a plain-language explanation here.</div>' : '<div class="small">This query:<ul class="mb-0">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div>';
    box.classList.remove('d-none');
  });

  function renderConfidenceChecklist(interpretation) {
    var box = $('confidenceChecklistBox');
    if (!interpretation || (!interpretation.tables.length && !interpretation.warnings.length)) { box.innerHTML = ''; return; }
    var c = interpretation.confidence || {};
    var items = [{ ok: c.tableIdentified, label: 'Table identified' }, { ok: c.columnsIdentified, label: 'Columns identified' }, { ok: c.relationshipsIdentified, label: 'Relationships identified' }, { ok: !c.hasAmbiguities, label: c.hasAmbiguities ? 'Some terms need clarification' : 'Filters identified' }];
    var html = '<ul class="small mb-1">' + items.map(function (it) { return '<li>' + (it.ok ? '✅' : '⚠️') + ' ' + esc(it.label) + '</li>'; }).join('') + '</ul>';
    if (c.unresolvedJoins && c.unresolvedJoins.length) html += '<div class="alert alert-warning small mb-0">⚠️ Unable to automatically connect: ' + esc(c.unresolvedJoins.join(', ')) + '. Connect these manually in Advanced Options.</div>';
    box.innerHTML = html;
  }
  function renderAmbiguityBox(interpretation) {
    var box = $('ambiguityBox');
    if (!interpretation || !interpretation.ambiguities || !interpretation.ambiguities.length) { box.classList.add('d-none'); box.innerHTML = ''; return; }
    var html = '<div class="alert alert-warning small mb-2">A few terms could mean more than one thing. Please choose the intended condition:</div>';
    interpretation.ambiguities.forEach(function (amb, ai) {
      html += '<div class="mb-2"><strong>"' + esc(amb.term) + '"</strong> could refer to:</div><div class="d-flex flex-wrap gap-2 mb-2">';
      amb.options.forEach(function (opt, oi) { html += '<button type="button" class="btn btn-outline-primary btn-sm ambiguity-option-btn" data-amb="' + ai + '" data-opt="' + oi + '">' + esc(opt.table + '.' + opt.column) + '</button>'; });
      html += '</div>';
    });
    box.innerHTML = html; box.classList.remove('d-none');
    box.querySelectorAll('.ambiguity-option-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ai = +btn.getAttribute('data-amb'), oi = +btn.getAttribute('data-opt');
        var opt = interpretation.ambiguities[ai].options[oi];
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
    parts.push('<h5 class="h6">Describe What You Need</h5>' + (promptText ? '<p class="small">' + esc(promptText) + '</p>' : '<p class="small text-body-secondary">No natural-language requirement provided.</p>'));
    parts.push('<h5 class="h6">Selected Tables</h5>' + (selectedTables.length ? '<p class="small">' + selectedTables.map(esc).join(', ') + '</p>' : '<p class="small text-body-secondary">No tables selected yet.</p>'));
    var anyCols = false, colsHtml = '';
    Object.keys(columnState).forEach(function (tname) {
      var checkedCols = Object.keys(columnState[tname]).filter(function (c) { return columnState[tname][c].checked; });
      if (!checkedCols.length) return; anyCols = true;
      colsHtml += '<div class="small"><code>' + tname + '</code>: ' + checkedCols.map(function (c) { var s = columnState[tname][c]; var extras = []; if (s.alias) extras.push('alias: ' + esc(s.alias)); if (s.decode) extras.push('decode on'); return c + (extras.length ? ' (' + extras.join(', ') + ')' : ''); }).join(', ') + '</div>';
    });
    parts.push('<h5 class="h6 mt-2">Selected Columns</h5>' + (anyCols ? colsHtml : '<p class="small text-body-secondary">No columns selected yet.</p>'));
    var builtFilters = APSQL_FILTER.buildWhereSql(readOnlyFilterGroup, $('dialectSel').value);
    parts.push('<h5 class="h6 mt-2">Filters</h5>' + (builtFilters.plainEnglish ? '<p class="small"><code>' + esc(builtFilters.plainEnglish) + '</code></p>' : '<p class="small text-body-secondary">No filters added yet.</p>'));
    var advLines = describeAdvancedOptions();
    parts.push('<h5 class="h6 mt-2">Advanced Options</h5>' + (advLines.length ? '<ul class="small mb-0">' + advLines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '<p class="small text-body-secondary mb-0">No advanced options enabled.</p>'));
    box.innerHTML = parts.join('');
  }
  function collectSelectedColumns() {
    var out = [];
    Object.keys(columnState).forEach(function (tname) { Object.keys(columnState[tname]).forEach(function (cname) { var s = columnState[tname][cname]; if (s.checked) { var entry = { table: tname, column: cname }; if (s.alias) entry.alias = s.alias; if (s.decode) { entry.decode = true; entry.elseMode = s.elseMode || 'convert'; } out.push(entry); } }); });
    return out;
  }
  var nlAggregates = [], nlGroupBy = [], nlHaving = null;
  function buildOptions() {
    var opts = { dialect: $('dialectSel').value };
    if (selectedTables.length) opts.selectedTables = selectedTables.slice();
    var cols = collectSelectedColumns();
    nlAggregates.forEach(function (a) { cols.push({ table: a.table, column: a.column, aggregate: a.aggregate, alias: a.alias }); });
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
    var interpretation = APSQL_NLQUERY.interpretRequirement(text, engine, {}); lastInterpretation = interpretation;
    selectedTables = APSQL_NLQUERY.mergeTableLists(selectedTables, interpretation.tables);
    var manualColsFlat = collectSelectedColumns();
    var mergedCols = APSQL_NLQUERY.mergeColumnLists(manualColsFlat, interpretation.columns);
    mergedCols.forEach(function (c) { var state = ensureColState(c.table); if (!state[c.column]) state[c.column] = { checked: true, alias: c.alias || '', decode: !!c.decode, elseMode: 'convert' }; else { state[c.column].checked = true; if (c.decode) state[c.column].decode = true; } });
    readOnlyFilterGroup.conditions = APSQL_NLQUERY.mergeFilterConditions(readOnlyFilterGroup.conditions, interpretation.filterConditions).map(function (c) { return c.id ? c : APSQL_FILTER.newCondition(c); });
    if (!sortRows.length && interpretation.orderBy && interpretation.orderBy.length) interpretation.orderBy.forEach(function (o) { sortRows.push({ table: o.table, column: o.column, direction: o.direction || 'ASC' }); });
    if (!$('optLimit').value.trim() && interpretation.limit) $('optLimit').value = String(interpretation.limit);
    if (interpretation.distinct) $('optDistinct2').checked = true;
    if (!$('optHierarchy').value && interpretation.hierarchyTable) $('optHierarchy').value = interpretation.hierarchyTable;
    nlAggregates = APSQL_NLQUERY.mergeAggregates(nlAggregates, interpretation.aggregates);
    nlGroupBy = APSQL_NLQUERY.mergeGroupBy(nlGroupBy, interpretation.groupBy);
    if (interpretation.having && !nlHaving) nlHaving = interpretation.having;
    refreshTablesColumnsUI(); renderDescriptionInterpretationBox(interpretation); renderConfidenceChecklist(interpretation); renderAmbiguityBox(interpretation);
  }
  function renderDescriptionInterpretationBox(interpretation) {
    var box = $('descriptionInterpretationBox'); if (!box) return;
    var hasMatched = interpretation.matched && interpretation.matched.length; var hasWarnings = interpretation.warnings && interpretation.warnings.length;
    if (!hasMatched && !hasWarnings) { box.innerHTML = ''; return; }
    var parts = [];
    if (hasMatched) parts.push('<div class="small"><strong>I understood your request as:</strong><ul class="mb-1">' + interpretation.matched.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>');
    if (hasWarnings) parts.push('<div class="alert alert-warning small mb-0">' + interpretation.warnings.map(esc).join('<br>') + '</div>');
    box.innerHTML = parts.join('');
  }
  function runGenerate() {
    applyDescriptionToSelection();
    var promptText = $('promptInput').value.trim(); var opts = buildOptions();
    var res = APSQL_ENGINE.generateSql(promptText, opts, engine, decodeStore);
    renderResult(res);
    if (lastInterpretation && lastInterpretation.confidence) lastInterpretation.confidence.sqlValidated = (res.status === 'ok');
    showView('builder'); $('resultBody').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('generateBtn').addEventListener('click', runGenerate);
  $('generateFromDescriptionBtn').addEventListener('click', runGenerate);
  $('promptInput').addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runGenerate(); });
  function resetQueryState(alsoClearPrompt) {
    if (alsoClearPrompt !== false) $('promptInput').value = '';
    selectedTables = []; columnState = {}; readOnlyFilterGroup.conditions = []; sortRows = []; existsRows = []; scalarRows = []; nlAggregates = []; nlGroupBy = []; nlHaving = null;
    $('optJoinInner').checked = true; syncJoinChoiceHighlight(); $('optLimit').value = ''; $('optView').value = ''; $('optHaving').value = ''; $('optHierarchy').value = ''; $('optDistinct2').checked = false;
    lastInterpretation = null; lastResult = null;
    $('descriptionInterpretationBox').innerHTML = ''; $('confidenceChecklistBox').innerHTML = ''; $('ambiguityBox').classList.add('d-none'); $('ambiguityBox').innerHTML = '';
    $('explanationReportBox').classList.add('d-none'); $('explanationReportBox').innerHTML = ''; $('optimizeReportBox').innerHTML = '';
    $('copyBtn').classList.add('d-none'); $('optimizeBtn').classList.add('d-none'); $('explainBtn').classList.add('d-none');
    $('resultBody').innerHTML = '<p class="text-body-secondary small mb-0">Your generated SQL will appear here as soon as you click Build Query.</p>';
    refreshTablesColumnsUI();
  }
  $('resetQueryBtn').addEventListener('click', function () { resetQueryState(true); });
  refreshTablesColumnsUI(); refreshHierarchyOptions();

  /* ------------------------------------------------------------------ *
   * Query Builder for CR
   * ------------------------------------------------------------------ */
  var crCommand = 'INSERT', crTable = '', crInsertColumns = {}, crUpdateColumns = {}, crFilterGroup = { conditions: [] }, crLastResult = null;
  function crRefreshTableOptions() { var sel = $('crTableSelect'); var current = sel.value; sel.innerHTML = allTables().map(function (t) { return '<option value="' + t.name + '">' + t.name + '</option>'; }).join(''); if (allTables().some(function (t) { return t.name === current; })) sel.value = current; else sel.value = allTables()[0] ? allTables()[0].name : ''; crTable = sel.value; }
  $('crTableSelect').addEventListener('change', function () { crTable = $('crTableSelect').value; crInsertColumns = {}; crUpdateColumns = {}; crFilterGroup = { conditions: [] }; crRenderAll(); });
  document.querySelectorAll('.cr-command-option').forEach(function (opt) { opt.addEventListener('click', function () { document.querySelectorAll('.cr-command-option').forEach(function (o) { o.classList.remove('active'); }); opt.classList.add('active'); crCommand = opt.getAttribute('data-command'); crRenderAll(); }); });
  function crRenderInsertPanel() {
    var table = engine.getTable(crTable); var body = $('crInsertColumnsBody'); body.innerHTML = ''; if (!table) return;
    table.columns.forEach(function (c) {
      if (!crInsertColumns[c.name]) crInsertColumns[c.name] = { checked: false, value: '' };
      var s = crInsertColumns[c.name];
      var row = document.createElement('div'); row.className = 'filter-condition-row';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input'; cb.checked = s.checked;
      var span = document.createElement('span'); span.className = 'small'; span.innerHTML = '<code>' + c.name + '</code> <span class="text-body-secondary">' + esc(c.type || '') + '</span>';
      var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm'; valInput.placeholder = 'Value'; valInput.value = s.value; valInput.disabled = !s.checked;
      cb.addEventListener('change', function () { s.checked = cb.checked; valInput.disabled = !cb.checked; crRenderDecodePanel(); });
      valInput.addEventListener('input', function () { s.value = valInput.value; });
      row.appendChild(cb); row.appendChild(span); row.appendChild(valInput); body.appendChild(row);
    });
  }
  function crRenderUpdatePanel() {
    var table = engine.getTable(crTable); var body = $('crUpdateColumnsBody'); body.innerHTML = ''; if (!table) return;
    table.columns.forEach(function (c) {
      if (!crUpdateColumns[c.name]) crUpdateColumns[c.name] = { checked: false, value: '' };
      var s = crUpdateColumns[c.name];
      var row = document.createElement('div'); row.className = 'filter-condition-row';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input'; cb.checked = s.checked;
      var span = document.createElement('span'); span.className = 'small'; span.innerHTML = '<code>' + c.name + '</code> <span class="text-body-secondary">' + esc(c.type || '') + '</span>';
      var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm'; valInput.placeholder = 'New Value'; valInput.value = s.value; valInput.disabled = !s.checked;
      cb.addEventListener('change', function () { s.checked = cb.checked; valInput.disabled = !cb.checked; crRenderDecodePanel(); });
      valInput.addEventListener('input', function () { s.value = valInput.value; });
      row.appendChild(cb); row.appendChild(span); row.appendChild(valInput); body.appendChild(row);
    });
  }
  function crRenderWherePanel() { var showWhere = crCommand === 'UPDATE' || crCommand === 'DELETE'; $('crWherePanel').classList.toggle('d-none', !showWhere); if (showWhere) renderFilterGroup($('crFilterGroup'), crFilterGroup, [crTable], function () {}); }
  $('crAddFilterBtn').addEventListener('click', function () { var firstCol = crTable && engine.getTable(crTable) ? engine.getTable(crTable).columns[0].name : ''; crFilterGroup.conditions.push(APSQL_FILTER.newCondition({ table: crTable, column: firstCol })); renderFilterGroup($('crFilterGroup'), crFilterGroup, [crTable], function () {}); });
  $('crClearFiltersBtn').addEventListener('click', function () { crFilterGroup.conditions = []; renderFilterGroup($('crFilterGroup'), crFilterGroup, [crTable], function () {}); });
  function crRenderDecodePanel() {
    var body = $('crDecodeBody'); var table = engine.getTable(crTable); if (!table) { body.innerHTML = ''; return; }
    var relevantCols = (crCommand === 'INSERT' ? Object.keys(crInsertColumns) : Object.keys(crUpdateColumns)).filter(function (name) { var s = crCommand === 'INSERT' ? crInsertColumns[name] : crUpdateColumns[name]; return s && s.checked; });
    if (!relevantCols.length) { body.innerHTML = '<div class="small text-body-secondary">Select a column above to configure or view its decode.</div>'; return; }
    body.innerHTML = '';
    relevantCols.forEach(function (colName) {
      var resolved = APSQL_DECODE.resolveDecode(engine, decodeStore, crTable, colName);
      var box = document.createElement('div'); box.className = 'mb-2 small';
      var header = '<code>' + colName + '</code> ';
      if (resolved.values && resolved.values.length) header += resolved.values.map(function (p) { return esc(p.code) + '=' + esc(p.label); }).join(', ');
      else header += '<span class="text-body-secondary">No predefined decode available.</span>';
      box.innerHTML = header; body.appendChild(box);
    });
  }
  function crRenderRequirementsSummary() {
    var box = $('crRequirementsSummaryBody'); var parts = []; var descText = $('crDescriptionInput').value.trim();
    parts.push('<h5 class="h6">Describe What You Need</h5>' + (descText ? '<p class="small">' + esc(descText) + '</p>' : '<p class="small text-body-secondary">No description provided.</p>'));
    parts.push('<p class="small"><strong>Query Type:</strong> ' + esc(crCommand) + ' &nbsp; <strong>Table:</strong> ' + esc(crTable) + '</p>');
    box.innerHTML = parts.join('');
  }
  function crRenderAll() {
    $('crInsertPanel').classList.toggle('d-none', crCommand !== 'INSERT');
    $('crUpdatePanel').classList.toggle('d-none', crCommand !== 'UPDATE');
    if (crCommand === 'INSERT') crRenderInsertPanel(); if (crCommand === 'UPDATE') crRenderUpdatePanel();
    crRenderWherePanel(); crRenderDecodePanel(); crRenderRequirementsSummary();
  }
  function crRenderResult(res) {
    crLastResult = res; var body = $('crResultBody');
    if (res.status === 'rejected') {
      body.innerHTML = '<div class="alert alert-danger small"><strong>Could not build this query.</strong><div>' + esc(res.message) + '</div></div>' + renderSuggestedFixes(res.message);
      $('crCopyBtn').classList.add('d-none'); $('crOptimizeBtn').classList.add('d-none'); $('crOptimizeReportBox').innerHTML = '';
      $('crWhereRequiredWarning').classList.toggle('d-none', !res.requiresWhereConfirmation);
      return;
    }
    $('crWhereRequiredWarning').classList.add('d-none');
    var warnings = (res.warnings || []).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
    body.innerHTML = '<div class="small mb-1"><strong>Query Type:</strong> ' + esc(res.command) + (res.isPreview ? '' : ' <span class="badge text-bg-warning">Change Request Query</span>') + '</div>' +
      '<pre class="sql-output">' + highlight(res.sql) + '</pre>' + (warnings ? '<ul class="small mt-2">' + warnings + '</ul>' : '') +
      '<div class="small text-body-secondary mt-2">Generated SQL only – this application does not execute database changes.</div>';
    $('crCopyBtn').classList.remove('d-none'); $('crOptimizeBtn').classList.remove('d-none'); $('crOptimizeReportBox').innerHTML = '';
  }
  $('crCopyBtn').addEventListener('click', function () { if (crLastResult && crLastResult.status === 'ok') { navigator.clipboard && navigator.clipboard.writeText(crLastResult.sql); var old = $('crCopyBtn').innerHTML; $('crCopyBtn').innerHTML = '✅ Copied'; setTimeout(function () { $('crCopyBtn').innerHTML = old; }, 1300); } });
  $('crOptimizeBtn').addEventListener('click', function () { if (!crLastResult || crLastResult.status !== 'ok') return; var opt = APSQL_OPTIMIZE.optimizeSql(engine, crLastResult); if (opt.hasChanges) { crLastResult = Object.assign({}, crLastResult, { sql: opt.optimizedSql }); crRenderResult(crLastResult); } renderOptimizeReport('crOptimizeReportBox', opt); });
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
    var box = $('crDescriptionInterpretationBox'); var hasMatched = interpretation.matched && interpretation.matched.length; var hasWarnings = interpretation.warnings && interpretation.warnings.length;
    if (!hasMatched && !hasWarnings) { box.innerHTML = ''; return; }
    var parts = [];
    if (hasMatched) parts.push('<div class="small"><strong>Interpreted from your description:</strong><ul class="mb-1">' + interpretation.matched.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>');
    if (hasWarnings) parts.push('<div class="alert alert-warning small mb-0">' + interpretation.warnings.map(esc).join('<br>') + '</div>');
    box.innerHTML = parts.join('');
  }
  function runCrBuild() {
    crApplyDescriptionToSelection();
    var request = { command: crCommand, table: crTable, allowNoWhere: $('crAllowNoWhere').checked };
    if (crCommand === 'INSERT') request.columns = Object.keys(crInsertColumns).filter(function (n) { return crInsertColumns[n].checked; }).map(function (n) { return { name: n, value: crInsertColumns[n].value }; });
    else if (crCommand === 'UPDATE') { request.updates = Object.keys(crUpdateColumns).filter(function (n) { return crUpdateColumns[n].checked; }).map(function (n) { return { column: n, value: crUpdateColumns[n].value }; }); request.filterGroup = crFilterGroup; }
    else if (crCommand === 'DELETE') request.filterGroup = crFilterGroup;
    var res = APSQL_CR.buildCrQuery(engine, request, $('crDialectSel').value);
    crRenderResult(res);
  }
  $('crBuildBtn').addEventListener('click', runCrBuild);
  $('crGenerateFromDescriptionBtn').addEventListener('click', runCrBuild);
  crRefreshTableOptions(); crRenderAll();
  document.querySelectorAll('#crManualTabs .nav-link').forEach(function (t) {
    t.addEventListener('click', function () {
      var name = t.getAttribute('data-cr-tab');
      document.querySelectorAll('#crManualTabs .nav-link').forEach(function (x) { x.classList.toggle('active', x === t); });
      document.querySelectorAll('.tab-pane-cr').forEach(function (p) { var show = p.id === 'cr-pane-' + name; p.classList.toggle('d-none', !show); p.classList.toggle('active', show); });
      if (name === 'requirements') crRenderRequirementsSummary();
    });
  });

  /* ------------------------------------------------------------------ *
   * Used Schema
   * ------------------------------------------------------------------ */
  var schemaSearchTerm = '';
  function highlightMatch(text, term) { if (!term) return esc(text); var escText = esc(text); var escTerm = esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (!escTerm) return escText; return escText.replace(new RegExp('(' + escTerm + ')', 'ig'), '<mark>$1</mark>'); }
  function tableMatchesSearch(t, term) { if (!term) return true; if ((t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(term) !== -1) return true; return t.columns.some(function (c) { return columnMatchesSearch(c, term); }); }
  function columnMatchesSearch(c, term) { if (!term) return true; return (c.name + ' ' + (c.alias || '') + ' ' + (c.description || '') + ' ' + (c.type || '')).toLowerCase().indexOf(term) !== -1; }
  function renderUsedSchema() {
    var st = engine.getStatus();
    $('usedSchemaSummary').innerHTML = [['Schema', st.schemaName], ['Version', st.schemaVersion], ['Status', '✅ Valid / Active'], ['Modules', st.moduleCount], ['Tables', st.tableCount], ['Columns', st.columnCount], ['Last Updated', st.lastUpdated]].map(function (row) {
      return '<div class="col-6 col-md-3"><div class="border rounded p-2 text-center h-100"><div class="small text-body-secondary">' + row[0] + '</div><div class="fw-semibold">' + esc(row[1]) + '</div></div></div>';
    }).join('');
    if (!allTables().length) { $('schemaTree').innerHTML = '<div class="alert alert-secondary small">The active schema currently has no tables. Upload a schema file under Schema → Update Schema to get started.</div>'; $('schemaSearchNoResults').classList.remove('show'); $('schemaSearchResultCount').textContent = ''; $('schemaSearchClearBtn').classList.add('d-none'); return; }
    var labels = moduleLabels(); var term = schemaSearchTerm.toLowerCase().trim(); var byModule = {};
    allTables().forEach(function (t) { (byModule[t.module] = byModule[t.module] || []).push(t); });
    var matchedTableCount = 0, matchedColumnCount = 0; var parts = [];
    Object.keys(byModule).sort().forEach(function (mod) {
      var allInModule = byModule[mod]; var matching = term ? allInModule.filter(function (t) { return tableMatchesSearch(t, term); }) : allInModule;
      if (term && !matching.length) return;
      var totalCols = allInModule.reduce(function (s, t) { return s + t.columns.length; }, 0);
      var tablesHtml = matching.map(function (t) {
        matchedTableCount++;
        var colsToShow = term ? t.columns.filter(function (c) { return columnMatchesSearch(c, term); }) : t.columns;
        matchedColumnCount += colsToShow.length;
        var colsHtml = colsToShow.map(function (c) {
          var badge = c.primary_key ? '<span class="badge text-bg-warning">PK</span>' : (c.foreign_key ? '<span class="badge text-bg-info">FK → ' + c.foreign_key.table + '.' + c.foreign_key.column + '</span>' : '');
          return '<div class="col-item"><code>' + highlightMatch(c.name, term) + '</code><span class="text-body-secondary">' + esc(c.type) + '</span>' + badge + '<span>' + highlightMatch(c.description || '', term) + '</span></div>';
        }).join('');
        return '<div class="schema-tree-table-row" data-table="' + t.name + '"><span><code>' + highlightMatch(t.name, term) + '</code> <span class="text-body-secondary small">(' + colsToShow.length + ' columns)</span></span><i class="bi bi-chevron-down"></i></div><div class="schema-tree-columns' + (term ? ' open' : '') + '" id="cols-' + t.name + '">' + colsHtml + '</div>';
      }).join('');
      parts.push('<div class="schema-tree-module"><div class="schema-tree-module-header" data-module="' + mod + '"><span>' + highlightMatch(labels[mod] || mod, term) + ' <span class="text-body-secondary small">(' + matching.length + ' tables, ' + totalCols + ' columns)</span></span><i class="bi bi-chevron-down"></i></div><div class="schema-tree-tables' + (term ? ' open' : '') + '" id="tables-' + mod + '">' + tablesHtml + '</div></div>');
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

  /* ------------------------------------------------------------------ *
   * About modal
   * ------------------------------------------------------------------ */
  var aboutModalEl = $('aboutModal'); var aboutModal = window.bootstrap ? new window.bootstrap.Modal(aboutModalEl) : null;
  $('aboutMenuBtn').addEventListener('click', function () {
    var st = engine.getStatus();
    $('aboutList').innerHTML = [
      ['Application name', 'AP-SQL Assistant'],
      ['Application version', '10.8.0'],
      ['What\'s new in V10.8', 'A completely redesigned, page-specific Guided Walkthrough with fully responsive positioning (it flips sides and docks as a bottom sheet on narrow screens so it always stays within the visible screen), a clear step counter and progress dots, and a general responsive-layout pass across every page so controls never run off-screen or get covered.'],
      ['Carried over from V10.7.1', 'The Secure GitHub Connection Vault unlock fix (no hardcoded placeholder token; unlocking now works with no token typed at all, reading anonymously when the repository allows it), Multiple Schema Store, the selectable Synchronization Schedule, and Operational Password Management.'],
      ['Active schema version', st.schemaVersion], ['Schema last updated', st.lastUpdated],
      ['Security', 'The Read Only Query Builder only ever emits read-only SELECT statements. The CR builder and Error Rectifier only ever produce SQL text for review and never execute it. The credential vault uses AES-256-GCM encryption with a PBKDF2-derived key. The operational password is stored only as a SHA-256 hash, never in plain text.']
    ].map(function (row) { return '<li class="mb-2"><strong>' + row[0] + ':</strong> ' + esc(row[1]) + '</li>'; }).join('');
    closeMenu(); if (aboutModal) aboutModal.show();
  });

  /* ------------------------------------------------------------------ *
   * Update Schema — password gate, import, sync, downloads
   * ------------------------------------------------------------------ */
  var WORKFLOW_STEPS = ['Upload Document', 'Read Document', 'Detect Format', 'Detect Tables', 'Detect Columns', 'Validate Schema', 'Show Preview', 'Apply Schema Update'];
  function renderWorkflowSteps(activeIdx) { $('workflowStepList').innerHTML = WORKFLOW_STEPS.map(function (s, i) { var cls = i < activeIdx ? 'text-bg-success' : (i === activeIdx ? 'text-bg-primary' : 'text-bg-light border'); return '<span class="badge ' + cls + ' me-1 mb-1">' + (i + 1) + '. ' + s + '</span>'; }).join(''); }
  renderWorkflowSteps(0);
  $('updateSchemaPasswordBtn').addEventListener('click', function () {
    passwordManager.verifyCurrentPassword($('updateSchemaPasswordInput').value).then(function (ok) {
      if (ok) {
        $('updateSchemaPasswordStep').classList.add('d-none'); $('updateSchemaWorkArea').classList.remove('d-none'); renderWorkflowSteps(1);
        renderSyncStatus(); renderGithubSyncStatus(); renderAllSharedSchemaStrips(); renderTargetSchemaSelect(); renderSchemaStoreList();
      } else $('updateSchemaPasswordError').classList.remove('d-none');
    });
  });
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
  $('toggleExpectedStructureBtn').addEventListener('click', function () { var box = $('expectedStructureBox'); var btn = $('toggleExpectedStructureBtn'); box.classList.toggle('d-none'); btn.textContent = box.classList.contains('d-none') ? 'View Expected Structure' : 'Hide Expected Structure'; });

  var pendingIncomingTables = null;
  $('updateSchemaFileInput').addEventListener('change', function () {
    $('unsupportedFormatError').classList.add('d-none');
    var file = $('updateSchemaFileInput').files && $('updateSchemaFileInput').files[0]; if (!file) return;
    if (!window.APSQL_SCHEMA_TOOLS.detectFormat(file.name)) { $('unsupportedFormatError').textContent = 'Unsupported file format. Please upload a .json or .csv file.'; $('unsupportedFormatError').classList.remove('d-none'); $('updateSchemaFileInput').value = ''; }
  });
  $('updateSchemaProcessBtn').addEventListener('click', function () {
    var file = $('updateSchemaFileInput').files && $('updateSchemaFileInput').files[0]; var resultBox = $('updateSchemaResult'); resultBox.innerHTML = ''; $('unsupportedFormatError').classList.add('d-none');
    if (!file) { resultBox.innerHTML = '<div class="alert alert-warning small">Please choose a file first.</div>'; return; }
    if (!window.APSQL_SCHEMA_TOOLS.detectFormat(file.name)) { $('unsupportedFormatError').textContent = 'Unsupported file format. Please upload a .json or .csv file.'; $('unsupportedFormatError').classList.remove('d-none'); return; }
    renderWorkflowSteps(2);
    window.APSQL_SCHEMA_TOOLS.fileToTables(file).then(function (tables) {
      renderWorkflowSteps(5);
      var validation = window.APSQL_SCHEMA_TOOLS.validateSchema(tables);
      $('validationResultBox').innerHTML = validation.valid ? '<div class="alert alert-success small">✅ Schema validated: no duplicate tables/columns, no missing names detected.</div>' : '<div class="alert alert-danger small">The schema could not be activated because validation failed.<ul class="mb-0">' + validation.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
      if (!validation.valid) { $('updateSchemaPreviewCard').classList.remove('d-none'); return; }
      pendingIncomingTables = tables; renderWorkflowSteps(6);
      var targetSchema = targetSchemaEntry().schema; var diff = window.APSQL_SCHEMA_TOOLS.computeDiff(targetSchema, tables);
      $('previewCurrentBox').innerHTML = 'Version: ' + esc(targetSchema.schema_version) + '<br>Tables: ' + diff.currentTableCount + '<br>Columns: ' + diff.currentColumnCount;
      $('previewNewBox').innerHTML = 'Version: ' + esc(diff.newVersion) + '<br>Tables: ' + diff.newTableCount + '<br>Columns: ' + diff.newColumnCount;
      $('previewChangesBox').innerHTML = '+ ' + diff.addedTableCount + ' New Tables<br>+ ' + diff.addedColumnCount + ' New Columns<br>~ ' + diff.updatedTableCount + ' Updated Tables';
      $('updateSchemaPreviewCard').classList.remove('d-none'); $('updateSchemaPreviewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) { resultBox.innerHTML = '<div class="alert alert-danger small">' + esc(err.message) + '</div>'; renderWorkflowSteps(1); });
  });
  function refreshAllViewsAfterSchemaChange() {
    refreshTablesColumnsUI(); refreshHierarchyOptions(); refreshModuleChips(); crRefreshTableOptions(); crRenderAll();
    if (currentView === 'usedschema') { renderUsedSchema(); renderSchemaStoreList(); }
  }
  function performApplySchemaUpdate() {
    if (!pendingIncomingTables) return;
    var targetEntry = targetSchemaEntry();
    var mergeResult = window.APSQL_SCHEMA_TOOLS.mergeSchemas(targetEntry.schema, pendingIncomingTables, $('updateSchemaFileInput').files[0].name);
    schemaStore.updateEntry(targetEntry.id, { schema: mergeResult.schema });
    if (targetEntry.id === schemaStore.getActiveId()) rebuildEngine();
    persistCurrentSchema(); renderSchemaPersistenceStatus(); renderWorkflowSteps(7); refreshAllViewsAfterSchemaChange(); renderSchemaStoreList(); renderTargetSchemaSelect();
    $('updateSchemaResult').innerHTML = '<div class="alert alert-success small">' + mergeResult.addedTables.length + ' new table(s), ' + mergeResult.addedColumns.length + ' new column(s) added to “' + esc(targetEntry.name) + '”.<br>Schema Version: ' + esc(mergeResult.schema.schema_version) + '</div>';
    $('updateSchemaPreviewCard').classList.add('d-none'); pendingIncomingTables = null;
  }
  var reauthApplyModalEl = $('reauthApplyModal'); var reauthApplyModal = window.bootstrap ? new window.bootstrap.Modal(reauthApplyModalEl) : null;
  $('activateSchemaBtn').addEventListener('click', function () { if (!pendingIncomingTables) return; $('reauthApplyPasswordInput').value = ''; $('reauthApplyPasswordError').classList.add('d-none'); if (reauthApplyModal) reauthApplyModal.show(); });
  $('confirmReauthApplyBtn').addEventListener('click', function () { passwordManager.verifyCurrentPassword($('reauthApplyPasswordInput').value).then(function (ok) { if (!ok) { $('reauthApplyPasswordError').classList.remove('d-none'); return; } if (reauthApplyModal) reauthApplyModal.hide(); performApplySchemaUpdate(); }); });
  $('cancelPreviewBtn').addEventListener('click', function () { $('updateSchemaPreviewCard').classList.add('d-none'); pendingIncomingTables = null; renderWorkflowSteps(1); $('updateSchemaResult').innerHTML = '<div class="text-body-secondary small">Update cancelled. No schema was changed.</div>'; });

  var deleteSchemaModalEl = $('deleteSchemaModal'); var deleteSchemaModal = window.bootstrap ? new window.bootstrap.Modal(deleteSchemaModalEl) : null;
  $('deleteSchemaBtn').addEventListener('click', function () { $('deleteSchemaPasswordInput').value = ''; $('deleteSchemaPasswordError').classList.add('d-none'); if (deleteSchemaModal) deleteSchemaModal.show(); });
  $('confirmDeleteSchemaBtn').addEventListener('click', function () {
    passwordManager.verifyCurrentPassword($('deleteSchemaPasswordInput').value).then(function (ok) {
      if (!ok) { $('deleteSchemaPasswordError').classList.remove('d-none'); return; }
      var targetEntry = targetSchemaEntry();
      triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaJsonBlob(targetEntry.schema), 'schema-backup-before-delete.json');
      var emptied = window.APSQL_SCHEMA_TOOLS.buildEmptySchema(targetEntry.schema);
      schemaStore.updateEntry(targetEntry.id, { schema: emptied });
      if (targetEntry.id === schemaStore.getActiveId()) { relationshipStore.clearAll(); relationshipDrafts = {}; rebuildEngine(); resetQueryState(true); }
      persistCurrentSchema(); renderSchemaPersistenceStatus();
      crInsertColumns = {}; crUpdateColumns = {}; crFilterGroup.conditions = []; $('crDescriptionInput').value = ''; $('crDescriptionInterpretationBox').innerHTML = '';
      refreshAllViewsAfterSchemaChange(); renderSchemaStoreList(); renderTargetSchemaSelect();
      if (deleteSchemaModal) deleteSchemaModal.hide();
      $('updateSchemaResult').innerHTML = '<div class="alert alert-success small">“' + esc(targetEntry.name) + '” has been emptied. A backup was automatically downloaded.</div>';
    });
  });

  /* ------------------------------------------------------------------ *
   * Error Rectifier
   * ------------------------------------------------------------------ */
  var errLastResult = null;
  function renderErrorRectifierResult(result) {
    errLastResult = result;
    $('errRectifiedSqlBody').innerHTML = '<pre class="sql-output">' + highlight(result.correctedSql) + '</pre>';
    $('errCopySqlBtn').classList.remove('d-none');
    $('errExplanationBody').innerHTML = '<div class="small mb-2"><strong>Error Identified</strong><div>' + esc(result.errorIdentified) + '</div></div><div class="small"><strong>Correction Applied</strong><div>' + esc(result.correctionApplied) + '</div></div>';
    $('errCopyExplanationBtn').classList.remove('d-none');
    var changedCard = $('errWhatChangedCard'), changedBody = $('errWhatChangedBody');
    if (result.changed && result.changes && result.changes.length) { changedCard.classList.remove('d-none'); changedBody.innerHTML = result.changes.map(function (c) { return '<div class="small mb-1"><code>' + esc(c.from) + '</code> → <code>' + esc(c.to) + '</code></div>'; }).join(''); }
    else { changedCard.classList.add('d-none'); changedBody.innerHTML = ''; }
  }
  $('errRectifyBtn').addEventListener('click', function () {
    var errorText = $('errErrorInput').value, sqlText = $('errSqlInput').value;
    var detected = window.APSQL_ERROR_RECTIFIER.detectDialectFromError(errorText); if (detected) $('errDialectSel').value = detected;
    var dialect = $('errDialectSel').value;
    var result = window.APSQL_ERROR_RECTIFIER.rectify(sqlText, errorText, engine, dialect);
    renderErrorRectifierResult(result);
  });
  $('errCopySqlBtn').addEventListener('click', function () { if (!errLastResult) return; navigator.clipboard && navigator.clipboard.writeText(errLastResult.correctedSql); var old = $('errCopySqlBtn').innerHTML; $('errCopySqlBtn').innerHTML = '✅ Copied'; setTimeout(function () { $('errCopySqlBtn').innerHTML = old; }, 1300); });
  $('errCopyExplanationBtn').addEventListener('click', function () { if (!errLastResult) return; var text = 'Error Identified: ' + errLastResult.errorIdentified + '\n\nCorrection Applied: ' + errLastResult.correctionApplied; navigator.clipboard && navigator.clipboard.writeText(text); var old = $('errCopyExplanationBtn').innerHTML; $('errCopyExplanationBtn').innerHTML = '✅ Copied'; setTimeout(function () { $('errCopyExplanationBtn').innerHTML = old; }, 1300); });

  /* ------------------------------------------------------------------ *
   * First-run: auto start the Home tour once, then let users restart any
   * page's tour at any time via the navbar / menu button.
   * ------------------------------------------------------------------ */
  showView('quickstart');
  if (window.APSQL_TOUR && !APSQL_TOUR.hasSeen('quickstart')) setTimeout(function () { APSQL_TOUR.start('quickstart'); }, 500);
})();
