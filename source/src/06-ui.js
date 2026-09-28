/* =========================================================================
   UI — page rendering, navigation, event wiring
   ========================================================================= */
(function () {
  'use strict';
  var U = window.SQLA.Utils;
  var Store = window.SQLA.Store;
  var Schema = window.SQLA.Services.Schema;
  var Vault = window.SQLA.Services.Vault;
  var Orchestrator = window.SQLA.Services.NlpOrchestrator;
  var NlpEngine = window.SQLA.NlpEngine;
  var Engines = window.SQLA.Engines;
  var Password = window.SQLA.Services.Password;

  var root;
  function esc(s) { return U.escapeHtml(s); }

  function icon(name) {
    var map = {
      database: '\u{1F5C4}\uFE0F', table: '\u{1F4CB}', code: '\u{1F9E9}', settings: '\u2699\uFE0F',
      bug: '\u{1F41E}', search: '\u{1F50D}', play: '\u25B6\uFE0F', lock: '\u{1F512}', shield: '\u{1F6E1}\uFE0F',
      sparkles: '\u2728', arrowright: '\u2192', check: '\u2705', warn: '\u26A0\uFE0F', cloud: '\u2601\uFE0F', offline: '\u{1F4BE}'
    };
    return map[name] || '';
  }

  /* --------------------------------------------------------- Nav shell - */
  function renderShell() {
    root.innerHTML =
      '<div class="app-shell">' +
        '<header class="topbar">' +
          '<button id="hamburgerBtn" class="icon-btn" aria-label="Menu">\u2630</button>' +
          '<div class="brand">' + icon('database') + ' SQL Assistant <span class="ver">\u00B7 V16.0</span></div>' +
          '<div class="topbar-right">' +
            '<select id="themeSelect" class="theme-select">' +
              '<option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>' +
            '</select>' +
          '</div>' +
        '</header>' +
        '<nav id="sideNav" class="side-nav hidden">' +
          navItem('quickstart', 'Quick Start') +
          navGroup('Query Builder', [navItem('readonly', 'Read Only Query Builder'), navItem('cr', 'Query Builder for CR')]) +
          navGroup('Schema', [navItem('schema', 'Used Schema'), navItem('updateschema', 'Update Schema')]) +
          navItem('rectifier', 'Error Rectifier') +
          navItem('settings', 'Settings \u{1F512}') +
          navItem('about', 'About') +
        '</nav>' +
        '<main id="pageMount" class="page-mount"></main>' +
        '<div id="toastMount" class="toast-mount"></div>' +
      '</div>';

    document.getElementById('themeSelect').value = Store.theme;
    document.getElementById('themeSelect').addEventListener('change', function (e) { Store.setTheme(e.target.value); });
    document.getElementById('hamburgerBtn').addEventListener('click', function () {
      document.getElementById('sideNav').classList.toggle('hidden');
    });
    root.querySelectorAll('[data-nav]').forEach(function (el) {
      el.addEventListener('click', function () {
        Store.setRoute(el.getAttribute('data-nav'));
        document.getElementById('sideNav').classList.add('hidden');
      });
    });
  }
  function navItem(route, label) { return '<div class="nav-item" data-nav="' + route + '">' + esc(label) + '</div>'; }
  function navGroup(label, itemsHtml) { return '<div class="nav-group"><div class="nav-group-label">' + esc(label) + '</div>' + itemsHtml.join('') + '</div>'; }

  function renderToasts() {
    var mount = document.getElementById('toastMount');
    if (!mount) return;
    mount.innerHTML = Store.toasts.map(function (t) {
      return '<div class="toast toast-' + t.kind + '">' + esc(t.text) + '</div>';
    }).join('');
  }

  /* ------------------------------------------------------- Quick Start - */
  function renderQuickstart(mount) {
    var schema = Schema.getActiveSchema();
    var modules = Array.from(new Set(schema.tables.map(function (t) { return t.module; })));
    mount.innerHTML =
      '<h2>Welcome — what does this tool do?</h2>' +
      '<p>SQL Assistant helps you describe what you need in plain language — including totals, averages, grouping, filtering, and sorting — or make manual selections, or combine both. Every request always uses your currently saved Active Schema as the single source of truth.</p>' +
      '<div class="card"><h3>' + icon('database') + ' Active schema: ' + esc(schema.name) + '</h3>' +
      '<p>Modules: ' + modules.map(esc).join(', ') + '</p></div>' +
      '<h3>' + icon('play') + ' Try an example</h3>' +
      '<div class="grid-2">' +
        exampleCard('table', 'Read Only Query Builder', 'Try "Show total invoice amount by supplier, only over 100000, sorted descending, top 20" — aggregation, GROUP BY, HAVING, ORDER BY, and LIMIT resolve automatically.', 'readonly') +
        exampleCard('code', 'Query Builder for CR', 'Build INSERT / UPDATE / DELETE SQL text, with mandatory-WHERE safeguards.', 'cr') +
        exampleCard('settings', 'Settings', 'Password-protected: Manual Schema Update, Schema Management, Enterprise Integration (M365 Copilot).', 'settings') +
        exampleCard('bug', 'Error Rectifier', 'Paste a database error and the SQL that caused it to get a corrected query.', 'rectifier') +
      '</div>' +
      '<p class="muted">' + icon('shield') + ' No execution, ever. SQL Assistant only ever produces SQL text for you to review and copy.</p>';
    mount.querySelectorAll('[data-nav]').forEach(function (el) { el.addEventListener('click', function () { Store.setRoute(el.getAttribute('data-nav')); }); });
  }
  function exampleCard(ic, title, desc, route) {
    return '<div class="card"><h4>' + icon(ic) + ' ' + esc(title) + '</h4><p>' + esc(desc) + '</p>' +
      '<button class="btn" data-nav="' + route + '">Open ' + icon('arrowright') + '</button></div>';
  }

  /* ------------------------------------------------- Read Only Builder - */
  function renderReadOnly(mount) {
    var schema = Schema.getActiveSchema();
    var state = Store.readOnly;
    var modules = {};
    schema.tables.forEach(function (t) { (modules[t.module] = modules[t.module] || []).push(t); });

    mount.innerHTML =
      '<h2>' + icon('table') + ' Read Only Query Builder</h2>' +
      '<div class="grid-2">' +
        '<div class="card">' +
          '<h3>Describe What You Need</h3>' +
          '<textarea id="nlText" rows="4" placeholder="e.g. Show total invoice amount by supplier, only over 100000, sorted descending, top 20">' + esc(state.naturalLanguageText) + '</textarea>' +
          '<div class="row-between">' +
            '<span id="engineBadge" class="badge">' + (state.lastOrchestration ? (state.lastOrchestration.engineUsed === 'online' ? (icon('cloud') + ' Enterprise-assisted') : (icon('offline') + ' Offline')) : '') + '</span>' +
            '<button id="buildQueryBtn" class="btn btn-primary">Build Query</button>' +
          '</div>' +
          (state.lastOrchestration && state.lastOrchestration.onlineAttempted && state.lastOrchestration.engineUsed === 'offline' ?
            '<p class="muted small">M365 Copilot Enterprise was attempted but unavailable (' + esc(state.lastOrchestration.onlineError || 'unknown reason') + ') — resolved via the offline engine instead.</p>' : '') +
          renderInterpretationSummary(state.lastRequirement) +
        '</div>' +
        '<div class="card">' +
          '<h3>Generated SQL</h3>' +
          '<pre id="sqlOutput" class="sql-output">' + esc(state.generatedSql) + '</pre>' +
          (state.warnings && state.warnings.length ? '<div class="warn-box">' + state.warnings.map(function (w) { return '<div>' + icon('warn') + ' ' + esc(w) + '</div>'; }).join('') + '</div>' : '') +
          '<div class="row">' +
            '<button id="copySqlBtn" class="btn">Copy SQL</button>' +
            '<button id="explainBtn" class="btn">Explain This Query</button>' +
            '<select id="dialectSelect" class="dialect-select">' +
              '<option value="Oracle">Oracle</option><option value="SQLServer">SQL Server</option><option value="ANSI">ANSI / Generic</option>' +
            '</select>' +
          '</div>' +
          '<div id="explainMount"></div>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<h3>Manual Selectors</h3>' +
        '<div class="tabs">' +
          '<div class="tab active" data-tab="tables">Tables & Columns</div>' +
          '<div class="tab" data-tab="filters">Filters</div>' +
          '<div class="tab" data-tab="advanced">Advanced Options</div>' +
        '</div>' +
        '<div id="tabTables" class="tab-panel">' + renderTablesColumnsPanel(schema, state, modules) + '</div>' +
        '<div id="tabFilters" class="tab-panel hidden">' + renderFiltersPanel(schema, state) + '</div>' +
        '<div id="tabAdvanced" class="tab-panel hidden">' + renderAdvancedPanel(state) + '</div>' +
      '</div>' +
      '<button id="startOverBtn" class="btn">Start Over</button>';

    document.getElementById('dialectSelect').value = state.dialect;

    // Wire events
    document.getElementById('nlText').addEventListener('input', function (e) { state.naturalLanguageText = e.target.value; });
    document.getElementById('buildQueryBtn').addEventListener('click', onBuildQuery);
    document.getElementById('copySqlBtn').addEventListener('click', function () {
      navigator.clipboard && navigator.clipboard.writeText(state.generatedSql).then(function () { Store.pushToast('success', 'SQL copied to clipboard.'); });
    });
    document.getElementById('explainBtn').addEventListener('click', function () {
      var explainMount = document.getElementById('explainMount');
      if (!state.lastRequirement) { explainMount.innerHTML = '<p class="muted">Build a query first (via Describe What You Need) to see a plain-language explanation.</p>'; return; }
      explainMount.innerHTML = '<div class="explain-box">' + esc(NlpEngine.explainQuery(state.lastRequirement)) + '</div>';
    });
    document.getElementById('dialectSelect').addEventListener('change', function (e) { state.dialect = e.target.value; Store.regenerateReadOnlySql(); render(); });
    document.getElementById('startOverBtn').addEventListener('click', function () { Store.resetReadOnly(); render(); });

    mount.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        mount.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        mount.querySelectorAll('.tab-panel').forEach(function (x) { x.classList.add('hidden'); });
        t.classList.add('active');
        document.getElementById('tab' + t.getAttribute('data-tab').charAt(0).toUpperCase() + t.getAttribute('data-tab').slice(1)).classList.remove('hidden');
      });
    });

    wireTablesColumnsPanel(mount, schema);
    wireFiltersPanel(mount, schema, state);
    wireAdvancedPanel(mount, state);
  }

  function renderInterpretationSummary(req) {
    if (!req) return '';
    var html = '<div class="interp-box"><strong>I understood your request as:</strong><ul>';
    html += '<li>Tables: ' + (req.matchedTables.join(', ') || '(none)') + '</li>';
    if (req.matchedColumns.length) html += '<li>Columns: ' + req.matchedColumns.map(function (c) { return c.table + '.' + c.column; }).join(', ') + '</li>';
    if (req.matchedFilters.length) html += '<li>Filters: ' + req.matchedFilters.map(function (f) { return f.table + '.' + f.column + ' ' + f.operator + ' ' + f.value; }).join('; ') + '</li>';
    if (req.matchedAggregates.length) html += '<li>Aggregation: ' + req.matchedAggregates.map(function (a) { return a.fn + '(' + a.column + ')'; }).join(', ') + '</li>';
    if (req.matchedSorts.length) html += '<li>Sort: ' + req.matchedSorts.map(function (s) { return s.ref + ' ' + s.direction; }).join(', ') + '</li>';
    html += '</ul>';
    html += '<strong>Confidence:</strong> ' + Math.round(req.confidence * 100) + '%';
    if (req.clarifications.length) {
      html += '<div class="clarify-box">' + icon('warn') + ' Needs clarification: ' + req.clarifications.map(esc).join(' ') + '</div>';
    }
    if (req.notes.length) html += '<div class="muted small">' + req.notes.map(esc).join(' ') + '</div>';
    html += '</div>';
    return html;
  }

  function onBuildQuery() {
    var state = Store.readOnly;
    var schema = Schema.getActiveSchema();
    if (!U.safeTrim(state.naturalLanguageText)) { Store.pushToast('warn', 'Type a description first.'); return; }
    var btn = document.getElementById('buildQueryBtn');
    btn.disabled = true; btn.textContent = 'Thinking\u2026';
    Orchestrator.run(state.naturalLanguageText, schema).then(function (orchestration) {
      state.lastOrchestration = orchestration;
      state.lastRequirement = orchestration.result;
      var derived = NlpEngine.requirementToState(orchestration.result, state.dialect);
      state.selectedTables = derived.selectedTables;
      state.selectedColumns = derived.selectedColumns;
      state.filters = derived.filters;
      state.sorts = derived.sorts;
      state.advanced = Object.assign(state.advanced, derived.advanced);
      Store.regenerateReadOnlySql();
      btn.disabled = false; btn.textContent = 'Build Query';
      render();
    });
  }

  function renderTablesColumnsPanel(schema, state, modules) {
    var html = '<div class="module-columns">';
    Object.keys(modules).forEach(function (m) {
      html += '<div class="module-block"><h4>' + esc(m) + '</h4>';
      modules[m].forEach(function (t) {
        var checked = state.selectedTables.indexOf(t.name) !== -1;
        html += '<label class="table-check"><input type="checkbox" class="table-toggle" data-table="' + t.name + '" ' + (checked ? 'checked' : '') + '/> <strong>' + esc(t.name) + '</strong>' + (t.objectType === 'VIEW' ? ' <span class="badge-view">VIEW</span>' : '') + ' <span class="muted small">' + esc(t.description) + '</span></label>';
        if (checked) {
          html += '<div class="column-list">';
          t.columns.forEach(function (c) {
            var colChecked = state.selectedColumns.some(function (sc) { return sc.table === t.name && sc.column === c.name; });
            html += '<label class="col-check"><input type="checkbox" class="col-toggle" data-table="' + t.name + '" data-col="' + c.name + '" ' + (colChecked ? 'checked' : '') + '/> ' + esc(c.name) + (c.decode ? ' <span class="badge-decode" title="' + esc(Engines.decodeLegend(c)) + '">DECODE</span>' : '') + '</label>';
          });
          html += '</div>';
        }
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  }
  function wireTablesColumnsPanel(mount, schema) {
    mount.querySelectorAll('.table-toggle').forEach(function (cb) {
      cb.addEventListener('change', function () { Store.toggleTable(cb.getAttribute('data-table')); render(); });
    });
    mount.querySelectorAll('.col-toggle').forEach(function (cb) {
      cb.addEventListener('change', function () { Store.toggleColumn(cb.getAttribute('data-table'), cb.getAttribute('data-col')); render(); });
    });
  }

  function renderFiltersPanel(schema, state) {
    var allCols = [];
    state.selectedTables.forEach(function (tn) {
      var t = schema.tables.filter(function (x) { return x.name === tn; })[0];
      if (t) t.columns.forEach(function (c) { allCols.push(tn + '.' + c.name); });
    });
    var html = '<div id="filterList">';
    state.filters.forEach(function (f, idx) {
      html += '<div class="filter-row">' + (idx > 0 ? '<select class="combinator-select" data-idx="' + idx + '"><option ' + (f.combinator === 'AND' ? 'selected' : '') + '>AND</option><option ' + (f.combinator === 'OR' ? 'selected' : '') + '>OR</option></select>' : '') +
        '<span>' + esc(f.table + '.' + f.column) + ' ' + esc(f.operator) + ' ' + esc(f.value) + '</span>' +
        '<button class="icon-btn remove-filter-btn" data-idx="' + idx + '">\u2716</button></div>';
    });
    html += '</div>';
    html += '<div class="filter-add-row">' +
      '<select id="filterColSelect">' + allCols.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="filterOpSelect">' + Engines.OPERATORS.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select>' +
      '<input id="filterValInput" placeholder="value"/>' +
      '<button id="addFilterBtn" class="btn">Add Filter</button></div>';
    return html;
  }
  function wireFiltersPanel(mount, schema, state) {
    var addBtn = mount.querySelector('#addFilterBtn');
    if (addBtn) addBtn.addEventListener('click', function () {
      var colSel = mount.querySelector('#filterColSelect').value;
      var parts = colSel.split('.');
      var op = mount.querySelector('#filterOpSelect').value;
      var val = mount.querySelector('#filterValInput').value;
      Store.addFilter({ table: parts[0], column: parts[1], operator: op, value: val, combinator: 'AND' });
      render();
    });
    mount.querySelectorAll('.remove-filter-btn').forEach(function (b) {
      b.addEventListener('click', function () { Store.removeFilter(parseInt(b.getAttribute('data-idx'), 10)); render(); });
    });
    mount.querySelectorAll('.combinator-select').forEach(function (s) {
      s.addEventListener('change', function () { state.filters[parseInt(s.getAttribute('data-idx'), 10)].combinator = s.value; Store.regenerateReadOnlySql(); });
    });
  }

  function renderAdvancedPanel(state) {
    return '<label><input type="checkbox" id="distinctChk" ' + (state.advanced.distinct ? 'checked' : '') + '/> DISTINCT</label>' +
      '<label>GROUP BY: <input id="groupByInput" value="' + esc((state.advanced.groupByColumns || []).join(', ')) + '" placeholder="table.column, table.column"/></label>' +
      '<label>HAVING: <input id="havingInput" value="' + esc(state.advanced.havingClause || '') + '" placeholder="SUM(t.amount) > 1000"/></label>' +
      '<label>LIMIT / TOP: <input id="limitInput" type="number" value="' + (state.advanced.limit || '') + '"/></label>' +
      '<label>Sort by: <input id="sortRefInput" placeholder="table.column"/> ' +
        '<select id="sortDirSelect"><option>ASC</option><option>DESC</option></select> ' +
        '<button id="addSortBtn" class="btn">Add Sort</button></label>' +
      '<div id="sortList">' + state.sorts.map(function (s, i) { return '<div>' + esc(s.ref) + ' ' + esc(s.direction) + ' <button class="icon-btn remove-sort-btn" data-idx="' + i + '">\u2716</button></div>'; }).join('') + '</div>';
  }
  function wireAdvancedPanel(mount, state) {
    var d = mount.querySelector('#distinctChk'); if (d) d.addEventListener('change', function () { state.advanced.distinct = d.checked; Store.regenerateReadOnlySql(); render(); });
    var g = mount.querySelector('#groupByInput'); if (g) g.addEventListener('input', function () { state.advanced.groupByColumns = g.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean); Store.regenerateReadOnlySql(); });
    var h = mount.querySelector('#havingInput'); if (h) h.addEventListener('input', function () { state.advanced.havingClause = h.value; Store.regenerateReadOnlySql(); });
    var l = mount.querySelector('#limitInput'); if (l) l.addEventListener('input', function () { state.advanced.limit = l.value ? parseInt(l.value, 10) : null; Store.regenerateReadOnlySql(); });
    var addSort = mount.querySelector('#addSortBtn');
    if (addSort) addSort.addEventListener('click', function () {
      var ref = mount.querySelector('#sortRefInput').value;
      var dir = mount.querySelector('#sortDirSelect').value;
      if (ref) { Store.addSort({ ref: ref, direction: dir }); render(); }
    });
    mount.querySelectorAll('.remove-sort-btn').forEach(function (b) { b.addEventListener('click', function () { Store.removeSort(parseInt(b.getAttribute('data-idx'), 10)); render(); }); });
  }

  /* ----------------------------------------------------------- CR page - */
  function renderCr(mount) {
    var schema = Schema.getActiveSchema();
    var state = Store.cr;
    mount.innerHTML =
      '<h2>' + icon('code') + ' Query Builder for CR (Change Request)</h2>' +
      '<div class="card">' +
        '<label>Query type: <select id="crTypeSelect"><option ' + (state.queryType === 'INSERT' ? 'selected' : '') + '>INSERT</option><option ' + (state.queryType === 'UPDATE' ? 'selected' : '') + '>UPDATE</option><option ' + (state.queryType === 'DELETE' ? 'selected' : '') + '>DELETE</option></select></label>' +
        '<label>Table: <select id="crTableSelect"><option value="">(choose)</option>' + schema.tables.map(function (t) { return '<option ' + (state.table === t.name ? 'selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>' +
        (state.queryType !== 'DELETE' ? renderCrValuesPanel(schema, state) : '') +
        renderCrFiltersPanel(schema, state) +
        '<label><input type="checkbox" id="crConfirmNoWhere" ' + (state.confirmNoWhere ? 'checked' : '') + '/> I confirm this should run with no WHERE clause (dangerous)</label>' +
      '</div>' +
      '<div class="card"><h3>Generated SQL</h3><pre class="sql-output">' + esc(state.generatedSql) + '</pre></div>';

    mount.querySelector('#crTypeSelect').addEventListener('change', function (e) { state.queryType = e.target.value; Store.regenerateCrSql(); render(); });
    mount.querySelector('#crTableSelect').addEventListener('change', function (e) { state.table = e.target.value || null; Store.regenerateCrSql(); render(); });
    var noWhereChk = mount.querySelector('#crConfirmNoWhere');
    if (noWhereChk) noWhereChk.addEventListener('change', function () { state.confirmNoWhere = noWhereChk.checked; Store.regenerateCrSql(); render(); });
    wireCrValuesPanel(mount, schema, state);
    wireCrFiltersPanel(mount, schema, state);
  }
  function renderCrValuesPanel(schema, state) {
    var table = schema.tables.filter(function (t) { return t.name === state.table; })[0];
    if (!table) return '';
    var html = '<h4>Values</h4><div id="crValuesList">';
    state.values.forEach(function (v, i) { html += '<div>' + esc(v.column) + ' = ' + esc(v.value) + ' <button class="icon-btn remove-val-btn" data-idx="' + i + '">\u2716</button></div>'; });
    html += '</div><div class="filter-add-row"><select id="crValColSelect">' + table.columns.map(function (c) { return '<option>' + esc(c.name) + '</option>'; }).join('') + '</select><input id="crValInput" placeholder="value"/><button id="addCrValBtn" class="btn">Add Value</button></div>';
    return html;
  }
  function wireCrValuesPanel(mount, schema, state) {
    var addBtn = mount.querySelector('#addCrValBtn');
    if (addBtn) addBtn.addEventListener('click', function () {
      state.values.push({ column: mount.querySelector('#crValColSelect').value, value: mount.querySelector('#crValInput').value });
      Store.regenerateCrSql(); render();
    });
    mount.querySelectorAll('.remove-val-btn').forEach(function (b) { b.addEventListener('click', function () { state.values.splice(parseInt(b.getAttribute('data-idx'), 10), 1); Store.regenerateCrSql(); render(); }); });
  }
  function renderCrFiltersPanel(schema, state) {
    var table = schema.tables.filter(function (t) { return t.name === state.table; })[0];
    if (!table) return '';
    var html = '<h4>Filters (WHERE)</h4><div id="crFilterList">';
    state.filters.forEach(function (f, i) { html += '<div>' + esc(f.table + '.' + f.column + ' ' + f.operator + ' ' + f.value) + ' <button class="icon-btn remove-crfilter-btn" data-idx="' + i + '">\u2716</button></div>'; });
    html += '</div><div class="filter-add-row"><select id="crFilterColSelect">' + table.columns.map(function (c) { return '<option>' + esc(c.name) + '</option>'; }).join('') + '</select><select id="crFilterOpSelect">' + Engines.OPERATORS.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select><input id="crFilterValInput" placeholder="value"/><button id="addCrFilterBtn" class="btn">Add Filter</button></div>';
    return html;
  }
  function wireCrFiltersPanel(mount, schema, state) {
    var addBtn = mount.querySelector('#addCrFilterBtn');
    if (addBtn) addBtn.addEventListener('click', function () {
      state.filters.push({ table: state.table, column: mount.querySelector('#crFilterColSelect').value, operator: mount.querySelector('#crFilterOpSelect').value, value: mount.querySelector('#crFilterValInput').value, combinator: 'AND' });
      Store.regenerateCrSql(); render();
    });
    mount.querySelectorAll('.remove-crfilter-btn').forEach(function (b) { b.addEventListener('click', function () { state.filters.splice(parseInt(b.getAttribute('data-idx'), 10), 1); Store.regenerateCrSql(); render(); }); });
  }

  /* ------------------------------------------------------- Schema pages  */
  function renderSchema(mount) {
    var schema = Schema.getActiveSchema();
    var all = Schema.getAllSchemas();
    mount.innerHTML = '<h2>' + icon('database') + ' Used Schema</h2>' +
      '<div class="card"><label>Active schema: <select id="activeSchemaSelect">' + all.map(function (s) { return '<option value="' + s.id + '" ' + (s.id === schema.id ? 'selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label></div>' +
      schema.tables.map(function (t) {
        return '<div class="card"><h4>' + esc(t.name) + (t.objectType === 'VIEW' ? ' <span class="badge-view">VIEW</span>' : '') + '</h4><p class="muted">' + esc(t.module) + ' \u00B7 ' + esc(t.description) + '</p>' +
          '<table class="mini-table"><tr><th>Column</th><th>Type</th><th>Nullable</th><th>Keys</th><th>Decode</th></tr>' +
          t.columns.map(function (c) {
            return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.type) + (c.length ? '(' + c.length + ')' : '') + '</td><td>' + (c.nullable ? 'Yes' : 'No') + '</td><td>' + (c.isPrimaryKey ? 'PK ' : '') + (c.isForeignKey ? 'FK\u2192' + c.references.table + '.' + c.references.column : '') + '</td><td>' + (c.decode ? esc(Engines.decodeLegend(c)) : '') + '</td></tr>';
          }).join('') + '</table></div>';
      }).join('');
    mount.querySelector('#activeSchemaSelect').addEventListener('change', function (e) { Schema.switchActiveSchema(e.target.value); Store.pushToast('success', 'Active schema switched.'); render(); });
  }

  function renderUpdateSchema(mount) {
    mount.innerHTML = '<h2>' + icon('database') + ' Update Schema (password-protected)</h2>' +
      '<div class="card"><p>Import a schema JSON (with <code>tables</code> and <code>relationships</code> arrays) to add it as a new, inactive schema — then switch to it from Used Schema.</p>' +
      '<textarea id="schemaImportText" rows="8" placeholder="Paste schema JSON here"></textarea>' +
      '<div class="row"><input id="schemaImportName" placeholder="Schema name"/><button id="importSchemaBtn" class="btn btn-primary">Import Schema</button></div>' +
      '<button id="exportSchemaBtn" class="btn">Export Active Schema as JSON</button>' +
      '<pre id="exportMount" class="sql-output hidden"></pre></div>';
    mount.querySelector('#importSchemaBtn').addEventListener('click', function () {
      var text = mount.querySelector('#schemaImportText').value;
      var name = mount.querySelector('#schemaImportName').value;
      var res = Schema.importSchema(text, name);
      if (res.ok) Store.pushToast('success', 'Schema imported. Switch to it from Used Schema.');
      else Store.pushToast('warn', res.error);
    });
    mount.querySelector('#exportSchemaBtn').addEventListener('click', function () {
      var m = mount.querySelector('#exportMount');
      m.textContent = Schema.exportActiveSchemaJson();
      m.classList.remove('hidden');
    });
  }

  /* --------------------------------------------------- Error Rectifier - */
  function renderRectifier(mount) {
    mount.innerHTML = '<h2>' + icon('bug') + ' Error Rectifier</h2>' +
      '<div class="card"><label>Database error message:<textarea id="errText" rows="2" placeholder="ORA-00904: invalid identifier"></textarea></label>' +
      '<label>SQL that caused it:<textarea id="errSql" rows="4"></textarea></label>' +
      '<button id="rectifyBtn" class="btn btn-primary">Rectify</button></div>' +
      '<div id="rectifyResult"></div>';
    mount.querySelector('#rectifyBtn').addEventListener('click', function () {
      var errText = mount.querySelector('#errText').value;
      var sql = mount.querySelector('#errSql').value;
      var result = Engines.rectifyError(errText, sql);
      mount.querySelector('#rectifyResult').innerHTML =
        '<div class="card"><h4>Explanation</h4><p>' + esc(result.explanation) + '</p>' +
        '<h4>What to check / change</h4><ul>' + result.whatChanged.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' +
        '<h4>SQL (review side-by-side with the explanation above)</h4><pre class="sql-output">' + esc(result.correctedSql) + '</pre></div>';
    });
  }

  /* --------------------------------------------------------- Settings -- */
  function renderSettings(mount) {
    if (!Store.vaultUnlocked) {
      mount.innerHTML = '<h2>' + icon('lock') + ' Settings</h2><div class="card"><label>Password: <input id="pwInput" type="password"/></label>' +
        '<button id="unlockBtn" class="btn btn-primary">Unlock</button><p class="muted small">Default password is "admin" on first run.</p></div>';
      mount.querySelector('#unlockBtn').addEventListener('click', function () {
        var pw = mount.querySelector('#pwInput').value;
        if (Password.verify(pw)) {
          Vault.unlock(pw).then(function () { Store.vaultUnlocked = true; render(); });
        } else { Store.pushToast('warn', 'Incorrect password.'); }
      });
      return;
    }
    Vault.readField('m365CopilotEnterpriseConfig').then(function (raw) {
      var cfg = raw ? JSON.parse(raw) : null;
      mount.innerHTML = '<h2>' + icon('settings') + ' Settings</h2>' +
        '<div class="card"><h3>' + icon('sparkles') + ' Enterprise Integration — M365 Copilot Enterprise (optional)</h3>' +
        '<p class="muted small">Stored in the same encrypted Secret Vault as everything else in Settings. Leave blank / delete to keep using the offline engine only (default, no change in behavior).</p>' +
        '<label>Tenant ID: <input id="cfgTenant" value="' + esc(cfg ? cfg.tenantId : '') + '"/></label>' +
        '<label>Client ID: <input id="cfgClient" value="' + esc(cfg ? cfg.clientId : '') + '"/></label>' +
        '<label>Copilot Endpoint URL: <input id="cfgEndpoint" value="' + esc(cfg ? cfg.copilotEndpoint : '') + '"/></label>' +
        '<label>Scopes (comma-separated): <input id="cfgScopes" value="' + esc(cfg && cfg.scopes ? cfg.scopes.join(', ') : '') + '"/></label>' +
        '<label><input type="checkbox" id="cfgDevTest" ' + (cfg && cfg.__devTestMode ? 'checked' : '') + '/> Developer test mode (simulates a Copilot response locally, for UI verification only — no real Microsoft service is contacted)</label>' +
        '<div class="row"><button id="saveCfgBtn" class="btn btn-primary">Save</button><button id="deleteCfgBtn" class="btn">Delete Configuration</button></div></div>' +
        '<div class="card"><h3>Change Settings Password</h3><input id="newPwInput" type="password" placeholder="new password"/><button id="setPwBtn" class="btn">Set Password</button></div>' +
        '<button id="lockBtn" class="btn">Lock Settings</button>';

      mount.querySelector('#saveCfgBtn').addEventListener('click', function () {
        var newCfg = {
          tenantId: mount.querySelector('#cfgTenant').value.trim(),
          clientId: mount.querySelector('#cfgClient').value.trim(),
          copilotEndpoint: mount.querySelector('#cfgEndpoint').value.trim(),
          scopes: mount.querySelector('#cfgScopes').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
          __devTestMode: mount.querySelector('#cfgDevTest').checked
        };
        Vault.writeField('m365CopilotEnterpriseConfig', newCfg).then(function () { Store.pushToast('success', 'Enterprise Integration configuration saved.'); });
      });
      mount.querySelector('#deleteCfgBtn').addEventListener('click', function () {
        Vault.deleteField('m365CopilotEnterpriseConfig').then(function () { Store.pushToast('success', 'Configuration deleted — offline engine only.'); render(); });
      });
      mount.querySelector('#setPwBtn').addEventListener('click', function () {
        var np = mount.querySelector('#newPwInput').value;
        if (np) { Password.setPassword(np); Store.pushToast('success', 'Password updated.'); }
      });
      mount.querySelector('#lockBtn').addEventListener('click', function () { Vault.lock(); Store.vaultUnlocked = false; render(); });
    });
  }

  /* ------------------------------------------------------------ About -- */
  function renderAbout(mount) {
    mount.innerHTML = '<h2>About</h2><div class="card">' +
      '<p><strong>SQL Assistant \u00B7 V16.0</strong></p>' +
      '<p>Baseline: V15.5 (latest confirmed working build). This release adds M365 Copilot Enterprise integration to Describe What You Need, with the offline NLP engine as the permanent fallback and the Active Schema always the authoritative source of database structure.</p>' +
      '<p>No database connection, ever. This tool only ever produces SQL text for you to review and copy.</p>' +
      '<p>Created by Subham Ain.</p></div>';
  }

  /* ------------------------------------------------------------ Router - */
  var ROUTES = {
    quickstart: renderQuickstart, readonly: renderReadOnly, cr: renderCr,
    schema: renderSchema, updateschema: renderUpdateSchema, rectifier: renderRectifier,
    settings: renderSettings, about: renderAbout
  };

  function render() {
    var mount = document.getElementById('pageMount');
    if (!mount) return;
    (ROUTES[Store.route] || renderQuickstart)(mount);
    renderToasts();
  }

  window.SQLA.UI = {
    init: function (rootEl) {
      root = rootEl;
      renderShell();
      Store.applyTheme(Store.theme);
      Store.subscribe(render);
      render();
    }
  };
})();
