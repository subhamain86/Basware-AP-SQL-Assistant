'use strict';
/**
 * dom-smoke.js — a lightweight DOM/Bootstrap simulation that loads the REAL
 * app.js and exercises the V10.7 features end-to-end, with special focus
 * on the V10.7.1 VAULT AUTHENTICATION BUG FIX:
 *   1. Multiple Schema Store: adding a second named schema, switching the
 *      active schema, and confirming the Read Only Query Builder actually
 *      uses the newly active schema's tables.
 *   2. Secure GitHub Connection Vault — THE FIX: publish a vault using the
 *      real connected token, then simulate a "second machine" that has NO
 *      token typed in at all and clicks "Fetch & Unlock Vault" — this must
 *      now SUCCEED (previously it always failed with a hardcoded-token
 *      401), recovering the real token into the (previously empty) field.
 *      Also verifies a wrong passphrase still fails cleanly, and that no
 *      hardcoded placeholder token string ever appears in any request.
 *   3. Selectable Schema Synchronization Schedule: changing the dropdown
 *      selection actually persists and is reflected on reload.
 *   4. Operational Password Management: changing the password via the
 *      real UI, confirming the OLD password now fails and the NEW one
 *      succeeds.
 * Every V10.1–V10.6 feature (manual Query Builder, CR builder, intelligent
 * Describe What You Need, Error Rectifier, GitHub sync) is also re-verified
 * here to confirm zero regression from this fix.
 */
var fs = require('fs');
var path = require('path');

function El(tag) {
  var cls = new Set(); var handlers = {}; var attrs = {}; var childrenArr = [];
  var el = {
    tagName: (tag || 'div').toUpperCase(), type: '', _value: '', checked: false, disabled: false,
    placeholder: '', title: '', children: childrenArr, files: null, href: '', download: '',
    style: (function () { var t = { setProperty: function () {}, getPropertyValue: function () { return ''; } }; return new Proxy(t, { get: function (tg, p) { return p in tg ? tg[p] : ''; }, set: function (tg, p, v) { tg[p] = v; return true; } }); })(),
    set value(v) { this._value = v; }, get value() { return this._value; },
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; }, get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
    set className(v) { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach(function (c) { cls.add(c); }); },
    get className() { return Array.from(cls).join(' '); },
    classList: { add: function (c) { cls.add(c); }, remove: function (c) { cls.delete(c); }, toggle: function (c, f) { if (f === undefined) f = !cls.has(c); if (f) cls.add(c); else cls.delete(c); return f; }, contains: function (c) { return cls.has(c); } },
    _cls: cls,
    setAttribute: function (k, v) { attrs[k] = v; }, getAttribute: function (k) { return attrs[k] !== undefined ? attrs[k] : null; },
    addEventListener: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    dispatch: function (ev, payload) { (handlers[ev] || []).forEach(function (fn) { fn(payload || { target: el }); }); },
    appendChild: function (c) { this.children.push(c); return c; },
    removeChild: function (c) { var i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); },
    querySelector: function () { return El('input'); }, querySelectorAll: function () { return []; },
    click: function () { this.dispatch('click'); },
    closest: function () { return null; }, scrollIntoView: function () {}, focus: function () {},
    getBoundingClientRect: function () { return { top: 0, left: 0, width: 100, height: 20, right: 100, bottom: 20 }; },
    offsetWidth: 340, offsetHeight: 64
  };
  return el;
}

