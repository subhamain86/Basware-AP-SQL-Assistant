/* app.js — UI wiring for AP-SQL Assistant V11.5. Every page reads from the same
   application state (schema store + relationship store + decode store + password
   manager), so schema changes propagate everywhere immediately (spec section 29). */
(function () {
  'use strict';

  //================================================================
  // 1. APPLICATION STATE
  //================================================================
  var APP = {
    schemaStore: null,
    relStore: null,
    decodeStore: null,
    passwordManager: null,
    conversation: null,
    engine: null,        // schema-engine over the merged active schema
    effEngine: null,      // wrapped with manual relationship store
    theme: 'system',
    manualTables: {},     // { TABLE_NAME: true }
    manualColumns: [],    // [{table,column,alias,decode,aggregate}]
    manualFilters: [],    // filter row state objects
    manualOrderBy: [],
    manualGroupBy: [],
    crFields: [],
    crFilters: [],
    lastRoResult: null,
    pendingDecodeApprovals: [], // [{table,column,def,requestedAt}]
    pendingSchemaUpdate: null,  // { schema, targetEntryId }
    workingSchemaEntryId: null, // schema currently targeted by import/download in Update Schema
    githubLinker: null,
    walkthrough: { steps: [], index: 0 }
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  //================================================================
  // 2. INITIALIZATION
  //================================================================
  document.addEventListener('DOMContentLoaded', function () {
    try { initState(); } catch (e) { console.error('State init failed', e); }
    try { wireNavigation(); } catch (e) { console.error('Nav wiring failed', e); }
    try { wireTheme(); } catch (e) { console.error('Theme wiring failed', e); }
    try { wireSyncSchedule(); } catch (e) { console.error('Sync schedule wiring failed', e); }
    try { renderHome(); } catch (e) { console.error('Home render failed', e); }
    try { wireReadOnlyBuilder(); } catch (e) { console.error('RO builder wiring failed', e); }
    try { wireCrBuilder(); } catch (e) { console.error('CR builder wiring failed', e); }
    try { renderUsedSchema(); } catch (e) { console.error('Used schema render failed', e); }
    try { wireUpdateSchema(); } catch (e) { console.error('Update schema wiring failed', e); }
    try { wireErrorRectifier(); } catch (e) { console.error('Rectifier wiring failed', e); }
    try { wireWalkthrough(); } catch (e) { console.error('Walkthrough wiring failed', e); }
    try { checkLiveSharedSchemaOnLoad(); } catch (e) { console.error('Live shared schema check failed', e); }
  });

  function initState() {
    APP.schemaStore = APSQL_SCHEMA_STORE.createStore(safeLocalStorage());
    if (APP.schemaStore.getEntries().length === 0) {
      APP.schemaStore.addEntry({ name: 'Embedded Sample Schema', schema: APSQL_SAMPLE_SCHEMA });
    }
    APP.workingSchemaEntryId = APP.schemaStore.getDefaultId();
    APP.relStore = APSQL_RELATIONSHIPS.createRelationshipStore();
    APP.decodeStore = APSQL_DECODE.createDecodeStore();
    APP.passwordManager = APSQL_PASSWORD_MANAGER.createPasswordManager(safeLocalStorage());
    APP.conversation = APSQL_CONVERSATION.createConversation();
    rebuildEngine();
  }

  function safeLocalStorage() {
    try { if (typeof localStorage !== 'undefined') { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage; } } catch (e) {}
    var mem = {};
    return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }, setItem: function (k, v) { mem[k] = v; }, removeItem: function (k) { delete mem[k]; } };
  }

  function rebuildEngine() {
    var merged = APP.schemaStore.getMergedActiveSchema();
    APP.engine = APSQL_SCHEMA_ENGINE.createEngine(merged);
    APP.effEngine = APSQL_RELATIONSHIPS.createEffectiveEngine(APP.engine, APP.relStore);
  }

  function onSchemaChanged() {
    rebuildEngine();
    renderHome();
    renderUsedSchema();
    renderUpdateSchemaLists();
    renderRoTables();
    renderRoColumns();
    populateCrTableSelect();
  }

  //================================================================
  // 3. NAVIGATION
  //================================================================
  function wireNavigation() {
    document.querySelectorAll('[data-nav]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        goTo(el.getAttribute('data-nav'));
        var oc = bootstrap.Offcanvas.getInstance($('appMenu'));
        if (oc) oc.hide();
      });
    });
    document.querySelectorAll('.menu-submenu-toggle').forEach(function (t) {
      t.addEventListener('click', function () {
        t.classList.toggle('open');
        var sub = $('submenu-' + t.getAttribute('data-toggle-submenu'));
        if (sub) sub.classList.toggle('open');
      });
    });
  }

  function goTo(viewName) {
    document.querySelectorAll('.app-view').forEach(function (v) { v.classList.remove('active'); });
    var target = $('view-' + viewName);
    if (target) target.classList.add('active');
    document.querySelectorAll('[data-nav]').forEach(function (el) { el.classList.toggle('active', el.getAttribute('data-nav') === viewName); });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  //================================================================
  // 4. THEME
  //================================================================
  function wireTheme() {
    var saved = safeLocalStorage().getItem('ap_sql_theme') || 'system';
    applyTheme(saved);
    document.querySelectorAll('[data-theme-choice]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        applyTheme(el.getAttribute('data-theme-choice'));
      });
    });
  }
  function applyTheme(choice) {
    APP.theme = choice;
    safeLocalStorage().setItem('ap_sql_theme', choice);
    var resolved = choice;
    if (choice === 'system') resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    document.documentElement.setAttribute('data-bs-theme', resolved);
  }

  //================================================================
  // 5. SYNC SCHEDULE (navbar)
  //================================================================
  function wireSyncSchedule() {
    var sel = $('syncScheduleSelect');
    if (!sel) return;
    APSQL_SYNC_SCHEDULE.getOptions().forEach(function (o) {
      var opt = document.createElement('option'); opt.value = o.id; opt.textContent = o.label; sel.appendChild(opt);
    });
    var saved = safeLocalStorage().getItem('ap_sql_sync_schedule') || 'manual';
    sel.value = saved;
    sel.addEventListener('change', function () { safeLocalStorage().setItem('ap_sql_sync_schedule', sel.value); });
  }

  //================================================================
  // 6. HOME
  //================================================================
  function renderHome() {
    var merged = APP.schemaStore.getMergedActiveSchema();
    var summary = $('homeSchemaSummary');
    if (summary) {
      var activeCount = APP.schemaStore.getActiveIds().length;
      var totalTables = merged.tables.length;
      summary.innerHTML = '<i class="bi bi-diagram-3"></i> Active schema(s): <strong>' + activeCount + '</strong> &nbsp;·&nbsp; Tables visible to SQL generation: <strong>' + totalTables + '</strong>';
    }
    var areas = $('homeSchemaAreas');
    if (areas) {
      areas.innerHTML = '';
      var modules = {};
      merged.tables.forEach(function (t) { var m = t.module || 'General'; modules[m] = (modules[m] || 0) + 1; });
      Object.keys(modules).forEach(function (m) {
        var label = (merged.module_labels && merged.module_labels[m]) || m;
        var span = document.createElement('span');
        span.className = 'badge text-bg-light border module-chip';
        span.textContent = label + ' (' + modules[m] + ')';
        areas.appendChild(span);
      });
      if (!Object.keys(modules).length) areas.innerHTML = '<span class="text-secondary small">No active schema tables yet — go to Update Schema to import one.</span>';
    }
  }

  //================================================================
  // 7. READ ONLY QUERY BUILDER
  //================================================================
  function wireReadOnlyBuilder() {
    renderRoTables();
    renderRoColumns();
    renderRoFilterRows();
    renderRoOrderByRows();
    renderRoGroupByRows();

    $('btnBuildQuery').addEventListener('click', function () { runDescribeBuild(); });
    $('describeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runDescribeBuild(); });
    $('btnBuildQueryManual').addEventListener('click', function () { runManualBuild(); });
    $('btnStartOver').addEventListener('click', function () {
      APP.conversation.reset(); APP.manualTables = {}; APP.manualColumns = []; APP.manualFilters = []; APP.manualOrderBy = []; APP.manualGroupBy = [];
      $('describeInput').value = ''; $('describeTurnCount').textContent = '0'; $('describeInterpretation').innerHTML = '';
      renderRoTables(); renderRoColumns(); renderRoFilterRows(); renderRoOrderByRows(); renderRoGroupByRows();
      $('roSqlOutput').textContent = '-- Your generated SQL will appear here.'; $('roSqlExplanation').innerHTML = ''; $('roSqlWarnings').innerHTML = '';
    });
    $('btnRemoveDuplicates').addEventListener('click', function () { $('roDistinct').checked = true; runManualBuild(); });
    $('btnCopyRoSql').addEventListener('click', function () { copyToClipboard($('roSqlOutput').textContent); });

    $('roTableSearch').addEventListener('input', function () { renderRoTables(); });
    $('roTablesSelectAll').addEventListener('click', function () { APP.engine.getAllTables().forEach(function (t) { APP.manualTables[t.name] = true; }); renderRoTables(); renderRoColumns(); });
    $('roTablesClear').addEventListener('click', function () { APP.manualTables = {}; renderRoTables(); renderRoColumns(); });

    $('roColumnSearch').addEventListener('input', function () { renderRoColumns(); });
    $('roColumnsSelectAll').addEventListener('click', function () { setAllRoColumns(true); });
    $('roColumnsUnselectAll').addEventListener('click', function () { setAllRoColumns(false); });

    $('roAddFilter').addEventListener('click', function () { APP.manualFilters.push({ table: '', column: '', operator: 'eq', value: '' }); renderRoFilterRows(); });
    $('roClearFilters').addEventListener('click', function () { APP.manualFilters = []; renderRoFilterRows(); });
    $('roAddOrderBy').addEventListener('click', function () { APP.manualOrderBy.push({ table: '', column: '', dir: 'asc' }); renderRoOrderByRows(); });
    $('roAddGroupBy').addEventListener('click', function () { APP.manualGroupBy.push({ table: '', column: '' }); renderRoGroupByRows(); });

    document.querySelector('#roConfigTabs').addEventListener('shown.bs.tab', function (e) {
      if (e.target && e.target.getAttribute('data-bs-target') === '#roTabSummary') updateRoSummary();
    });
  }

  function selectedRoTables() { return Object.keys(APP.manualTables).filter(function (t) { return APP.manualTables[t]; }); }

  function renderRoTables() {
    var list = $('roTableList'); if (!list) return;
    var term = ($('roTableSearch').value || '').toUpperCase();
    list.innerHTML = '';
    APP.engine.getAllTables().filter(function (t) { return !term || t.name.toUpperCase().indexOf(term) !== -1; }).forEach(function (t) {
      var row = document.createElement('div'); row.className = 'form-check';
      var checked = !!APP.manualTables[t.name];
      row.innerHTML = '<input class="form-check-input" type="checkbox" id="rotbl_' + t.name + '" ' + (checked ? 'checked' : '') + '>' +
        '<label class="form-check-label small" for="rotbl_' + t.name + '"><strong>' + esc(t.name) + '</strong> <span class="text-secondary">' + esc(t.notes || '') + '</span></label>';
      row.querySelector('input').addEventListener('change', function (e) {
        if (e.target.checked) APP.manualTables[t.name] = true; else delete APP.manualTables[t.name];
        renderRoColumns();
      });
      list.appendChild(row);
    });
    $('roTableCount').textContent = String(selectedRoTables().length);
  }

  function renderRoColumns() {
    var list = $('roColumnList'); if (!list) return;
    var term = ($('roColumnSearch').value || '').toUpperCase();
    list.innerHTML = '';
    var tables = selectedRoTables();
    if (!tables.length) { list.innerHTML = '<div class="text-secondary small p-2">Select at least one table first.</div>'; return; }
    tables.forEach(function (tn) {
      var t = APP.engine.getTable(tn); if (!t) return;
      var heading = document.createElement('div'); heading.className = 'col-group-heading'; heading.textContent = tn; list.appendChild(heading);
      (t.columns || []).filter(function (c) { return !term || c.name.toUpperCase().indexOf(term) !== -1; }).forEach(function (c) {
        var existing = APP.manualColumns.filter(function (mc) { return mc.table === tn && mc.column === c.name; })[0];
        var row = document.createElement('div'); row.className = 'column-row-grid';
        row.innerHTML =
          '<span class="col-check"><input class="form-check-input" type="checkbox" ' + (existing ? 'checked' : '') + '></span>' +
          '<span class="col-name">' + esc(c.name) + '</span>' +
          '<input class="form-control form-control-sm col-alias" placeholder="alias" value="' + esc(existing ? existing.alias || '' : '') + '" ' + (existing ? '' : 'disabled') + '>' +
          '<button type="button" class="btn btn-sm btn-outline-secondary col-decode ' + (existing ? '' : 'disabled') + '" title="CASE/DECODE" ' + (existing ? '' : 'disabled') + '><i class="bi bi-gear"></i></button>';
        var checkbox = row.querySelector('input[type=checkbox]');
        var aliasInput = row.querySelector('.col-alias');
        var decodeBtn = row.querySelector('.col-decode');
        checkbox.addEventListener('change', function () {
          if (checkbox.checked) {
            APP.manualColumns.push({ table: tn, column: c.name, alias: '', decode: false });
            aliasInput.disabled = false; decodeBtn.disabled = false; decodeBtn.classList.remove('disabled');
          } else {
            APP.manualColumns = APP.manualColumns.filter(function (mc) { return !(mc.table === tn && mc.column === c.name); });
            aliasInput.disabled = true; decodeBtn.disabled = true; decodeBtn.classList.add('disabled');
          }
        });
        aliasInput.addEventListener('input', function () {
          var mc = APP.manualColumns.filter(function (x) { return x.table === tn && x.column === c.name; })[0];
          if (mc) mc.alias = aliasInput.value;
        });
        decodeBtn.addEventListener('click', function () { openDecodeDialog(tn, c.name); });
        list.appendChild(row);
      });
    });
  }

  function setAllRoColumns(select) {
    var tables = selectedRoTables();
    if (select) {
      tables.forEach(function (tn) {
        var t = APP.engine.getTable(tn); if (!t) return;
        (t.columns || []).forEach(function (c) {
          if (!APP.manualColumns.some(function (mc) { return mc.table === tn && mc.column === c.name; })) APP.manualColumns.push({ table: tn, column: c.name, alias: '', decode: false });
        });
      });
    } else {
      APP.manualColumns = APP.manualColumns.filter(function (mc) { return tables.indexOf(mc.table) === -1; });
    }
    renderRoColumns();
  }

  function openDecodeDialog(table, column) {
    var existing = APSQL_DECODE.resolveDecode(APP.engine, APP.decodeStore, table, column);
    if (existing) {
      alert('A CASE/DECODE definition already exists for ' + table + '.' + column + ' (source: ' + existing.source + '). It will be applied automatically when this column is marked as decoded.');
      var mc = APP.manualColumns.filter(function (x) { return x.table === table && x.column === column; })[0];
      if (mc) mc.decode = true;
      return;
    }
    var casesText = prompt('Define CASE/DECODE for ' + table + '.' + column + '.\nEnter one "value=label" pair per line (e.g.\n1=Pending\n2=Approved):', '');
    if (casesText === null) return;
    var elseVal = prompt('Default (ELSE) label if no case matches (optional):', '') || '';
    var cases = casesText.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var idx = l.indexOf('='); return idx === -1 ? null : { when: l.slice(0, idx).trim(), then: l.slice(idx + 1).trim() };
    }).filter(Boolean);
    var def = { cases: cases, else_value: elseVal };
    var v = APSQL_DECODE.validateNewDefinition(APP.engine, APP.decodeStore, table, column, def);
    if (!v.valid) { alert('Could not save this definition:\n' + v.errors.join('\n')); return; }
    APP.decodeStore.setManual(table, column, def);
    APP.pendingDecodeApprovals.push({ table: table, column: column, def: def, requestedAt: new Date().toISOString() });
    renderDecodeApprovalList();
    var mc2 = APP.manualColumns.filter(function (x) { return x.table === table && x.column === column; })[0];
    if (mc2) mc2.decode = true;
    alert('Manual definition saved for this session and queued for Admin Approval in Update Schema before it is written into the Default schema.');
  }

  function renderRoFilterRows() {
    var container = $('roFilterRows'); if (!container) return;
    container.innerHTML = '';
    APP.manualFilters.forEach(function (f, idx) {
      var row = document.createElement('div'); row.className = 'filter-row';
      row.innerHTML = buildColumnSelectHtml('f-table-' + idx, f.table) +
        '<select class="form-select form-select-sm f-operator">' + operatorOptionsHtml(f.operator) + '</select>' +
        '<input class="form-control form-control-sm f-value" placeholder="value" value="' + esc(f.value || '') + '">' +
        '<input class="form-control form-control-sm f-value2" placeholder="value 2 (BETWEEN)" value="' + esc(f.value2 || '') + '" style="display:' + (f.operator === 'between' ? 'inline-block' : 'none') + '">' +
        '<button class="btn btn-sm btn-outline-danger f-remove"><i class="bi bi-x-lg"></i></button>';
      wireColumnSelect(row, f, function () { });
      var opSel = row.querySelector('.f-operator');
      opSel.value = f.operator;
      opSel.addEventListener('change', function () { f.operator = opSel.value; row.querySelector('.f-value2').style.display = (f.operator === 'between') ? 'inline-block' : 'none'; });
      row.querySelector('.f-value').addEventListener('input', function (e) { f.value = e.target.value; });
      row.querySelector('.f-value2').addEventListener('input', function (e) { f.value2 = e.target.value; });
      row.querySelector('.f-remove').addEventListener('click', function () { APP.manualFilters.splice(idx, 1); renderRoFilterRows(); });
      container.appendChild(row);
    });
  }

  function operatorOptionsHtml(current) {
    var ops = [['eq', '='], ['neq', '<>'], ['gt', '>'], ['gte', '>='], ['lt', '<'], ['lte', '<='], ['like', 'LIKE'], ['notlike', 'NOT LIKE'], ['in', 'Is one of (IN)'], ['notin', 'Is not one of (NOT IN)'], ['between', 'BETWEEN'], ['isnull', 'IS NULL'], ['isnotnull', 'IS NOT NULL']];
    return ops.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === current ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  }

  function buildColumnSelectHtml(idPrefix, selectedValue) {
    var tables = selectedRoTables().length ? selectedRoTables() : APP.engine.getAllTables().map(function (t) { return t.name; });
    var html = '<select class="form-select form-select-sm f-column" data-id="' + idPrefix + '"><option value="">table.column</option>';
    tables.forEach(function (tn) {
      var t = APP.engine.getTable(tn); if (!t) return;
      (t.columns || []).forEach(function (c) {
        var val = tn + '.' + c.name;
        html += '<option value="' + val + '"' + (val === selectedValue ? ' selected' : '') + '>' + val + '</option>';
      });
    });
    html += '</select>';
    return html;
  }

  function wireColumnSelect(row, target, onChange) {
    var sel = row.querySelector('.f-column');
    sel.addEventListener('change', function () {
      var parts = sel.value.split('.');
      target.table = parts[0] || ''; target.column = parts[1] || '';
      var colDef = target.table ? APP.engine.getColumn(target.table, target.column) : null;
      target.columnType = colDef ? colDef.type : null;
      onChange();
    });
  }

  function renderRoOrderByRows() {
    var container = $('roOrderByRows'); if (!container) return;
    container.innerHTML = '';
    APP.manualOrderBy.forEach(function (o, idx) {
      var row = document.createElement('div'); row.className = 'orderby-row';
      row.innerHTML = buildColumnSelectHtml('ob-' + idx, o.table ? o.table + '.' + o.column : '') +
        '<select class="form-select form-select-sm ob-dir"><option value="asc"' + (o.dir === 'asc' ? ' selected' : '') + '>ASC</option><option value="desc"' + (o.dir === 'desc' ? ' selected' : '') + '>DESC</option></select>' +
        '<button class="btn btn-sm btn-outline-danger ob-remove"><i class="bi bi-x-lg"></i></button>';
      wireColumnSelect(row, o, function () { });
      row.querySelector('.ob-dir').addEventListener('change', function (e) { o.dir = e.target.value; });
      row.querySelector('.ob-remove').addEventListener('click', function () { APP.manualOrderBy.splice(idx, 1); renderRoOrderByRows(); });
      container.appendChild(row);
    });
  }

  function renderRoGroupByRows() {
    var container = $('roGroupByRows'); if (!container) return;
    container.innerHTML = '';
    APP.manualGroupBy.forEach(function (g, idx) {
      var row = document.createElement('div'); row.className = 'groupby-row';
      row.innerHTML = buildColumnSelectHtml('gb-' + idx, g.table ? g.table + '.' + g.column : '') +
        '<button class="btn btn-sm btn-outline-danger gb-remove"><i class="bi bi-x-lg"></i></button>';
      wireColumnSelect(row, g, function () { });
      row.querySelector('.gb-remove').addEventListener('click', function () { APP.manualGroupBy.splice(idx, 1); renderRoGroupByRows(); });
      container.appendChild(row);
    });
  }

  function updateRoSummary() {
    $('roSummaryJson').textContent = JSON.stringify(assembleRoOptions(), null, 2);
  }

  function assembleRoOptions() {
    var dialect = $('describeDialect').value;
    var options = {
      dialect: dialect,
      selectedTables: selectedRoTables(),
      selectedColumns: APP.manualColumns.slice(),
      filterGroup: { conditions: APP.manualFilters.filter(function (f) { return f.table && f.column; }).map(function (f) { return APSQL_FILTER.newCondition(f); }) },
      orderBy: APP.manualOrderBy.filter(function (o) { return o.table && o.column; }),
      groupBy: APP.manualGroupBy.filter(function (g) { return g.table && g.column; }),
      having: ($('roHaving').value || '') || undefined,
      cteName: $('roCteName').value || undefined,
      distinct: $('roDistinct').checked,
      joinType: $('roJoinType').value,
      limit: $('roLimit').value ? parseInt($('roLimit').value, 10) : undefined
    };
    var advRaw = ($('roAdvancedJson').value || '').trim();
    if (advRaw) {
      try {
        var adv = JSON.parse(advRaw);
        Object.keys(adv).forEach(function (k) { if (adv[k] !== null && adv[k] !== undefined) options[k] = adv[k]; });
      } catch (e) { showAlertBox('roSqlWarnings', 'warning', 'Power-user JSON options could not be parsed and were ignored: ' + e.message); }
    }
    return options;
  }

  function planToOptions(plan, dialect) {
    var opts = {
      dialect: dialect,
      selectedTables: plan.tables,
      selectedColumns: plan.columns.map(function (c) { return { table: c.table, column: c.column }; }),
      filterGroup: { conditions: (plan.filterConditions || []).map(function (c) {
        var copy = Object.assign({}, c);
        if (typeof copy.value === 'string' && /^__(DAYS|MONTHS)_AGO_/.test(copy.value)) copy.value = APSQL_NLQ.resolveRelativeDates(copy.value);
        return APSQL_FILTER.newCondition(copy);
      }) },
      orderBy: plan.orderBy || [],
      groupBy: plan.groupBy || [],
      distinct: !!plan.distinct,
      limit: plan.limit || undefined
    };
    if (plan.aggregations && plan.aggregations.length) {
      plan.aggregations.forEach(function (a) {
        opts.selectedColumns.push({ table: a.table, column: a.column, aggregate: a.fn, alias: a.fn.toLowerCase() + '_' + a.column });
      });
    }
    return opts;
  }

  function runDescribeBuild() {
    var text = $('describeInput').value.trim();
    if (!text) return;
    var plan = APP.conversation.submit(text, APP.effEngine);
    $('describeTurnCount').textContent = String(APP.conversation.getHistory().length);
    renderInterpretation(plan);
    if (plan.missingInfo && plan.missingInfo.length) return; // don't attempt generation if we couldn't understand it
    var options = planToOptions(plan, $('describeDialect').value);
    generateAndRenderRo(options);
  }

  function runManualBuild() {
    var options = assembleRoOptions();
    if (!options.selectedTables.length && APP.conversation.getCurrentPlan()) {
      var plan = APP.conversation.getCurrentPlan();
      var planOpts = planToOptions(plan, options.dialect);
      options.selectedTables = planOpts.selectedTables;
      if (!options.selectedColumns.length) options.selectedColumns = planOpts.selectedColumns;
      options.filterGroup.conditions = options.filterGroup.conditions.concat(planOpts.filterGroup.conditions);
    }
    generateAndRenderRo(options);
    updateRoSummary();
  }

  function renderInterpretation(plan) {
    var box = $('describeInterpretation');
    if (!plan.tables.length) {
      box.innerHTML = '<div class="alert alert-warning py-2 px-3 mb-0 small">' + (plan.missingInfo || []).map(esc).join('<br>') + '</div>';
      return;
    }
    var lines = [];
    lines.push('<strong>Tables:</strong> ' + plan.tables.join(', '));
    if (plan.columns && plan.columns.length) lines.push('<strong>Columns:</strong> ' + plan.columns.map(function (c) { return c.table + '.' + c.column; }).join(', '));
    if (plan.filterConditions && plan.filterConditions.length) lines.push('<strong>Filters:</strong> ' + plan.filterConditions.length + ' condition(s)');
    if (plan.aggregations && plan.aggregations.length) lines.push('<strong>Aggregation:</strong> ' + plan.aggregations.map(function (a) { return a.fn + '(' + a.column + ')'; }).join(', '));
    if (plan.orderBy && plan.orderBy.length) lines.push('<strong>Sort:</strong> ' + plan.orderBy.map(function (o) { return o.table + '.' + o.column + ' ' + o.dir.toUpperCase(); }).join(', '));
    if (plan.warnings && plan.warnings.length) lines.push('<span class="text-warning">' + plan.warnings.join('<br>') + '</span>');
    box.innerHTML = '<div class="alert alert-light border py-2 px-3 mb-0 small"><ul class="mb-0">' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul></div>';
  }

  function generateAndRenderRo(options) {
    if (!options.selectedTables || !options.selectedTables.length) {
      showAlertBox('roSqlWarnings', 'warning', 'Select at least one table (manually, or via a description above) before building a query.');
      return;
    }
    var result = APSQL_VALIDATION.selfCorrect(APSQL_SQL.generateSql, null, options, APP.effEngine, APP.decodeStore, APP.effEngine, 3);
    $('roSqlWarnings').innerHTML = '';
    if (result.status !== 'ok') {
      $('roSqlOutput').textContent = '-- Could not generate SQL.';
      $('roSqlExplanation').innerHTML = '';
      showAlertBox('roSqlWarnings', 'danger', (result.errors || []).join('<br>'));
      return;
    }
    APP.lastRoResult = result;
    $('roSqlOutput').textContent = result.sql;
    $('roSqlExplanation').textContent = APSQL_OPTIMIZE.explainQuery(result, APP.effEngine) || '';
    var hints = APSQL_OPTIMIZE.optimizationHints(result.sql);
    var allWarnings = (result.warnings || []).concat(hints);
    if (allWarnings.length) showAlertBox('roSqlWarnings', 'info', allWarnings.join('<br>'));
  }

  function showAlertBox(containerId, kind, html) {
    var el = $(containerId); if (!el) return;
    el.innerHTML = '<div class="alert alert-' + kind + ' py-2 px-3 mb-0 small">' + html + '</div>';
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(function () {});
    else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
  }

  //================================================================
  // 8. CR QUERY BUILDER
  //================================================================
  function wireCrBuilder() {
    populateCrTableSelect();
    document.querySelectorAll('.cr-command-option').forEach(function (opt) {
      opt.addEventListener('click', function () {
        document.querySelectorAll('.cr-command-option').forEach(function (o) { o.classList.remove('active'); });
        opt.classList.add('active');
        APP.crFields = [];
        renderCrFieldRows();
        updateCrUiForCommand();
      });
    });
    $('crAddField').addEventListener('click', function () { APP.crFields.push({ column: '', value: '' }); renderCrFieldRows(); });
    $('crAddFilter').addEventListener('click', function () { APP.crFilters.push({ table: '', column: '', operator: 'eq', value: '' }); renderCrFilterRows(); });
    $('btnBuildCr').addEventListener('click', buildCrQuerySql);
    $('btnCopyCrSql').addEventListener('click', function () { copyToClipboard($('crSqlOutput').textContent); });
    $('crTableSelect').addEventListener('change', function () { APP.crFields = []; APP.crFilters = []; renderCrFieldRows(); renderCrFilterRows(); });
    renderCrFieldRows(); renderCrFilterRows(); updateCrUiForCommand();
  }

  function currentCrCommand() { var el = document.querySelector('.cr-command-option.active'); return el ? el.getAttribute('data-command') : 'INSERT'; }

  function updateCrUiForCommand() {
    var cmd = currentCrCommand();
    $('crFieldsHeading').textContent = cmd === 'DELETE' ? 'No columns needed for DELETE' : (cmd === 'UPDATE' ? 'Columns to Update' : 'Columns & Values');
    $('crFieldRows').style.display = cmd === 'DELETE' ? 'none' : '';
    $('crAddField').style.display = cmd === 'DELETE' ? 'none' : '';
    $('crFilterCard').style.display = cmd === 'INSERT' ? 'none' : '';
  }

  function populateCrTableSelect() {
    var sel = $('crTableSelect'); if (!sel) return;
    sel.innerHTML = '';
    APP.engine.getAllTables().forEach(function (t) { var o = document.createElement('option'); o.value = t.name; o.textContent = t.name; sel.appendChild(o); });
  }

  function renderCrFieldRows() {
    var container = $('crFieldRows'); if (!container) return;
    container.innerHTML = '';
    var table = $('crTableSelect').value;
    var t = APP.engine.getTable(table);
    APP.crFields.forEach(function (f, idx) {
      var row = document.createElement('div'); row.className = 'field-row';
      var colOptions = '<option value="">column</option>' + ((t && t.columns) || []).map(function (c) { return '<option value="' + c.name + '"' + (c.name === f.column ? ' selected' : '') + '>' + c.name + '</option>'; }).join('');
      row.innerHTML = '<select class="form-select form-select-sm cf-col">' + colOptions + '</select>' +
        '<input class="form-control form-control-sm cf-val" placeholder="value" value="' + esc(f.value || '') + '">' +
        '<button class="btn btn-sm btn-outline-danger cf-remove"><i class="bi bi-x-lg"></i></button>';
      row.querySelector('.cf-col').addEventListener('change', function (e) { f.column = e.target.value; });
      row.querySelector('.cf-val').addEventListener('input', function (e) { f.value = e.target.value; });
      row.querySelector('.cf-remove').addEventListener('click', function () { APP.crFields.splice(idx, 1); renderCrFieldRows(); });
      container.appendChild(row);
    });
  }

  function renderCrFilterRows() {
    var container = $('crFilterRows'); if (!container) return;
    container.innerHTML = '';
    var table = $('crTableSelect').value;
    var t = APP.engine.getTable(table);
    APP.crFilters.forEach(function (f, idx) {
      var row = document.createElement('div'); row.className = 'filter-row';
      var colOptions = '<option value="">column</option>' + ((t && t.columns) || []).map(function (c) { return '<option value="' + c.name + '"' + (c.name === f.column ? ' selected' : '') + '>' + c.name + '</option>'; }).join('');
      row.innerHTML = '<select class="form-select form-select-sm cff-col">' + colOptions + '</select>' +
        '<select class="form-select form-select-sm cff-op">' + operatorOptionsHtml(f.operator) + '</select>' +
        '<input class="form-control form-control-sm cff-val" placeholder="value" value="' + esc(f.value || '') + '">' +
        '<button class="btn btn-sm btn-outline-danger cff-remove"><i class="bi bi-x-lg"></i></button>';
      row.querySelector('.cff-col').addEventListener('change', function (e) { f.column = e.target.value; f.table = table; });
      row.querySelector('.cff-op').addEventListener('change', function (e) { f.operator = e.target.value; });
      row.querySelector('.cff-val').addEventListener('input', function (e) { f.value = e.target.value; });
      row.querySelector('.cff-remove').addEventListener('click', function () { APP.crFilters.splice(idx, 1); renderCrFilterRows(); });
      container.appendChild(row);
    });
  }

  function buildCrQuerySql() {
    var table = $('crTableSelect').value;
    var command = currentCrCommand();
    var dialect = $('crDialect').value;
    var req = { command: command, table: table, explicitOverride: $('crExplicitOverride').checked };
    if (command === 'INSERT') req.columns = APP.crFields.filter(function (f) { return f.column; }).map(function (f) { return { name: f.column, value: f.value }; });
    if (command === 'UPDATE') req.updates = APP.crFields.filter(function (f) { return f.column; }).map(function (f) { return { column: f.column, value: f.value }; });
    req.filterGroup = { conditions: APP.crFilters.filter(function (f) { return f.column; }).map(function (f) { return APSQL_FILTER.newCondition({ table: table, column: f.column, operator: f.operator, value: f.value }); }) };
    var result = APSQL_CR.buildCrQuery(APP.effEngine, req, dialect);
    $('crSqlWarnings').innerHTML = '';
    if (result.status === 'rejected' || result.status === 'error') {
      $('crSqlOutput').textContent = '-- Query blocked.';
      showAlertBox('crSqlWarnings', 'danger', (result.errors || []).join('<br>'));
      return;
    }
    $('crSqlOutput').textContent = result.sql;
    if ((result.warnings || []).length) showAlertBox('crSqlWarnings', 'warning', result.warnings.join('<br>'));
  }

  //================================================================
  // 9. USED SCHEMA
  //================================================================
  function renderUsedSchema() {
    var list = $('usedSchemaList'); if (!list) return;
    list.innerHTML = '';
    APP.schemaStore.getEntries().forEach(function (e) {
      var state = APP.schemaStore.getSchemaState(e.id);
      var badgeClass = state === 'default' ? 'badge-schema-default' : (state === 'active' ? 'badge-schema-active' : 'badge-schema-inactive');
      var row = document.createElement('div'); row.className = 'd-flex align-items-center justify-content-between border rounded p-2 mb-2';
      row.innerHTML = '<div><input type="checkbox" class="form-check-input me-2" ' + (state === 'default' ? 'disabled checked' : (state === 'active' ? 'checked' : '')) + '> <strong>' + esc(e.name) + '</strong> <span class="text-secondary small">v' + esc(e.version) + '</span></div>' +
        '<span class="badge ' + badgeClass + ' text-uppercase">' + state + '</span>';
      row.querySelector('input').addEventListener('change', function (ev) {
        var ok = APP.schemaStore.setEntryActive(e.id, ev.target.checked);
        if (!ok) { ev.target.checked = true; alert('The Default schema is always Active and cannot be deactivated here. Change the Default schema first in Update Schema.'); }
        onSchemaChanged();
      });
      list.appendChild(row);
    });
  }

  //================================================================
  // 10. UPDATE SCHEMA
  //================================================================
  function wireUpdateSchema() {
    $('btnUnlockUpdateSchema').addEventListener('click', function () {
      var pw = $('updateSchemaPasswordInput').value;
      APP.passwordManager.verifyCurrentPassword(pw).then(function (ok) {
        if (ok) { $('updateSchemaLock').style.display = 'none'; $('updateSchemaContent').style.display = ''; renderUpdateSchemaLists(); renderDecodeApprovalList(); }
        else { $('updateSchemaPasswordError').style.display = 'block'; $('updateSchemaPasswordError').textContent = 'Incorrect password.'; }
      });
    });
    $('btnForgotPassword').addEventListener('click', function () {
      if (confirm('Reset the operational password back to its default? This does not delete any stored schemas.')) {
        APP.passwordManager.resetToDefault();
        alert('Password reset to the documented default. You can now unlock Update Schema with it.');
      }
    });

    $('btnAddNewSchema').addEventListener('click', function () {
      var name = $('newSchemaName').value.trim() || undefined;
      var entry = APP.schemaStore.addEntry({ name: name, schema: { schema_name: name || 'New Schema', schema_version: '1.0', tables: [] } });
      $('newSchemaName').value = '';
      onSchemaChanged();
    });

    $('btnSaveActiveSelection').addEventListener('click', function () {
      document.querySelectorAll('#activeSchemaChoices input[type=checkbox]').forEach(function (cb) {
        APP.schemaStore.setEntryActive(cb.value, cb.checked);
      });
      onSchemaChanged();
      alert('Active schema selection saved.');
    });

    $('btnProcessFile').addEventListener('click', processSchemaImportFile);
    document.querySelectorAll('[data-sample]').forEach(function (btn) { btn.addEventListener('click', function () { downloadSampleFormat(btn.getAttribute('data-sample')); }); });
    document.querySelectorAll('[data-download]').forEach(function (btn) { btn.addEventListener('click', function () { downloadCurrentSchema(btn.getAttribute('data-download')); }); });
    $('btnViewExpectedStructure').addEventListener('click', function () {
      alert('Expected structure (JSON): { schema_name, schema_version, module_labels, tables: [ { name, module, notes, columns: [ { name, type, nullable, primary_key, foreign_key:{table,column}|null, alias, description, decode } ] } ] }.\nCSV/XLSX use one row per column with headers: table, module, column, type, nullable, primary_key, fk_table, fk_column, alias, description.');
    });

    $('btnApplySchemaUpdate').addEventListener('click', function () {
      if (!APP.pendingSchemaUpdate) return;
      APP.schemaStore.updateEntrySchema(APP.pendingSchemaUpdate.targetEntryId, APP.pendingSchemaUpdate.schema);
      APP.pendingSchemaUpdate = null;
      $('schemaPreviewPanel').style.display = 'none';
      showAlertBox('schemaImportMessage', 'success', 'Schema update applied.');
      onSchemaChanged();
    });
    $('btnCancelSchemaUpdate').addEventListener('click', function () {
      APP.pendingSchemaUpdate = null;
      $('schemaPreviewPanel').style.display = 'none';
      showAlertBox('schemaImportMessage', 'secondary', 'Update canceled — no changes were made.');
    });

    $('btnCheckSharedSchemaNow').addEventListener('click', function () {
      var path = $('sharedSchemaPath').value || APSQL_SHARED_SCHEMA_LOADER.DEFAULT_PATH;
      APSQL_SHARED_SCHEMA_LOADER.checkNow(path).then(function (r) {
        var el = $('sharedSchemaResult');
        if (r.found) { el.innerHTML = '<span class="text-success">Found a shared schema at ' + esc(path) + '. Applying to the Default schema…</span>'; APP.schemaStore.updateEntrySchema(APP.schemaStore.getDefaultId(), r.schema); onSchemaChanged(); }
        else el.innerHTML = '<span class="text-secondary">' + esc(r.reason) + '</span>';
      });
    });

    APP.githubLinker = APSQL_SCHEMA_SYNC.createLinker(safeLocalStorage());
    $('btnLinkFile').addEventListener('click', function () {
      APP.githubLinker.link().then(function () { $('linkedFileResult').innerHTML = '<span class="text-success">File linked.</span>'; })
        .catch(function (e) { $('linkedFileResult').innerHTML = '<span class="text-danger">' + esc(e.message) + '</span>'; });
    });
    $('btnReadLinkedFile').addEventListener('click', function () {
      APP.githubLinker.readLinkedFile().then(function (schema) {
        APP.schemaStore.updateEntrySchema(APP.schemaStore.getDefaultId(), schema);
        onSchemaChanged();
        $('linkedFileResult').innerHTML = '<span class="text-success">Linked file applied to the Default schema.</span>';
      }).catch(function (e) { $('linkedFileResult').innerHTML = '<span class="text-danger">' + esc(e.message) + '</span>'; });
    });
    $('btnWriteLinkedFile').addEventListener('click', function () {
      var entry = APP.schemaStore.getEntry(APP.schemaStore.getDefaultId());
      APP.githubLinker.writeLinkedFile(entry.schema).then(function () { $('linkedFileResult').innerHTML = '<span class="text-success">Default schema published to the linked file.</span>'; })
        .catch(function (e) { $('linkedFileResult').innerHTML = '<span class="text-danger">' + esc(e.message) + '</span>'; });
    });

    $('btnGithubFetch').addEventListener('click', function () {
      var cfg = { owner: $('ghOwner').value, repo: $('ghRepo').value, path: $('ghPath').value, branch: $('ghBranch').value || undefined };
      APSQL_GITHUB_SYNC.fetchSchemaAnonymous(cfg).then(function (schema) {
        APP.schemaStore.updateEntrySchema(APP.schemaStore.getDefaultId(), schema);
        onSchemaChanged();
        $('githubSyncResult').innerHTML = '<span class="text-success">Fetched and applied to the Default schema.</span>';
      }).catch(function (e) { $('githubSyncResult').innerHTML = '<span class="text-danger">' + esc(e.message) + '</span>'; });
    });

    $('btnEncryptPublishVault').addEventListener('click', function () {
      var cfg = { owner: $('ghOwner').value, repo: $('ghRepo').value, path: $('ghPath').value, branch: $('ghBranch').value || undefined, token: $('ghToken').value };
      var pw = $('vaultPassword').value;
      if (!pw) { $('vaultResult').innerHTML = '<span class="text-danger">Enter a vault password first.</span>'; return; }
      APSQL_VAULT.encryptVault(cfg, pw).then(function (vault) {
        safeLocalStorage().setItem('ap_sql_github_vault', JSON.stringify(vault));
        $('vaultResult').innerHTML = '<span class="text-success">Vault encrypted and stored (locally). Token is never stored in plaintext.</span>';
      });
    });
    $('btnFetchUnlockVault').addEventListener('click', function () {
      var raw = safeLocalStorage().getItem('ap_sql_github_vault');
      if (!raw) { $('vaultResult').innerHTML = '<span class="text-danger">No vault file was found. Ask an administrator to publish one first.</span>'; return; }
      var vault; try { vault = JSON.parse(raw); } catch (e) { $('vaultResult').innerHTML = '<span class="text-danger">This does not look like a valid encrypted credential vault.</span>'; return; }
      var pw = $('vaultPassword').value;
      APSQL_VAULT.decryptVault(vault, pw).then(function (cfg) {
        $('ghOwner').value = cfg.owner || ''; $('ghRepo').value = cfg.repo || ''; $('ghPath').value = cfg.path || ''; $('ghToken').value = cfg.token || '';
        $('vaultResult').innerHTML = '<span class="text-success">Vault unlocked.</span>';
      }).catch(function (e) { $('vaultResult').innerHTML = '<span class="text-danger">' + esc(e.message) + '</span>'; });
    });

    $('btnChangePassword').addEventListener('click', function () {
      APP.passwordManager.changePassword($('pwCurrent').value, $('pwNew').value, $('pwConfirm').value).then(function (r) {
        $('pwChangeResult').innerHTML = r.ok ? '<span class="text-success">Password changed.</span>' : '<span class="text-danger">' + esc(r.error) + '</span>';
        if (r.ok) { $('pwCurrent').value = ''; $('pwNew').value = ''; $('pwConfirm').value = ''; }
      });
    });

    $('btnDeleteSchemaContents').addEventListener('click', function () {
      if (!confirm('Permanently clear the working schema\u2019s contents? A backup will download automatically first.')) return;
      var entry = APP.schemaStore.getEntry(APP.workingSchemaEntryId);
      if (!entry) return;
      downloadFile(entry.name.replace(/\s+/g, '_') + '_backup.json', JSON.stringify(entry.schema, null, 2), 'application/json');
      APP.schemaStore.updateEntrySchema(entry.id, { schema_name: entry.schema.schema_name, schema_version: entry.schema.schema_version, module_labels: {}, tables: [] });
      onSchemaChanged();
    });

    renderUpdateSchemaLists();
  }

  function renderUpdateSchemaLists() {
    var manage = $('manageSchemaList'); if (!manage) return;
    manage.innerHTML = '';
    APP.schemaStore.getEntries().forEach(function (e) {
      var state = APP.schemaStore.getSchemaState(e.id);
      var row = document.createElement('div'); row.className = 'd-flex align-items-center justify-content-between border rounded p-2 mb-1';
      row.innerHTML = '<span><input type="radio" name="workingSchema" ' + (APP.workingSchemaEntryId === e.id ? 'checked' : '') + '> ' + esc(e.name) + ' <span class="badge text-bg-light border">' + state + '</span></span>' +
        '<button class="btn btn-sm btn-outline-danger" ' + (state === 'default' ? 'disabled title="Cannot delete the Default schema"' : '') + '><i class="bi bi-trash"></i></button>';
      row.querySelector('input').addEventListener('change', function () { APP.workingSchemaEntryId = e.id; $('workingWithSchemaName').textContent = e.name; });
      row.querySelector('button').addEventListener('click', function () { if (confirm('Delete "' + e.name + '"? This cannot be undone.')) { APP.schemaStore.removeEntry(e.id); onSchemaChanged(); renderUpdateSchemaLists(); } });
      manage.appendChild(row);
    });
    var workingEntry = APP.schemaStore.getEntry(APP.workingSchemaEntryId);
    $('workingWithSchemaName').textContent = workingEntry ? workingEntry.name : '—';

    var defaultChoices = $('defaultSchemaChoices'); defaultChoices.innerHTML = '';
    var activeChoices = $('activeSchemaChoices'); activeChoices.innerHTML = '';
    APP.schemaStore.getEntries().forEach(function (e) {
      var d = document.createElement('div'); d.className = 'form-check';
      d.innerHTML = '<input class="form-check-input" type="radio" name="defaultSchemaRadio" value="' + e.id + '" ' + (APP.schemaStore.isDefault(e.id) ? 'checked' : '') + '> <label class="form-check-label small">' + esc(e.name) + '</label>';
      d.querySelector('input').addEventListener('change', function () { APP.schemaStore.setDefaultId(e.id); onSchemaChanged(); renderUpdateSchemaLists(); });
      defaultChoices.appendChild(d);

      var a = document.createElement('div'); a.className = 'form-check';
      a.innerHTML = '<input class="form-check-input" type="checkbox" value="' + e.id + '" ' + (APP.schemaStore.isActive(e.id) ? 'checked' : '') + ' ' + (APP.schemaStore.isDefault(e.id) ? 'disabled' : '') + '> <label class="form-check-label small">' + esc(e.name) + '</label>';
      activeChoices.appendChild(a);
    });
  }

  function renderDecodeApprovalList() {
    var el = $('decodeApprovalList'); if (!el) return;
    if (!APP.pendingDecodeApprovals.length) { el.innerHTML = 'No pending definitions.'; return; }
    el.innerHTML = '';
    APP.pendingDecodeApprovals.forEach(function (p, idx) {
      var row = document.createElement('div'); row.className = 'border rounded p-2 mb-2 d-flex justify-content-between align-items-center';
      row.innerHTML = '<span><strong>' + esc(p.table) + '.' + esc(p.column) + '</strong> — ' + p.def.cases.length + ' case(s)</span>' +
        '<div><button class="btn btn-sm btn-success me-1">Approve</button><button class="btn btn-sm btn-outline-danger">Reject</button></div>';
      row.querySelectorAll('button')[0].addEventListener('click', function () {
        var def = APP.schemaStore.getEntry(APP.schemaStore.getDefaultId());
        var t = (def.schema.tables || []).filter(function (tt) { return tt.name.toUpperCase() === p.table.toUpperCase(); })[0];
        if (t) {
          var col = (t.columns || []).filter(function (c) { return c.name.toUpperCase() === p.column.toUpperCase(); })[0];
          if (col) col.decode = p.def;
        }
        APP.schemaStore.updateEntrySchema(def.id, def.schema);
        APP.pendingDecodeApprovals.splice(idx, 1);
        onSchemaChanged(); renderDecodeApprovalList();
      });
      row.querySelectorAll('button')[1].addEventListener('click', function () { APP.pendingDecodeApprovals.splice(idx, 1); renderDecodeApprovalList(); });
      el.appendChild(row);
    });
  }

  function downloadFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadSampleFormat(fmt) {
    if (fmt === 'json') downloadFile('ap-sql-sample-schema.json', APSQL_SCHEMA_TOOLS.sampleJson(), 'application/json');
    else if (fmt === 'csv') downloadFile('ap-sql-sample-schema.csv', APSQL_SCHEMA_TOOLS.sampleCsv(), 'text/csv');
    else if (fmt === 'xlsx') {
      if (typeof XLSX === 'undefined') { alert('XLSX library not loaded (no internet connection?).'); return; }
      var rows = APSQL_SCHEMA_TOOLS.tablesToCsvRows(APSQL_SCHEMA_TOOLS.sampleSchemaObject().tables);
      var ws = XLSX.utils.aoa_to_sheet(rows); var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Schema');
      XLSX.writeFile(wb, 'ap-sql-sample-schema.xlsx');
    } else if (fmt === 'doc') {
      var rows2 = APSQL_SCHEMA_TOOLS.tablesToCsvRows(APSQL_SCHEMA_TOOLS.sampleSchemaObject().tables);
      downloadFile('ap-sql-sample-schema.doc', rowsToHtmlTableDoc(rows2), 'application/msword');
    }
  }

  function rowsToHtmlTableDoc(rows) {
    var html = '<html><head><meta charset="utf-8"></head><body><table border="1">' +
      rows.map(function (r, i) { return '<tr>' + r.map(function (c) { return (i === 0 ? '<th>' : '<td>') + esc(c) + (i === 0 ? '</th>' : '</td>'); }).join('') + '</tr>'; }).join('') +
      '</table></body></html>';
    return html;
  }

  function downloadCurrentSchema(fmt) {
    var entry = APP.schemaStore.getEntry(APP.workingSchemaEntryId);
    if (!entry) return;
    var base = (entry.name || 'schema').replace(/\s+/g, '_');
    if (fmt === 'json') downloadFile(base + '.json', JSON.stringify(entry.schema, null, 2), 'application/json');
    else if (fmt === 'csv') downloadFile(base + '.csv', APSQL_SCHEMA_TOOLS.rowsToCsvString(APSQL_SCHEMA_TOOLS.tablesToCsvRows(entry.schema.tables)), 'text/csv');
    else if (fmt === 'xlsx') {
      if (typeof XLSX === 'undefined') { alert('XLSX library not loaded (no internet connection?).'); return; }
      var rows = APSQL_SCHEMA_TOOLS.tablesToCsvRows(entry.schema.tables);
      var ws = XLSX.utils.aoa_to_sheet(rows); var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Schema');
      XLSX.writeFile(wb, base + '.xlsx');
    } else if (fmt === 'doc') {
      downloadFile(base + '.doc', rowsToHtmlTableDoc(APSQL_SCHEMA_TOOLS.tablesToCsvRows(entry.schema.tables)), 'application/msword');
    }
  }

  function processSchemaImportFile() {
    var input = $('schemaImportFile');
    var file = input.files && input.files[0];
    if (!file) { showAlertBox('schemaImportMessage', 'warning', 'Choose a file first.'); return; }
    var ext = file.name.split('.').pop().toLowerCase();
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var newSchema;
        if (ext === 'json') {
          newSchema = JSON.parse(e.target.result);
        } else if (ext === 'csv') {
          newSchema = APSQL_SCHEMA_TOOLS.parseCsvToSchema(e.target.result);
        } else if (ext === 'xlsx' || ext === 'xls') {
          if (typeof XLSX === 'undefined') throw new Error('XLSX library not available (no internet connection?).');
          var wb = XLSX.read(e.target.result, { type: 'binary' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var csvStr = XLSX.utils.sheet_to_csv(ws);
          newSchema = APSQL_SCHEMA_TOOLS.parseCsvToSchema(csvStr);
        } else if (ext === 'docx') {
          if (typeof mammoth === 'undefined') throw new Error('DOCX reader library not available (no internet connection?).');
          mammoth.extractRawText({ arrayBuffer: e.target.result }).then(function (result) {
            var csvLike = docxTextToCsv(result.value);
            finishImport(APSQL_SCHEMA_TOOLS.parseCsvToSchema(csvLike));
          }).catch(function (err) { showAlertBox('schemaImportMessage', 'danger', 'Could not read .docx: ' + esc(err.message)); });
          return;
        } else if (ext === 'doc') {
          // Only supports the app's own HTML-table-in-.doc export format (round-trip).
          var text = e.target.result;
          var tmp = document.createElement('div'); tmp.innerHTML = text;
          var table = tmp.querySelector('table');
          if (!table) throw new Error('This .doc file was not produced by AP-SQL Assistant\u2019s own export and cannot be parsed. Please use .json, .csv, or .xlsx for external files.');
          var rows = Array.prototype.map.call(table.querySelectorAll('tr'), function (tr) {
            return Array.prototype.map.call(tr.querySelectorAll('th,td'), function (td) { return td.textContent; });
          });
          newSchema = APSQL_SCHEMA_TOOLS.csvRowsToTables(rows);
          newSchema = { schema_name: 'Imported Schema', schema_version: '1.0', module_labels: {}, tables: newSchema };
        } else {
          throw new Error('Unsupported file type: .' + ext);
        }
        finishImport(newSchema);
      } catch (err) {
        showAlertBox('schemaImportMessage', 'danger', 'Import failed: ' + esc(err.message));
      }
    };
    if (ext === 'xlsx' || ext === 'xls') reader.readAsBinaryString(file);
    else if (ext === 'docx') reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }

  function docxTextToCsv(text) {
    // Best-effort: mammoth extracts tab-separated-ish table text; normalize into CSV rows.
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    return lines.map(function (l) { return l.split(/\t|\s{2,}/).join(','); }).join('\n');
  }

  function finishImport(newSchema) {
    var v = APSQL_SCHEMA_TOOLS.validateSchema(newSchema.tables || []);
    var targetEntry = APP.schemaStore.getEntry(APP.workingSchemaEntryId);
    var diff = APSQL_SCHEMA_TOOLS.diffSchemas(targetEntry ? targetEntry.schema : { tables: [] }, newSchema);
    $('previewAdded').innerHTML = diff.added.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') || '<li class="text-secondary">None</li>';
    $('previewRemoved').innerHTML = diff.removed.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') || '<li class="text-secondary">None</li>';
    $('previewChanged').innerHTML = diff.changed.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') || '<li class="text-secondary">None</li>';
    $('schemaPreviewPanel').style.display = '';
    APP.pendingSchemaUpdate = { schema: newSchema, targetEntryId: APP.workingSchemaEntryId };
    var msgKind = v.valid ? 'success' : 'warning';
    var msg = v.valid ? 'File parsed successfully.' : ('Parsed with warnings: ' + v.errors.concat(v.warnings).join('; '));
    showAlertBox('schemaImportMessage', msgKind, msg);
  }

  function checkLiveSharedSchemaOnLoad() {
    APSQL_SHARED_SCHEMA_LOADER.checkNow().then(function (r) {
      if (r.found) {
        APP.schemaStore.updateEntrySchema(APP.schemaStore.getDefaultId(), r.schema);
        onSchemaChanged();
      }
    });
  }

  //================================================================
  // 11. ERROR RECTIFIER
  //================================================================
  function wireErrorRectifier() {
    $('btnRectify').addEventListener('click', function () {
      var sql = $('rectifierSql').value;
      var err = $('rectifierError').value;
      var dialect = $('rectifierDialect').value;
      if (!sql || !err) { $('rectifierOutput').textContent = '-- Provide both the SQL and the error text.'; return; }
      var result = APSQL_ERROR_RECTIFIER.rectify(sql, err, APP.effEngine, dialect);
      $('rectifierOutput').textContent = result.correctedSql;
      $('rectifierExplanation').innerHTML = (result.changes.length ? '<ul>' + result.changes.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') + esc(result.explanation);
    });
    $('btnRectifierClear').addEventListener('click', function () {
      $('rectifierSql').value = ''; $('rectifierError').value = ''; $('rectifierOutput').textContent = '-- Corrected SQL will appear here.'; $('rectifierExplanation').innerHTML = '';
    });
    $('btnCopyRectifiedSql').addEventListener('click', function () { copyToClipboard($('rectifierOutput').textContent); });
  }

  //================================================================
  // 12. GUIDED WALKTHROUGH
  //================================================================
  var WALKTHROUGH_STEPS = {
    home: [
      { text: 'Welcome to AP-SQL Assistant. This home page summarizes your active schema and links to every major tool.' },
      { id: 'homeSchemaAreas', text: 'These chips show every module/table area covered by your currently Active schema(s).' }
    ],
    readonly: [
      { id: 'stepDescribe', text: 'Describe What You Need in plain language. Follow-up instructions refine the same query conversationally.' },
      { id: 'stepGeneratedSql', text: 'Generated SQL appears here, already validated and self-corrected, with a plain-language explanation.' },
      { id: 'stepManualConfig', text: 'For precise control, use Manual Query Configuration: Select Table, Select Column, Filters, and Advanced Options.' }
    ],
    cr: [
      { id: 'crCommandSelector', text: 'Choose INSERT, UPDATE, or DELETE.' },
      { id: 'crFilterCard', text: 'UPDATE/DELETE require a WHERE condition unless you explicitly override the safeguard.' }
    ],
    'used-schema': [ { id: 'usedSchemaList', text: 'Tick which stored schemas are Active right now — takes effect immediately, no password needed.' } ],
    'update-schema': [
      { id: 'updateSchemaLock', text: 'Update Schema is password-protected. Default password: P@assw0rd.' },
      { id: 'manageSchemaList', text: 'Manage every stored schema here, and pick which one you are currently working with.' }
    ],
    rectifier: [ { id: 'rectifierSql', text: 'Paste a database error and the SQL that caused it to get a schema-aware correction.' } ]
  };

  function wireWalkthrough() {
    $('btnWalkthrough').addEventListener('click', startWalkthroughForCurrentPage);
    $('menuRestartWalkthrough').addEventListener('click', function (e) { e.preventDefault(); startWalkthroughForCurrentPage(); });
    $('walkthroughClose').addEventListener('click', closeWalkthrough);
    $('walkthroughNext').addEventListener('click', function () { advanceWalkthrough(1); });
    $('walkthroughPrev').addEventListener('click', function () { advanceWalkthrough(-1); });
  }

  function currentViewName() {
    var active = document.querySelector('.app-view.active');
    return active ? active.id.replace('view-', '') : 'home';
  }

  function startWalkthroughForCurrentPage() {
    var page = currentViewName();
    APP.walkthrough.steps = WALKTHROUGH_STEPS[page] || [{ text: 'No walkthrough steps are defined for this page yet.' }];
    APP.walkthrough.index = 0;
    showWalkthroughStep();
  }

  function showWalkthroughStep() {
    clearWalkthroughHighlight();
    var step = APP.walkthrough.steps[APP.walkthrough.index];
    if (!step) { closeWalkthrough(); return; }
    $('walkthroughOverlay').style.display = 'block';
    $('walkthroughTitle').textContent = 'Step ' + (APP.walkthrough.index + 1) + ' of ' + APP.walkthrough.steps.length;
    $('walkthroughText').textContent = step.text;
    $('walkthroughProgress').textContent = (APP.walkthrough.index + 1) + ' / ' + APP.walkthrough.steps.length;
    $('walkthroughPrev').disabled = APP.walkthrough.index === 0;
    $('walkthroughNext').textContent = (APP.walkthrough.index === APP.walkthrough.steps.length - 1) ? 'Done' : 'Next';
    if (step.id) {
      var el = $(step.id);
      if (el) { el.classList.add('walkthrough-highlight'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
  }
  function clearWalkthroughHighlight() { document.querySelectorAll('.walkthrough-highlight').forEach(function (el) { el.classList.remove('walkthrough-highlight'); }); }
  function advanceWalkthrough(delta) {
    var next = APP.walkthrough.index + delta;
    if (next >= APP.walkthrough.steps.length) { closeWalkthrough(); return; }
    if (next < 0) return;
    APP.walkthrough.index = next;
    showWalkthroughStep();
  }
  function closeWalkthrough() { $('walkthroughOverlay').style.display = 'none'; clearWalkthroughHighlight(); }

})();
