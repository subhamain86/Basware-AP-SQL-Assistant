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

  /* ---------------- Live Shared Schema ---------------- */
  var sharedSchemaChecked = false, sharedSchemaFound = false, sharedSchemaError = null;
  var SHARED_SCHEMA_PATH = APSQL_SHARED_SCHEMA.DEFAULT_SHARED_SCHEMA_PATH;
  function renderSharedSchemaStrip(elId) {
    var el = $(elId); if (!el) return;
    var state = { checked: sharedSchemaChecked, found: sharedSchemaFound, error: sharedSchemaError, path: SHARED_SCHEMA_PATH };
    var status = APSQL_SHARED_SCHEMA.describeSharedSchemaStatus(state);
    el.className = 'shared-schema-strip level-' + status.level;
    var icon = status.level === 'live' ? '<span class="shared-schema-pulse"></span>' : '<i class="bi bi-broadcast"></i>';
    el.innerHTML = icon + '<span class="shared-schema-text">' + esc(status.text) + '</span>';
  }
  function renderAllSharedSchemaStrips() {
    ['sharedSchemaStripQuickstart', 'sharedSchemaStripBuilder', 'sharedSchemaStripCr', 'sharedSchemaStripUsedSchema'].forEach(renderSharedSchemaStrip);
    var adminEl = $('sharedSchemaStatusBodyAdmin');
    if (adminEl) {
      var state = { checked: sharedSchemaChecked, found: sharedSchemaFound, error: sharedSchemaError, path: SHARED_SCHEMA_PATH };
      var status = APSQL_SHARED_SCHEMA.describeSharedSchemaStatus(state);
      adminEl.innerHTML = '<div class="shared-schema-strip level-' + status.level + '">' + (status.level === 'live' ? '<span class="shared-schema-pulse"></span>' : '<i class="bi bi-broadcast"></i>') + '<span class="shared-schema-text">' + esc(status.text) + '</span></div>';
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

  /* ---------------- Cross-device File System Access sync ---------------- */
  var syncSupported = APSQL_SYNC.isFileSystemAccessSupported(window);
  var syncHandleStore = syncSupported ? APSQL_SYNC.createHandleStore() : null;
  var linkedHandle = null, lastKnownFileModified = null, syncNeedsReconnect = false, syncError = null, syncLastCheckedAt = null;
  function currentSyncState() { return { supported: syncSupported, linked: !!linkedHandle, fileName: linkedHandle ? linkedHandle.name : null, needsReconnect: syncNeedsReconnect, error: syncError }; }
  function renderSyncStatus(transientNote) {
    var statusBody = $('schemaSyncStatusBody'), actionsBody = $('schemaSyncActionsBody'), lastCheckEl = $('schemaSyncLastCheck');
    if (!statusBody || !actionsBody) return;
    var status = APSQL_SYNC.describeSyncStatus(currentSyncState());
    statusBody.innerHTML = '<div class="schema-sync-status-line level-' + status.level + '">' + (status.level === 'linked' ? '<span class="schema-sync-pulse"></span>' : '<i class="bi bi-info-circle"></i>') + '<span>' + esc(transientNote || status.text) + '</span></div>';
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
        setActiveSchemaObject(result.schema); rebuildEngine(); lastKnownFileModified = result.lastModified; refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus();
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
  function unlinkSharedFile() { linkedHandle = null; lastKnownFileModified = null; syncError = null; syncNeedsReconnect = false; syncLastCheckedAt = null; (syncHandleStore ? syncHandleStore.clearHandle() : Promise.resolve()).then(renderSyncStatus).catch(renderSyncStatus); }
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
      return APSQL_SYNC.verifyPermissionSilent(handle, 'read').then(function (granted) { if (!granted) { syncNeedsReconnect = true; renderSyncStatus(); return; } return checkLinkedFileForUpdates(false).then(renderSyncStatus); });
    }).catch(renderSyncStatus);
  } else renderSyncStatus();

  /* ---------------- GitHub-hosted schema sync ---------------- */
  var githubConfigStore = APSQL_GITHUB_SYNC.createConfigStore();
  var githubConfig = null, githubLastSha = null, githubError = null, githubConflict = false, githubLastCheckedAt = null;
  function renderGithubSyncStatus(transientNote) {
    var statusBody = $('githubSyncStatusBody'), actionsBody = $('githubSyncActionsBody'), lastCheckEl = $('githubSyncLastCheck'), configForm = $('githubSyncConfigForm'), tokenWarningBox = $('githubTokenWarningBox');
    if (!statusBody || !actionsBody) return;
    if (tokenWarningBox) tokenWarningBox.classList.remove('d-none');
    var state = { configured: !!githubConfig, conflict: githubConflict, error: githubError, owner: githubConfig && githubConfig.owner, repo: githubConfig && githubConfig.repo, path: githubConfig && githubConfig.path, branch: githubConfig && githubConfig.branch };
    var status = APSQL_GITHUB_SYNC.describeGitHubSyncStatus(state);
    statusBody.innerHTML = '<div class="github-sync-status-line level-' + status.level + '">' + (status.level === 'connected' ? '<span class="github-sync-pulse"></span>' : '<i class="bi bi-github"></i>') + '<span>' + esc(transientNote || status.text) + '</span></div>';
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
        githubConfig = config; githubLastSha = result.sha; setActiveSchemaObject(result.schema); rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus();
        return null;
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
    githubConfig = saved;
    checkGithubForUpdates(false).then(function () { renderGithubSyncStatus(); });
  })();
  (function defaultGithubPathToSharedPath() { var pathInput = $('githubPathInput'); if (pathInput && !pathInput.value) pathInput.value = SHARED_SCHEMA_PATH; })();

  /* ---------------- Selectable sync schedule (V11: control now lives in the navbar) ---------------- */
  var syncScheduleSelectedId = APSQL_SYNC_SCHEDULE.loadSelectedOptionId();
  var syncIntervalHandle = null;
  function runAllAutomaticSyncChecks() { if (document.hidden) return; checkSharedSchema(); checkLinkedFileForUpdates(false); checkGithubForUpdates(false); }
  function applySyncScheduleInterval() {
    if (syncIntervalHandle) { clearInterval(syncIntervalHandle); syncIntervalHandle = null; }
    var ms = APSQL_SYNC_SCHEDULE.toIntervalMs(syncScheduleSelectedId);
    if (ms != null) syncIntervalHandle = setInterval(runAllAutomaticSyncChecks, ms);
  }
  applySyncScheduleInterval();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) runAllAutomaticSyncChecks(); });
  function renderSyncScheduleSelect() {
    var sel = $('syncScheduleSelect'); if (!sel) return;
    sel.innerHTML = APSQL_SYNC_SCHEDULE.OPTIONS.map(function (o) { return '<option value="' + o.id + '">' + esc(o.label) + '</option>'; }).join('');
    sel.value = syncScheduleSelectedId;
    var note = $('syncScheduleCurrentNote'); if (note) note.textContent = 'Synchronizing: ' + APSQL_SYNC_SCHEDULE.getOption(syncScheduleSelectedId).label + '.';
  }
  renderSyncScheduleSelect();
  if ($('syncScheduleSelect')) $('syncScheduleSelect').addEventListener('change', function () { syncScheduleSelectedId = $('syncScheduleSelect').value; APSQL_SYNC_SCHEDULE.saveSelectedOptionId(null, syncScheduleSelectedId); applySyncScheduleInterval(); renderSyncScheduleSelect(); });

  /* ---------------- Secure GitHub connection vault ---------------- */
  function renderVaultStatus(transientNote, level) {
    var box = $('vaultStatusBody'); if (!box) return;
    var lvl = level || 'unset';
    var text = transientNote || (APSQL_VAULT.isSupported() ? 'No vault has been published in this session yet. Fill in the GitHub connection above, enter a passphrase, and click "Encrypt & Publish Vault".' : 'This browser does not support the Web Crypto API required for the secure credential vault.');
    box.innerHTML = '<div class="vault-status-line level-' + lvl + '"><i class="bi bi-shield-lock"></i><span>' + esc(text) + '</span></div>';
  }
  function refreshVaultControlAvailability() {
    var unsupportedNote = $('vaultUnsupportedNote'); var controls = $('vaultControls'); if (!unsupportedNote || !controls) return;
    var supported = APSQL_VAULT.isSupported();
    unsupportedNote.classList.toggle('d-none', supported);
    if (!supported) unsupportedNote.textContent = 'This browser does not support the Web Crypto API (SubtleCrypto) required to encrypt or decrypt the credential vault. Try a modern version of Chrome, Edge, Firefox, or Safari.';
    controls.classList.toggle('d-none', !supported);
    if ($('publishVaultBtn')) $('publishVaultBtn').disabled = !githubConfig;
  }
  renderVaultStatus(); refreshVaultControlAvailability();
  if ($('publishVaultBtn')) $('publishVaultBtn').addEventListener('click', function () {
    var passphrase = $('vaultPassphraseInput').value; var resultBox = $('vaultResultBox');
    if (!githubConfig) { resultBox.innerHTML = '<div class="alert alert-warning mb-0">Connect GitHub-Hosted Schema Sync above first, so there is a connection to encrypt.</div>'; return; }
    if (!passphrase) { resultBox.innerHTML = '<div class="alert alert-warning mb-0">Please enter a vault passphrase.</div>'; return; }
    resultBox.innerHTML = '<div class="alert alert-info mb-0">Encrypting and publishing the vault…</div>';
    APSQL_VAULT.buildVaultBlob(githubConfig, passphrase).then(function (blobText) {
      var vaultPath = githubConfig.path.replace(/(\.[^./]+)?$/, '') + '.vault.json';
      var vaultGithubConfig = Object.assign({}, githubConfig, { path: vaultPath });
      return APSQL_GITHUB_SYNC.fetchRawJsonFile(vaultGithubConfig).then(function (existing) { return APSQL_GITHUB_SYNC.pushSchemaToGitHub(vaultGithubConfig, JSON.parse(blobText), existing.exists ? existing.sha : null); }).then(function () {
        renderVaultStatus('Vault published to ' + vaultGithubConfig.path + '. Share the passphrase with authorized users out-of-band — it is never stored in the vault itself.', 'published');
        resultBox.innerHTML = '<div class="alert alert-success mb-0">Vault encrypted and published successfully. The token was never sent or stored in plain text.</div>';
        $('vaultPassphraseInput').value = '';
      });
    }).catch(function (err) { renderVaultStatus('Could not publish the vault: ' + err.message, 'error'); resultBox.innerHTML = '<div class="alert alert-danger mb-0">' + esc(err.message) + '</div>'; });
  });
  if ($('unlockVaultBtn')) $('unlockVaultBtn').addEventListener('click', function () {
    var passphrase = $('vaultUnlockPassphraseInput').value; var resultBox = $('vaultResultBox');
    var pathInput = ($('githubPathInput').value || SHARED_SCHEMA_PATH).trim(); var vaultPath = pathInput.replace(/(\.[^./]+)?$/, '') + '.vault.json';
    var owner = ($('githubOwnerInput').value || '').trim(); var repo = ($('githubRepoInput').value || '').trim(); var branch = ($('githubBranchInput').value || 'main').trim() || 'main'; var typedToken = ($('githubTokenInput').value || '').trim();
    if (!owner || !repo) { resultBox.innerHTML = '<div class="alert alert-warning mb-0">Please fill in at least the repository owner and name above, so the vault file can be located.</div>'; return; }
    if (!passphrase) { resultBox.innerHTML = '<div class="alert alert-warning mb-0">Please enter the vault passphrase to unlock.</div>'; return; }
    resultBox.innerHTML = '<div class="alert alert-info mb-0">Fetching and unlocking the vault…</div>';
    var lookupConfig = { owner: owner, repo: repo, branch: branch, path: vaultPath }; if (typedToken) lookupConfig.token = typedToken;
    APSQL_GITHUB_SYNC.fetchRawJsonFile(lookupConfig).then(function (result) {
      if (!result.exists) throw new Error('No vault file was found at ' + vaultPath + '. Ask an administrator to publish one first.');
      return APSQL_VAULT.decryptConfig(result.content, passphrase);
    }).then(function (decryptedConfig) {
      $('githubOwnerInput').value = decryptedConfig.owner || ''; $('githubRepoInput').value = decryptedConfig.repo || ''; $('githubBranchInput').value = decryptedConfig.branch || 'main'; $('githubPathInput').value = decryptedConfig.path || ''; $('githubTokenInput').value = decryptedConfig.token || '';
      resultBox.innerHTML = '<div class="alert alert-success mb-0">Vault unlocked. The GitHub connection fields above have been filled in — click "Connect & Sync Now" to activate this connection on this machine.</div>';
      $('vaultUnlockPassphraseInput').value = '';
    }).catch(function (err) { resultBox.innerHTML = '<div class="alert alert-danger mb-0">' + esc(err.message) + '</div>'; });
  });

  /* ---------------- Operational password ---------------- */
  var passwordManager = APSQL_PASSWORD_MANAGER.createPasswordManager();
  function renderPasswordCustomNote() { var note = $('passwordCustomStatusNote'); if (!note) return; note.textContent = passwordManager.isCustomPasswordSet() ? '(A custom password is currently set in this browser.)' : '(Currently using the default password for this browser.)'; }
  renderPasswordCustomNote();
  if ($('changePasswordBtn')) $('changePasswordBtn').addEventListener('click', function () {
    var current = $('currentPasswordInput').value, next = $('newPasswordInput').value, confirmNext = $('confirmNewPasswordInput').value; var resultBox = $('passwordChangeResultBox');
    passwordManager.changePassword(current, next, confirmNext).then(function (result) {
      if (!result.ok) { resultBox.innerHTML = '<div class="alert alert-danger mb-0">' + esc(result.error) + '</div>'; return; }
      resultBox.innerHTML = '<div class="alert alert-success mb-0">The operational password has been changed successfully in this browser.</div>';
      $('currentPasswordInput').value = ''; $('newPasswordInput').value = ''; $('confirmNewPasswordInput').value = ''; renderPasswordCustomNote();
    });
  });

  /* ---------------- Persistence status / multi-schema store ---------------- */
  function persistCurrentSchema() { schemaStore.persist(); syncWriteCurrentSchemaIfLinked(); pushToGithubIfConfigured(); }
  function renderSchemaPersistenceStatus() {
    var el = $('schemaPersistenceStatus'); if (!el) return; var entry = schemaStore.getActiveEntry();
    el.innerHTML = '<i class="bi bi-database-check"></i> Currently working with <strong>' + esc(entry ? entry.name : 'an unnamed schema') + '</strong> (' + schemaStore.count() + ' schema' + (schemaStore.count() === 1 ? '' : 's') + ' stored in this browser). Applying an update or deleting content is saved automatically from now on.';
  }
  renderSchemaPersistenceStatus();
  function renderSchemaStoreList() {
    var box = $('schemaStoreList'); if (!box) return; box.innerHTML = '';
    var entries = schemaStore.listEntries();
    if (!entries.length) { var empty = document.createElement('div'); empty.className = 'schema-store-empty'; empty.textContent = 'No schemas stored yet. Add one under Update Schema.'; box.appendChild(empty); return; }
    var activeId = schemaStore.getActiveId();
    entries.forEach(function (e) {
      var st = APSQL.createEngine(e.schema).getStatus(); var isActive = e.id === activeId;
      var item = document.createElement('div'); item.className = 'schema-store-item' + (isActive ? ' active' : ''); item.setAttribute('data-entry-id', e.id);
      var main = document.createElement('div'); main.className = 'schema-store-item-main';
      var nameLine = document.createElement('div'); nameLine.className = 'schema-store-item-name'; nameLine.innerHTML = '<i class="bi bi-diagram-3"></i> ' + esc(e.name) + (isActive ? ' <span class="badge text-bg-primary schema-store-active-badge">Active</span>' : '');
      var metaLine = document.createElement('div'); metaLine.className = 'schema-store-item-meta';
      metaLine.innerHTML = '<span>Version: ' + esc(st.schemaVersion || '\u2014') + '</span><span>Source: ' + esc(e.source) + '</span><span>Tables: ' + st.tableCount + '</span><span>Last sync: ' + (e.lastSyncAt ? new Date(e.lastSyncAt).toLocaleString() : 'never') + '</span><span class="schema-store-sync-badge status-' + (e.lastSyncStatus || 'idle') + '">Sync status: ' + esc(e.lastSyncStatus || 'idle') + (e.lastSyncError ? ' (' + esc(e.lastSyncError) + ')' : '') + '</span>';
      main.appendChild(nameLine); main.appendChild(metaLine);
      var actions = document.createElement('div'); actions.className = 'schema-store-item-actions';
      if (!isActive) {
        var selectBtn = document.createElement('button'); selectBtn.type = 'button'; selectBtn.className = 'btn btn-outline-primary btn-sm schema-store-select-btn'; selectBtn.setAttribute('data-entry-id', e.id); selectBtn.innerHTML = 'Set Active';
        selectBtn.addEventListener('click', function () { schemaStore.setActiveId(e.id); rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderSchemaStoreList(); });
        actions.appendChild(selectBtn);
      }
      item.appendChild(main); item.appendChild(actions); box.appendChild(item);
    });
  }
  var targetSchemaId = null;
  function renderTargetSchemaSelect() {
    var sel = $('targetSchemaSelect'); if (!sel) return; var entries = schemaStore.listEntries();
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
    $('deleteStoredSchemaPasswordInput').value = ''; $('deleteStoredSchemaPasswordError').classList.add('d-none'); if (deleteStoredSchemaModal) deleteStoredSchemaModal.show();
  });
  var deleteStoredSchemaModalEl = $('deleteStoredSchemaModal'); var deleteStoredSchemaModal = window.bootstrap && deleteStoredSchemaModalEl ? new window.bootstrap.Modal(deleteStoredSchemaModalEl) : null;
  if ($('confirmDeleteStoredSchemaBtn')) $('confirmDeleteStoredSchemaBtn').addEventListener('click', function () {
    var pw = $('deleteStoredSchemaPasswordInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (!ok) { $('deleteStoredSchemaPasswordError').classList.remove('d-none'); return; }
      schemaStore.removeEntry(targetSchemaId); targetSchemaId = schemaStore.getActiveId(); rebuildEngine(); refreshAllViewsAfterSchemaChange(); renderSchemaPersistenceStatus(); renderSchemaStoreList(); renderTargetSchemaSelect();
      if (deleteStoredSchemaModal) deleteStoredSchemaModal.hide();
    });
  });

  function moduleLabels() { return engine.getModuleLabels(); }
  function allTables() { return engine.getAllTables().slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }); }

  /* ---------------- Navbar / layout basics ---------------- */
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

  var offcanvasEl = $('mainMenu'); var offcanvasInstance = window.bootstrap && offcanvasEl ? new window.bootstrap.Offcanvas(offcanvasEl) : null;
  function closeMenu() { if (offcanvasInstance) offcanvasInstance.hide(); }
  var currentView = 'quickstart';
  function showView(view) {
    document.querySelectorAll('.offcanvas-body > button.nav-link, .menu-submenu .nav-link').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    document.querySelectorAll('.app-view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    window.scrollTo(0, 0); currentView = view;
    if (view === 'usedschema') { renderUsedSchema(); renderSchemaStoreList(); }
  }
  document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function () { showView(b.getAttribute('data-view')); closeMenu(); }); });
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

  var QUICK_EXAMPLES = [
    { ic: 'bi-person-check', title: 'Users whose login is allowed', desc: 'A simple single-table filter — resolved automatically.', text: 'Show all users whose login is allowed.', badge: 'badge-teal' },
    { ic: 'bi-people-fill', title: 'Active users, group & exclusion', desc: 'Multi-table join, filter, exclusion, and sort — all automatic.', text: 'Show all active users with their email address and user group, exclude Basware users, and sort by login account.', badge: 'badge-indigo' },
    { ic: 'bi-bank', title: 'Active suppliers', desc: 'Table + columns + filter, identified from plain language.', text: 'Show supplier name and supplier code for active suppliers.', badge: 'badge-orange' },
    { ic: 'bi-cash-coin', title: 'Total invoiced per supplier', desc: 'Aggregation (SUM) with an automatic GROUP BY and join.', text: 'Show the total gross amount grouped by supplier.', badge: 'badge-purple' },
    { ic: 'bi-envelope', title: 'Supplier email addresses', desc: 'Maps everyday wording to the right schema column.', text: 'Show the supplier email address.', badge: 'badge-pink' },
    { ic: 'bi-diagram-3', title: 'Supervisor chain (recursive)', desc: 'Walk the whole reporting hierarchy in one query.', hierarchy: 'ADM_USER_DATA', badge: 'badge-blue' }
  ];
  (function initQuickStart() {
    var grid = $('qsExampleGrid'); if (!grid) return;
    grid.innerHTML = QUICK_EXAMPLES.map(function (q, i) {
      return '<div class="col"><div class="card h-100 qs-example-card" data-i="' + i + '"><div class="card-body"><div class="qs-icon-badge ' + q.badge + ' mb-2"><i class="bi ' + q.ic + '"></i></div><h3 class="h6">' + esc(q.title) + '</h3><p class="small text-body-secondary mb-0">' + esc(q.desc) + '</p></div></div></div>';
    }).join('');
    grid.querySelectorAll('.qs-example-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var q = QUICK_EXAMPLES[+card.getAttribute('data-i')]; showView('builder');
        if (q.hierarchy) { resetQueryState(false); $('optHierarchy').value = q.hierarchy; selectedTables = [q.hierarchy]; columnState = {}; refreshTablesColumnsUI(); runGenerate(); }
        else { resetQueryState(false); $('promptInput').value = q.text; runGenerate(); }
      });
    });
    refreshModuleChips();
  })();
  function refreshModuleChips() {
    var counts = {}; allTables().forEach(function (t) { counts[t.module] = (counts[t.module] || 0) + 1; }); var labels = moduleLabels();
    var el = $('qsModuleChips'); if (!el) return;
    el.innerHTML = Object.keys(counts).sort().map(function (m) { return '<span class="badge text-bg-secondary module-chip me-1 mb-1">' + esc(labels[m] || m) + ' · ' + counts[m] + '</span>'; }).join('');
  }

  var selectedTables = []; var columnState = {};
  function refreshModuleDropdown() {
    var sel = $('moduleFilterSel'); if (!sel) return; var labels = moduleLabels(); var counts = {};
    allTables().forEach(function (t) { counts[t.module] = (counts[t.module] || 0) + 1; });
    sel.innerHTML = '<option value="">Select Module ▾</option>' + Object.keys(counts).sort().map(function (m) { return '<option value="' + m + '">' + esc(labels[m] || m) + ' (' + counts[m] + ')</option>'; }).join('');
  }
  function renderTableList() {
    var moduleFilter = $('moduleFilterSel').value; var searchFilter = ($('tableSearchInput').value || '').toLowerCase(); var grid = $('tableListGrid'); grid.innerHTML = '';
    allTables().forEach(function (t) {
      if (moduleFilter && t.module !== moduleFilter) return;
      if (searchFilter && (t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(searchFilter) === -1) return;
      var col = document.createElement('div'); col.className = 'col-md-6 col-lg-4';
      var checked = selectedTables.indexOf(t.name) !== -1;
      col.innerHTML = '<label class="form-check d-flex align-items-start gap-2 border rounded p-2"><input type="checkbox" class="form-check-input mt-1"' + (checked ? ' checked' : '') + '><span><code>' + esc(t.name) + '</code><br><span class="small text-body-secondary">(' + esc(t.module) + ')</span></span></label>';
      col.querySelector('input').addEventListener('change', function (e) { toggleTable(t.name, e.target.checked); });
      grid.appendChild(col);
    });
  }
  function visibleTableNames() {
    var moduleFilter = $('moduleFilterSel').value; var searchFilter = ($('tableSearchInput').value || '').toLowerCase();
    return allTables().filter(function (t) { if (moduleFilter && t.module !== moduleFilter) return false; if (searchFilter && (t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(searchFilter) === -1) return false; return true; }).map(function (t) { return t.name; });
  }
  function toggleTable(name, on) {
    var idx = selectedTables.indexOf(name);
    if (on && idx === -1) selectedTables.push(name);
    if (!on && idx !== -1) { selectedTables.splice(idx, 1); delete columnState[name]; }
    refreshTableSelCount(); refreshSelectedTableDropdown(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows();
  }
  function refreshTableSelCount() { var el = $('tableSelCount'); if (el) el.textContent = selectedTables.length + ' table' + (selectedTables.length === 1 ? '' : 's') + ' selected'; }
  if ($('moduleFilterSel')) $('moduleFilterSel').addEventListener('change', renderTableList);
  if ($('tableSearchInput')) $('tableSearchInput').addEventListener('input', renderTableList);
  if ($('tableSelectAllBtn')) $('tableSelectAllBtn').addEventListener('click', function () { visibleTableNames().forEach(function (n) { if (selectedTables.indexOf(n) === -1) selectedTables.push(n); }); refreshTableSelCount(); refreshSelectedTableDropdown(); renderTableList(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); });
  if ($('tableUnselectAllBtn')) $('tableUnselectAllBtn').addEventListener('click', function () { selectedTables = []; columnState = {}; refreshTableSelCount(); refreshSelectedTableDropdown(); renderTableList(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); });
  function refreshSelectedTableDropdown() {
    var sel = $('selectedTableDropdown'); if (!sel) return; var current = sel.value;
    sel.innerHTML = '<option value="">Selected Table ▾</option>' + selectedTables.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
    if (selectedTables.indexOf(current) !== -1) sel.value = current; else if (selectedTables.length) sel.value = selectedTables[0];
  }
  if ($('selectedTableDropdown')) $('selectedTableDropdown').addEventListener('change', renderColumnList);
  function ensureColState(tname) { if (!columnState[tname]) columnState[tname] = {}; return columnState[tname]; }

  function buildColumnRow(tname, col) {
    var state = ensureColState(tname);
    if (!state[col.name]) state[col.name] = { checked: false, alias: col.alias || '', decode: false, elseMode: 'convert' };
    var s = state[col.name];
    var row = document.createElement('div'); row.id = 'colrow_' + tname + '_' + col.name; row.className = 'column-row-grid' + (s.checked ? ' on' : '');
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input col-check'; cb.checked = s.checked;
    var nameWrap = document.createElement('div'); nameWrap.className = 'col-name';
    var badgeText = col.primary_key ? 'PK' : (col.foreign_key ? 'FK' : (col.type || '').split('(')[0]);
    nameWrap.innerHTML = '<code>' + col.name + '</code> <span class="badge text-bg-light border">' + esc(badgeText) + '</span>' + (col.description ? '<div class="small text-body-secondary">' + esc(col.description) + '</div>' : '');
    var aliasInput = document.createElement('input'); aliasInput.type = 'text'; aliasInput.className = 'form-control form-control-sm col-alias'; aliasInput.placeholder = 'rename (optional)'; aliasInput.value = s.alias; aliasInput.disabled = !s.checked;
    var decodeWrap = document.createElement('div'); decodeWrap.className = 'col-decode' + (!s.checked ? ' disabled' : '');
    var decodeCb = document.createElement('input'); decodeCb.type = 'checkbox'; decodeCb.className = 'form-check-input'; decodeCb.checked = s.decode; decodeCb.disabled = !s.checked;
    var decodeLabel = document.createElement('span'); decodeLabel.className = 'small ms-1'; decodeLabel.textContent = 'Decode';
    decodeWrap.appendChild(decodeCb); decodeWrap.appendChild(decodeLabel);
    cb.addEventListener('change', function () { s.checked = cb.checked; if (!cb.checked) { s.decode = false; decodeCb.checked = false; } row.classList.toggle('on', cb.checked); aliasInput.disabled = !cb.checked; decodeCb.disabled = !cb.checked; decodeWrap.classList.toggle('disabled', !cb.checked); refreshFilterColumnOptions(); });
    aliasInput.addEventListener('input', function () { s.alias = aliasInput.value.trim(); });
    decodeCb.addEventListener('change', function () { s.decode = decodeCb.checked; });
    row.appendChild(cb); row.appendChild(nameWrap); row.appendChild(aliasInput); row.appendChild(decodeWrap);
    return row;
  }
  function renderColumnList() {
    var body = $('columnListBody'); if (!body) return; body.innerHTML = '';
    var tname = $('selectedTableDropdown').value;
    if (selectedTables.length === 0) { $('columnListEmpty').textContent = 'Select one or more tables above, then pick a table to view its columns.'; return; }
    if (!tname) { $('columnListEmpty').textContent = 'Pick a selected table above to view and choose its columns.'; return; }
    $('columnListEmpty').textContent = ''; var table = engine.getTable(tname); if (!table) return;
    var term = ($('columnSearchInput').value || '').toLowerCase().trim();
    var cols = table.columns.filter(function (c) { return !term || (c.name + ' ' + (c.alias || '') + ' ' + (c.description || '')).toLowerCase().indexOf(term) !== -1; });
    var heading = document.createElement('div'); heading.className = 'col-group-heading'; heading.textContent = tname; body.appendChild(heading);
    cols.forEach(function (c) { body.appendChild(buildColumnRow(tname, c)); });
  }
  if ($('columnSearchInput')) $('columnSearchInput').addEventListener('input', renderColumnList);
  if ($('columnSelectAllBtn')) $('columnSelectAllBtn').addEventListener('click', function () { var tname = $('selectedTableDropdown').value; if (!tname) return; var table = engine.getTable(tname); var state = ensureColState(tname); table.columns.forEach(function (c) { if (!state[c.name]) state[c.name] = { checked: false, alias: c.alias || '', decode: false, elseMode: 'convert' }; state[c.name].checked = true; }); renderColumnList(); refreshFilterColumnOptions(); });
  if ($('columnUnselectAllBtn')) $('columnUnselectAllBtn').addEventListener('click', function () { var tname = $('selectedTableDropdown').value; if (!tname) return; var state = ensureColState(tname); Object.keys(state).forEach(function (k) { state[k].checked = false; state[k].decode = false; }); renderColumnList(); refreshFilterColumnOptions(); });

  function refreshTablesColumnsUI() { refreshModuleDropdown(); renderTableList(); refreshTableSelCount(); refreshSelectedTableDropdown(); renderColumnList(); refreshFilterColumnOptions(); renderJoinPreview(); renderSortRows(); renderExistsRows(); renderScalarRows(); }
  function refreshHierarchyOptions() {
    var sel = $('optHierarchy'); if (!sel) return; var current = sel.value; var opts = ['<option value="">— none —</option>'];
    allTables().forEach(function (t) { if (engine.getSelfReferencingEdges(t.name).length > 0) opts.push('<option value="' + t.name + '">' + t.name + '</option>'); });
    sel.innerHTML = opts.join(''); if (allTables().some(function (t) { return t.name === current; })) sel.value = current;
  }
  function columnOptionsForTables(tableNames) {
    var opts = [];
    (tableNames && tableNames.length ? tableNames : allTables().map(function (t) { return t.name; })).forEach(function (tname) { var t = engine.getTable(tname); if (!t) return; t.columns.forEach(function (c) { opts.push({ table: tname, column: c.name }); }); });
    return opts;
  }
  function renderFilterGroup(containerEl, filterGroup, availableTables, onChange) {
    containerEl.innerHTML = ''; var colOptions = columnOptionsForTables(availableTables);
    filterGroup.conditions.forEach(function (cond, idx) {
      var row = document.createElement('div'); row.className = 'filter-condition-row' + (idx === 0 ? ' first-condition' : '');
      var joinSel = document.createElement('select'); joinSel.className = 'form-select form-select-sm join-select'; joinSel.innerHTML = '<option value="AND">AND</option><option value="OR">OR</option>'; joinSel.value = cond.join || 'AND';
      joinSel.addEventListener('change', function () { cond.join = joinSel.value; onChange(); });
      var colSel = document.createElement('select'); colSel.className = 'form-select form-select-sm filter-col-select';
      colSel.innerHTML = colOptions.map(function (o) { var val = o.table + '.' + o.column; return '<option value="' + val + '">' + o.table + '.' + o.column + '</option>'; }).join('');
      colSel.value = (cond.table ? cond.table + '.' : '') + cond.column;
      colSel.addEventListener('change', function () { var parts = colSel.value.split('.'); cond.table = parts[0]; cond.column = parts[1]; onChange(); });
      var opSel = document.createElement('select'); opSel.className = 'form-select form-select-sm filter-op-select';
      opSel.innerHTML = APSQL_FILTER.OPERATORS.map(function (o) { return '<option value="' + o.id + '">' + o.label + '</option>'; }).join(''); opSel.value = cond.operator;
      var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm filter-value-input'; valInput.placeholder = 'Value'; valInput.value = cond.value || '';
      var val2Input = document.createElement('input'); val2Input.className = 'form-control form-control-sm filter-value2-input'; val2Input.placeholder = 'and...'; val2Input.value = cond.value2 || '';
      var multiHint = document.createElement('div'); multiHint.className = 'multi-value-hint d-none small text-body-secondary'; multiHint.textContent = 'Separate multiple values with commas, e.g. 10, 20, 40';
      function refreshArity() { var op = APSQL_FILTER.getOperator(opSel.value); valInput.style.display = op.arity >= 1 ? '' : 'none'; val2Input.style.display = op.arity === 2 ? '' : 'none'; var isMulti = !!op.multi; valInput.placeholder = isMulti ? 'value1, value2, ...' : 'Value'; multiHint.classList.toggle('d-none', !isMulti); }
      opSel.addEventListener('change', function () { cond.operator = opSel.value; refreshArity(); onChange(); });
      valInput.addEventListener('input', function () { cond.value = valInput.value; });
      val2Input.addEventListener('input', function () { cond.value2 = val2Input.value; });
      refreshArity();
      var toolbar = document.createElement('div'); toolbar.className = 'd-flex gap-1 filter-remove-btn';
      var dupBtn = document.createElement('button'); dupBtn.type = 'button'; dupBtn.className = 'btn btn-outline-secondary btn-sm'; dupBtn.title = 'Duplicate'; dupBtn.textContent = '\u29C9';
      dupBtn.addEventListener('click', function () { var copy = APSQL_FILTER.duplicateCondition(cond); filterGroup.conditions.splice(idx + 1, 0, copy); onChange(); renderFilterGroup(containerEl, filterGroup, availableTables, onChange); });
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm'; rmBtn.title = 'Remove'; rmBtn.textContent = '\u00d7';
      rmBtn.addEventListener('click', function () { filterGroup.conditions.splice(idx, 1); onChange(); renderFilterGroup(containerEl, filterGroup, availableTables, onChange); });
      toolbar.appendChild(dupBtn); toolbar.appendChild(rmBtn);
      row.appendChild(joinSel); row.appendChild(colSel); row.appendChild(opSel); row.appendChild(valInput); row.appendChild(val2Input); row.appendChild(toolbar); row.appendChild(multiHint);
      containerEl.appendChild(row);
    });
    if (!colOptions.length) containerEl.innerHTML = '<p class="multi-row-empty">Select at least one table first to build filter conditions.</p>';
  }
  var readOnlyFilterGroup = { conditions: [] };
  function refreshFilterColumnOptions() { renderFilterGroup($('readOnlyFilterGroup'), readOnlyFilterGroup, selectedTables, function () {}); }
  if ($('readOnlyAddFilterBtn')) $('readOnlyAddFilterBtn').addEventListener('click', function () { var firstTable = selectedTables[0]; var firstCol = firstTable ? engine.getTable(firstTable).columns[0].name : ''; readOnlyFilterGroup.conditions.push(APSQL_FILTER.newCondition({ table: firstTable, column: firstCol })); refreshFilterColumnOptions(); });
  if ($('readOnlyClearFiltersBtn')) $('readOnlyClearFiltersBtn').addEventListener('click', function () { readOnlyFilterGroup.conditions = []; refreshFilterColumnOptions(); });

  function updateJoinCardVisibility() { var card = $('joinOptionCard'); if (!card) return; if (selectedTables.length < 2) { card.classList.add('d-none'); if ($('optJoinInner')) $('optJoinInner').checked = true; syncJoinChoiceHighlight(); } else card.classList.remove('d-none'); }
  function syncJoinChoiceHighlight() { if ($('optJoinInnerLabel')) $('optJoinInnerLabel').classList.toggle('selected', $('optJoinInner').checked); if ($('optJoinLeftLabel')) $('optJoinLeftLabel').classList.toggle('selected', $('optJoinLeft').checked); }
  document.querySelectorAll('input[name="joinType"]').forEach(function (r) { r.addEventListener('change', syncJoinChoiceHighlight); });
  if ($('joinResetBtn')) $('joinResetBtn').addEventListener('click', function () { $('optJoinInner').checked = true; syncJoinChoiceHighlight(); });
  syncJoinChoiceHighlight();

  var relationshipDrafts = {};
  function ensureRelationshipDraft(tableName, candidatePartners) {
    if (!relationshipDrafts[tableName]) { var partner = candidatePartners[0] || ''; var partnerTbl = engine.getTable(partner); var thisTbl = engine.getTable(tableName); relationshipDrafts[tableName] = { partnerTable: partner, thisColumn: thisTbl && thisTbl.columns[0] ? thisTbl.columns[0].name : '', partnerColumn: partnerTbl && partnerTbl.columns[0] ? partnerTbl.columns[0].name : '' }; }
    return relationshipDrafts[tableName];
  }
  var pendingSaveRelationshipDraft = null;
  function renderJoinPreview() {
    updateJoinCardVisibility(); var previewBox = $('joinPreviewBox'); var defineBox = $('defineRelationshipContainer'); if (!previewBox || !defineBox) return;
    if (selectedTables.length < 2) { previewBox.innerHTML = '<p class="multi-row-empty">Select two or more tables on the Tables & Columns tab to see how they\u2019ll be connected.</p>'; defineBox.innerHTML = ''; return; }
    var plan = APSQL_ENGINE.buildJoinPlan(engine, selectedTables);
    var lines = plan.joins.map(function (j) { return '<li><code>' + j.on.fromTable + '</code> \u2192 <code>' + j.on.toTable + '</code> using <code>' + j.on.fromColumn + ' = ' + j.on.toColumn + '</code></li>'; });
    if (!lines.length) lines.push('<li>No connections established yet.</li>');
    previewBox.innerHTML = '<ul>' + lines.join('') + '</ul>'; defineBox.innerHTML = '';
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
      var thisTbl = engine.getTable(tableName); thisColSel.innerHTML = (thisTbl ? thisTbl.columns : []).map(function (c) { return '<option value="' + c.name + '">' + c.name + '</option>'; }).join('');
      if (thisTbl && thisTbl.columns.some(function (c) { return c.name === draft.thisColumn; })) thisColSel.value = draft.thisColumn;
      var partnerTbl = engine.getTable(partnerSel.value); partnerColSel.innerHTML = (partnerTbl ? partnerTbl.columns : []).map(function (c) { return '<option value="' + c.name + '">' + c.name + '</option>'; }).join('');
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
    var activeBadge = document.createElement('span'); activeBadge.className = 'badge text-bg-success relationship-active-badge d-none'; activeBadge.innerHTML = 'Active for this session';
    if (relationshipStore.hasManualRelationship(tableName, draft.partnerTable)) activeBadge.classList.remove('d-none');
    var actions = document.createElement('div'); actions.className = 'define-relationship-actions mt-2';
    var useBtn = document.createElement('button'); useBtn.type = 'button'; useBtn.className = 'btn btn-outline-primary btn-sm'; useBtn.innerHTML = 'Use for this query';
    useBtn.addEventListener('click', function () { relationshipStore.setManualRelationship(tableName, thisColSel.value, partnerSel.value, partnerColSel.value); renderJoinPreview(); });
    var saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'btn btn-outline-success btn-sm'; saveBtn.innerHTML = 'Save relationship to schema';
    saveBtn.addEventListener('click', function () {
      pendingSaveRelationshipDraft = { fromTable: tableName, fromColumn: thisColSel.value, toTable: partnerSel.value, toColumn: partnerColSel.value };
      $('saveRelationshipSummary').innerHTML = '<code>' + tableName + '.' + thisColSel.value + '</code> \u2192 <code>' + partnerSel.value + '.' + partnerColSel.value + '</code>';
      $('saveRelationshipPasswordInput').value = ''; $('saveRelationshipPasswordError').classList.add('d-none'); if (saveRelationshipModal) saveRelationshipModal.show();
    });
    actions.appendChild(useBtn); actions.appendChild(saveBtn); actions.appendChild(activeBadge); box.appendChild(actions);
    return box;
  }

  var sortRows = [];
  function renderSortRows() {
    var container = $('sortRowsContainer'); if (!container) return; container.innerHTML = '';
    var colOptions = columnOptionsForTables(selectedTables);
    if (!colOptions.length) { container.innerHTML = '<p class="multi-row-empty">Select at least one table on the Tables & Columns tab first.</p>'; return; }
    if (!sortRows.length) { container.innerHTML = '<p class="multi-row-empty">No sort columns added yet — results will be shown in default order.</p>'; return; }
    sortRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row';
      var colSel = document.createElement('select'); colSel.className = 'form-select form-select-sm filter-col-select';
      colSel.innerHTML = colOptions.map(function (o) { var val = o.table + '.' + o.column; return '<option value="' + val + '">' + o.table + '.' + o.column + '</option>'; }).join('');
      colSel.value = (row.table ? row.table + '.' : '') + row.column;
      colSel.addEventListener('change', function () { var parts = colSel.value.split('.'); row.table = parts[0]; row.column = parts[1]; });
      var dirSel = document.createElement('select'); dirSel.className = 'form-select form-select-sm filter-op-select'; dirSel.innerHTML = '<option value="ASC">Smallest / earliest first</option><option value="DESC">Largest / latest first</option>'; dirSel.value = row.direction || 'ASC';
      dirSel.addEventListener('change', function () { row.direction = dirSel.value; });
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm filter-remove-btn'; rmBtn.textContent = '\u00d7'; rmBtn.addEventListener('click', function () { sortRows.splice(idx, 1); renderSortRows(); });
      rowEl.appendChild(colSel); rowEl.appendChild(dirSel); rowEl.appendChild(rmBtn); container.appendChild(rowEl);
    });
  }
  if ($('addSortRowBtn')) $('addSortRowBtn').addEventListener('click', function () { if (!selectedTables.length) return; var t = selectedTables[0]; var tbl = engine.getTable(t); sortRows.push({ table: t, column: tbl ? tbl.columns[0].name : '', direction: 'ASC' }); renderSortRows(); });
  if ($('clearSortBtn')) $('clearSortBtn').addEventListener('click', function () { sortRows = []; renderSortRows(); });

  var existsRows = [];
  function renderExistsRows() {
    var container = $('existsRowsContainer'); if (!container) return; container.innerHTML = ''; var tbls = allTables();
    if (!existsRows.length) { container.innerHTML = '<p class="multi-row-empty">No related-table checks added yet.</p>'; return; }
    existsRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row';
      var tblSel = document.createElement('select'); tblSel.className = 'form-select form-select-sm filter-col-select'; tblSel.innerHTML = tbls.map(function (t) { return '<option value="' + t.name + '">' + t.name + '</option>'; }).join(''); tblSel.value = row.relatedTable || (tbls[0] ? tbls[0].name : '');
      tblSel.addEventListener('change', function () { row.relatedTable = tblSel.value; });
      var negWrap = document.createElement('div'); negWrap.className = 'form-check d-flex align-items-center gap-1';
      var negCb = document.createElement('input'); negCb.type = 'checkbox'; negCb.className = 'form-check-input mt-0'; negCb.checked = !!row.negate; negCb.addEventListener('change', function () { row.negate = negCb.checked; });
      var negLabel = document.createElement('label'); negLabel.className = 'form-check-label multi-row-remove-label'; negLabel.textContent = 'Opposite (no match)'; negWrap.appendChild(negCb); negWrap.appendChild(negLabel);
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm filter-remove-btn'; rmBtn.textContent = '\u00d7'; rmBtn.addEventListener('click', function () { existsRows.splice(idx, 1); renderExistsRows(); });
      rowEl.appendChild(tblSel); rowEl.appendChild(negWrap); rowEl.appendChild(rmBtn); container.appendChild(rowEl);
    });
  }
  if ($('addExistsRowBtn')) $('addExistsRowBtn').addEventListener('click', function () { var tbls = allTables(); if (!tbls.length) return; existsRows.push({ relatedTable: tbls[0].name, negate: false }); renderExistsRows(); });
  if ($('clearExistsBtn')) $('clearExistsBtn').addEventListener('click', function () { existsRows = []; renderExistsRows(); });

  var scalarRows = [];
  function renderScalarRows() {
    var container = $('scalarRowsContainer'); if (!container) return; container.innerHTML = ''; var tbls = allTables();
    if (!scalarRows.length) { container.innerHTML = '<p class="multi-row-empty">No related counts added yet.</p>'; return; }
    scalarRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row';
      var tblSel = document.createElement('select'); tblSel.className = 'form-select form-select-sm filter-col-select'; tblSel.innerHTML = tbls.map(function (t) { return '<option value="' + t.name + '">' + t.name + '</option>'; }).join(''); tblSel.value = row.relatedTable || (tbls[0] ? tbls[0].name : '');
      tblSel.addEventListener('change', function () { row.relatedTable = tblSel.value; });
      var label = document.createElement('span'); label.className = 'small text-body-secondary'; label.textContent = 'Count of matching records';
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm filter-remove-btn'; rmBtn.textContent = '\u00d7'; rmBtn.addEventListener('click', function () { scalarRows.splice(idx, 1); renderScalarRows(); });
      rowEl.appendChild(tblSel); rowEl.appendChild(label); rowEl.appendChild(rmBtn); container.appendChild(rowEl);
    });
  }
  if ($('addScalarRowBtn')) $('addScalarRowBtn').addEventListener('click', function () { var tbls = allTables(); if (!tbls.length) return; scalarRows.push({ relatedTable: tbls[0].name }); renderScalarRows(); });
  if ($('clearScalarBtn')) $('clearScalarBtn').addEventListener('click', function () { scalarRows = []; renderScalarRows(); });

  if ($('optLimitClearBtn')) $('optLimitClearBtn').addEventListener('click', function () { $('optLimit').value = ''; });
  if ($('optViewClearBtn')) $('optViewClearBtn').addEventListener('click', function () { $('optView').value = ''; });
  if ($('optHavingClearBtn')) $('optHavingClearBtn').addEventListener('click', function () { $('optHaving').value = ''; });
  if ($('optHierarchyClearBtn')) $('optHierarchyClearBtn').addEventListener('click', function () { $('optHierarchy').value = ''; });

  var KW = /\b(SELECT|FROM|WHERE|JOIN|LEFT|INNER|ON|AND|OR|GROUP BY|ORDER BY|HAVING|DISTINCT|AS|TOP|FETCH FIRST|ROWS ONLY|BETWEEN|IN|LIMIT|CASE|WHEN|THEN|ELSE|END|WITH|RECURSIVE|EXISTS|NOT|LIKE|IS NULL|IS NOT NULL|COUNT|SUM|AVG|MIN|MAX)\b/g;
  function highlight(sql) { var e = esc(sql); e = e.replace(/'([^']*)'/g, "<span class=\"sql-str\">'$1'</span>"); e = e.replace(KW, '<span class="sql-kw">$1</span>'); return e; }
  function renderSuggestedFixes(message) { var suggestions = APSQL_SUGGEST.buildSuggestions(message); return '<div class="suggested-fixes-box mt-2"><strong>Suggested fixes:</strong><ul>' + suggestions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>'; }
  function renderOptimizeReport(containerId, opt) {
    var box = $(containerId); if (!box) return; var parts = [];
    if (opt.changesApplied.length) parts.push('<div><strong>Changes applied:</strong><ul>' + opt.changesApplied.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>');
    if (opt.recommendations.length) parts.push('<div><strong>Recommendations:</strong><ul>' + opt.recommendations.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>');
    if (!parts.length) parts.push('<div class="alert alert-success mb-0">No further optimizations detected — this query already looks efficient.</div>');
    box.innerHTML = '<div class="optimize-report-box">' + parts.join('') + '</div>';
  }

  var lastResult = null;
  function renderResult(res) {
    lastResult = res; var body = $('resultBody');
    if (res.status === 'rejected' || res.status === 'clarification_needed') {
      var titleText = res.status === 'rejected' ? 'Could not build this query.' : 'One more detail needed.'; var alertClass = res.status === 'rejected' ? 'alert-danger' : 'alert-warning';
      body.innerHTML = '<div class="alert ' + alertClass + '"><strong>' + titleText + '</strong><div>' + esc(res.message) + '</div>' + renderSuggestedFixes(res.message) + '</div>';
      $('copyBtn').classList.add('d-none'); $('optimizeBtn').classList.add('d-none'); $('optimizeReportBox').innerHTML = ''; $('explainBtn').classList.add('d-none'); $('explanationReportBox').innerHTML = ''; $('explanationReportBox').classList.add('d-none'); return;
    }
    var tables = (res.tablesUsed || []).map(function (t) { return '<span class="badge text-bg-secondary me-1">' + t + '</span>'; }).join('');
    var cols = (res.columnsUsed || []).map(function (c) { return '<span class="badge text-bg-light border me-1">' + c.table + '.' + c.column + (c.alias ? ' as ' + c.alias : '') + '</span>'; }).join('');
    var filters = (res.filtersApplied || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') || '<li>None</li>';
    var assumptions = (res.assumptions || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    body.innerHTML = '<div class="small text-success mb-2">\u2705 Query validated against active schema (' + esc(res.dialect || '') + ', read-only)</div><pre class="sql-output">' + highlight(res.sql) + '</pre><div class="mt-2"><strong>Tables Used:</strong> ' + (tables || 'None') + '</div><div class="mt-1"><strong>Columns Used:</strong> ' + (cols || 'None (aggregated query)') + '</div><div class="mt-2"><strong>Filters Applied:</strong><ul>' + filters + '</ul></div>' + (assumptions ? '<div><strong>Assumptions:</strong><ul>' + assumptions + '</ul></div>' : '');
    $('copyBtn').classList.remove('d-none'); $('optimizeBtn').classList.remove('d-none'); $('optimizeReportBox').innerHTML = ''; $('explainBtn').classList.remove('d-none');
  }
  if ($('copyBtn')) $('copyBtn').addEventListener('click', function () { if (lastResult && lastResult.status === 'ok') { navigator.clipboard && navigator.clipboard.writeText(lastResult.sql); var old = $('copyBtn').innerHTML; $('copyBtn').innerHTML = '\u2705 Copied'; setTimeout(function () { $('copyBtn').innerHTML = old; }, 1300); } });
  if ($('optimizeBtn')) $('optimizeBtn').addEventListener('click', function () { if (!lastResult || lastResult.status !== 'ok') return; var opt = APSQL_OPTIMIZE.optimizeSql(engine, lastResult); if (opt.hasChanges) { lastResult = Object.assign({}, lastResult, { sql: opt.optimizedSql }); renderResult(lastResult); } renderOptimizeReport('optimizeReportBox', opt); });

  var lastInterpretation = null;
  if ($('explainBtn')) $('explainBtn').addEventListener('click', function () {
    var box = $('explanationReportBox'); var isHidden = box.classList.contains('d-none'); if (!isHidden) { box.classList.add('d-none'); return; }
    var lines = lastInterpretation ? APSQL_NLQUERY.explainInterpretation(lastInterpretation) : [];
    if (!lines.length) box.innerHTML = '<div class="alert alert-secondary mb-0">This query was built manually (or nothing to explain yet). Describe your requirement above and click Build Query to see a plain-language explanation here.</div>';
    else box.innerHTML = '<div><strong>This query:</strong><ul>' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div>';
    box.classList.remove('d-none');
  });

  function renderConfidenceChecklist(interpretation) {
    var box = $('confidenceChecklistBox'); if (!box) return;
    if (!interpretation || (!interpretation.tables.length && !interpretation.warnings.length)) { box.innerHTML = ''; return; }
    var c = interpretation.confidence || {};
    var items = [{ ok: c.tableIdentified, label: 'Table identified' }, { ok: c.columnsIdentified, label: 'Columns identified' }, { ok: c.relationshipsIdentified, label: 'Relationships identified' }, { ok: !c.hasAmbiguities, label: c.hasAmbiguities ? 'Some terms need clarification' : 'Filters identified' }];
    var html = '<ul>' + items.map(function (it) { return '<li class="' + (it.ok ? 'ok' : 'warn') + '"><i class="bi ' + (it.ok ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill') + '"></i> ' + esc(it.label) + '</li>'; }).join('') + '</ul>';
    if (c.unresolvedJoins && c.unresolvedJoins.length) html += '<div class="small text-warning">\u26A0\uFE0F Unable to automatically connect: ' + esc(c.unresolvedJoins.join(', ')) + '. You can connect these manually in Advanced Options.</div>';
    box.innerHTML = html;
  }
  function renderAmbiguityBox(interpretation) {
    var box = $('ambiguityBox'); if (!box) return;
    if (!interpretation || !interpretation.ambiguities || !interpretation.ambiguities.length) { box.classList.add('d-none'); box.innerHTML = ''; return; }
    var html = '<p class="mb-2">A few terms in your description could mean more than one thing. Please choose the intended condition:</p>';
    interpretation.ambiguities.forEach(function (amb, ai) {
      html += '<div class="ambiguity-option-row-wrap mb-2"><div class="small fw-semibold">\u201C' + esc(amb.term) + '\u201D could refer to:</div><div class="ambiguity-option-row">';
      amb.options.forEach(function (opt, oi) { html += '<button type="button" class="btn btn-outline-secondary ambiguity-option-btn" data-amb="' + ai + '" data-opt="' + oi + '">' + esc(opt.table + '.' + opt.column) + (opt.description ? ' <span class="text-body-secondary">' + esc(opt.description) + '</span>' : '') + '</button>'; });
      html += '</div></div>';
    });
    box.innerHTML = html; box.classList.remove('d-none');
    box.querySelectorAll('.ambiguity-option-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ai = +btn.getAttribute('data-amb'), oi = +btn.getAttribute('data-opt'); var amb = interpretation.ambiguities[ai]; var opt = amb.options[oi];
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
    var box = $('requirementsSummaryBody'); if (!box) return; var promptText = $('promptInput').value.trim(); var parts = [];
    parts.push('<h4 class="h6">Describe What You Need</h4>');
    parts.push(promptText ? '<p>' + esc(promptText) + '</p>' : '<p class="text-body-secondary">No natural-language requirement provided.</p>');
    parts.push('<h4 class="h6">Selected Tables</h4>');
    parts.push(selectedTables.length ? '<p>' + selectedTables.map(esc).join(', ') + '</p>' : '<p class="text-body-secondary">No tables selected yet.</p>');
    parts.push('<h4 class="h6">Selected Columns</h4>');
    var anyCols = false, colsHtml = '';
    Object.keys(columnState).forEach(function (tname) {
      var checkedCols = Object.keys(columnState[tname]).filter(function (c) { return columnState[tname][c].checked; });
      if (!checkedCols.length) return; anyCols = true;
      colsHtml += '<div><code>' + tname + '</code>: ' + checkedCols.map(function (c) { var s = columnState[tname][c]; var extras = []; if (s.alias) extras.push('alias: ' + esc(s.alias)); if (s.decode) extras.push('decode: on'); return c + (extras.length ? ' (' + extras.join(', ') + ')' : ''); }).join(', ') + '</div>';
    });
    parts.push(anyCols ? colsHtml : '<p class="text-body-secondary">No columns selected yet.</p>');
    parts.push('<h4 class="h6">Filters</h4>');
    var builtFilters = APSQL_FILTER.buildWhereSql(readOnlyFilterGroup, $('dialectSel').value);
    parts.push(builtFilters.plainEnglish ? '<p><code>' + esc(builtFilters.plainEnglish) + '</code></p>' : '<p class="text-body-secondary">No filters added yet.</p>');
    parts.push('<h4 class="h6">Advanced Options</h4>');
    var advLines = describeAdvancedOptions();
    parts.push(advLines.length ? '<p>' + advLines.map(esc).join('<br>') + '</p>' : '<p class="text-body-secondary">No advanced options enabled.</p>');
    box.innerHTML = parts.join('');
  }
  function collectSelectedColumns() {
    var out = [];
    Object.keys(columnState).forEach(function (tname) { Object.keys(columnState[tname]).forEach(function (cname) { var s = columnState[tname][cname]; if (s.checked) { var entry = { table: tname, column: cname }; if (s.alias) entry.alias = s.alias; if (s.decode) { entry.decode = true; entry.elseMode = s.elseMode || 'convert'; } out.push(entry); } }); });
    return out;
  }
  var nlAggregates = []; var nlGroupBy = []; var nlHaving = null;
  function buildOptions() {
    var opts = { dialect: $('dialectSel').value }; if (selectedTables.length) opts.selectedTables = selectedTables.slice();
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
    var interpretation = APSQL_NLQUERY.interpretRequirement(text, engine, {}); lastInterpretation = interpretation;
    selectedTables = APSQL_NLQUERY.mergeTableLists(selectedTables, interpretation.tables);
    var manualColsFlat = collectSelectedColumns(); var mergedCols = APSQL_NLQUERY.mergeColumnLists(manualColsFlat, interpretation.columns);
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
    refreshTablesColumnsUI(); renderDescriptionInterpretationBox(interpretation); renderConfidenceChecklist(interpretation); renderAmbiguityBox(interpretation);
  }
  function renderDescriptionInterpretationBox(interpretation) {
    var box = $('descriptionInterpretationBox'); if (!box) return;
    var hasMatched = interpretation.matched && interpretation.matched.length; var hasWarnings = interpretation.warnings && interpretation.warnings.length;
    if (!hasMatched && !hasWarnings) { box.innerHTML = ''; return; }
    var parts = [];
    if (hasMatched) parts.push('<div>I understood your request as:<ul>' + interpretation.matched.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>');
    if (hasWarnings) parts.push('<div class="text-warning">' + interpretation.warnings.map(esc).join('<br>') + '</div>');
    box.innerHTML = '<div class="description-interpretation-box alert alert-light border">' + parts.join('') + '</div>';
  }
  function runGenerate() {
    applyDescriptionToSelection(); var promptText = $('promptInput').value.trim(); var opts = buildOptions();
    var res = APSQL_ENGINE.generateSql(promptText, opts, engine, decodeStore); renderResult(res);
    if (lastInterpretation && lastInterpretation.confidence) lastInterpretation.confidence.sqlValidated = (res.status === 'ok');
    showView('builder'); $('resultBody').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  if ($('generateBtn')) $('generateBtn').addEventListener('click', runGenerate);
  if ($('generateFromDescriptionBtn')) $('generateFromDescriptionBtn').addEventListener('click', runGenerate);
  if ($('promptInput')) $('promptInput').addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runGenerate(); });
  function resetQueryState(alsoClearPrompt) {
    if (alsoClearPrompt !== false) $('promptInput').value = '';
    selectedTables = []; columnState = {}; readOnlyFilterGroup.conditions = []; sortRows = []; existsRows = []; scalarRows = []; nlAggregates = []; nlGroupBy = []; nlHaving = null;
    $('optJoinInner').checked = true; syncJoinChoiceHighlight(); $('optLimit').value = ''; $('optView').value = ''; $('optHaving').value = ''; $('optHierarchy').value = ''; $('optDistinct2').checked = false;
    lastInterpretation = null; lastResult = null; $('descriptionInterpretationBox').innerHTML = ''; $('confidenceChecklistBox').innerHTML = ''; $('ambiguityBox').classList.add('d-none'); $('ambiguityBox').innerHTML = '';
    $('explanationReportBox').classList.add('d-none'); $('explanationReportBox').innerHTML = ''; $('optimizeReportBox').innerHTML = ''; $('copyBtn').classList.add('d-none'); $('optimizeBtn').classList.add('d-none'); $('explainBtn').classList.add('d-none');
    $('resultBody').innerHTML = '<p class="text-body-secondary mb-0">Your generated SQL will appear here as soon as you click Build Query.</p>'; refreshTablesColumnsUI();
  }
  if ($('resetQueryBtn')) $('resetQueryBtn').addEventListener('click', function () { resetQueryState(true); });
  refreshTablesColumnsUI(); refreshHierarchyOptions();

  /* ---------------- Query Builder for CR ---------------- */
  var crCommand = 'INSERT'; var crTable = ''; var crInsertColumns = {}; var crUpdateColumns = {}; var crFilterGroup = { conditions: [] }; var crLastResult = null;
  function crRefreshTableOptions() { var sel = $('crTableSelect'); if (!sel) return; var current = sel.value; sel.innerHTML = allTables().map(function (t) { return '<option value="' + t.name + '">' + t.name + '</option>'; }).join(''); if (allTables().some(function (t) { return t.name === current; })) sel.value = current; else sel.value = allTables()[0] ? allTables()[0].name : ''; crTable = sel.value; }
  if ($('crTableSelect')) $('crTableSelect').addEventListener('change', function () { crTable = $('crTableSelect').value; crInsertColumns = {}; crUpdateColumns = {}; crFilterGroup = { conditions: [] }; crRenderAll(); });
  document.querySelectorAll('.cr-command-option').forEach(function (opt) { opt.addEventListener('click', function () { document.querySelectorAll('.cr-command-option').forEach(function (o) { o.classList.remove('active'); }); opt.classList.add('active'); crCommand = opt.getAttribute('data-command'); crRenderAll(); }); });
  function crRenderInsertPanel() {
    var table = engine.getTable(crTable); var body = $('crInsertColumnsBody'); body.innerHTML = ''; if (!table) return;
    table.columns.forEach(function (c) {
      if (!crInsertColumns[c.name]) crInsertColumns[c.name] = { checked: false, value: '' }; var s = crInsertColumns[c.name];
      var row = document.createElement('div'); row.className = 'cr-value-row'; var label = document.createElement('div');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input me-2'; cb.checked = s.checked;
      var span = document.createElement('span'); span.innerHTML = '<code>' + c.name + '</code> <span class="small text-body-secondary">' + esc((c.type || '')) + '</span>'; label.appendChild(cb); label.appendChild(span);
      var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm'; valInput.placeholder = 'Value'; valInput.value = s.value; valInput.disabled = !s.checked;
      cb.addEventListener('change', function () { s.checked = cb.checked; valInput.disabled = !cb.checked; }); valInput.addEventListener('input', function () { s.value = valInput.value; });
      row.appendChild(label); row.appendChild(valInput); body.appendChild(row);
    });
  }
  function crRenderUpdatePanel() {
    var table = engine.getTable(crTable); var body = $('crUpdateColumnsBody'); body.innerHTML = ''; if (!table) return;
    table.columns.forEach(function (c) {
      if (!crUpdateColumns[c.name]) crUpdateColumns[c.name] = { checked: false, value: '' }; var s = crUpdateColumns[c.name];
      var row = document.createElement('div'); row.className = 'cr-value-row'; var label = document.createElement('div');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input me-2'; cb.checked = s.checked;
      var span = document.createElement('span'); span.innerHTML = '<code>' + c.name + '</code> <span class="small text-body-secondary">' + esc((c.type || '')) + '</span>'; label.appendChild(cb); label.appendChild(span);
      var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm'; valInput.placeholder = 'New Value'; valInput.value = s.value; valInput.disabled = !s.checked;
      cb.addEventListener('change', function () { s.checked = cb.checked; valInput.disabled = !cb.checked; }); valInput.addEventListener('input', function () { s.value = valInput.value; });
      row.appendChild(label); row.appendChild(valInput); body.appendChild(row);
    });
  }
  function crRenderWherePanel() { var showWhere = crCommand === 'UPDATE' || crCommand === 'DELETE' || crCommand === 'SELECT'; $('crWherePanel').classList.toggle('d-none', !showWhere); if (showWhere) renderFilterGroup($('crFilterGroup'), crFilterGroup, [crTable], function () {}); }
  if ($('crAddFilterBtn')) $('crAddFilterBtn').addEventListener('click', function () { var firstCol = crTable && engine.getTable(crTable) ? engine.getTable(crTable).columns[0].name : ''; crFilterGroup.conditions.push(APSQL_FILTER.newCondition({ table: crTable, column: firstCol })); renderFilterGroup($('crFilterGroup'), crFilterGroup, [crTable], function () {}); });
  if ($('crClearFiltersBtn')) $('crClearFiltersBtn').addEventListener('click', function () { crFilterGroup.conditions = []; renderFilterGroup($('crFilterGroup'), crFilterGroup, [crTable], function () {}); });
  function crRenderDecodePanel() {
    var body = $('crDecodeBody'); var table = engine.getTable(crTable); if (!table) { body.innerHTML = ''; return; }
    var relevantCols = (crCommand === 'INSERT' ? Object.keys(crInsertColumns) : Object.keys(crUpdateColumns)).filter(function (name) { var s = crCommand === 'INSERT' ? crInsertColumns[name] : crUpdateColumns[name]; return s && s.checked; });
    if (!relevantCols.length) { body.innerHTML = '<p class="text-body-secondary small mb-0">Select a column above to configure or view its decode.</p>'; return; }
    body.innerHTML = '';
    relevantCols.forEach(function (colName) {
      var resolved = APSQL_DECODE.resolveDecode(engine, decodeStore, crTable, colName); var box = document.createElement('div'); box.className = 'mb-3';
      var header = document.createElement('div'); header.className = 'd-flex align-items-center gap-2 mb-1'; header.innerHTML = '<code>' + colName + '</code>';
      if (resolved.source) header.innerHTML += ' <span class="badge text-bg-light border">' + (resolved.source === 'schema' ? 'Schema Defined' : 'User Defined') + '</span>';
      box.appendChild(header);
      if (resolved.values && resolved.values.length) { var list = document.createElement('div'); list.className = 'small text-body-secondary'; list.innerHTML = resolved.values.map(function (p) { return esc(p.code) + ' = ' + esc(p.label); }).join('<br>'); box.appendChild(list); }
      else { var noneMsg = document.createElement('div'); noneMsg.className = 'small text-body-secondary mb-1'; noneMsg.textContent = 'No predefined decode available.'; box.appendChild(noneMsg); }
      body.appendChild(box);
    });
  }
  function crRenderRequirementsSummary() {
    var box = $('crRequirementsSummaryBody'); var parts = []; var descText = $('crDescriptionInput').value.trim();
    parts.push('<h4 class="h6">Describe What You Need</h4>');
    parts.push(descText ? '<p>' + esc(descText) + '</p>' : '<p class="text-body-secondary">No description provided.</p>');
    parts.push('<p><strong>Query Type:</strong> ' + esc(crCommand) + '</p>');
    parts.push('<p><strong>Table:</strong> ' + esc(crTable) + '</p>');
    if (crCommand === 'INSERT') { var insCols = Object.keys(crInsertColumns).filter(function (n) { return crInsertColumns[n].checked; }); parts.push('<p><strong>Columns:</strong> ' + (insCols.join(', ') || 'None selected') + '</p>'); }
    else if (crCommand === 'UPDATE') { var updCols = Object.keys(crUpdateColumns).filter(function (n) { return crUpdateColumns[n].checked; }); parts.push('<p><strong>Columns to Update:</strong> ' + (updCols.join(', ') || 'None selected') + '</p>'); }
    if (crCommand === 'UPDATE' || crCommand === 'DELETE' || crCommand === 'SELECT') { var built = APSQL_FILTER.buildWhereSql(crFilterGroup, $('crDialectSel').value); parts.push('<p><strong>WHERE:</strong> ' + (built.plainEnglish ? esc(built.plainEnglish) : 'None') + '</p>'); }
    box.innerHTML = parts.join('');
  }
  function crRenderAll() { $('crInsertPanel').classList.toggle('d-none', crCommand !== 'INSERT'); $('crUpdatePanel').classList.toggle('d-none', crCommand !== 'UPDATE'); if (crCommand === 'INSERT') crRenderInsertPanel(); if (crCommand === 'UPDATE') crRenderUpdatePanel(); crRenderWherePanel(); crRenderDecodePanel(); crRenderRequirementsSummary(); }
  function crRenderResult(res) {
    crLastResult = res; var body = $('crResultBody');
    if (res.status === 'rejected') { body.innerHTML = '<div class="alert alert-danger"><strong>Could not build this query.</strong><div>' + esc(res.message) + '</div>' + renderSuggestedFixes(res.message) + '</div>'; $('crCopyBtn').classList.add('d-none'); $('crOptimizeBtn').classList.add('d-none'); $('crOptimizeReportBox').innerHTML = ''; $('crWhereRequiredWarning').classList.toggle('d-none', !res.requiresWhereConfirmation); return; }
    $('crWhereRequiredWarning').classList.add('d-none');
    var warnings = (res.warnings || []).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
    body.innerHTML = '<div class="mb-1"><strong>Query Type:</strong> ' + esc(res.command) + (res.isPreview ? '' : ' <span class="badge text-bg-warning">Change Request Query</span>') + '</div><pre class="sql-output">' + highlight(res.sql) + '</pre>' + (warnings ? '<ul class="text-warning">' + warnings + '</ul>' : '') + '<div class="cr-safety-banner alert alert-secondary mt-2 mb-0 small">Generated SQL only \u2013 this application does not execute database changes.</div>';
    $('crCopyBtn').classList.remove('d-none'); $('crOptimizeBtn').classList.remove('d-none'); $('crOptimizeReportBox').innerHTML = '';
  }
  if ($('crCopyBtn')) $('crCopyBtn').addEventListener('click', function () { if (crLastResult && crLastResult.status === 'ok') { navigator.clipboard && navigator.clipboard.writeText(crLastResult.sql); var old = $('crCopyBtn').innerHTML; $('crCopyBtn').innerHTML = '\u2705 Copied'; setTimeout(function () { $('crCopyBtn').innerHTML = old; }, 1300); } });
  if ($('crOptimizeBtn')) $('crOptimizeBtn').addEventListener('click', function () { if (!crLastResult || crLastResult.status !== 'ok') return; var opt = APSQL_OPTIMIZE.optimizeSql(engine, crLastResult); if (opt.hasChanges) { crLastResult = Object.assign({}, crLastResult, { sql: opt.optimizedSql }); crRenderResult(crLastResult); } renderOptimizeReport('crOptimizeReportBox', opt); });
  function crApplyDescriptionToSelection() {
    var text = $('crDescriptionInput').value.trim(); if (!text) { $('crDescriptionInterpretationBox').innerHTML = ''; return; }
    var interpretation = APSQL_NLQUERY.interpretCrRequirement(text, engine, {});
    if (interpretation.command) { crCommand = interpretation.command; document.querySelectorAll('.cr-command-option').forEach(function (o) { o.classList.toggle('active', o.getAttribute('data-command') === crCommand); }); }
    if (interpretation.table && engine.getTable(interpretation.table) && interpretation.table !== crTable) { crTable = interpretation.table; $('crTableSelect').value = crTable; crInsertColumns = {}; crUpdateColumns = {}; crFilterGroup = { conditions: [] }; }
    if (crCommand === 'INSERT' && interpretation.insertColumns && interpretation.insertColumns.length) interpretation.insertColumns.forEach(function (c) { if (!engine.columnExists(crTable, c.name)) return; if (!crInsertColumns[c.name]) crInsertColumns[c.name] = { checked: false, value: '' }; crInsertColumns[c.name].checked = true; if (!crInsertColumns[c.name].value) crInsertColumns[c.name].value = c.value; });
    if (crCommand === 'UPDATE' && interpretation.updateColumns && interpretation.updateColumns.length) interpretation.updateColumns.forEach(function (c) { if (!engine.columnExists(crTable, c.column)) return; if (!crUpdateColumns[c.column]) crUpdateColumns[c.column] = { checked: false, value: '' }; crUpdateColumns[c.column].checked = true; if (!crUpdateColumns[c.column].value) crUpdateColumns[c.column].value = c.value; });
    if ((crCommand === 'UPDATE' || crCommand === 'DELETE') && interpretation.filterConditions && interpretation.filterConditions.length) crFilterGroup.conditions = APSQL_NLQUERY.mergeFilterConditions(crFilterGroup.conditions, interpretation.filterConditions).map(function (c) { return c.id ? c : APSQL_FILTER.newCondition(c); });
    crRenderAll(); renderCrDescriptionInterpretationBox(interpretation);
  }
  function renderCrDescriptionInterpretationBox(interpretation) {
    var box = $('crDescriptionInterpretationBox'); if (!box) return;
    var hasMatched = interpretation.matched && interpretation.matched.length; var hasWarnings = interpretation.warnings && interpretation.warnings.length;
    if (!hasMatched && !hasWarnings) { box.innerHTML = ''; return; }
    var parts = [];
    if (hasMatched) parts.push('<div>Interpreted from your description:<ul>' + interpretation.matched.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>');
    if (hasWarnings) parts.push('<div class="text-warning">' + interpretation.warnings.map(esc).join('<br>') + '</div>');
    box.innerHTML = '<div class="alert alert-light border">' + parts.join('') + '</div>';
  }
  function runCrBuild() {
    crApplyDescriptionToSelection();
    var request = { command: crCommand, table: crTable, allowNoWhere: $('crAllowNoWhere').checked };
    if (crCommand === 'INSERT') request.columns = Object.keys(crInsertColumns).filter(function (n) { return crInsertColumns[n].checked; }).map(function (n) { return { name: n, value: crInsertColumns[n].value }; });
    else if (crCommand === 'UPDATE') { request.updates = Object.keys(crUpdateColumns).filter(function (n) { return crUpdateColumns[n].checked; }).map(function (n) { return { column: n, value: crUpdateColumns[n].value }; }); request.filterGroup = crFilterGroup; }
    else if (crCommand === 'DELETE' || crCommand === 'SELECT') request.filterGroup = crFilterGroup;
    var res = APSQL_CR.buildCrQuery(engine, request, $('crDialectSel').value); crRenderResult(res);
  }
  if ($('crBuildBtn')) $('crBuildBtn').addEventListener('click', runCrBuild);
  if ($('crGenerateFromDescriptionBtn')) $('crGenerateFromDescriptionBtn').addEventListener('click', runCrBuild);
  crRefreshTableOptions(); crRenderAll();
  document.querySelectorAll('#crManualTabs .nav-link').forEach(function (t) {
    t.addEventListener('click', function () {
      var name = t.getAttribute('data-cr-tab');
      document.querySelectorAll('#crManualTabs .nav-link').forEach(function (x) { x.classList.toggle('active', x === t); });
      document.querySelectorAll('.tab-pane-cr').forEach(function (p) { var show = p.id === 'cr-pane-' + name; p.classList.toggle('d-none', !show); p.classList.toggle('active', show); });
      if (name === 'requirements') crRenderRequirementsSummary();
    });
  });

  /* ---------------- Used Schema ---------------- */
  var schemaSearchTerm = '';
  function highlightMatch(text, term) { if (!term) return esc(text); var escText = esc(text); var escTerm = esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (!escTerm) return escText; return escText.replace(new RegExp('(' + escTerm + ')', 'ig'), '<mark>$1</mark>'); }
  function tableMatchesSearch(t, term) { if (!term) return true; if ((t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(term) !== -1) return true; return t.columns.some(function (c) { return columnMatchesSearch(c, term); }); }
  function columnMatchesSearch(c, term) { if (!term) return true; return (c.name + ' ' + (c.alias || '') + ' ' + (c.description || '') + ' ' + (c.type || '')).toLowerCase().indexOf(term) !== -1; }
  function renderUsedSchema() {
    var st = engine.getStatus();
    $('usedSchemaSummary').innerHTML = [['Schema', st.schemaName], ['Version', st.schemaVersion], ['Status', '\u2705 Valid / Active'], ['Modules', st.moduleCount], ['Tables', st.tableCount], ['Columns', st.columnCount], ['Last Updated', st.lastUpdated]].map(function (row) { return '<div class="d-flex justify-content-between border-bottom py-1"><span class="text-body-secondary">' + row[0] + '</span><span class="fw-semibold">' + row[1] + '</span></div>'; }).join('');
    if (!allTables().length) { $('schemaTree').innerHTML = '<div class="alert alert-secondary mb-0">The active schema currently has no tables. Upload a schema file under Schema \u2192 Update Schema to get started.</div>'; $('schemaSearchNoResults').classList.remove('show'); $('schemaSearchResultCount').textContent = ''; $('schemaSearchClearBtn').classList.add('d-none'); return; }
    var labels = moduleLabels(); var term = schemaSearchTerm.toLowerCase().trim(); var byModule = {};
    allTables().forEach(function (t) { (byModule[t.module] = byModule[t.module] || []).push(t); });
    var matchedTableCount = 0, matchedColumnCount = 0; var parts = [];
    Object.keys(byModule).sort().forEach(function (mod) {
      var allInModule = byModule[mod]; var matching = term ? allInModule.filter(function (t) { return tableMatchesSearch(t, term); }) : allInModule; if (term && !matching.length) return;
      var totalCols = allInModule.reduce(function (s, t) { return s + t.columns.length; }, 0);
      var tablesHtml = matching.map(function (t) {
        matchedTableCount++; var colsToShow = term ? t.columns.filter(function (c) { return columnMatchesSearch(c, term); }) : t.columns; matchedColumnCount += colsToShow.length;
        var colsHtml = colsToShow.map(function (c) { var badge = c.primary_key ? 'PK' : (c.foreign_key ? ('FK \u2192 ' + c.foreign_key.table + '.' + c.foreign_key.column) : ''); return '<div class="col-item"><code>' + highlightMatch(c.name, term) + '</code> <span class="small">' + esc(c.type) + '</span> <span class="badge text-bg-light border">' + esc(badge) + '</span><div class="col-desc">' + highlightMatch(c.description || '', term) + '</div></div>'; }).join('');
        return '<div class="schema-tree-table-row" data-table="' + t.name + '"><code>' + highlightMatch(t.name, term) + '</code><span class="small text-body-secondary">(' + colsToShow.length + ' columns) \u25be</span></div><div class="schema-tree-columns' + (term ? ' open' : '') + '" id="cols-' + t.name + '">' + colsHtml + '</div>';
      }).join('');
      parts.push('<div class="schema-tree-module"><div class="schema-tree-module-header" data-module="' + mod + '"><span>' + highlightMatch(labels[mod] || mod, term) + ' (' + matching.length + ' tables, ' + totalCols + ' columns)</span><span>\u25be</span></div><div class="schema-tree-tables' + (term ? ' open' : '') + '" id="tables-' + mod + '">' + tablesHtml + '</div></div>');
    });
    $('schemaTree').innerHTML = parts.join('');
    $('schemaTree').querySelectorAll('.schema-tree-module-header').forEach(function (h) { h.addEventListener('click', function () { $('tables-' + h.getAttribute('data-module')).classList.toggle('open'); }); });
    $('schemaTree').querySelectorAll('.schema-tree-table-row').forEach(function (r) { r.addEventListener('click', function () { $('cols-' + r.getAttribute('data-table')).classList.toggle('open'); }); });
    $('schemaSearchNoResults').classList.toggle('show', !!(term && matchedTableCount === 0));
    $('schemaSearchResultCount').textContent = term && matchedTableCount ? (matchedTableCount + ' tables and ' + matchedColumnCount + ' columns match "' + schemaSearchTerm + '".') : '';
    $('schemaSearchClearBtn').classList.toggle('d-none', !term);
  }
  if ($('schemaSearchInput')) $('schemaSearchInput').addEventListener('input', function (e) { schemaSearchTerm = e.target.value; renderUsedSchema(); });
  if ($('schemaSearchClearBtn')) $('schemaSearchClearBtn').addEventListener('click', function () { $('schemaSearchInput').value = ''; schemaSearchTerm = ''; renderUsedSchema(); });

  /* ---------------- About modal ---------------- */
  var aboutModalEl = $('aboutModal'); var aboutModal = window.bootstrap && aboutModalEl ? new window.bootstrap.Modal(aboutModalEl) : null;
  if ($('aboutMenuBtn')) $('aboutMenuBtn').addEventListener('click', function () {
    var st = engine.getStatus();
    $('aboutList').innerHTML = [['Application name', 'AP-SQL Assistant'], ['Application version', '11.0.0'], ['Purpose', 'Multiple schemas can be stored, switched between, and independently synchronized; the GitHub connection can be encrypted and shared across machines via a passphrase-protected vault; the synchronization schedule is now selectable directly from the navigation bar on every page; and the operational password can be changed \u2014 all while retaining the intelligent Describe What You Need engine, the structured Query Builder, the CR Builder, and the Error Rectifier. V11.0 moves the Schema Synchronization Schedule control out of Update Schema and into the main navbar, so it is always one click away regardless of which page you are on, without changing any other part of the application.'], ['Active schema version', st.schemaVersion], ['Schema last updated', st.lastUpdated], ['Security', 'The Read Only Query Builder only ever emits read-only SELECT statements. The CR builder and Error Rectifier only ever produce SQL text for review and never execute it. The credential vault uses AES-256-GCM encryption with a PBKDF2-derived key; because this is a client-side-only application with no server-side secret store, the vault passphrase itself is the real access boundary and must be shared with authorized users separately \u2014 it is never stored alongside the encrypted vault. The operational password is stored only as a SHA-256 hash, never in plain text, and changing it requires the current password.']].map(function (row) { return '<div class="mb-2"><strong>' + row[0] + ':</strong> ' + esc(row[1]) + '</div>'; }).join('');
    closeMenu(); if (aboutModal) aboutModal.show(); else aboutModalEl.classList.add('show');
  });

  /* ---------------- Update Schema workflow ---------------- */
  var WORKFLOW_STEPS = ['Upload Document', 'Read Document', 'Detect Format', 'Detect Modules', 'Detect Tables', 'Detect Columns', 'Extract Metadata', 'Normalize Schema', 'Validate Schema', 'Show Preview', 'User Reviews Changes', 'Generate JSON', 'Validate JSON', 'Apply Schema Update'];
  function renderWorkflowSteps(activeIdx) { var el = $('workflowStepList'); if (!el) return; el.innerHTML = WORKFLOW_STEPS.map(function (s, i) { var cls = i < activeIdx ? 'text-bg-success' : (i === activeIdx ? 'text-bg-primary' : 'text-bg-light border'); return '<span class="badge ' + cls + '">' + (i + 1) + '. ' + s + '</span>'; }).join(''); }
  renderWorkflowSteps(0);
  if ($('updateSchemaPasswordBtn')) $('updateSchemaPasswordBtn').addEventListener('click', function () {
    var pw = $('updateSchemaPasswordInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (ok) { $('updateSchemaPasswordStep').classList.add('d-none'); $('updateSchemaWorkArea').classList.remove('d-none'); renderWorkflowSteps(1); renderSyncStatus(); renderGithubSyncStatus(); renderAllSharedSchemaStrips(); renderTargetSchemaSelect(); renderSchemaStoreList(); }
      else $('updateSchemaPasswordError').classList.remove('d-none');
    });
  });
  if ($('sharedSchemaRefreshBtn')) $('sharedSchemaRefreshBtn').addEventListener('click', function () { checkSharedSchema(); });
  function triggerDownload(blob, filename) { var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); }
  if ($('downloadCurrentJsonBtn')) $('downloadCurrentJsonBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaJsonBlob(currentSchema()), 'current-schema.json'); });
  if ($('downloadCurrentCsvBtn')) $('downloadCurrentCsvBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaCsvBlob(currentSchema()), 'current-schema.csv'); });
  if ($('downloadCurrentDocxBtn')) $('downloadCurrentDocxBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaDocxBlob(currentSchema()), 'current-schema.docx'); });
  if ($('downloadCurrentXlsxBtn')) $('downloadCurrentXlsxBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaXlsxBlob(currentSchema()), 'current-schema.xlsx'); });
  if ($('downloadCurrentDocBtn')) $('downloadCurrentDocBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaDocBlob(currentSchema()), 'current-schema.doc'); });
  if ($('downloadJsonSampleBtn')) $('downloadJsonSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleJsonBlob(), 'sample-schema.json'); });
  if ($('downloadCsvSampleBtn')) $('downloadCsvSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleCsvBlob(), 'sample-schema.csv'); });
  if ($('downloadDocxSampleBtn')) $('downloadDocxSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleDocxBlob(), 'sample-schema.docx'); });
  if ($('downloadXlsxSampleBtn')) $('downloadXlsxSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleXlsxBlob(), 'sample-schema.xlsx'); });
  if ($('downloadDocSampleBtn')) $('downloadDocSampleBtn').addEventListener('click', function () { triggerDownload(window.APSQL_SCHEMA_TOOLS.buildSampleDocBlob(), 'sample-schema.doc'); });
  if ($('toggleExpectedStructureBtn')) $('toggleExpectedStructureBtn').addEventListener('click', function () { var box = $('expectedStructureBox'); var btn = $('toggleExpectedStructureBtn'); box.classList.toggle('d-none'); btn.innerHTML = box.classList.contains('d-none') ? 'View Expected Structure' : 'Hide Expected Structure'; });
  var pendingIncomingTables = null;
  if ($('updateSchemaFileInput')) $('updateSchemaFileInput').addEventListener('change', function () {
    $('unsupportedFormatError').classList.add('d-none'); var file = $('updateSchemaFileInput').files && $('updateSchemaFileInput').files[0]; if (!file) return;
    if (!window.APSQL_SCHEMA_TOOLS.detectFormat(file.name)) { $('unsupportedFormatError').textContent = 'Unsupported file format. Please upload a .json or .csv file.'; $('unsupportedFormatError').classList.remove('d-none'); $('updateSchemaFileInput').value = ''; }
  });
  if ($('updateSchemaProcessBtn')) $('updateSchemaProcessBtn').addEventListener('click', function () {
    var file = $('updateSchemaFileInput').files && $('updateSchemaFileInput').files[0]; var resultBox = $('updateSchemaResult'); resultBox.innerHTML = ''; $('unsupportedFormatError').classList.add('d-none');
    if (!file) { resultBox.innerHTML = '<div class="alert alert-warning mb-0">Please choose a file first.</div>'; return; }
    if (!window.APSQL_SCHEMA_TOOLS.detectFormat(file.name)) { $('unsupportedFormatError').textContent = 'Unsupported file format. Please upload a .json or .csv file.'; $('unsupportedFormatError').classList.remove('d-none'); return; }
    renderWorkflowSteps(3);
    window.APSQL_SCHEMA_TOOLS.fileToTables(file).then(function (tables) {
      renderWorkflowSteps(8); var validation = window.APSQL_SCHEMA_TOOLS.validateSchema(tables);
      $('validationResultBox').innerHTML = validation.valid ? '<div class="alert alert-success mb-0">\u2705 Schema validated: no duplicate tables/columns, no missing names detected.</div>' : '<div class="alert alert-danger"><div>The schema could not be activated because validation failed. The existing schema has not been changed.</div><ul>' + validation.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
      if (!validation.valid) { $('updateSchemaPreviewCard').classList.remove('d-none'); return; }
      pendingIncomingTables = tables; renderWorkflowSteps(9);
      var targetSchema = targetSchemaEntry().schema; var diff = window.APSQL_SCHEMA_TOOLS.computeDiff(targetSchema, tables);
      $('previewCurrentBox').innerHTML = 'Version: ' + esc(targetSchema.schema_version) + '<br>Tables: ' + diff.currentTableCount + '<br>Columns: ' + diff.currentColumnCount;
      $('previewNewBox').innerHTML = 'Version: ' + esc(diff.newVersion) + '<br>Tables: ' + diff.newTableCount + '<br>Columns: ' + diff.newColumnCount;
      $('previewChangesBox').innerHTML = '<span class="diff-added">+ ' + diff.addedTableCount + ' New Tables</span><br><span class="diff-added">+ ' + diff.addedColumnCount + ' New Columns</span><br><span class="diff-updated">~ ' + diff.updatedTableCount + ' Updated Tables</span>';
      $('updateSchemaPreviewCard').classList.remove('d-none'); $('updateSchemaPreviewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) { resultBox.innerHTML = '<div class="alert alert-danger mb-0">' + esc(err.message) + '</div>'; renderWorkflowSteps(1); });
  });
  function refreshAllViewsAfterSchemaChange() {
    refreshTablesColumnsUI(); refreshHierarchyOptions(); refreshModuleChips(); crRefreshTableOptions(); crRenderAll();
    if (currentView === 'usedschema') { renderUsedSchema(); renderSchemaStoreList(); }
  }
  function performApplySchemaUpdate() {
    if (!pendingIncomingTables) return; var targetEntry = targetSchemaEntry();
    var mergeResult = window.APSQL_SCHEMA_TOOLS.mergeSchemas(targetEntry.schema, pendingIncomingTables, $('updateSchemaFileInput').files[0].name);
    schemaStore.updateEntry(targetEntry.id, { schema: mergeResult.schema }); if (targetEntry.id === schemaStore.getActiveId()) rebuildEngine();
    persistCurrentSchema(); renderSchemaPersistenceStatus(); renderWorkflowSteps(13); refreshAllViewsAfterSchemaChange(); renderSchemaStoreList(); renderTargetSchemaSelect();
    $('updateSchemaResult').innerHTML = '<div class="alert alert-success">' + mergeResult.addedTables.length + ' new table(s), ' + mergeResult.addedColumns.length + ' new column(s) added to \u201C' + esc(targetEntry.name) + '\u201D.<br>Schema Version: <code>' + esc(mergeResult.schema.schema_version) + '</code><br>Other stored schemas were not affected.</div>';
    $('updateSchemaPreviewCard').classList.add('d-none'); pendingIncomingTables = null;
  }
  var reauthApplyModalEl = $('reauthApplyModal'); var reauthApplyModal = window.bootstrap && reauthApplyModalEl ? new window.bootstrap.Modal(reauthApplyModalEl) : null;
  if ($('activateSchemaBtn')) $('activateSchemaBtn').addEventListener('click', function () { if (!pendingIncomingTables) return; $('reauthApplyPasswordInput').value = ''; $('reauthApplyPasswordError').classList.add('d-none'); if (reauthApplyModal) reauthApplyModal.show(); });
  if ($('confirmReauthApplyBtn')) $('confirmReauthApplyBtn').addEventListener('click', function () { var pw = $('reauthApplyPasswordInput').value; passwordManager.verifyCurrentPassword(pw).then(function (ok) { if (!ok) { $('reauthApplyPasswordError').classList.remove('d-none'); return; } if (reauthApplyModal) reauthApplyModal.hide(); performApplySchemaUpdate(); }); });
  if ($('cancelPreviewBtn')) $('cancelPreviewBtn').addEventListener('click', function () { $('updateSchemaPreviewCard').classList.add('d-none'); pendingIncomingTables = null; renderWorkflowSteps(1); $('updateSchemaResult').innerHTML = '<div class="alert alert-secondary mb-0">Update cancelled. No schema was changed.</div>'; });
  var deleteSchemaModalEl = $('deleteSchemaModal'); var deleteSchemaModal = window.bootstrap && deleteSchemaModalEl ? new window.bootstrap.Modal(deleteSchemaModalEl) : null;
  if ($('deleteSchemaBtn')) $('deleteSchemaBtn').addEventListener('click', function () { $('deleteSchemaPasswordInput').value = ''; $('deleteSchemaPasswordError').classList.add('d-none'); if (deleteSchemaModal) deleteSchemaModal.show(); });
  if ($('confirmDeleteSchemaBtn')) $('confirmDeleteSchemaBtn').addEventListener('click', function () {
    var pw = $('deleteSchemaPasswordInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (!ok) { $('deleteSchemaPasswordError').classList.remove('d-none'); return; }
      var targetEntry = targetSchemaEntry(); triggerDownload(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaJsonBlob(targetEntry.schema), 'schema-backup-before-delete.json');
      var emptied = window.APSQL_SCHEMA_TOOLS.buildEmptySchema(targetEntry.schema); schemaStore.updateEntry(targetEntry.id, { schema: emptied });
      if (targetEntry.id === schemaStore.getActiveId()) { relationshipStore.clearAll(); relationshipDrafts = {}; rebuildEngine(); resetQueryState(true); }
      persistCurrentSchema(); renderSchemaPersistenceStatus(); crInsertColumns = {}; crUpdateColumns = {}; crFilterGroup.conditions = []; $('crDescriptionInput').value = ''; $('crDescriptionInterpretationBox').innerHTML = '';
      refreshAllViewsAfterSchemaChange(); renderSchemaStoreList(); renderTargetSchemaSelect(); if (deleteSchemaModal) deleteSchemaModal.hide();
      $('updateSchemaResult').innerHTML = '<div class="alert alert-warning">\u201C' + esc(targetEntry.name) + '\u201D has been emptied. A backup was automatically downloaded. Other stored schemas were not affected.</div>';
    });
  });
  var saveRelationshipModalEl = $('saveRelationshipModal'); var saveRelationshipModal = window.bootstrap && saveRelationshipModalEl ? new window.bootstrap.Modal(saveRelationshipModalEl) : null;
  if ($('confirmSaveRelationshipBtn')) $('confirmSaveRelationshipBtn').addEventListener('click', function () {
    if (!pendingSaveRelationshipDraft) return; var pw = $('saveRelationshipPasswordInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (!ok) { $('saveRelationshipPasswordError').classList.remove('d-none'); return; }
      var d = pendingSaveRelationshipDraft; var updatedSchema;
      try { updatedSchema = window.APSQL_SCHEMA_TOOLS.saveRelationshipToSchema(currentSchema(), d.fromTable, d.fromColumn, d.toTable, d.toColumn); } catch (err) { $('saveRelationshipPasswordError').classList.remove('d-none'); $('saveRelationshipPasswordError').textContent = err.message; return; }
      setActiveSchemaObject(updatedSchema); relationshipStore.clearManualRelationship(d.fromTable, d.toTable); delete relationshipDrafts[d.fromTable]; rebuildEngine(); persistCurrentSchema(); renderSchemaPersistenceStatus(); refreshAllViewsAfterSchemaChange(); renderJoinPreview();
      if (saveRelationshipModal) saveRelationshipModal.hide(); pendingSaveRelationshipDraft = null;
    });
  });

  /* ---------------- Error Rectifier ---------------- */
  var errLastResult = null;
  function renderErrorRectifierResult(result) {
    errLastResult = result;
    $('errRectifiedSqlBody').innerHTML = '<pre class="sql-output">' + highlight(result.correctedSql) + '</pre>'; $('errCopySqlBtn').classList.remove('d-none');
    $('errExplanationBody').innerHTML = '<div class="explanation-heading">Error Identified</div><div class="mb-2">' + esc(result.errorIdentified) + '</div><div class="explanation-heading">Correction Applied</div><div>' + esc(result.correctionApplied) + '</div>';
    $('errCopyExplanationBtn').classList.remove('d-none');
    var changedCard = $('errWhatChangedCard'); var changedBody = $('errWhatChangedBody');
    if (result.changed && result.changes && result.changes.length) { changedCard.classList.remove('d-none'); changedBody.innerHTML = result.changes.map(function (c) { return '<div class="change-row"><code class="change-from">' + esc(c.from) + '</code> <span class="change-arrow">\u2192</span> <code class="change-to">' + esc(c.to) + '</code></div>'; }).join(''); }
    else { changedCard.classList.add('d-none'); changedBody.innerHTML = ''; }
  }
  if ($('errRectifyBtn')) $('errRectifyBtn').addEventListener('click', function () {
    var errorText = $('errErrorInput').value; var sqlText = $('errSqlInput').value; var detected = window.APSQL_ERROR_RECTIFIER.detectDialectFromError(errorText);
    if (detected) $('errDialectSel').value = detected; var dialect = $('errDialectSel').value;
    var result = window.APSQL_ERROR_RECTIFIER.rectify(sqlText, errorText, engine, dialect); renderErrorRectifierResult(result);
  });
  if ($('errCopySqlBtn')) $('errCopySqlBtn').addEventListener('click', function () { if (!errLastResult) return; navigator.clipboard && navigator.clipboard.writeText(errLastResult.correctedSql); var old = $('errCopySqlBtn').innerHTML; $('errCopySqlBtn').innerHTML = '\u2705 Copied'; setTimeout(function () { $('errCopySqlBtn').innerHTML = old; }, 1300); });
  if ($('errCopyExplanationBtn')) $('errCopyExplanationBtn').addEventListener('click', function () { if (!errLastResult) return; var text = 'Error Identified: ' + errLastResult.errorIdentified + '\n\nCorrection Applied: ' + errLastResult.correctionApplied; navigator.clipboard && navigator.clipboard.writeText(text); var old = $('errCopyExplanationBtn').innerHTML; $('errCopyExplanationBtn').innerHTML = '\u2705 Copied'; setTimeout(function () { $('errCopyExplanationBtn').innerHTML = old; }, 1300); });

  /* ---------------- Guided Walkthrough (carried forward from V10.9) ---------------- */
  var TOURS = {
    quickstart: [
      { sel: '[data-tour="hamburger"]', place: 'bottom', title: 'Open the Menu', body: 'What it does: Opens the side menu, which lists every page in the app.<br>Why it helps: This is how you get to the Read Only Query Builder, Query Builder for CR, Used Schema, Update Schema, and Error Rectifier.<br>What to do: Select this button any time you want to switch pages.' },
      { sel: '#qsModuleChips', place: 'bottom', title: 'Areas covered by the active schema', body: 'What it does: Lists every module documented in the schema that is currently active.<br>Why it helps: Gives you a quick sense of what data is available before you start building a query.' },
      { sel: '#qsExampleGrid', place: 'top', title: 'Try a ready-made example', body: 'What it does: Each card is a pre-written request.<br>Why it helps: Examples are the fastest way to see how Describe What You Need turns plain language into validated SQL.<br>What to do: Select any card that looks interesting.' }
    ],
    builder: [
      { sel: '#promptInput', place: 'bottom', title: 'Describe What You Need', body: 'What it does: A free-text box where you describe your requirement in plain language.<br>What to do: Type your requirement, then press Ctrl+Enter or select Build Query.' },
      { sel: '#dialectSel', place: 'bottom', title: 'SQL dialect', body: 'What it does: Chooses which database flavor the generated SQL should target.<br>What to do: Pick the dialect that matches your target database before building.' },
      { sel: '#manualTabs', place: 'bottom', title: 'Tables & Columns, Advanced Options, Requirements', body: 'What it does: Three tabs for manual, precise control.<br>What to do: Select a tab to configure that aspect of the query.' },
      { sel: '#generateFromDescriptionBtn', place: 'bottom', title: 'Build Query (from your description)', body: 'What it does: Interprets the text above and immediately builds the SQL.' },
      { sel: '#generateBtn', place: 'top', title: 'Build Query (from manual selections)', body: 'What it does: Generates SQL from whatever you have configured across the tabs.' },
      { sel: '#resultBody', place: 'left', title: 'Generated SQL', body: 'What it does: Shows the validated, ready-to-copy SQL.<br>What to do: Use Copy Result, Optimize, or Explain This Query.' }
    ],
    crbuilder: [
      { sel: '#crCommandSelector', place: 'bottom', title: 'Query Type', body: 'What it does: Selects whether you are drafting an INSERT, UPDATE, or DELETE statement.' },
      { sel: '#crDescriptionInput', place: 'bottom', title: 'Describe the change', body: 'What it does: A free-text box for describing an INSERT, UPDATE, or DELETE requirement in plain language.' },
      { sel: '#crTableSelect', place: 'bottom', title: 'Table', body: 'What it does: Chooses which table this Change Request targets.' },
      { sel: '#crManualTabs', place: 'top', title: 'Tables & Columns / Requirements', body: 'What it does: Holds the columns/values or WHERE conditions for your chosen command.' },
      { sel: '#crBuildBtn', place: 'top', title: 'Build Query', body: 'What it does: Generates the final Change Request SQL text.' },
      { sel: '#crResultBody', place: 'left', title: 'Generated SQL', body: 'What it does: Shows the generated Change Request SQL.' }
    ],
    usedschema: [
      { sel: '#usedSchemaSummary', place: 'bottom', title: 'The currently active schema', body: 'What it does: A quick summary of the active schema.' },
      { sel: '#schemaStoreList', place: 'bottom', title: 'Stored Schemas', body: 'What it does: Lists every schema stored in this browser and lets you switch which one is active.' },
      { sel: '#schemaSearchInput', place: 'bottom', title: 'Search the schema', body: 'What it does: A live search box across every table, column, and description.' },
      { sel: '#schemaTree', place: 'top', title: 'Browse tables and columns', body: 'What it does: An expandable tree of every module, table, and column in the active schema.' }
    ],
    updateschema_locked: [
      { sel: '#updateSchemaPasswordStep', place: 'bottom', title: 'Administrator access', body: 'What it does: Update Schema is a password-protected administrator action that never connects to a production database.' }
    ],
    updateschema_unlocked: [
      { sel: '#schemaPersistenceStatus', place: 'bottom', title: 'Multiple schemas', body: 'What it does: Shows which stored schema you are currently working with.' },
      { sel: '#targetSchemaSelect', place: 'bottom', title: 'Manage Stored Schemas', body: 'What it does: Lets you choose which stored schema you are currently editing, add a new one, or delete one.' },
      { sel: '#sharedSchemaCard', place: 'top', title: 'Live Shared Schema', body: 'What it does: Automatically checks a well-known file path relative to this page for a published schema.' },
      { sel: '#schemaSyncCard', place: 'top', title: 'Cross-Device Schema Sync (Option A)', body: 'What it does: Links the schema you are working with to a single shared file.' },
      { sel: '#githubSyncCard', place: 'top', title: 'GitHub-Hosted Schema Sync (Option B)', body: 'What it does: Connects to a schema file hosted in a GitHub repository.' },
      { sel: '#vaultControls', place: 'top', title: 'Secure GitHub Connection Vault', body: 'What it does: Encrypts your GitHub connection details behind a passphrase.' },
      { sel: '#updateSchemaFileInput', place: 'bottom', title: 'Smart Schema Import Engine', body: 'What it does: Reads a JSON or CSV file describing your database schema and merges it into the selected stored schema.' },
      { sel: '#changePasswordBtn', place: 'top', title: 'Operational Password', body: 'What it does: Changes the password required to unlock this Update Schema section, for this browser.' },
      { sel: '#deleteSchemaBtn', place: 'top', title: 'Danger Zone', body: 'What it does: Permanently removes every table, column, and relationship from the schema you are currently working with.' }
    ],
    errorrectifier: [
      { sel: '[data-tour="err-safety"]', place: 'bottom', title: 'What Error Rectifier does', body: 'What it does: Helps you fix SQL after a database error, using the active schema to check table and column names.' },
      { sel: '#errErrorInput', place: 'bottom', title: 'Enter Database Error', body: 'What it does: A box for the exact error message returned by your database.' },
      { sel: '#errSqlInput', place: 'bottom', title: 'Enter Current SQL Query', body: 'What it does: The exact SQL statement that produced the error above.' },
      { sel: '#errDialectSel', place: 'bottom', title: 'SQL dialect', body: 'What it does: Confirms which database flavor the correction should target.' },
      { sel: '#errRectifyBtn', place: 'bottom', title: 'Rectify SQL', body: 'What it does: Analyzes the error and SQL together and attempts an automatic, schema-aware correction.' },
      { sel: '#errRectifiedSqlBody', place: 'left', title: 'Rectified SQL & Explanation', body: 'What it does: Shows the corrected SQL, plus what was wrong and what was changed.' }
    ],
    navbar: [
      { sel: '#syncScheduleSelect', place: 'bottom', title: 'Schema Synchronization Schedule', body: 'What it does: Chooses how often this browser automatically checks the Live Shared Schema, a linked file, and GitHub for updates. New in V11.0: this control now lives in the navbar, so it is available on every page instead of only on Update Schema.<br>What to do: Pick a frequency, or "Manual only" to disable automatic checks.<br>Then: The chosen schedule applies immediately to all three sync sources.' }
    ],
    about: []
  };
  function pickTourForView(view) {
    if (view === 'updateschema') { var workArea = $('updateSchemaWorkArea'); var unlocked = workArea && !workArea.classList.contains('d-none'); return unlocked ? TOURS.updateschema_unlocked : TOURS.updateschema_locked; }
    return TOURS[view] && TOURS[view].length ? TOURS[view] : TOURS.quickstart;
  }
  var TOUR = TOURS.quickstart; var tourIdx = 0, tourOpen = false;
  var overlay = $('tourOverlay'), spotlight = $('tourSpotlight'), popup = $('tourPopup');
  function clampToViewport(top, left, popW, popH) { var vw = window.innerWidth, vh = window.innerHeight, margin = 12; return { top: Math.min(Math.max(margin, top), Math.max(margin, vh - popH - margin)), left: Math.min(Math.max(margin, left), Math.max(margin, vw - popW - margin)) }; }
  function isElementVisible(el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function resolveStepTarget(step) { var el; try { el = document.querySelector(step.sel); } catch (e) { el = null; } return el; }
  function positionTour() {
    var step = TOUR[tourIdx]; if (!step) { endTour(); return; }
    var target = resolveStepTarget(step); var visible = isElementVisible(target);
    if (visible) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () {
      var vw = window.innerWidth, vh = window.innerHeight; var popW = Math.min(popup.offsetWidth || 360, vw - 24); var popH = Math.min(popup.offsetHeight || 190, vh - 24);
      if (visible) {
        var r = target.getBoundingClientRect(); var pad = 8;
        spotlight.style.display = ''; spotlight.style.top = (r.top - pad) + 'px'; spotlight.style.left = (r.left - pad) + 'px'; spotlight.style.width = (r.width + pad * 2) + 'px'; spotlight.style.height = (r.height + pad * 2) + 'px';
        var spaceBelow = vh - r.bottom, spaceAbove = r.top, spaceRight = vw - r.right, spaceLeft = r.left; var sideOrder = ['bottom', 'top', 'right', 'left']; var spaceMap = { bottom: spaceBelow, top: spaceAbove, right: spaceRight, left: spaceLeft };
        var preferred = step.place; var sides = (preferred ? [preferred].concat(sideOrder.filter(function (s) { return s !== preferred; })) : sideOrder.slice()).sort(function (a, b) { if (a === preferred) return -1; if (b === preferred) return 1; return spaceMap[b] - spaceMap[a]; });
        var rawTop = null, rawLeft = null;
        for (var i = 0; i < sides.length; i++) { var side = sides[i]; var t, l; if (side === 'bottom') { t = r.bottom + 14; l = r.left; } else if (side === 'top') { t = r.top - popH - 14; l = r.left; } else if (side === 'left') { l = r.left - popW - 14; t = r.top; } else { l = r.right + 14; t = r.top; } var fits = t >= 12 && t + popH <= vh - 12 && l >= 12 && l + popW <= vw - 12; if (fits) { rawTop = t; rawLeft = l; break; } }
        if (rawTop === null) { rawTop = r.bottom + 14; rawLeft = r.left; }
        var clamped = clampToViewport(rawTop, rawLeft, popW, popH); popup.style.top = clamped.top + 'px'; popup.style.left = clamped.left + 'px';
      } else { spotlight.style.display = 'none'; var centerTop = Math.max(12, (vh - popH) / 2), centerLeft = Math.max(12, (vw - popW) / 2); popup.style.top = centerTop + 'px'; popup.style.left = centerLeft + 'px'; }
      $('tourStepLabel').textContent = 'Step ' + (tourIdx + 1) + ' of ' + TOUR.length + ' \u2014 ' + currentView; $('tourTitle').textContent = step.title; $('tourBody').innerHTML = step.body;
      $('tourDots').innerHTML = TOUR.map(function (_, i) { return '<i class="' + (i === tourIdx ? 'on' : '') + '"></i>'; }).join('');
      $('tourPrev').disabled = tourIdx === 0; $('tourNext').textContent = tourIdx === TOUR.length - 1 ? 'Done' : 'Next';
    }, 260);
  }
  function startTour() { TOUR = pickTourForView(currentView); tourIdx = 0; tourOpen = true; overlay.classList.add('show'); positionTour(); }
  function endTour() { tourOpen = false; overlay.classList.remove('show'); }
  function nextTour() { if (tourIdx < TOUR.length - 1) { tourIdx++; positionTour(); } else endTour(); }
  function prevTour() { if (tourIdx > 0) { tourIdx--; positionTour(); } }
  if ($('tourBtn')) $('tourBtn').addEventListener('click', startTour);
  if ($('tourNext')) $('tourNext').addEventListener('click', nextTour);
  if ($('tourPrev')) $('tourPrev').addEventListener('click', prevTour);
  if ($('tourSkip')) $('tourSkip').addEventListener('click', endTour);
  if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) endTour(); });
  document.addEventListener('keydown', function (e) { if (!tourOpen) return; if (e.key === 'Escape') endTour(); else if (e.key === 'ArrowRight') nextTour(); else if (e.key === 'ArrowLeft') prevTour(); });
  window.addEventListener('resize', function () { if (tourOpen) positionTour(); });
})();