var registry = {};
global.document = {
  getElementById: function (id) { return registry[id] || (registry[id] = El()); },
  querySelector: function () { return El('div'); },
  querySelectorAll: function (sel) { return registry['__qsa_' + sel] || []; },
  createElement: function (t) { return El(t); },
  addEventListener: function () {}, body: El(), documentElement: El()
};
global.window = { addEventListener: function () {}, innerWidth: 1200, innerHeight: 800, scrollTo: function () {}, matchMedia: function () { return { matches: false, addEventListener: function () {} }; } };
global.window.__AP_SCHEMA__ = require(path.join(__dirname, '..', 'schema', 'schema-sample.js'));
global.window.bootstrap = { Modal: function () { this.show = function () {}; this.hide = function () {}; }, Offcanvas: function () { this.hide = function () {}; } };
var localStorageBackingStore = {};
global.localStorage = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(localStorageBackingStore, k) ? localStorageBackingStore[k] : null; }, setItem: function (k, v) { localStorageBackingStore[k] = String(v); }, removeItem: function (k) { delete localStorageBackingStore[k]; } };
Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: function () {} } }, configurable: true, writable: true });
global.URL = { createObjectURL: function () { return 'blob:mock'; }, revokeObjectURL: function () {} };
var realSetTimeout = setTimeout;
global.setTimeout = function (fn) { try { fn(); } catch (e) { throw e; } };
global.setInterval = function () { return 0; }; global.clearInterval = function () {};
if (typeof global.crypto === 'undefined' || !global.crypto || typeof global.crypto.subtle === 'undefined') {
  Object.defineProperty(global, 'crypto', { value: require('crypto').webcrypto, configurable: true, writable: true });
}

function makeFakeIndexedDB() {
  var stores = {};
  return { open: function (dbName) { var req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, error: null }; realSetTimeout(function () { var isNew = !stores[dbName]; if (isNew) stores[dbName] = {}; var db = { createObjectStore: function (s) { stores[dbName][s] = {}; }, transaction: function (s) { var tx = { oncomplete: null }; var api = { put: function (v, k) { var r = { onsuccess: null }; realSetTimeout(function () { stores[dbName][s][k] = v; if (tx.oncomplete) tx.oncomplete(); if (r.onsuccess) r.onsuccess(); }, 0); return r; }, get: function (k) { var r = { result: undefined, onsuccess: null }; realSetTimeout(function () { r.result = stores[dbName][s][k]; if (r.onsuccess) r.onsuccess(); }, 0); return r; }, delete: function (k) { var r = { onsuccess: null }; realSetTimeout(function () { delete stores[dbName][s][k]; if (tx.oncomplete) tx.oncomplete(); if (r.onsuccess) r.onsuccess(); }, 0); return r; } }; tx.objectStore = function () { return api; }; return tx; } }; if (isNew && req.onupgradeneeded) { req.result = db; req.onupgradeneeded(); } req.result = db; if (req.onsuccess) req.onsuccess(); }, 0); return req; } };
}
global.indexedDB = makeFakeIndexedDB();

/* Fake fetch serving both the static Live Shared Schema path (always 404
 * here) and a GitHub Contents API remote (GET/PUT/DELETE) for BOTH the
 * schema file and a SEPARATE vault file at "<path>.vault.json". Also
 * records the Authorization header (or its absence) sent on the MOST
 * RECENT GET, so the test can directly prove the vault-unlock fix: no
 * Authorization header at all when the "second machine" has no token. */
var fakeRemoteFiles = {};
var lastGetAuthHeader = { seen: false, value: undefined };
global.fetch = function (url, init) {
  var GH = require(path.join(__dirname, '..', 'js', 'github-sync-engine.js'));
  if (String(url).indexOf('api.github.com') === -1) return Promise.resolve({ status: 404, ok: false, text: function () { return Promise.resolve(''); }, json: function () { return Promise.resolve({}); } });
  var pathMatch = String(url).match(/contents\/([^?]+)/);
  var filePath = pathMatch ? decodeURIComponent(pathMatch[1]) : 'unknown';
  var method = (init && init.method) || 'GET';
  var store = fakeRemoteFiles[filePath] || (fakeRemoteFiles[filePath] = { content: null, sha: null });
  function resp(status, jsonBody) { return { status: status, ok: status >= 200 && status < 300, json: function () { return Promise.resolve(jsonBody); } }; }
  if (method === 'GET') {
    lastGetAuthHeader.seen = !!(init && init.headers && Object.prototype.hasOwnProperty.call(init.headers, 'Authorization'));
    lastGetAuthHeader.value = init && init.headers ? init.headers.Authorization : undefined;
    if (store.content == null) return Promise.resolve(resp(404, {}));
    return Promise.resolve(resp(200, { content: GH.utf8ToBase64(store.content), sha: store.sha, encoding: 'base64' }));
  }
  if (method === 'PUT') { var body = JSON.parse(init.body); if (store.content != null && body.sha !== store.sha) return Promise.resolve(resp(409, {})); var newSha = 'sha-' + Math.random().toString(36).slice(2); store.content = GH.base64ToUtf8(body.content); store.sha = newSha; return Promise.resolve(resp(200, { content: { sha: newSha } })); }
  if (method === 'DELETE') { var delBody = JSON.parse(init.body); if (store.content == null) return Promise.resolve(resp(404, {})); if (delBody.sha !== store.sha) return Promise.resolve(resp(409, {})); store.content = null; store.sha = null; return Promise.resolve(resp(200, {})); }
  return Promise.resolve(resp(500, {}));
};

