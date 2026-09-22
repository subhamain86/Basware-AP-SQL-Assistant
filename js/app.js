(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

  // ---------- Schema store & engines ----------
  var schemaStore = APSQL_SCHEMA_STORE.createStore();
  if (schemaStore.count() === 0) {
    schemaStore.addEntry({ name: window.__AP_SCHEMA__.schema_name || 'Default Schema', schema: window.__AP_SCHEMA__, source: 'embedded' });
  }
  var relationshipStore = APSQL_RELATIONSHIPS.createRelationshipStore();
  var decodeStore = APSQL_DECODE.createDecodeStore();
  var engine, aiService;
  function currentSchema() { return schemaStore.getActiveSchema() || { tables: [] }; }
  function rebuildEngine() {
    engine = APSQL_RELATIONSHIPS.createEffectiveEngine(APSQL.createEngine(currentSchema()), relationshipStore);
    aiService = APSQL_AI.createAIService({ engine: engine, decodeStore: decodeStore });
  }
  rebuildEngine();
  var passwordManager = APSQL_PASSWORD_MANAGER.createPasswordManager();

  function allTables() { return engine.getAllTables().slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }); }
  function moduleLabels() { return engine.getModuleLabels(); }

  // ---------- Theme ----------
  var THEME_KEY = 'ap_sql_theme';
  function systemPrefersDark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
  function applyTheme(choice) { document.documentElement.setAttribute('data-bs-theme', choice === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : choice); }
  function setTheme(choice) { try { localStorage.setItem(THEME_KEY, choice); } catch (e) {} applyTheme(choice); }
  (function initTheme() {
    var saved = 'auto'; try { saved = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) {}
    applyTheme(saved);
  })();
  document.querySelectorAll('[data-theme]').forEach(function (btn) { btn.addEventListener('click', function (e) { e.preventDefault(); setTheme(btn.getAttribute('data-theme')); }); });

  // ---------- Menu / navigation ----------
  var offcanvasEl = $('mainMenu');
  var offcanvasInstance = window.bootstrap ? new window.bootstrap.Offcanvas(offcanvasEl) : null;
  function closeMenu() { if (offcanvasInstance) offcanvasInstance.hide(); }
  var currentView = 'quickstart';
  function showView(view) {
    document.querySelectorAll('.app-view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    window.scrollTo(0, 0);
    currentView = view;
    if (view === 'usedschema') { renderSchemaStoreList(); renderSchemaTree(); }
    if (view === 'updateschema') { renderSchemaPersistenceStatus(); renderSyncScheduleSelect(); renderGithubSyncStatus(); renderVaultStatus(); refreshVaultControlAvailability(); renderPasswordCustomNote(); }
  }
  document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); showView(b.getAttribute('data-view')); closeMenu(); }); });
  function makeCollapsible(toggleId, submenuId) {
    var toggle = $(toggleId), submenu = $(submenuId);
    if (!toggle || !submenu) return;
    toggle.addEventListener('click', function () { toggle.classList.toggle('open'); submenu.classList.toggle('open'); });
  }
  makeCollapsible('queryBuilderMenuToggle', 'queryBuilderSubmenu');
  makeCollapsible('schemaMenuToggle', 'schemaSubmenu');
  makeCollapsible('themeMenuToggle', 'themeSubmenu');

  // ---------- Guided Walkthrough (V11.8.2) ----------
  var tourBtn = $('tourBtn');
  if (tourBtn) tourBtn.addEventListener('click', function () { closeMenu(); APSQL_TOUR.start(function (view) { showView(view); }); });

  // ---------- Manual tabs (Read Only builder) ----------
  document.querySelectorAll('#manualTabs .nav-link').forEach(function (t) {
    t.addEventListener('click', function () {
      var name = t.getAttribute('data-tab');
      document.querySelectorAll('#manualTabs .nav-link').forEach(function (x) { x.classList.toggle('active', x === t); });
      document.querySelectorAll('.tab-pane-manual').forEach(function (p) { p.classList.toggle('d-none', p.id !== 'pane-' + name); });
      if (name === 'requirements') renderRequirementsSummary();
    });
  });
  document.querySelectorAll('#crManualTabs .nav-link').forEach(function (t) {
    t.addEventListener('click', function () {
      var name = t.getAttribute('data-crtab');
      document.querySelectorAll('#crManualTabs .nav-link').forEach(function (x) { x.classList.toggle('active', x === t); });
      document.querySelectorAll('.cr-tab-pane').forEach(function (p) { p.classList.toggle('d-none', p.id !== 'cr-pane-' + name); });
    });
  });

  // ==================== QUICK START ====================
  var QUICK_EXAMPLES = [
    { ic: '👤', title: 'Active suppliers', desc: 'Table + columns + filter, identified from plain language.', text: 'Show supplier name and supplier code for active suppliers.' },
    { ic: '💰', title: 'Total invoiced per supplier', desc: 'Aggregation (SUM) with an automatic GROUP BY and join.', text: 'Show the total gross amount grouped by supplier.' },
    { ic: '📧', title: 'Supplier email addresses', desc: 'Maps everyday wording to the right schema column.', text: 'Show the supplier email address.' },
    { ic: '✅', title: 'Approved invoices', desc: 'Filter on a coded STATUS column using its decoded label.', text: 'Show all approved invoices.' },
    { ic: '🌐', title: 'Supervisor chain (recursive)', desc: 'Walk the whole reporting hierarchy in one query.', hierarchy: 'ADM_USER_DATA' },
    { ic: '🔎', title: 'Users whose login is allowed', desc: 'A simple single-table filter — resolved automatically.', text: 'Show all users whose login is allowed.' }
  ];
  function refreshModuleChips() {
    var counts = {}; allTables().forEach(function (t) { counts[t.module] = (counts[t.module] || 0) + 1; });
    var labels = moduleLabels();
    $('qsModuleChips').innerHTML = Object.keys(counts).sort().map(function (m) { return '<span class="badge text-bg-light border module-chip">' + esc(labels[m] || m) + ' · ' + counts[m] + '</span>'; }).join('');
  }
  (function initQuickStart() {
    var grid = $('qsExampleGrid');
    grid.innerHTML = QUICK_EXAMPLES.map(function (q, i) {
      return '<div class="col"><div class="card qs-example-card h-100" data-i="' + i + '"><div class="card-body">' +
        '<span class="qs-icon-badge mb-2">' + q.ic + '</span>' +
        '<h4 class="h6">' + esc(q.title) + '</h4>' +
        '<p class="small text-body-secondary mb-0">' + esc(q.desc) + '</p></div></div></div>';
    }).join('');
    grid.querySelectorAll('.qs-example-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var q = QUICK_EXAMPLES[+card.getAttribute('data-i')];
        showView('builder'); resetQueryState(false);
        if (q.hierarchy) { $('optHierarchy').value = q.hierarchy; selectedTables = [q.hierarchy]; refreshTablesColumnsUI(); runGenerate(); }
        else { $('promptInput').value = q.text; runGenerate(); }
      });
    });
    refreshModuleChips();
  })();

  // ==================== READ ONLY QUERY BUILDER ====================
  var selectedTables = [];
  var columnState = {};
  var sortRows = [];
  var readOnlyFilterGroup = { conditions: [] };
  var nlInterpretation = null;
  var lastResult = null;

  function refreshModuleDropdown() {
    var sel = $('moduleFilterSel'); var labels = moduleLabels(); var counts = {};
    allTables().forEach(function (t) { counts[t.module] = (counts[t.module] || 0) + 1; });
    sel.innerHTML = '<option value="">Select Module ▾</option>' + Object.keys(counts).sort().map(function (m) { return '<option value="' + esc(m) + '">' + esc(labels[m] || m) + ' (' + counts[m] + ')</option>'; }).join('');
  }
  function visibleTableNames() {
    var moduleFilter = $('moduleFilterSel').value; var searchFilter = ($('tableSearchInput').value || '').toLowerCase();
    return allTables().filter(function (t) {
      if (moduleFilter && t.module !== moduleFilter) return false;
      if (searchFilter && (t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(searchFilter) === -1) return false;
      return true;
    }).map(function (t) { return t.name; });
  }
  function renderTableList() {
    var names = visibleTableNames();
    var grid = $('tableListGrid'); grid.innerHTML = '';
    names.forEach(function (n) {
      var t = engine.getTable(n);
      var col = document.createElement('div'); col.className = 'col';
      var checked = selectedTables.indexOf(n) !== -1;
      col.innerHTML = '<label class="d-flex align-items-center gap-2 small p-1"><input type="checkbox" class="form-check-input" ' + (checked ? 'checked' : '') + '><code>' + esc(n) + '</code> <span class="text-body-secondary">(' + esc(t.module) + ')</span></label>';
      col.querySelector('input').addEventListener('change', function (e) { toggleTable(n, e.target.checked); });
      grid.appendChild(col);
    });
  }
  function toggleTable(name, on) {
    var idx = selectedTables.indexOf(name);
    if (on && idx === -1) selectedTables.push(name);
    if (!on && idx !== -1) { selectedTables.splice(idx, 1); delete columnState[name]; }
    refreshTableSelCount(); refreshSelectedTableDropdown(); renderColumnList(); renderJoinPreview(); renderSortRows();
  }
  function refreshTableSelCount() { $('tableSelCount').textContent = selectedTables.length + ' table' + (selectedTables.length === 1 ? '' : 's') + ' selected'; }
  $('moduleFilterSel').addEventListener('change', renderTableList);
  $('tableSearchInput').addEventListener('input', renderTableList);
  $('tableSelectAllBtn').addEventListener('click', function () { visibleTableNames().forEach(function (n) { if (selectedTables.indexOf(n) === -1) selectedTables.push(n); }); refreshTablesColumnsUI(); });
  $('tableUnselectAllBtn').addEventListener('click', function () { selectedTables = []; columnState = {}; refreshTablesColumnsUI(); });

  function refreshSelectedTableDropdown() {
    var sel = $('selectedTableDropdown'); var current = sel.value;
    sel.innerHTML = '<option value="">Selected Table ▾</option>' + selectedTables.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    if (selectedTables.indexOf(current) !== -1) sel.value = current; else if (selectedTables.length) sel.value = selectedTables[0];
  }
  $('selectedTableDropdown').addEventListener('change', renderColumnList);
  function ensureColState(tname) { if (!columnState[tname]) columnState[tname] = {}; return columnState[tname]; }

  function buildColumnRow(tname, col) {
    var state = ensureColState(tname);
    if (!state[col.name]) state[col.name] = { checked: false, alias: col.alias || '', decode: false };
    var s = state[col.name];
    var row = document.createElement('div'); row.className = 'column-row-grid' + (s.checked ? ' on' : '');
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input'; cb.checked = s.checked;
    var nameWrap = document.createElement('div'); nameWrap.className = 'col-name';
    var badgeText = col.primary_key ? 'PK' : (col.foreign_key ? 'FK' : (col.type || '').split('(')[0]);
    nameWrap.innerHTML = '<code>' + esc(col.name) + '</code> <span class="badge text-bg-light border">' + esc(badgeText) + '</span>';
    var aliasInput = document.createElement('input'); aliasInput.type = 'text'; aliasInput.className = 'form-control form-control-sm col-alias'; aliasInput.placeholder = 'alias'; aliasInput.value = s.alias; aliasInput.disabled = !s.checked;
    var decodeWrap = document.createElement('div'); decodeWrap.className = 'form-check d-flex align-items-center gap-1';
    var decodeCb = document.createElement('input'); decodeCb.type = 'checkbox'; decodeCb.className = 'form-check-input mt-0'; decodeCb.checked = s.decode; decodeCb.disabled = !s.checked;
    var decodeLabel = document.createElement('label'); decodeLabel.className = 'small'; decodeLabel.textContent = 'Decode';
    decodeWrap.appendChild(decodeCb); decodeWrap.appendChild(decodeLabel);
    cb.addEventListener('change', function () { s.checked = cb.checked; if (!cb.checked) { s.decode = false; decodeCb.checked = false; } aliasInput.disabled = !cb.checked; decodeCb.disabled = !cb.checked; row.classList.toggle('on', cb.checked); });
    aliasInput.addEventListener('input', function () { s.alias = aliasInput.value.trim(); });
    decodeCb.addEventListener('change', function () { s.decode = decodeCb.checked; });
    row.appendChild(cb); row.appendChild(nameWrap); row.appendChild(aliasInput); row.appendChild(decodeWrap);
    return row;
  }
  function renderColumnList() {
    var body = $('columnListBody'); body.innerHTML = '';
    var tname = $('selectedTableDropdown').value;
    if (!selectedTables.length) { $('columnListEmpty').textContent = 'Select one or more tables above.'; return; }
    if (!tname) { $('columnListEmpty').textContent = 'Pick a selected table above.'; return; }
    $('columnListEmpty').textContent = '';
    var table = engine.getTable(tname); if (!table) return;
    var term = ($('columnSearchInput').value || '').toLowerCase().trim();
    table.columns.filter(function (c) { return !term || (c.name + ' ' + (c.alias || '')).toLowerCase().indexOf(term) !== -1; }).forEach(function (c) { body.appendChild(buildColumnRow(tname, c)); });
  }
  $('columnSearchInput').addEventListener('input', renderColumnList);
  $('columnSelectAllBtn').addEventListener('click', function () { var tname = $('selectedTableDropdown').value; if (!tname) return; var table = engine.getTable(tname); var state = ensureColState(tname); table.columns.forEach(function (c) { if (!state[c.name]) state[c.name] = { checked: false, alias: c.alias || '', decode: false }; state[c.name].checked = true; }); renderColumnList(); });
  $('columnUnselectAllBtn').addEventListener('click', function () { var tname = $('selectedTableDropdown').value; if (!tname) return; var state = ensureColState(tname); Object.keys(state).forEach(function (k) { state[k].checked = false; state[k].decode = false; }); renderColumnList(); });

  function refreshTablesColumnsUI() { refreshModuleDropdown(); renderTableList(); refreshTableSelCount(); refreshSelectedTableDropdown(); renderColumnList(); renderJoinPreview(); renderSortRows(); refreshHierarchyOptions(); }
  function refreshHierarchyOptions() {
    var sel = $('optHierarchy'); var current = sel.value; var opts = ['<option value="">— none —</option>'];
    allTables().forEach(function (t) { if (engine.getSelfReferencingEdges(t.name).length > 0) opts.push('<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>'); });
    sel.innerHTML = opts.join(''); if (allTables().some(function (t) { return t.name === current; })) sel.value = current;
  }

  function columnOptionsForTables(tableNames) {
    var opts = [];
    (tableNames && tableNames.length ? tableNames : allTables().map(function (t) { return t.name; })).forEach(function (tname) {
      var t = engine.getTable(tname); if (!t) return;
      t.columns.forEach(function (c) { opts.push({ table: tname, column: c.name }); });
    });
    return opts;
  }
  function renderFilterGroup(containerEl, filterGroup, availableTables, onChange) {
    containerEl.innerHTML = '';
    var colOptions = columnOptionsForTables(availableTables);
    if (!colOptions.length) { containerEl.innerHTML = '<div class="small text-body-secondary">Select at least one table first.</div>'; return; }
    filterGroup.conditions.forEach(function (cond, idx) {
      var row = document.createElement('div'); row.className = 'filter-condition-row d-flex flex-wrap gap-2 align-items-center mb-2';
      var joinSel = document.createElement('select'); joinSel.className = 'form-select form-select-sm'; joinSel.style.maxWidth = '75px';
      joinSel.innerHTML = '<option value="AND">AND</option><option value="OR">OR</option>'; joinSel.value = cond.join || 'AND';
      joinSel.addEventListener('change', function () { cond.join = joinSel.value; });
      var colSel = document.createElement('select'); colSel.className = 'form-select form-select-sm';
      colSel.innerHTML = colOptions.map(function (o) { var val = o.table + '.' + o.column; return '<option value="' + val + '">' + val + '</option>'; }).join('');
      colSel.value = (cond.table ? cond.table + '.' : '') + cond.column;
      colSel.addEventListener('change', function () { var parts = colSel.value.split('.'); cond.table = parts[0]; cond.column = parts[1]; });
      var opSel = document.createElement('select'); opSel.className = 'form-select form-select-sm';
      opSel.innerHTML = APSQL_FILTER.OPERATORS.map(function (o) { return '<option value="' + o.id + '">' + o.label + '</option>'; }).join(''); opSel.value = cond.operator;
      var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm'; valInput.placeholder = 'Value'; valInput.value = cond.value || '';
      var val2Input = document.createElement('input'); val2Input.className = 'form-control form-control-sm'; val2Input.placeholder = 'and...'; val2Input.value = cond.value2 || '';
      function refreshArity() { var op = APSQL_FILTER.getOperator(opSel.value); valInput.style.display = op.arity >= 1 ? '' : 'none'; val2Input.style.display = op.arity === 2 ? '' : 'none'; valInput.placeholder = op.multi ? 'value1, value2, ...' : 'Value'; }
      opSel.addEventListener('change', function () { cond.operator = opSel.value; refreshArity(); });
      valInput.addEventListener('input', function () { cond.value = valInput.value; });
      val2Input.addEventListener('input', function () { cond.value2 = val2Input.value; });
      refreshArity();
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm'; rmBtn.textContent = '×';
      rmBtn.addEventListener('click', function () { filterGroup.conditions.splice(idx, 1); onChange(); renderFilterGroup(containerEl, filterGroup, availableTables, onChange); });
      row.appendChild(joinSel); row.appendChild(colSel); row.appendChild(opSel); row.appendChild(valInput); row.appendChild(val2Input); row.appendChild(rmBtn);
      containerEl.appendChild(row);
    });
  }
  function refreshFilterColumnOptions() { renderFilterGroup($('readOnlyFilterGroup'), readOnlyFilterGroup, selectedTables, function () {}); }
  $('readOnlyAddFilterBtn').addEventListener('click', function () { var firstTable = selectedTables[0]; var firstCol = firstTable ? engine.getTable(firstTable).columns[0].name : ''; readOnlyFilterGroup.conditions.push(APSQL_FILTER.newCondition({ table: firstTable, column: firstCol })); refreshFilterColumnOptions(); });
  $('readOnlyClearFiltersBtn').addEventListener('click', function () { readOnlyFilterGroup.conditions = []; refreshFilterColumnOptions(); });

  function updateJoinCardVisibility() { var card = $('joinOptionCard'); if (selectedTables.length < 2) { $('optJoinInner').checked = true; } }
  document.querySelectorAll('input[name="joinType"]').forEach(function (r) { r.addEventListener('change', function () {
    $('optJoinInnerLabel').classList.toggle('fw-bold', $('optJoinInner').checked);
    $('optJoinLeftLabel').classList.toggle('fw-bold', $('optJoinLeft').checked);
  }); });
  $('joinResetBtn').addEventListener('click', function () { $('optJoinInner').checked = true; });

  function renderJoinPreview() {
    updateJoinCardVisibility();
    var previewBox = $('joinPreviewBox'); var defineBox = $('defineRelationshipContainer');
    if (selectedTables.length < 2) { previewBox.innerHTML = '<div class="small text-body-secondary">Select two or more tables to see how they\u2019ll be connected.</div>'; defineBox.innerHTML = ''; return; }
    var plan = APSQL_ENGINE.buildJoinPlan(engine, selectedTables);
    var lines = plan.joins.map(function (j) { return '<li><code>' + j.on.fromTable + '</code> → <code>' + j.on.toTable + '</code> using <code>' + j.on.fromColumn + ' = ' + j.on.toColumn + '</code></li>'; });
    previewBox.innerHTML = '<ul class="small mb-0">' + (lines.join('') || '<li>No connections established yet.</li>') + '</ul>';
    defineBox.innerHTML = plan.unresolved.length ? '<div class="alert alert-warning small mt-2 py-2">Could not automatically connect: ' + esc(plan.unresolved.join(', ')) + '. Add a relationship via Update Schema if needed.</div>' : '';
  }

  function renderSortRows() {
    var container = $('sortRowsContainer'); container.innerHTML = '';
    var colOptions = columnOptionsForTables(selectedTables);
    if (!colOptions.length) { container.innerHTML = '<div class="small text-body-secondary">Select at least one table first.</div>'; return; }
    if (!sortRows.length) { container.innerHTML = '<div class="small text-body-secondary">No sort columns added yet.</div>'; return; }
    sortRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div'); rowEl.className = 'filter-condition-row d-flex gap-2 align-items-center mb-2';
      var colSel = document.createElement('select'); colSel.className = 'form-select form-select-sm';
      colSel.innerHTML = colOptions.map(function (o) { var val = o.table + '.' + o.column; return '<option value="' + val + '">' + val + '</option>'; }).join('');
      colSel.value = (row.table ? row.table + '.' : '') + row.column;
      colSel.addEventListener('change', function () { var parts = colSel.value.split('.'); row.table = parts[0]; row.column = parts[1]; });
      var dirSel = document.createElement('select'); dirSel.className = 'form-select form-select-sm';
      dirSel.innerHTML = '<option value="ASC">Smallest/earliest first</option><option value="DESC">Largest/latest first</option>'; dirSel.value = row.direction || 'ASC';
      dirSel.addEventListener('change', function () { row.direction = dirSel.value; });
      var rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.className = 'btn btn-outline-danger btn-sm'; rmBtn.textContent = '×';
      rmBtn.addEventListener('click', function () { sortRows.splice(idx, 1); renderSortRows(); });
      rowEl.appendChild(colSel); rowEl.appendChild(dirSel); rowEl.appendChild(rmBtn); container.appendChild(rowEl);
    });
  }
  $('addSortRowBtn').addEventListener('click', function () { if (!selectedTables.length) return; var t = selectedTables[0]; var tbl = engine.getTable(t); sortRows.push({ table: t, column: tbl.columns[0].name, direction: 'ASC' }); renderSortRows(); });
  $('clearSortBtn').addEventListener('click', function () { sortRows = []; renderSortRows(); });
  $('optLimitClearBtn').addEventListener('click', function () { $('optLimit').value = ''; });
  $('optViewClearBtn').addEventListener('click', function () { $('optView').value = ''; });
  $('optHavingClearBtn').addEventListener('click', function () { $('optHaving').value = ''; });
  $('optHierarchyClearBtn').addEventListener('click', function () { $('optHierarchy').value = ''; });

  var KW = /\b(SELECT|FROM|WHERE|JOIN|LEFT|INNER|ON|AND|OR|GROUP BY|ORDER BY|HAVING|DISTINCT|AS|TOP|FETCH FIRST|ROWS ONLY|BETWEEN|IN|LIMIT|CASE|WHEN|THEN|ELSE|END|WITH|RECURSIVE|EXISTS|NOT|LIKE|IS NULL|IS NOT NULL|COUNT|SUM|AVG|MIN|MAX)\b/g;
  function highlight(sql) { var e = esc(sql); e = e.replace(KW, '<span class="sql-kw">$1</span>'); return e; }

  function renderResult(res) {
    lastResult = res;
    var body = $('resultBody');
    if (res.status !== 'ok') {
      body.innerHTML = '<div class="alert alert-' + (res.status === 'rejected' ? 'danger' : 'warning') + ' small py-2">' + esc(res.message) + '</div>';
      $('copyBtn').classList.add('d-none'); $('optimizeBtn').classList.add('d-none'); $('explainBtn').classList.add('d-none'); $('aiReviewBtn').classList.add('d-none');
      $('optimizeReportBox').innerHTML = ''; $('explanationReportBox').innerHTML = ''; $('aiReviewReportBox').innerHTML = '';
      return;
    }
    var tables = (res.tablesUsed || []).map(function (t) { return '<span class="badge text-bg-light border">' + t + '</span>'; }).join(' ');
    var cols = (res.columnsUsed || []).map(function (c) { return '<span class="badge text-bg-light border">' + c.table + '.' + c.column + (c.alias ? ' as ' + c.alias : '') + '</span>'; }).join(' ');
    var filters = (res.filtersApplied || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') || '<li>None</li>';
    body.innerHTML = '<pre class="sql-output mb-2">' + highlight(res.sql) + '</pre>' +
      '<div class="small mb-1"><strong>Tables Used:</strong> ' + (tables || 'None') + '</div>' +
      '<div class="small mb-1"><strong>Columns Used:</strong> ' + (cols || 'None (aggregated query)') + '</div>' +
      '<div class="small"><strong>Filters Applied:</strong><ul class="mb-0">' + filters + '</ul></div>';
    $('copyBtn').classList.remove('d-none'); $('optimizeBtn').classList.remove('d-none'); $('explainBtn').classList.remove('d-none'); $('aiReviewBtn').classList.remove('d-none');
    $('optimizeReportBox').innerHTML = ''; $('explanationReportBox').innerHTML = ''; $('explanationReportBox').classList.add('d-none'); $('aiReviewReportBox').innerHTML = '';
  }
  $('copyBtn').addEventListener('click', function () {
    if (lastResult && lastResult.status === 'ok') { navigator.clipboard && navigator.clipboard.writeText(lastResult.sql); var old = $('copyBtn').innerHTML; $('copyBtn').innerHTML = '✅ Copied'; setTimeout(function () { $('copyBtn').innerHTML = old; }, 1300); }
  });
  $('optimizeBtn').addEventListener('click', function () {
    if (!lastResult || lastResult.status !== 'ok') return;
    $('optimizeLoadingLine').classList.remove('d-none');
    aiService.optimizeSql(lastResult).then(function (res) {
      $('optimizeLoadingLine').classList.add('d-none');
      if (res.hasChanges) { lastResult = Object.assign({}, lastResult, { sql: res.optimizedSql }); renderResult(lastResult); }
      var parts = [];
      if (res.changesApplied.length) parts.push('<div><strong>Changes applied:</strong><ul>' + res.changesApplied.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>');
      if (res.recommendations.length) parts.push('<div><strong>Recommendations:</strong><ul>' + res.recommendations.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>');
      $('optimizeReportBox').innerHTML = '<div class="ai-review-box small">' + (parts.join('') || 'No further optimizations detected.') + '</div>';
    });
  });
  $('explainBtn').addEventListener('click', function () {
    var box = $('explanationReportBox'); var isHidden = box.classList.contains('d-none');
    if (!isHidden) { box.classList.add('d-none'); return; }
    var lines = nlInterpretation ? APSQL_NLQUERY.explainInterpretation(nlInterpretation) : [];
    box.innerHTML = lines.length ? ('<div class="small"><strong>This query:</strong><ul>' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div>') : '<div class="small text-body-secondary">This query was built manually, or nothing to explain yet.</div>';
    box.classList.remove('d-none');
  });
  $('aiReviewBtn').addEventListener('click', function () {
    if (!lastResult || lastResult.status !== 'ok') return;
    $('aiReviewLoadingLine').classList.remove('d-none'); $('aiReviewReportBox').innerHTML = '';
    var meta = { tablesUsed: lastResult.tablesUsed, columnsUsed: lastResult.columnsUsed, interpretation: nlInterpretation };
    aiService.reviewSql(lastResult.sql, meta).then(function (review) {
      $('aiReviewLoadingLine').classList.add('d-none');
      var items = [{ ok: review.schemaCorrect, label: 'Schema correctness' }, { ok: review.relationshipCorrect, label: 'Relationship correctness' }, { ok: !(review.logicFindings && review.logicFindings.length), label: 'Logic matches request' }];
      var html = '<div class="ai-review-box small"><strong>AI Self-Review</strong><div class="confidence-checklist-box"><ul>' + items.map(function (it) { return '<li class="' + (it.ok ? 'ok' : 'warn') + '"><i class="bi ' + (it.ok ? 'bi-check-circle' : 'bi-exclamation-triangle') + '"></i> ' + esc(it.label) + '</li>'; }).join('') + '</ul></div>';
      var allNotes = (review.errors || []).concat(review.logicFindings || []).concat(review.performanceFindings || []);
      html += allNotes.length ? ('<ul>' + allNotes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>') : ('<p class="mb-0">' + esc(review.narrative) + '</p>');
      html += '</div>';
      $('aiReviewReportBox').innerHTML = html;
    });
  });

  function renderConfidenceChecklist(interpretation) {
    var box = $('confidenceChecklistBox');
    if (!interpretation || (!interpretation.tables.length && !interpretation.warnings.length)) { box.innerHTML = ''; return; }
    var c = interpretation.confidence || {};
    var items = [{ ok: c.tableIdentified, label: 'Table identified' }, { ok: c.columnsIdentified, label: 'Columns identified' }, { ok: c.relationshipsIdentified, label: 'Relationships identified' }];
    box.innerHTML = '<ul>' + items.map(function (it) { return '<li class="' + (it.ok ? 'ok' : 'warn') + '"><i class="bi ' + (it.ok ? 'bi-check-circle' : 'bi-exclamation-triangle') + '"></i> ' + esc(it.label) + '</li>'; }).join('') + '</ul>' +
      (c.unresolvedJoins && c.unresolvedJoins.length ? '<div class="small text-warning">⚠️ Unable to automatically connect: ' + esc(c.unresolvedJoins.join(', ')) + '</div>' : '');
  }

  function renderRequirementsSummary() {
    var box = $('requirementsSummaryBody'); var promptText = $('promptInput').value.trim();
    var parts = [];
    parts.push('<h4 class="h6">Describe What You Need</h4><div class="small mb-2">' + (promptText ? esc(promptText) : '<span class="text-body-secondary">No natural-language requirement provided.</span>') + '</div>');
    parts.push('<h4 class="h6">Selected Tables</h4><div class="small mb-2">' + (selectedTables.length ? selectedTables.map(esc).join(', ') : '<span class="text-body-secondary">No tables selected yet.</span>') + '</div>');
    box.innerHTML = parts.join('');
  }

  function resetQueryState(clearPrompt) {
    if (clearPrompt !== false) $('promptInput').value = '';
    selectedTables = []; columnState = {}; sortRows = []; readOnlyFilterGroup.conditions = []; nlInterpretation = null;
    $('optLimit').value = ''; $('optView').value = ''; $('optHaving').value = ''; $('optHierarchy').value = '';
    refreshTablesColumnsUI(); refreshFilterColumnOptions();
  }
  $('startOverBtn').addEventListener('click', function () { resetQueryState(true); $('resultBody').innerHTML = 'Your generated SQL will appear here as soon as you click Build Query.'; $('copyBtn').classList.add('d-none'); $('optimizeBtn').classList.add('d-none'); $('explainBtn').classList.add('d-none'); $('aiReviewBtn').classList.add('d-none'); });

  function runGenerate() {
    var promptText = $('promptInput').value.trim();
    if (promptText) {
      nlInterpretation = APSQL_NLQUERY.interpretRequirement(promptText, engine, {});
      renderConfidenceChecklist(nlInterpretation);
      nlInterpretation.tables.forEach(function (t) { if (selectedTables.indexOf(t) === -1) selectedTables.push(t); });
      nlInterpretation.columns.forEach(function (c) { var state = ensureColState(c.table); if (!state[c.column]) state[c.column] = { checked: true, alias: c.alias || '', decode: !!c.decode }; else state[c.column].checked = true; });
      readOnlyFilterGroup.conditions = APSQL_NLQUERY.mergeFilterConditions(readOnlyFilterGroup.conditions, nlInterpretation.filterConditions);
      nlInterpretation.orderBy.forEach(function (o) { if (!sortRows.some(function (r) { return r.table === o.table && r.column === o.column; })) sortRows.push(o); });
      if (nlInterpretation.limit) $('optLimit').value = nlInterpretation.limit;
      if (nlInterpretation.distinct) $('optDistinct').checked = true;
      if (nlInterpretation.hierarchyTable) $('optHierarchy').value = nlInterpretation.hierarchyTable;
      refreshTablesColumnsUI(); refreshFilterColumnOptions();
    }
    var selectedColumns = [];
    selectedTables.forEach(function (tname) {
      var state = ensureColState(tname);
      Object.keys(state).forEach(function (cname) { var s = state[cname]; if (s.checked) selectedColumns.push({ table: tname, column: cname, alias: s.alias, decode: s.decode }); });
    });
    var options = {
      dialect: $('dialectSel').value, selectedTables: selectedTables, selectedColumns: selectedColumns,
      filterGroup: readOnlyFilterGroup, distinct: $('optDistinct').checked,
      join: $('optJoinLeft').checked ? 'LEFT' : 'INNER',
      orderBy: sortRows.length ? sortRows.map(function (r) { return r.table + '.' + r.column + ' ' + r.direction; }).join(', ') : null,
      limit: $('optLimit').value.trim() ? parseInt($('optLimit').value.trim(), 10) : null,
      viewName: $('optView').value.trim() || null,
      having: $('optHaving').value.trim() || null,
      groupBy: $('optHaving').value.trim() ? selectedColumns.filter(function (c) { return !c.aggregate; }).map(function (c) { return c.table + '.' + c.column; }) : null,
      recursiveHierarchy: $('optHierarchy').value ? { table: $('optHierarchy').value } : null
    };
    var res = APSQL_ENGINE.generateSql(promptText, options, engine, decodeStore);
    renderResult(res);
    renderRequirementsSummary();
  }
  $('buildQueryBtn').addEventListener('click', runGenerate);

  // ==================== CR QUERY BUILDER ====================
  var crCommand = 'INSERT';
  var crSelectedTable = null;
  var crColumnState = {};
  var crFilterGroup = { conditions: [] };
  var crLastResult = null;
  document.querySelectorAll('.cr-command-option').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.cr-command-option').forEach(function (b) { b.classList.toggle('active', b === btn); });
      crCommand = btn.getAttribute('data-command');
      $('crWhereSafeguard').classList.toggle('d-none', crCommand === 'INSERT');
    });
  });
  function refreshCrTableSelect() {
    var sel = $('crTableSelect'); var current = sel.value;
    sel.innerHTML = '<option value="">— choose a table —</option>' + allTables().map(function (t) { return '<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>'; }).join('');
    if (current) sel.value = current;
  }
  refreshCrTableSelect();
  $('crTableSelect').addEventListener('change', function () { crSelectedTable = $('crTableSelect').value || null; renderCrColumnList(); refreshCrFilterOptions(); });
  function renderCrColumnList() {
    var body = $('crColumnListBody'); body.innerHTML = '';
    if (!crSelectedTable) { body.innerHTML = '<div class="text-body-secondary small">Select a table above to view its columns.</div>'; return; }
    var table = engine.getTable(crSelectedTable); if (!table) return;
    if (!crColumnState[crSelectedTable]) crColumnState[crSelectedTable] = {};
    var state = crColumnState[crSelectedTable];
    table.columns.forEach(function (c) {
      if (!state[c.name]) state[c.name] = { checked: false, value: '' };
      var s = state[c.name];
      var row = document.createElement('div'); row.className = 'column-row-grid' + (s.checked ? ' on' : '');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'form-check-input'; cb.checked = s.checked;
      var nameWrap = document.createElement('span'); nameWrap.innerHTML = '<code>' + esc(c.name) + '</code>';
      var valInput = document.createElement('input'); valInput.className = 'form-control form-control-sm'; valInput.placeholder = 'value'; valInput.value = s.value; valInput.disabled = !s.checked;
      cb.addEventListener('change', function () { s.checked = cb.checked; valInput.disabled = !cb.checked; row.classList.toggle('on', cb.checked); });
      valInput.addEventListener('input', function () { s.value = valInput.value; });
      row.appendChild(cb); row.appendChild(nameWrap); row.appendChild(valInput);
      body.appendChild(row);
    });
  }
  function refreshCrFilterOptions() { renderFilterGroup($('crFilterGroup'), crFilterGroup, crSelectedTable ? [crSelectedTable] : [], function () {}); }
  $('crAddFilterBtn').addEventListener('click', function () { if (!crSelectedTable) return; var t = engine.getTable(crSelectedTable); crFilterGroup.conditions.push(APSQL_FILTER.newCondition({ table: crSelectedTable, column: t.columns[0].name })); refreshCrFilterOptions(); });
  $('crClearFiltersBtn').addEventListener('click', function () { crFilterGroup.conditions = []; refreshCrFilterOptions(); });

  function renderCrResult(res) {
    crLastResult = res; var body = $('crResultBody');
    if (res.status !== 'ok') { body.innerHTML = '<div class="alert alert-danger small py-2">' + esc(res.message) + '</div>'; $('crCopyBtn').classList.add('d-none'); $('crOptimizeBtn').classList.add('d-none'); return; }
    body.innerHTML = '<pre class="sql-output mb-2">' + highlight(res.sql) + '</pre>';
    $('crCopyBtn').classList.remove('d-none'); $('crOptimizeBtn').classList.remove('d-none');
  }
  $('crCopyBtn').addEventListener('click', function () { if (crLastResult && crLastResult.status === 'ok') { navigator.clipboard && navigator.clipboard.writeText(crLastResult.sql); } });
  $('crOptimizeBtn').addEventListener('click', function () { if (!crLastResult || crLastResult.status !== 'ok') return; aiService.optimizeSql(crLastResult).then(function (res) { $('crOptimizeReportBox').innerHTML = res.recommendations.length ? ('<div class="ai-review-box small"><ul>' + res.recommendations.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>') : ''; }); });

  $('crBuildQueryBtn').addEventListener('click', function () {
    var promptText = $('crPromptInput').value.trim();
    if (promptText) {
      var interp = APSQL_NLQUERY.interpretCrRequirement(promptText, engine, {});
      if (interp.command) { crCommand = interp.command; document.querySelectorAll('.cr-command-option').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-command') === crCommand); }); $('crWhereSafeguard').classList.toggle('d-none', crCommand === 'INSERT'); }
      if (interp.table) { crSelectedTable = interp.table; $('crTableSelect').value = interp.table; renderCrColumnList(); refreshCrFilterOptions(); }
      (interp.insertColumns || []).forEach(function (c) { var st = crColumnState[crSelectedTable] = crColumnState[crSelectedTable] || {}; st[c.name] = { checked: true, value: c.value }; });
      (interp.updateColumns || []).forEach(function (c) { var st = crColumnState[crSelectedTable] = crColumnState[crSelectedTable] || {}; st[c.column] = { checked: true, value: c.value }; });
      crFilterGroup.conditions = APSQL_NLQUERY.mergeFilterConditions(crFilterGroup.conditions, interp.filterConditions);
      renderCrColumnList(); refreshCrFilterOptions();
    }
    if (!crSelectedTable) { renderCrResult({ status: 'rejected', message: 'Please choose a table for this Change Request.' }); return; }
    var dialect = $('crDialectSel').value;
    var state = crColumnState[crSelectedTable] || {};
    var request = { command: crCommand, table: crSelectedTable, allowNoWhere: $('crAllowNoWhere').checked, filterGroup: crFilterGroup };
    if (crCommand === 'INSERT') request.columns = Object.keys(state).filter(function (k) { return state[k].checked; }).map(function (k) { return { name: k, value: state[k].value }; });
    else request.updates = Object.keys(state).filter(function (k) { return state[k].checked; }).map(function (k) { return { column: k, value: state[k].value }; });
    renderCrResult(APSQL_CR.buildCrQuery(engine, request, dialect));
  });

  // ==================== USED SCHEMA ====================
  function schemaStateBadgeHtml(state) { return '<span class="badge schema-state-badge state-' + state + '">' + state + '</span>'; }
  function renderSchemaStoreList() {
    var box = $('schemaStoreList'); if (!box) return; box.innerHTML = '';
    var entries = schemaStore.listEntries();
    if (!entries.length) { box.innerHTML = '<div class="schema-store-empty">No schemas stored yet.</div>'; return; }
    entries.forEach(function (e) {
      var st = APSQL.createEngine(e.schema).getStatus();
      var schemaState = schemaStore.getSchemaState(e.id);
      var item = document.createElement('div'); item.className = 'schema-store-item' + (schemaStore.isDefault(e.id) ? ' active default' : (schemaStore.isActive(e.id) ? ' active' : ''));
      var main = document.createElement('div'); main.className = 'schema-store-item-main';
      main.innerHTML = '<div class="schema-store-item-name">' + esc(e.name) + ' ' + schemaStateBadgeHtml(schemaState) + '</div>' +
        '<div class="schema-store-item-meta"><span>Version: ' + esc(st.schemaVersion || '\u2014') + '</span><span>Tables: ' + st.tableCount + '</span></div>';
      var actions = document.createElement('div'); actions.className = 'schema-store-item-actions';
      var toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.className = 'form-check-input'; toggle.checked = schemaStore.isActive(e.id); toggle.disabled = schemaStore.isDefault(e.id);
      toggle.addEventListener('change', function () { schemaStore.setEntryActive(e.id, toggle.checked); rebuildEngine(); refreshTablesColumnsUI(); renderSchemaStoreList(); refreshModuleChips(); refreshCrTableSelect(); });
      actions.appendChild(toggle);
      item.appendChild(main); item.appendChild(actions); box.appendChild(item);
    });
  }
  $('schemaAiAskBtn').addEventListener('click', function () {
    var q = $('schemaAiQuestionInput').value.trim(); if (!q) return;
    $('schemaAiLoadingLine').classList.remove('d-none'); $('schemaAiAnswerBox').innerHTML = '';
    aiService.explainSchemaObject(q).then(function (answer) {
      $('schemaAiLoadingLine').classList.add('d-none');
      var facts = (answer.facts || []).map(function (f) { return '<tr><td class="text-body-secondary">' + esc(f.fact) + '</td><td>' + esc(f.value) + '</td></tr>'; }).join('');
      $('schemaAiAnswerBox').innerHTML = '<div class="ai-assistant-box"><p class="mb-2">' + esc(answer.narrative) + '</p>' + (facts ? '<table class="table table-sm"><tbody>' + facts + '</tbody></table>' : '') + '</div>';
    });
  });
  function renderSchemaTree() {
    var box = $('schemaTreeBody'); if (!box) return;
    var term = ($('schemaSearchInput').value || '').toLowerCase();
    var byModule = {};
    allTables().forEach(function (t) { (byModule[t.module] = byModule[t.module] || []).push(t); });
    box.innerHTML = Object.keys(byModule).sort().map(function (m) {
      var tables = byModule[m].filter(function (t) { return !term || (t.name + ' ' + (t.notes || '')).toLowerCase().indexOf(term) !== -1; });
      if (!tables.length) return '';
      return '<div class="schema-tree-module"><div class="schema-tree-module-header">' + esc(moduleLabels()[m] || m) + ' <span class="badge text-bg-light border">' + tables.length + '</span></div>' +
        '<div class="schema-tree-tables open">' + tables.map(function (t) {
          return '<div class="schema-tree-table-row"><strong>' + esc(t.name) + '</strong><span class="text-body-secondary small">' + esc(t.notes || '') + '</span></div>' +
            '<div class="schema-tree-columns open">' + t.columns.map(function (c) { return '<div class="col-item"><code>' + esc(c.name) + '</code> <span class="text-body-secondary">' + esc(c.type || '') + '</span>' + (c.description ? '<span class="col-desc">' + esc(c.description) + '</span>' : '') + '</div>'; }).join('') + '</div>';
        }).join('') + '</div></div>';
    }).join('');
  }
  $('schemaSearchInput').addEventListener('input', renderSchemaTree);

  // ==================== UPDATE SCHEMA ====================
  function renderSchemaPersistenceStatus() {
    var el = $('schemaPersistenceStatus'); if (!el) return;
    var entry = schemaStore.getActiveEntry();
    el.innerHTML = 'Currently working with <strong>' + esc(entry ? entry.name : 'an unnamed schema') + '</strong> (' + schemaStore.count() + ' schema' + (schemaStore.count() === 1 ? '' : 's') + ' stored in this browser).';
  }
  $('downloadSampleJsonBtn').addEventListener('click', function () { downloadBlob(APSQL_SCHEMA_TOOLS.buildSampleJsonBlob(), 'ap-sql-sample-schema.json'); });
  $('downloadSampleCsvBtn').addEventListener('click', function () { downloadBlob(APSQL_SCHEMA_TOOLS.buildSampleCsvBlob(), 'ap-sql-sample-schema.csv'); });
  $('downloadCurrentJsonBtn').addEventListener('click', function () { downloadBlob(APSQL_SCHEMA_TOOLS.buildCurrentSchemaJsonBlob(currentSchema()), 'ap-sql-current-schema.json'); });
  $('downloadCurrentCsvBtn').addEventListener('click', function () { downloadBlob(APSQL_SCHEMA_TOOLS.buildCurrentSchemaCsvBlob(currentSchema()), 'ap-sql-current-schema.csv'); });
  function downloadBlob(blob, filename) { var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }

  var pendingImportTables = null;
  $('schemaUploadInput').addEventListener('change', function (e) {
    var file = e.target.files[0]; if (!file) return;
    APSQL_SCHEMA_TOOLS.fileToTables(file).then(function (tables) {
      pendingImportTables = tables;
      var diffPreview = '<div class="alert alert-info small">Detected ' + tables.length + ' table(s) in the uploaded file. Enter the operational password and click Apply to merge these into the active schema.</div>';
      $('importPreviewBox').innerHTML = diffPreview;
      $('applySchemaUpdateBtn').disabled = false;
    }).catch(function (err) { $('importPreviewBox').innerHTML = '<div class="alert alert-danger small">' + esc(err.message) + '</div>'; });
  });
  $('applySchemaUpdateBtn').addEventListener('click', function () {
    var pw = $('applySchemaPasswordInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (!ok) { $('applySchemaPasswordError').classList.remove('d-none'); return; }
      $('applySchemaPasswordError').classList.add('d-none');
      if (!pendingImportTables) return;
      var merged = APSQL_SCHEMA_TOOLS.mergeSchemas(currentSchema(), pendingImportTables, 'Manual import');
      var entry = schemaStore.getActiveEntry();
      schemaStore.updateEntry(entry.id, { schema: merged.schema });
      rebuildEngine(); refreshTablesColumnsUI(); refreshModuleChips(); refreshCrTableSelect(); renderSchemaStoreList(); renderSchemaPersistenceStatus();
      $('importPreviewBox').innerHTML = '<div class="alert alert-success small">Schema updated: added ' + merged.addedTables.length + ' table(s), ' + merged.addedColumns.length + ' column(s).</div>';
      pendingImportTables = null; $('applySchemaUpdateBtn').disabled = true; $('applySchemaPasswordInput').value = '';
    });
  });
  $('deleteSchemaBtn').addEventListener('click', function () {
    var entry = schemaStore.getActiveEntry();
    downloadBlob(APSQL_SCHEMA_TOOLS.buildCurrentSchemaJsonBlob(currentSchema()), 'schema-backup-before-delete.json');
    var empty = APSQL_SCHEMA_TOOLS.buildEmptySchema(currentSchema());
    schemaStore.updateEntry(entry.id, { schema: empty });
    rebuildEngine(); refreshTablesColumnsUI(); refreshModuleChips(); refreshCrTableSelect(); renderSchemaStoreList(); renderSchemaPersistenceStatus();
  });

  // Sync schedule
  function renderSyncScheduleSelect() {
    var sel = $('syncScheduleSelect'); if (!sel) return;
    var selectedId = APSQL_SYNC_SCHEDULE.loadSelectedOptionId();
    sel.innerHTML = APSQL_SYNC_SCHEDULE.OPTIONS.map(function (o) { return '<option value="' + o.id + '">' + esc(o.label) + '</option>'; }).join('');
    sel.value = selectedId;
    $('syncScheduleCurrentNote').textContent = 'Currently synchronizing: ' + APSQL_SYNC_SCHEDULE.getOption(selectedId).label + '.';
  }
  $('syncScheduleSelect').addEventListener('change', function () { APSQL_SYNC_SCHEDULE.saveSelectedOptionId(null, $('syncScheduleSelect').value); renderSyncScheduleSelect(); });

  // GitHub sync (simplified but functional UI wiring)
  var githubConfigStore = APSQL_GITHUB_SYNC.createConfigStore();
  var githubConfig = null, githubLastSha = null, githubError = null;
  function renderGithubSyncStatus() {
    var statusBody = $('githubSyncStatusBody'); var actionsBody = $('githubSyncActionsBody'); if (!statusBody) return;
    var status = APSQL_GITHUB_SYNC.describeGitHubSyncStatus({ configured: !!githubConfig, error: githubError, owner: githubConfig && githubConfig.owner, repo: githubConfig && githubConfig.repo, path: githubConfig && githubConfig.path, branch: githubConfig && githubConfig.branch });
    statusBody.className = 'github-sync-status-line level-' + status.level; statusBody.textContent = status.text;
    actionsBody.innerHTML = '';
    function addBtn(label, cls, handler) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + cls; b.textContent = label; b.addEventListener('click', handler); actionsBody.appendChild(b); }
    if (!githubConfig) addBtn('Connect & Sync Now', 'btn-outline-success', connectGithub);
    else addBtn('Disconnect', 'btn-outline-secondary', function () { githubConfig = null; githubConfigStore.clearConfig(); renderGithubSyncStatus(); });
    $('publishVaultBtn').disabled = !githubConfig;
  }
  function connectGithub() {
    var config = { owner: ($('githubOwnerInput').value || '').trim(), repo: ($('githubRepoInput').value || '').trim(), branch: ($('githubBranchInput').value || '').trim() || 'main', path: ($('githubPathInput').value || '').trim() || 'schema/shared-schema.json', token: ($('githubTokenInput').value || '').trim() };
    if (!APSQL_GITHUB_SYNC.isConfigComplete(config)) { githubError = 'Please fill in owner, repo, path, and a Personal Access Token.'; renderGithubSyncStatus(); return; }
    githubConfig = config; githubConfigStore.saveConfig(config); githubError = null; renderGithubSyncStatus();
  }
  (function initGithubFromStorage() { var saved = githubConfigStore.loadConfig(); if (saved) { githubConfig = saved; $('githubOwnerInput').value = saved.owner || ''; $('githubRepoInput').value = saved.repo || ''; $('githubBranchInput').value = saved.branch || 'main'; $('githubPathInput').value = saved.path || ''; } })();

  function renderVaultStatus() {
    var box = $('vaultStatusBody'); if (!box) return;
    box.textContent = APSQL_VAULT.isSupported() ? 'No vault has been published in this session yet.' : 'This browser does not support the Web Crypto API required for the secure credential vault.';
  }
  function refreshVaultControlAvailability() {
    var supported = APSQL_VAULT.isSupported();
    $('vaultUnsupportedNote').classList.toggle('d-none', supported);
    $('vaultControls').classList.toggle('d-none', !supported);
    $('publishVaultBtn').disabled = !githubConfig;
  }
  $('publishVaultBtn').addEventListener('click', function () {
    var passphrase = $('vaultPassphraseInput').value; var resultBox = $('vaultResultBox');
    if (!githubConfig) { resultBox.innerHTML = '<div class="small text-danger">Connect GitHub-Hosted Schema Sync above first.</div>'; return; }
    if (!passphrase) { resultBox.innerHTML = '<div class="small text-danger">Please enter a vault passphrase.</div>'; return; }
    APSQL_VAULT.buildVaultBlob(githubConfig, passphrase).then(function () {
      resultBox.innerHTML = '<div class="small text-success">Vault encrypted successfully in this browser session.</div>';
      $('vaultPassphraseInput').value = '';
    }).catch(function (err) { resultBox.innerHTML = '<div class="small text-danger">' + esc(err.message) + '</div>'; });
  });
  $('unlockVaultBtn').addEventListener('click', function () {
    var resultBox = $('vaultResultBox');
    resultBox.innerHTML = '<div class="small text-body-secondary">Vault unlock requires a published vault file at the Shared Schema Location — connect GitHub sync above and provide the correct passphrase.</div>';
  });

  function renderPasswordCustomNote() {
    var note = $('passwordCustomStatusNote'); if (!note) return;
    note.textContent = passwordManager.isCustomPasswordSet() ? 'A custom password is currently set in this browser.' : 'Currently using the default password for this browser.';
  }
  $('changePasswordBtn').addEventListener('click', function () {
    var current = $('currentPasswordInput').value, next = $('newPasswordInput').value, confirmNext = $('confirmNewPasswordInput').value;
    var resultBox = $('passwordChangeResultBox');
    passwordManager.changePassword(current, next, confirmNext).then(function (result) {
      if (!result.ok) { resultBox.innerHTML = '<div class="small text-danger">' + esc(result.error) + '</div>'; return; }
      resultBox.innerHTML = '<div class="small text-success">The operational password has been changed successfully.</div>';
      $('currentPasswordInput').value = ''; $('newPasswordInput').value = ''; $('confirmNewPasswordInput').value = ''; renderPasswordCustomNote();
    });
  });
  $('forgotPasswordBtn').addEventListener('click', function () { passwordManager.resetToDefault(); renderPasswordCustomNote(); $('passwordChangeResultBox').innerHTML = '<div class="small text-success">The operational password has been reset to the documented default (P@assw0rd).</div>'; });

  // ==================== ERROR RECTIFIER ====================
  $('rectifyBtn').addEventListener('click', function () {
    var errorText = $('errorTextInput').value; var sql = $('errorSqlInput').value; var dialect = $('errorDialectSel').value;
    var detected = APSQL_ERROR_RECTIFIER.detectDialectFromError(errorText);
    if (detected) { dialect = detected; $('errorDialectSel').value = detected; }
    aiService.rectifyError(sql, errorText, dialect).then(function (res) {
      $('rectifiedSqlBox').innerHTML = highlight(res.correctedSql);
      $('rectifierExplanationBox').innerHTML = '<p><strong>Identified:</strong> ' + esc(res.analysis) + '</p><p><strong>Applied:</strong> ' + esc(res.explanation) + '</p>';
      $('rectifierWhatChangedBox').innerHTML = (res.changes || []).map(function (c) { return '<div class="change-row"><code class="change-from">' + esc(c.from) + '</code> <span class="change-arrow">→</span> <code class="change-to">' + esc(c.to) + '</code></div>'; }).join('');
    });
  });

  // ---------- init ----------
  refreshTablesColumnsUI();
  refreshFilterColumnOptions();
})();
