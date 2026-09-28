/* =========================================================================
   STATE STORE — app-wide reactive state (route, theme, query states, toasts)
   ========================================================================= */
(function () {
  'use strict';
  var U = window.SQLA.Utils;
  var Engines = window.SQLA.Engines;
  var Schema = window.SQLA.Services.Schema;

  function emptyReadOnlyState(dialect) {
    return {
      dialect: dialect || 'Oracle',
      naturalLanguageText: '',
      selectedTables: [],
      selectedColumns: [],
      joins: [],
      filters: [],
      sorts: [],
      advanced: { distinct: false, groupByColumns: [], havingClause: '', limit: null, ctes: [], relatedFilters: [], relatedCounts: [] },
      generatedSql: '-- Select at least one table (or describe your requirement above) to generate SQL.',
      lastRequirement: null,
      lastOrchestration: null,
      warnings: []
    };
  }
  function emptyCrState(dialect) {
    return { dialect: dialect || 'Oracle', naturalLanguageText: '', queryType: 'UPDATE', table: null, values: [], filters: [], confirmNoWhere: false, generatedSql: '-- Choose a table for this Change Request.' };
  }

  var Store = {
    route: 'quickstart',
    theme: U.safeLocalStorageGet('sqla.theme.v16') || 'system',
    readOnly: emptyReadOnlyState(),
    cr: emptyCrState(),
    toasts: [],
    vaultUnlocked: false,
    _listeners: []
  };

  Store.subscribe = function (fn) { Store._listeners.push(fn); return function () { Store._listeners = Store._listeners.filter(function (f) { return f !== fn; }); }; };
  Store.notify = function () { Store._listeners.forEach(function (fn) { fn(); }); };

  Store.setRoute = function (route) { Store.route = route; Store.notify(); };
  Store.setTheme = function (theme) { Store.theme = theme; U.safeLocalStorageSet('sqla.theme.v16', theme); Store.notify(); applyTheme(theme); };

  function applyTheme(theme) {
    var effective = theme;
    if (theme === 'system') effective = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', effective);
  }
  Store.applyTheme = applyTheme;

  Store.pushToast = function (kind, text) {
    var toast = { id: U.makeId('toast'), kind: kind, text: text };
    Store.toasts.push(toast);
    Store.notify();
    setTimeout(function () { Store.toasts = Store.toasts.filter(function (t) { return t.id !== toast.id; }); Store.notify(); }, 4500);
  };

  Store.regenerateReadOnlySql = function () {
    var schema = Schema.getActiveSchema();
    var result = Engines.buildSelectSQL(Store.readOnly, schema);
    if (typeof result === 'string') { Store.readOnly.generatedSql = result; Store.readOnly.warnings = []; }
    else { Store.readOnly.generatedSql = result.sql; Store.readOnly.warnings = result.warnings; }
    Store.notify();
  };

  Store.regenerateCrSql = function () {
    Store.cr.generatedSql = Engines.buildCrSQL(Store.cr);
    Store.notify();
  };

  /** Manual selection mutation helpers */
  Store.toggleTable = function (tableName) {
    var idx = Store.readOnly.selectedTables.indexOf(tableName);
    if (idx === -1) Store.readOnly.selectedTables.push(tableName);
    else {
      Store.readOnly.selectedTables.splice(idx, 1);
      Store.readOnly.selectedColumns = Store.readOnly.selectedColumns.filter(function (c) { return c.table !== tableName; });
    }
    Store.regenerateReadOnlySql();
  };
  Store.toggleColumn = function (tableName, columnName) {
    var idx = Store.readOnly.selectedColumns.findIndex ? Store.readOnly.selectedColumns.findIndex(function (c) { return c.table === tableName && c.column === columnName; }) : -1;
    if (idx === -1) Store.readOnly.selectedColumns.push({ table: tableName, column: columnName, displayMode: 'plain', alias: null });
    else Store.readOnly.selectedColumns.splice(idx, 1);
    Store.regenerateReadOnlySql();
  };
  Store.addFilter = function (filter) { Store.readOnly.filters.push(filter); Store.regenerateReadOnlySql(); };
  Store.removeFilter = function (idx) { Store.readOnly.filters.splice(idx, 1); Store.regenerateReadOnlySql(); };
  Store.addSort = function (sort) { Store.readOnly.sorts.push(sort); Store.regenerateReadOnlySql(); };
  Store.removeSort = function (idx) { Store.readOnly.sorts.splice(idx, 1); Store.regenerateReadOnlySql(); };

  Store.resetReadOnly = function () { Store.readOnly = emptyReadOnlyState(Store.readOnly.dialect); Store.notify(); };
  Store.resetCr = function () { Store.cr = emptyCrState(Store.cr.dialect); Store.notify(); };

  window.SQLA.Store = Store;
})();