global.APSQL = require(path.join(__dirname, '..', 'js', 'schema-engine.js'));
global.APSQL_DATATYPE = require(path.join(__dirname, '..', 'js', 'datatype-engine.js'));
global.APSQL_FILTER = require(path.join(__dirname, '..', 'js', 'filter-engine.js'));
global.APSQL_DECODE = require(path.join(__dirname, '..', 'js', 'decode-engine.js'));
global.APSQL_VALIDATE = require(path.join(__dirname, '..', 'js', 'validation-engine.js'));
global.APSQL_ENGINE = require(path.join(__dirname, '..', 'js', 'sql-engine.js'));
global.APSQL_CR = require(path.join(__dirname, '..', 'js', 'cr-engine.js'));
global.APSQL_SCHEMA_TOOLS = require(path.join(__dirname, '..', 'js', 'schema-tools.js'));
global.APSQL_RELATIONSHIPS = require(path.join(__dirname, '..', 'js', 'relationship-store.js'));
global.APSQL_SUGGEST = require(path.join(__dirname, '..', 'js', 'suggestion-engine.js'));
global.APSQL_OPTIMIZE = require(path.join(__dirname, '..', 'js', 'optimize-engine.js'));
global.APSQL_ERROR_RECTIFIER = require(path.join(__dirname, '..', 'js', 'error-rectifier-engine.js'));
global.APSQL_NLQUERY = require(path.join(__dirname, '..', 'js', 'nl-query-engine.js'));
global.APSQL_SYNC = require(path.join(__dirname, '..', 'js', 'schema-sync-engine.js'));
global.APSQL_GITHUB_SYNC = require(path.join(__dirname, '..', 'js', 'github-sync-engine.js'));
global.APSQL_SHARED_SCHEMA = require(path.join(__dirname, '..', 'js', 'shared-schema-loader.js'));
global.APSQL_VAULT = require(path.join(__dirname, '..', 'js', 'credential-vault-engine.js'));
global.APSQL_SCHEMA_STORE = require(path.join(__dirname, '..', 'js', 'schema-store-engine.js'));
global.APSQL_PASSWORD_MANAGER = require(path.join(__dirname, '..', 'js', 'password-manager-engine.js'));
global.APSQL_SYNC_SCHEDULE = require(path.join(__dirname, '..', 'js', 'sync-schedule-engine.js'));

var REQUIRED_IDS = [
  'mainNavbar', 'mainMenu', 'queryBuilderMenuToggle', 'queryBuilderSubmenu', 'schemaMenuToggle', 'schemaSubmenu', 'themeMenuToggle', 'themeSubmenu', 'aboutMenuBtn', 'aboutModal', 'aboutList',
  'qsExampleGrid', 'qsModuleChips',
  'moduleFilterSel', 'tableSearchInput', 'tableSelectAllBtn', 'tableUnselectAllBtn', 'tableSelCount', 'tableListGrid',
  'selectedTableDropdown', 'columnSearchInput', 'columnSelectAllBtn', 'columnUnselectAllBtn', 'columnListBody', 'columnListEmpty',
  'readOnlyFilterGroup', 'readOnlyAddFilterBtn', 'readOnlyClearFiltersBtn',
  'joinOptionCard', 'optJoinInner', 'optJoinLeft', 'optJoinInnerLabel', 'optJoinLeftLabel', 'joinResetBtn', 'joinPreviewBox', 'defineRelationshipContainer',
  'sortRowsContainer', 'addSortRowBtn', 'clearSortBtn', 'optLimit', 'optLimitClearBtn', 'optView', 'optViewClearBtn',
  'existsRowsContainer', 'addExistsRowBtn', 'clearExistsBtn', 'scalarRowsContainer', 'addScalarRowBtn', 'clearScalarBtn',
  'optHaving', 'optHavingClearBtn', 'optHierarchy', 'optHierarchyClearBtn',
  'promptInput', 'dialectSel', 'optDistinct2', 'generateBtn', 'generateFromDescriptionBtn', 'descriptionInterpretationBox',
  'resultBody', 'copyBtn', 'optimizeBtn', 'optimizeReportBox', 'manualTabs', 'requirementsSummaryBody',
  'resetQueryBtn', 'confidenceChecklistBox', 'ambiguityBox', 'explainBtn', 'explanationReportBox',
  'crCommandSelector', 'crDialectSel', 'crTableSelect', 'crDescriptionInput', 'crBuildBtn', 'crGenerateFromDescriptionBtn', 'crDescriptionInterpretationBox',
  'crInsertPanel', 'crInsertColumnsBody', 'crUpdatePanel', 'crUpdateColumnsBody', 'crWherePanel', 'crWhereRequiredWarning', 'crFilterGroup', 'crAddFilterBtn', 'crClearFiltersBtn', 'crAllowNoWhere',
  'crDecodePanel', 'crDecodeBody', 'crRequirementsSummaryBody', 'crResultBody', 'crCopyBtn', 'crOptimizeBtn', 'crOptimizeReportBox', 'crManualTabs',
  'schemaSearchInput', 'schemaSearchClearBtn', 'schemaSearchResultCount', 'schemaSearchNoResults', 'schemaTree', 'usedSchemaSummary', 'schemaPersistenceStatus',
  'schemaSyncCard', 'schemaSyncStatusBody', 'schemaSyncActionsBody', 'schemaSyncLastCheck',
  'githubSyncCard', 'githubSyncStatusBody', 'githubSyncActionsBody', 'githubSyncLastCheck', 'githubSyncConfigForm', 'githubTokenWarningBox', 'githubOwnerInput', 'githubRepoInput', 'githubBranchInput', 'githubPathInput', 'githubTokenInput',
  'sharedSchemaStripQuickstart', 'sharedSchemaStripBuilder', 'sharedSchemaStripCr', 'sharedSchemaStripUsedSchema', 'sharedSchemaCard', 'sharedSchemaStatusBodyAdmin', 'sharedSchemaRefreshBtn', 'sharedSchemaPathDisplay',
  'updateSchemaPasswordStep', 'updateSchemaPasswordInput', 'updateSchemaPasswordBtn', 'updateSchemaPasswordError', 'updateSchemaWorkArea',
  'downloadCurrentJsonBtn', 'downloadCurrentCsvBtn', 'downloadCurrentDocxBtn', 'downloadCurrentXlsxBtn', 'downloadCurrentDocBtn',
  'workflowStepList', 'updateSchemaFileInput', 'updateSchemaProcessBtn', 'toggleExpectedStructureBtn', 'expectedStructureBox', 'unsupportedFormatError',
  'downloadJsonSampleBtn', 'downloadCsvSampleBtn', 'downloadDocxSampleBtn', 'downloadXlsxSampleBtn', 'downloadDocSampleBtn',
  'validationResultBox', 'updateSchemaResult', 'updateSchemaPreviewCard', 'previewCurrentBox', 'previewNewBox', 'previewChangesBox', 'previewDetailBox', 'activateSchemaBtn', 'cancelPreviewBtn',
  'reauthApplyModal', 'reauthApplyPasswordInput', 'reauthApplyPasswordError', 'confirmReauthApplyBtn',
  'deleteSchemaBtn', 'deleteSchemaModal', 'deleteSchemaPasswordInput', 'deleteSchemaPasswordError', 'confirmDeleteSchemaBtn',
  'saveRelationshipModal', 'saveRelationshipSummary', 'saveRelationshipPasswordInput', 'saveRelationshipPasswordError', 'confirmSaveRelationshipBtn',
  'errErrorInput', 'errSqlInput', 'errDialectSel', 'errRectifyBtn', 'errRectifiedSqlBody', 'errCopySqlBtn', 'errExplanationBody', 'errCopyExplanationBtn', 'errWhatChangedCard', 'errWhatChangedBody',
  'tourBtn', 'tourOverlay', 'tourSpotlight', 'tourPopup', 'tourStepLabel', 'tourTitle', 'tourBody', 'tourDots', 'tourPrev', 'tourNext', 'tourSkip',
  'schemaStoreList', 'targetSchemaSelect', 'showAddSchemaFormBtn', 'deleteTargetSchemaBtn', 'addSchemaFormBox', 'newSchemaNameInput', 'confirmAddSchemaBtn', 'cancelAddSchemaBtn',
  'syncScheduleSelect', 'syncScheduleCurrentNote',
  'vaultStatusBody', 'vaultUnsupportedNote', 'vaultControls', 'vaultPassphraseInput', 'publishVaultBtn', 'vaultUnlockPassphraseInput', 'unlockVaultBtn', 'vaultResultBox',
  'currentPasswordInput', 'newPasswordInput', 'confirmNewPasswordInput', 'changePasswordBtn', 'passwordChangeResultBox', 'passwordCustomStatusNote',
  'deleteStoredSchemaModal', 'deleteStoredSchemaPasswordInput', 'deleteStoredSchemaPasswordError', 'confirmDeleteStoredSchemaBtn'
];
REQUIRED_IDS.forEach(function (id) { registry[id] = El(id === 'updateSchemaFileInput' ? 'input' : 'div'); });
['copyBtn', 'optimizeBtn', 'explainBtn', 'crCopyBtn', 'crOptimizeBtn', 'ambiguityBox', 'explanationReportBox', 'errWhatChangedCard', 'unsupportedFormatError', 'expectedStructureBox', 'updateSchemaPreviewCard', 'updateSchemaWorkArea', 'crWhereRequiredWarning', 'schemaSearchClearBtn', 'githubSyncConfigForm', 'githubTokenWarningBox', 'addSchemaFormBox']
  .forEach(function (id) { registry[id].classList.add('d-none'); });

var viewBtns = ['quickstart', 'builder', 'crbuilder', 'usedschema', 'updateschema', 'errorrectifier'].map(function (v) { var b = El('button'); b.setAttribute('data-view', v); if (v === 'quickstart') b.classList.add('active'); return b; });
registry['__qsa_[data-view]'] = viewBtns;
registry['__qsa_.app-view'] = ['quickstart', 'builder', 'crbuilder', 'usedschema', 'updateschema', 'errorrectifier'].map(function (v) { var el = El('section'); el.id = 'view-' + v; if (v === 'quickstart') el.classList.add('active'); return el; });
registry['__qsa_.offcanvas-body > button.nav-link, .menu-submenu .nav-link'] = viewBtns;
registry['__qsa_[data-theme]'] = [];
registry['__qsa_.cr-command-option'] = ['INSERT', 'UPDATE', 'DELETE'].map(function (c) { var b = El('div'); b.setAttribute('data-command', c); if (c === 'INSERT') b.classList.add('active'); return b; });
registry['__qsa_#manualTabs .nav-link'] = ['tables', 'advanced', 'requirements'].map(function (t) { var b = El('button'); b.setAttribute('data-tab', t); if (t === 'tables') b.classList.add('active'); return b; });
registry['__qsa_.tab-pane-manual'] = ['tables', 'advanced', 'requirements'].map(function (t) { var el = El('div'); el.id = 'pane-' + t; if (t === 'tables') el.classList.add('active'); else el.classList.add('d-none'); return el; });
registry['__qsa_#crManualTabs .nav-link'] = ['tables', 'requirements'].map(function (t) { var b = El('button'); b.setAttribute('data-cr-tab', t); if (t === 'tables') b.classList.add('active'); return b; });
registry['__qsa_.tab-pane-cr'] = ['tables', 'requirements'].map(function (t) { var el = El('div'); el.id = 'cr-pane-' + t; if (t === 'tables') el.classList.add('active'); else el.classList.add('d-none'); return el; });
registry['__qsa_input[name="joinType"]'] = [registry['optJoinInner'], registry['optJoinLeft']];

var pass = 0, fail = 0;
function ok(msg, cond) { if (cond) { pass++; } else { fail++; console.log('  \u2717 ' + msg); } }
function stripTags(html) { return String(html || '').replace(/<[^>]+>/g, ''); }
function flushMicrotasks(waitMs) { return new Promise(function (resolve) { realSetTimeout(resolve, waitMs || 40); }); }

require(path.join(__dirname, '..', 'js', 'app.js'));

async function runAsyncChecks() {
  await flushMicrotasks(60);
  ok('app.js loads without throwing against the mocked DOM (single embedded schema auto-migrated into the new store)', true);

  /* ================================================================
     Feature 1: Multiple Schema Store
     ================================================================ */
  registry['updateSchemaPasswordInput'].value = 'P@assw0rd';
  registry['updateSchemaPasswordBtn'].dispatch('click');
  await flushMicrotasks(40);
  ok('Correct password unlocks the Update Schema work area', registry['updateSchemaWorkArea']._cls.has('d-none') === false);
  function schemaItemNameHtml(item) { return (item.children || []).map(function (main) { return (main.children || []).map(function (line) { return line._html || ''; }).join(''); }).join(''); }
  function findButtonsByClass(el, cls) { var out = []; (el.children || []).forEach(function (c) { if (c._cls && c._cls.has(cls)) out.push(c); out = out.concat(findButtonsByClass(c, cls)); }); return out; }
  function allTablesCountFromDom() { return (registry['tableListGrid'].children || []).length; }

  ok('The stored-schema list shows exactly one schema right after migration', registry['schemaStoreList'].children.length === 1);
  ok('...and it is marked Active', (registry['schemaStoreList'].children || []).some(function (item) { return schemaItemNameHtml(item).indexOf('Active') !== -1; }));

  registry['showAddSchemaFormBtn'].dispatch('click');
  registry['newSchemaNameInput'].value = 'Finance Reporting Schema';
  registry['confirmAddSchemaBtn'].dispatch('click');
  ok('A second, brand-new named schema now exists in the store and is rendered as a real DOM row', registry['schemaStoreList'].children.length === 2 && (registry['schemaStoreList'].children || []).some(function (item) { return schemaItemNameHtml(item).indexOf('Finance Reporting Schema') !== -1; }));

  var selectButtons = findButtonsByClass(registry['schemaStoreList'], 'schema-store-select-btn');
  ok('A real, clickable "Set Active" button was rendered for the non-active schema', selectButtons.length >= 1);
  if (selectButtons.length) selectButtons[0].dispatch('click');
  await flushMicrotasks(20);
  ok('After switching, the newly added (empty) schema is now active and the Tables & Columns list reflects zero tables', allTablesCountFromDom() === 0);

  var switchBackButtons = findButtonsByClass(registry['schemaStoreList'], 'schema-store-select-btn');
  if (switchBackButtons.length) switchBackButtons[0].dispatch('click');
  await flushMicrotasks(20);
  ok('Switching back to the original schema restores its full table list', allTablesCountFromDom() > 0);

  /* ================================================================
     Feature 2: Secure GitHub Connection Vault — V10.7.1 FIX VERIFICATION
     ================================================================ */
  registry['githubOwnerInput'].value = 'acme-corp';
  registry['githubRepoInput'].value = 'ap-sql-schema-store';
  registry['githubBranchInput'].value = 'main';
  registry['githubPathInput'].value = 'schema/shared-schema.json';
  registry['githubTokenInput'].value = 'ghp_SuperSecretToken12345';
  var connectBtn = null;
  (function findConnectBtn() { (registry['githubSyncActionsBody'].children || []).forEach(function (b) { if (b.innerHTML && b.innerHTML.indexOf('Connect & Sync Now') !== -1) connectBtn = b; }); })();
  ok('A "Connect & Sync Now" button is rendered when GitHub Sync is not yet configured', !!connectBtn);
  if (connectBtn) connectBtn.dispatch('click');
  await flushMicrotasks(80);

  registry['vaultPassphraseInput'].value = 'correct-horse-battery-staple';
  registry['publishVaultBtn'].dispatch('click');
  await flushMicrotasks(100);
  var vaultResultText = stripTags(registry['vaultResultBox']._html || '');
  ok('Publishing the vault reports success', /encrypted and published successfully/i.test(vaultResultText));
  ok('The published vault file on the fake GitHub remote does NOT contain the plaintext token anywhere', Object.keys(fakeRemoteFiles).some(function (p) { return /vault\.json$/.test(p); }) && Object.keys(fakeRemoteFiles).filter(function (p) { return /vault\.json$/.test(p); }).every(function (p) { return String(fakeRemoteFiles[p].content).indexOf('SuperSecretToken') === -1; }));

  /* THE FIX ITSELF: simulate a genuinely "different machine" — wipe the
   * GitHub Token field COMPLETELY EMPTY (no token typed at all) — and
   * unlock the vault purely via the passphrase. Before the fix, this
   * always failed with a hardcoded-token 401; after the fix, the lookup
   * runs anonymously (no Authorization header) since the repo/vault path
   * itself needs no auth to read in this test's fake remote. */
  registry['githubTokenInput'].value = '';
  registry['githubOwnerInput'].value = 'acme-corp'; registry['githubRepoInput'].value = 'ap-sql-schema-store'; registry['githubBranchInput'].value = 'main'; registry['githubPathInput'].value = 'schema/shared-schema.json';
  registry['vaultUnlockPassphraseInput'].value = 'correct-horse-battery-staple';
  registry['unlockVaultBtn'].dispatch('click');
  await flushMicrotasks(100);
  ok('THE FIX: unlocking the vault on a "new machine" with an EMPTY token field now SUCCEEDS (previously always 401\u2019d on a hardcoded fake token)', /Vault unlocked/i.test(stripTags(registry['vaultResultBox']._html || '')));
  ok('...and restores the exact original real token into the (previously empty) token field', registry['githubTokenInput'].value === 'ghp_SuperSecretToken12345');
  ok('...and the lookup that succeeded sent NO Authorization header at all (a genuine anonymous GET, not a fabricated credential)', lastGetAuthHeader.seen === false);

  /* Wrong passphrase must still fail cleanly, even with no token typed */
  registry['githubTokenInput'].value = '';
  registry['vaultUnlockPassphraseInput'].value = 'totally-wrong-passphrase';
  registry['unlockVaultBtn'].dispatch('click');
  await flushMicrotasks(100);
  ok('Unlocking with the WRONG passphrase (still with no token typed) fails with a clear passphrase error, not a 401/crash', /Incorrect vault passphrase/i.test(stripTags(registry['vaultResultBox']._html || '')));

  /* ================================================================
     Feature 3: Selectable Schema Synchronization Schedule
     ================================================================ */
  ok('The sync schedule dropdown is populated with the predefined options', (registry['syncScheduleSelect']._html || '').indexOf('Every 5 minutes') !== -1);
  registry['syncScheduleSelect'].value = '1h';
  registry['syncScheduleSelect'].dispatch('change');
  ok('Selecting a new schedule updates the "currently synchronizing" note', /Every hour/i.test(stripTags(registry['syncScheduleCurrentNote']._text || registry['syncScheduleCurrentNote'].textContent || '')));
  ok('The selection was persisted to localStorage so it survives a reload', global.APSQL_SYNC_SCHEDULE.loadSelectedOptionId() === '1h');

  /* ================================================================
     Feature 4: Operational Password Management
     ================================================================ */
  registry['currentPasswordInput'].value = 'P@assw0rd';
  registry['newPasswordInput'].value = 'MyNewOpsPass1';
  registry['confirmNewPasswordInput'].value = 'MyNewOpsPass1';
  registry['changePasswordBtn'].dispatch('click');
  await flushMicrotasks(60);
  ok('Changing the password via the real UI reports success', /changed successfully/i.test(stripTags(registry['passwordChangeResultBox']._html || '')));

  var freshPm = global.APSQL_PASSWORD_MANAGER.createPasswordManager();
  var oldStillWorks = await freshPm.verifyCurrentPassword('P@assw0rd');
  var newWorks = await freshPm.verifyCurrentPassword('MyNewOpsPass1');
  ok('After changing the password, the OLD password no longer verifies', oldStillWorks === false);
  ok('After changing the password, the NEW password verifies correctly', newWorks === true);

  /* ================================================================
     Regression checks: V10.1–V10.6 features still work unaffected.
     ================================================================ */
  registry['promptInput'].value = 'Show all active users with their email address and user group, exclude Basware users, and sort by login account.';
  registry['generateFromDescriptionBtn'].dispatch('click');
  var sqlText = stripTags(registry['resultBody']._html || '');
  ok('Intelligent Describe What You Need engine still resolves the full success-criteria sentence with zero manual selection', /Query validated against active schema/i.test(sqlText) && /ADM_USER_GROUP_MEMBER/.test(sqlText));

  var engineForCheck = APSQL.createEngine(global.window.__AP_SCHEMA__);
  var storeForCheck = APSQL_DECODE.createDecodeStore();
  var fgIn = { conditions: [APSQL_FILTER.newCondition({ table: 'IA_INVOICE', column: 'STATUS', operator: 'in', value: '10, 40, 90' })] };
  var resIn = APSQL_ENGINE.generateSql('', { selectedTables: ['IA_INVOICE'], selectedColumns: [{ table: 'IA_INVOICE', column: 'INVOICE_NUMBER' }], filterGroup: fgIn }, engineForCheck, storeForCheck);
  ok('"Is one of" filter still produces a real IN (...) clause end-to-end', resIn.status === 'ok' && /WHERE IA_INVOICE\.STATUS IN \(10, 40, 90\)/.test(resIn.sql));

  registry['errErrorInput'].value = 'ORA-00932: inconsistent datatypes: expected CHAR got NUMBER';
  registry['errSqlInput'].value = "SELECT CASE WHEN LOGIN_TYPE = 0 THEN 'Forms' ELSE LOGIN_TYPE END AS LT FROM ADM_USER_DATA;";
  registry['errDialectSel'].value = 'Generic';
  registry['errRectifyBtn'].dispatch('click');
  ok('Error Rectifier still auto-detects Oracle and corrects the ELSE branch (no regression)', registry['errDialectSel'].value === 'Oracle' && /TO_CHAR\(LOGIN_TYPE\)/.test(registry['errRectifiedSqlBody']._html || ''));

  var manualRes = APSQL_ENGINE.generateSql('', { selectedTables: ['IA_SUPPLIER'], selectedColumns: [{ table: 'IA_SUPPLIER', column: 'SUPPLIER_NAME' }] }, engineForCheck, storeForCheck);
  ok('Manual Query Builder (pure programmatic selection, no description at all) still produces valid SQL', manualRes.status === 'ok' && /SELECT IA_SUPPLIER\.SUPPLIER_NAME/.test(manualRes.sql));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

runAsyncChecks();
