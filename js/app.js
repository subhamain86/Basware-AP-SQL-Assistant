/* ==========================================================================
   AP-SQL Assistant V11.4 — Application wiring (UI <-> engines)
   ========================================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Shorthand DOM helpers
  // ---------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function alertBox(kind, text) { return '<div class="alert alert-' + kind + '">' + esc(text) + '</div>'; }

  // ---------------------------------------------------------------------
  // Core state
  // ---------------------------------------------------------------------
  var schemaStore = window.APSQL_SCHEMA_STORE.createStore();
  var relationshipStore = window.APSQL_RELATIONSHIP.createRelationshipStore();
  var decodeSessionStore = window.APSQL_DECODE.createDecodeStore(); // pending-approval scratch space only
  var passwordManager = window.APSQL_PASSWORD_MANAGER.createPasswordManager();
  var githubConfigStore = window.APSQL_GITHUB_SYNC.createConfigStore();
  var engine = null; // effective engine (schema + manual relationship overlay)

  var uiState = {
    selectedTables: [],                 // array of table names
    selectedColumns: [],                // [{table, column, alias, aggregate, distinct, decode}]
    filters: [],                        // filter condition objects (filter-engine format)
    lastGeneratedResult: null,
    pendingDecodeDraft: null,           // draft awaiting admin approval
    onPasswordApproved: null            // callback set right before opening password modal
  };

  function refreshEngine() {
    var merged = schemaStore.getMergedActiveSchema();
    var base = window.APSQL.createEngine(merged);
    engine = window.APSQL_RELATIONSHIP.createEffectiveEngine(base, relationshipStore);
    return merged;
  }

  function bootstrapSchemaStoreIfEmpty() {
    if (schemaStore.count() === 0 && window.__AP_SCHEMA__) {
      schemaStore.importLegacySingleSchema(window.__AP_SCHEMA__, window.__AP_SCHEMA__.schema_name || 'Embedded Schema');
    }
  }

  function currentDialect() { return $('globalDialect').value || 'Generic'; }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  function initTabs() {
    var buttons = document.querySelectorAll('#tabbar button');
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        buttons.forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tabpanel').forEach(function (p) { p.classList.remove('active'); });
        b.classList.add('active');
        $('tab-' + b.getAttribute('data-tab')).classList.add('active');
      });
    });
  }

  // ---------------------------------------------------------------------
  // Header / schema status
  // ---------------------------------------------------------------------
  function renderHeaderStatus() {
    var def = schemaStore.getDefaultEntry();
    var active = schemaStore.getActiveEntries();
    $('hdrSchemaName').textContent = def ? def.name : 'No schema loaded';
    var merged = schemaStore.getMergedActiveSchema();
    $('hdrSchemaTables').textContent = '(' + (merged.tables || []).length + ' tables · ' + active.length + ' active schema' + (active.length === 1 ? '' : 's') + ')';
  }

  // =======================================================================
  // SECTION 3 — Manual Query Configuration: Select Table / Select Column / Filters
  // =======================================================================
  function tableMatches(table, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return table.name.toLowerCase().indexOf(q) !== -1 || (table.notes || '').toLowerCase().indexOf(q) !== -1;
  }

  function renderTableList() {
    var q = $('tableSearch').value.trim();
    var listNode = $('tableList');
    clearNode(listNode);
    var tables = engine.getAllTables().filter(function (t) { return tableMatches(t, q); });
    var modules = {};
    tables.forEach(function (t) { (modules[t.module] = modules[t.module] || []).push(t); });
    var labels = engine.getModuleLabels();
    Object.keys(modules).sort().forEach(function (m) {
      listNode.appendChild(el('div', { class: 'mqc-group-label', text: labels[m] || m }));
      modules[m].forEach(function (t) {
        var selected = uiState.selectedTables.indexOf(t.name) !== -1;
        var item = el('label', { class: 'mqc-item' + (selected ? ' selected' : '') }, [
          el('input', { type: 'checkbox', checked: selected ? 'checked' : null }),
          el('div', {}, [
            el('div', { class: 'name', text: t.name }),
            el('div', { class: 'meta', text: (t.notes || (t.columns.length + ' columns')) })
          ])
        ]);
        var cb = item.querySelector('input');
        cb.checked = selected;
        cb.addEventListener('change', function () {
          if (cb.checked) uiState.selectedTables.push(t.name);
          else uiState.selectedTables = uiState.selectedTables.filter(function (n) { return n !== t.name; });
          uiState.selectedColumns = uiState.selectedColumns.filter(function (c) { return uiState.selectedTables.indexOf(c.table) !== -1; });
          renderTableList(); renderColumnList(); renderFilterExistsHierarchy();
        });
        listNode.appendChild(item);
      });
    });
    $('tableCount').textContent = uiState.selectedTables.length ? uiState.selectedTables.length + ' selected' : '';
  }

  function columnSelected(table, column) {
    return uiState.selectedColumns.some(function (c) { return c.table === table && c.column === column; });
  }
  function getColumnSel(table, column) {
    return uiState.selectedColumns.filter(function (c) { return c.table === table && c.column === column; })[0];
  }

  function renderColumnList() {
    var listNode = $('columnList'); clearNode(listNode);
    if (!uiState.selectedTables.length) {
      listNode.appendChild(el('div', { class: 'muted small', style: 'padding:10px;', text: 'Select one or more tables first.' }));
      $('columnCount').textContent = '';
      return;
    }
    var q = $('columnSearch').value.trim().toLowerCase();
    uiState.selectedTables.forEach(function (tname) {
      var table = engine.getTable(tname); if (!table) return;
      var cols = table.columns.filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) !== -1; });
      if (!cols.length) return;
      listNode.appendChild(el('div', { class: 'mqc-group-label', text: tname }));
      cols.forEach(function (c) {
        var sel = columnSelected(tname, c.name);
        var hasDecode = Array.isArray(c.decode) && c.decode.length;
        var row = el('div', { class: 'mqc-item' + (sel ? ' selected' : '') });
        var cb = el('input', { type: 'checkbox' }); cb.checked = sel;
        var nameWrap = el('div', {}, [
          el('div', { class: 'name' }, []),
          el('div', { class: 'meta', text: (c.type || '') + (c.primary_key ? ' · PK' : '') })
        ]);
        nameWrap.firstChild.textContent = c.name + (c.alias ? ' (' + c.alias + ')' : '');
        if (hasDecode) nameWrap.firstChild.appendChild(el('span', { class: 'badge-decode', text: 'DECODE' }));
        row.appendChild(cb); row.appendChild(nameWrap);
        var controls = el('div', { class: 'col-row-controls' });
        var gear = el('button', { class: 'decode-gear', title: 'CASE / DECODE options', text: '⚙️' });
        gear.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); openDecodeModal(tname, c.name); });
        controls.appendChild(gear);
        row.appendChild(controls);
        cb.addEventListener('change', function () {
          if (cb.checked) uiState.selectedColumns.push({ table: tname, column: c.name, alias: '', aggregate: '', distinct: false, decode: false });
          else uiState.selectedColumns = uiState.selectedColumns.filter(function (x) { return !(x.table === tname && x.column === c.name); });
          renderColumnList();
        });
        listNode.appendChild(row);
      });
    });
    $('columnCount').textContent = uiState.selectedColumns.length ? uiState.selectedColumns.length + ' selected' : '';
  }

  // ---------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------
  function allSelectableColumns() {
    var out = [];
    uiState.selectedTables.forEach(function (tname) {
      var t = engine.getTable(tname); if (!t) return;
      t.columns.forEach(function (c) { out.push({ table: tname, column: c.name }); });
    });
    return out;
  }

  function renderFilterList() {
    var listNode = $('filterList'); clearNode(listNode);
    if (!uiState.filters.length) {
      listNode.appendChild(el('div', { class: 'muted small', style: 'padding:10px;', text: 'No filters added yet.' }));
      $('filterCount').textContent = '';
      return;
    }
    var options = allSelectableColumns();
    uiState.filters.forEach(function (cond, idx) {
      var wrap = el('div', { class: 'filter-row' });
      var top = el('div', { class: 'filter-row-top' });
      if (idx > 0) {
        var joinSel = el('select', { style: 'width:70px;' }, [el('option', { value: 'AND', text: 'AND' }), el('option', { value: 'OR', text: 'OR' })]);
        joinSel.value = cond.join || 'AND';
        joinSel.addEventListener('change', function () { cond.join = joinSel.value; });
        top.appendChild(joinSel);
      }
      var colSel = el('select', {});
      colSel.appendChild(el('option', { value: '', text: '— column —' }));
      options.forEach(function (o) {
        var opt = el('option', { value: o.table + '.' + o.column, text: o.table + '.' + o.column });
        if (cond.table === o.table && cond.column === o.column) opt.selected = true;
        colSel.appendChild(opt);
      });
      colSel.addEventListener('change', function () { var parts = colSel.value.split('.'); cond.table = parts[0]; cond.column = parts.slice(1).join('.'); });
      top.appendChild(colSel);
      var removeBtn = el('button', { class: 'filter-remove', text: '✕', title: 'Remove filter' });
      removeBtn.addEventListener('click', function () { uiState.filters.splice(idx, 1); renderFilterList(); });
      top.appendChild(removeBtn);
      wrap.appendChild(top);

      var row2 = el('div', { class: 'row' });
      var opSel = el('select', {});
      window.APSQL_FILTER.OPERATORS.forEach(function (o) { var opt = el('option', { value: o.id, text: o.label }); if (cond.operator === o.id) opt.selected = true; opSel.appendChild(opt); });
      opSel.addEventListener('change', function () { cond.operator = opSel.value; renderFilterList(); });
      row2.appendChild(opSel);
      var op = window.APSQL_FILTER.getOperator(cond.operator) || { arity: 1 };
      if (op.arity >= 1) {
        var val1 = el('input', { type: 'text', placeholder: op.multi ? 'value1, value2, …' : 'value' });
        val1.value = cond.value || '';
        val1.addEventListener('input', function () { cond.value = val1.value; });
        row2.appendChild(val1);
      }
      if (op.arity === 2) {
        var val2 = el('input', { type: 'text', placeholder: 'to value' });
        val2.value = cond.value2 || '';
        val2.addEventListener('input', function () { cond.value2 = val2.value; });
        row2.appendChild(val2);
      }
      wrap.appendChild(row2);
      listNode.appendChild(wrap);
    });
    $('filterCount').textContent = uiState.filters.length + ' condition' + (uiState.filters.length === 1 ? '' : 's');
  }

  function renderFilterExistsHierarchy() {
    // EXISTS filters + recursive hierarchy availability
    var area = $('existsFilterArea'); clearNode(area);
    var base = uiState.selectedTables[0];
    var recursiveCb = $('optRecursive');
    if (base && engine.getSelfReferencingEdges(base).length) {
      recursiveCb.disabled = false;
    } else {
      recursiveCb.disabled = true; recursiveCb.checked = false;
    }
  }

  // =======================================================================
  // SQL generation (manual configuration + NL requirement)
  // =======================================================================
  function collectManualOptions() {
    return {
      dialect: currentDialect(),
      selectedTables: uiState.selectedTables.slice(),
      selectedColumns: uiState.selectedColumns.map(function (c) { return Object.assign({}, c); }),
      filterGroup: { conditions: uiState.filters.map(function (f) { return Object.assign({}, f); }) },
      join: $('optJoinType').value,
      distinct: $('optDistinct').checked,
      limit: $('optLimit').value ? parseInt($('optLimit').value, 10) : null,
      orderBy: $('optOrderBy').value.trim() || null,
      groupBy: $('optGroupBy').value.trim() ? $('optGroupBy').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : null,
      having: $('optHaving').value.trim() || null,
      viewName: $('optViewName').value.trim() || null,
      recursiveHierarchy: $('optRecursive').checked && uiState.selectedTables[0] ? { table: uiState.selectedTables[0] } : null
    };
  }

  function renderSqlResult(result, requirementText) {
    uiState.lastGeneratedResult = result;
    var msgNode = $('sqlMessages'); clearNode(msgNode);
    var explainNode = $('sqlExplain'); clearNode(explainNode);
    if (!result || result.status === 'clarification_needed') {
      $('sqlOutput').textContent = '-- ' + (result ? result.message : 'Please provide more detail.');
      msgNode.innerHTML = alertBox('info', result ? result.message : 'Please provide more detail.');
      return;
    }
    if (result.status === 'rejected') {
      $('sqlOutput').textContent = '-- Query could not be generated.';
      msgNode.innerHTML = alertBox('error', result.message);
      var suggestions = window.APSQL_SUGGEST.buildSuggestions(result.message);
      var ul = el('ul', { class: 'explain-list' });
      suggestions.forEach(function (s) { ul.appendChild(el('li', { text: s })); });
      explainNode.appendChild(el('div', { class: 'small', html: '<strong>Suggestions</strong>' }));
      explainNode.appendChild(ul);
      return;
    }
    $('sqlOutput').textContent = result.sql;
    var lines = [];
    if (result.tablesUsed && result.tablesUsed.length) lines.push('Tables used: ' + result.tablesUsed.join(', '));
    if (result.filtersApplied && result.filtersApplied.length) result.filtersApplied.forEach(function (f) { lines.push(f); });
    if (result.assumptions && result.assumptions.length) result.assumptions.forEach(function (a) { lines.push('Assumption: ' + a); });
    if (lines.length) {
      var ul2 = el('ul', { class: 'explain-list' });
      lines.forEach(function (l) { ul2.appendChild(el('li', { text: l })); });
      explainNode.appendChild(el('div', { class: 'small', html: '<strong>What this query does</strong>' }));
      explainNode.appendChild(ul2);
    }
  }

  function generateFromManualConfig() {
    var opts = collectManualOptions();
    var requirement = $('nlRequirement').value.trim();
    var result = window.APSQL_ENGINE.generateSql(requirement, opts, engine, decodeSessionStoreForActiveSchema());
    renderSqlResult(result, requirement);
  }

  // The decode store used at SQL-generation time should reflect the CURRENT schema first
  // (handled inside decode-engine.resolveDecode via `engine`), with the session-only
  // manual store only used as a fallback preview before a draft has been approved.
  function decodeSessionStoreForActiveSchema() { return decodeSessionStore; }

  function applyInterpretationToManualConfig(interp) {
    uiState.selectedTables = interp.tables.slice();
    uiState.selectedColumns = interp.columns.map(function (c) { return { table: c.table, column: c.column, alias: '', aggregate: '', distinct: false, decode: false }; });
    uiState.filters = interp.filterConditions.map(function (c) { return window.APSQL_FILTER.newCondition(c); });
    $('optOrderBy').value = interp.orderBy && interp.orderBy.length ? interp.orderBy.map(function (o) { return o.table + '.' + o.column + ' ' + o.direction; }).join(', ') : '';
    $('optLimit').value = interp.limit || '';
    $('optDistinct').checked = !!interp.distinct;
    $('optRecursive').checked = !!interp.hierarchyTable;
    renderTableList(); renderColumnList(); renderFilterList(); renderFilterExistsHierarchy();
  }

  function buildFromNaturalLanguage() {
    var text = $('nlRequirement').value.trim();
    var warnNode = $('nlWarnings'); clearNode(warnNode);
    if (!text) { warnNode.innerHTML = alertBox('warn', 'Please describe what you need first.'); return; }
    var interp = window.APSQL_NLQUERY.interpretRequirement(text, engine);
    if (interp.warnings && interp.warnings.length) { warnNode.innerHTML = interp.warnings.map(function (w) { return alertBox('warn', w); }).join(''); }
    applyInterpretationToManualConfig(interp);
    if (interp.tables.length) generateFromManualConfig();
    else renderSqlResult({ status: 'clarification_needed', message: 'Could not confidently determine tables from your description — refine Select Table / Select Column below, then click "Generate SQL from Manual Configuration".' });
  }

  // =======================================================================
  // CASE / DECODE modal — schema-aware lookup + manual addition + admin approval
  // =======================================================================
  function openDecodeModal(table, column) {
    var backdrop = $('decodeModalBackdrop');
    var body = $('decodeModalBody'); var footer = $('decodeModalFooter');
    clearNode(body); clearNode(footer);
    $('decodeModalTitle').textContent = 'CASE / DECODE — ' + table + '.' + column;
    var resolved = window.APSQL_DECODE.resolveDecode(engine, decodeSessionStore, table, column);
    var colSel = getColumnSel(table, column);

    if (resolved.source === 'schema') {
      body.innerHTML = alertBox('ok', 'A CASE/DECODE definition already exists in the active schema for this column and will be used automatically when this column is selected.');
      var kv = el('div', { class: 'kv mt8' });
      resolved.values.forEach(function (p) { kv.appendChild(el('div', { text: p.code })); kv.appendChild(el('div', { text: p.label })); });
      body.appendChild(kv);
      var useLabel = el('label', { class: 'inline mt12' }, [el('input', { type: 'checkbox' }), document.createTextNode(' Use CASE/DECODE display for this column in generated SQL')]);
      var useCb = useLabel.querySelector('input'); useCb.checked = !!(colSel && colSel.decode);
      useCb.addEventListener('change', function () { if (colSel) { colSel.decode = useCb.checked; renderColumnList(); } });
      body.appendChild(useLabel);
      var closeBtn = el('button', { class: 'btn', text: 'Close' });
      closeBtn.addEventListener('click', closeDecodeModal);
      footer.appendChild(closeBtn);
    } else {
      body.innerHTML = alertBox('warn', 'No CASE/DECODE definition was found in the active schema for ' + table + '.' + column + '. You can add a manual definition below — it will require Admin approval before being saved to the current schema.');
      if (resolved.source === 'session') {
        body.appendChild(el('div', { class: 'small mt8', html: '<strong>Pending (not yet approved) session draft:</strong>' }));
        var kv2 = el('div', { class: 'kv mt8' });
        resolved.values.forEach(function (p) { kv2.appendChild(el('div', { text: p.code })); kv2.appendChild(el('div', { text: p.label })); });
        body.appendChild(kv2);
      }
      body.appendChild(buildManualDecodeForm(table, column));
    }
    backdrop.classList.add('open');
  }
  function closeDecodeModal() { $('decodeModalBackdrop').classList.remove('open'); }
  $('decodeModalClose').addEventListener('click', closeDecodeModal);
  $('decodeModalBackdrop').addEventListener('click', function (e) { if (e.target === $('decodeModalBackdrop')) closeDecodeModal(); });

  function buildManualDecodeForm(table, column) {
    var wrap = el('div', { class: 'mt12' });
    wrap.appendChild(el('div', { class: 'small', html: '<strong>Manual CASE/DECODE Definition</strong>' }));
    var pairsWrap = el('div', { class: 'mt8', id: 'decodePairsWrap' });
    var pairs = [{ code: '', label: '' }];

    function renderPairs() {
      clearNode(pairsWrap);
      pairs.forEach(function (p, idx) {
        var row = el('div', { class: 'pair-row' });
        var codeInput = el('input', { type: 'text', placeholder: 'Condition / value (e.g. 1)' }); codeInput.value = p.code;
        codeInput.addEventListener('input', function () { p.code = codeInput.value; });
        var labelInput = el('input', { type: 'text', placeholder: 'Result / output (e.g. Active)' }); labelInput.value = p.label;
        labelInput.addEventListener('input', function () { p.label = labelInput.value; });
        var rm = el('button', { class: 'filter-remove', text: '✕' });
        rm.addEventListener('click', function () { pairs.splice(idx, 1); renderPairs(); });
        row.appendChild(codeInput); row.appendChild(labelInput); row.appendChild(rm);
        pairsWrap.appendChild(row);
      });
    }
    renderPairs();
    wrap.appendChild(pairsWrap);
    var addPairBtn = el('button', { class: 'btn secondary sm mt8', text: '➕ Add condition' });
    addPairBtn.addEventListener('click', function () { pairs.push({ code: '', label: '' }); renderPairs(); });
    wrap.appendChild(addPairBtn);

    var elseInput = el('input', { type: 'text', placeholder: 'ELSE / default value (optional)' });
    wrap.appendChild(el('label', { class: 'mt8', text: 'ELSE / default value' }));
    wrap.appendChild(elseInput);
    var descInput = el('textarea', { rows: '2', placeholder: 'Optional description' });
    wrap.appendChild(el('label', { class: 'mt8', text: 'Description (optional)' }));
    wrap.appendChild(descInput);

    var msgArea = el('div', { class: 'mt8' });
    wrap.appendChild(msgArea);

    var submitBtn = el('button', { class: 'btn mt12', text: 'Submit for Admin Approval' });
    submitBtn.addEventListener('click', function () {
      clearNode(msgArea);
      var draft = window.APSQL_DECODE_APPROVAL.createDraft({ table: table, column: column, description: descInput.value, elseDefault: elseInput.value, pairs: pairs });
      var check = window.APSQL_DECODE_APPROVAL.validateDraft(draft);
      if (!check.valid) { msgArea.innerHTML = check.errors.map(function (e) { return alertBox('error', e); }).join(''); return; }
      decodeSessionStore.setManualDecode(table, column, check.cleanPairs);
      uiState.pendingDecodeDraft = draft;
      requestAdminApproval(function (approvedBy) {
        var defaultEntry = schemaStore.getDefaultEntry();
        if (!defaultEntry) { msgArea.innerHTML = alertBox('error', 'No default schema is set to save this definition into.'); return; }
        var applyResult = window.APSQL_DECODE_APPROVAL.applyApprovedDraftToSchema(defaultEntry.schema, draft, { approvedBy: approvedBy });
        if (!applyResult.ok) {
          if (applyResult.duplicate) {
            msgArea.innerHTML = alertBox('info', applyResult.errors[0]);
            var colSelDup = getColumnSel(table, column); if (colSelDup) { colSelDup.decode = true; }
            refreshEngine(); renderColumnList(); renderHeaderStatus();
          } else {
            msgArea.innerHTML = applyResult.errors.map(function (e) { return alertBox('error', e); }).join('');
          }
          return;
        }
        schemaStore.updateEntry(defaultEntry.id, { schema: applyResult.schema });
        decodeSessionStore.clearManualDecode(table, column);
        refreshEngine();
        var colSelNew = getColumnSel(table, column); if (colSelNew) colSelNew.decode = true;
        renderColumnList(); renderHeaderStatus(); renderSchemaEntries();
        msgArea.innerHTML = alertBox('ok', 'Approved and saved to the current schema (' + defaultEntry.name + ').');
        setTimeout(closeDecodeModal, 900);
      });
    });
    wrap.appendChild(submitBtn);
    return wrap;
  }

  // ---------------------------------------------------------------------
  // Admin password approval modal (reused for decode approval and other admin actions)
  // ---------------------------------------------------------------------
  function requestAdminApproval(onApproved) {
    uiState.onPasswordApproved = onApproved;
    $('pwModalInput').value = '';
    clearNode($('pwModalMsg'));
    $('pwModalBackdrop').classList.add('open');
    $('pwModalInput').focus();
  }
  function closePwModal() { $('pwModalBackdrop').classList.remove('open'); uiState.onPasswordApproved = null; }
  $('pwModalCancel').addEventListener('click', closePwModal);
  $('pwModalClose').addEventListener('click', closePwModal);
  $('pwModalBackdrop').addEventListener('click', function (e) { if (e.target === $('pwModalBackdrop')) closePwModal(); });
  $('pwModalApprove').addEventListener('click', function () {
    var pw = $('pwModalInput').value;
    passwordManager.verifyCurrentPassword(pw).then(function (ok) {
      if (!ok) { $('pwModalMsg').innerHTML = alertBox('error', 'Incorrect password. Approval denied.'); return; }
      var cb = uiState.onPasswordApproved;
      closePwModal();
      if (cb) cb('Administrator');
    });
  });

  // =======================================================================
  // Wiring — Section 1 / 2 / 3
  // =======================================================================
  function initReadOnlyBuilder() {
    $('btnBuildQuery').addEventListener('click', buildFromNaturalLanguage);
    $('btnClearAll').addEventListener('click', function () {
      $('nlRequirement').value = ''; uiState.selectedTables = []; uiState.selectedColumns = []; uiState.filters = [];
      ['optLimit', 'optOrderBy', 'optGroupBy', 'optHaving', 'optViewName'].forEach(function (id) { $(id).value = ''; });
      $('optDistinct').checked = false; $('optRecursive').checked = false;
      clearNode($('nlWarnings'));
      renderTableList(); renderColumnList(); renderFilterList(); renderFilterExistsHierarchy();
      renderSqlResult({ status: 'clarification_needed', message: 'Cleared. Describe a new requirement, or select tables/columns manually.' });
    });
    $('tableSearch').addEventListener('input', renderTableList);
    $('columnSearch').addEventListener('input', renderColumnList);
    $('btnAddFilter').addEventListener('click', function () {
      var opts = allSelectableColumns();
      var first = opts[0] || { table: '', column: '' };
      uiState.filters.push(window.APSQL_FILTER.newCondition({ table: first.table, column: first.column }));
      renderFilterList();
    });
    $('btnGenerateManual').addEventListener('click', generateFromManualConfig);
    $('btnCopySql').addEventListener('click', function () {
      var text = $('sqlOutput').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
    });
    $('btnOptimizeSql').addEventListener('click', function () {
      if (!uiState.lastGeneratedResult || uiState.lastGeneratedResult.status !== 'ok') return;
      var opt = window.APSQL_OPTIMIZE.optimizeSql(engine, uiState.lastGeneratedResult);
      $('sqlOutput').textContent = opt.optimizedSql;
      var explainNode = $('sqlExplain');
      var box = el('div', { class: 'mt8' });
      if (opt.changesApplied.length) { box.innerHTML += alertBox('ok', 'Optimizations applied: ' + opt.changesApplied.join(' ')); }
      if (opt.recommendations.length) { box.innerHTML += opt.recommendations.map(function (r) { return alertBox('info', r); }).join(''); }
      explainNode.appendChild(box);
    });
    $('btnSendToRectifier').addEventListener('click', function () {
      $('rectSql').value = $('sqlOutput').textContent;
      document.querySelector('#tabbar button[data-tab="rectifier"]').click();
    });
  }

  // =======================================================================
  // CR Query Builder
  // =======================================================================
  function populateCrTableSelect() {
    var sel = $('crTable'); clearNode(sel);
    engine.getAllTables().forEach(function (t) { sel.appendChild(el('option', { value: t.name, text: t.name })); });
    renderCrColumnsArea();
  }
  function renderCrColumnsArea() {
    var area = $('crColumnsArea'); clearNode(area);
    var tname = $('crTable').value; var table = engine.getTable(tname);
    var cmd = $('crCommand').value;
    if (!table) return;
    if (cmd === 'INSERT') {
      area.appendChild(el('div', { class: 'small', html: '<strong>Columns &amp; values to insert</strong>' }));
      table.columns.forEach(function (c) {
        var row = el('div', { class: 'row', style: 'align-items:center;' });
        var lab = el('label', { class: 'inline', style: 'flex:0 0 40px;' }, [el('input', { type: 'checkbox', 'data-col': c.name })]);
        var name = el('div', { style: 'flex:0 0 160px; font-size:12.5px; font-weight:600;', text: c.name });
        var val = el('input', { type: 'text', placeholder: 'value', 'data-valfor': c.name });
        row.appendChild(lab); row.appendChild(name); row.appendChild(val);
        area.appendChild(row);
      });
    } else if (cmd === 'UPDATE') {
      area.appendChild(el('div', { class: 'small', html: '<strong>Columns to update</strong>' }));
      table.columns.forEach(function (c) {
        var row = el('div', { class: 'row', style: 'align-items:center;' });
        var lab = el('label', { class: 'inline', style: 'flex:0 0 40px;' }, [el('input', { type: 'checkbox', 'data-col': c.name })]);
        var name = el('div', { style: 'flex:0 0 160px; font-size:12.5px; font-weight:600;', text: c.name });
        var val = el('input', { type: 'text', placeholder: 'new value', 'data-valfor': c.name });
        row.appendChild(lab); row.appendChild(name); row.appendChild(val);
        area.appendChild(row);
      });
    }
    renderCrFilterArea();
  }
  function renderCrFilterArea() {
    var area = $('crFilterArea'); clearNode(area);
    var cmd = $('crCommand').value;
    if (cmd === 'INSERT') return;
    area.appendChild(el('div', { class: 'small', html: '<strong>WHERE condition(s)</strong>' }));
    if (!window.__crFilters) window.__crFilters = [];
    var listNode = el('div', {});
    function draw() {
      clearNode(listNode);
      var tname = $('crTable').value; var table = engine.getTable(tname);
      window.__crFilters.forEach(function (cond, idx) {
        var wrap = el('div', { class: 'filter-row' });
        var row2 = el('div', { class: 'row' });
        var colSel = el('select', {});
        (table ? table.columns : []).forEach(function (c) { var opt = el('option', { value: c.name, text: c.name }); if (cond.column === c.name) opt.selected = true; colSel.appendChild(opt); });
        colSel.addEventListener('change', function () { cond.table = tname; cond.column = colSel.value; });
        cond.table = tname; if (!cond.column && table && table.columns[0]) cond.column = table.columns[0].name;
        row2.appendChild(colSel);
        var opSel = el('select', {});
        window.APSQL_FILTER.OPERATORS.forEach(function (o) { var opt = el('option', { value: o.id, text: o.label }); if (cond.operator === o.id) opt.selected = true; opSel.appendChild(opt); });
        opSel.addEventListener('change', function () { cond.operator = opSel.value; draw(); });
        row2.appendChild(opSel);
        var op = window.APSQL_FILTER.getOperator(cond.operator) || { arity: 1 };
        if (op.arity >= 1) { var v1 = el('input', { type: 'text', placeholder: 'value' }); v1.value = cond.value || ''; v1.addEventListener('input', function () { cond.value = v1.value; }); row2.appendChild(v1); }
        var rm = el('button', { class: 'filter-remove', text: '✕' }); rm.addEventListener('click', function () { window.__crFilters.splice(idx, 1); draw(); });
        row2.appendChild(rm);
        wrap.appendChild(row2); listNode.appendChild(wrap);
      });
    }
    draw();
    area.appendChild(listNode);
    var addBtn = el('button', { class: 'btn secondary sm mt8', text: '➕ Add condition' });
    addBtn.addEventListener('click', function () { window.__crFilters.push(window.APSQL_FILTER.newCondition({})); draw(); });
    area.appendChild(addBtn);
  }

  function initCrBuilder() {
    $('crSafetyBanner').textContent = window.APSQL_CR.SAFETY_BANNER;
    $('crCommand').addEventListener('change', renderCrColumnsArea);
    $('crTable').addEventListener('change', renderCrColumnsArea);
    $('btnBuildCr').addEventListener('click', function () {
      var cmd = $('crCommand').value; var tname = $('crTable').value;
      var msgs = $('crMessages'); clearNode(msgs);
      var request = { command: cmd, table: tname, allowNoWhere: $('crAllowNoWhere').checked };
      if (cmd === 'INSERT') {
        request.columns = [];
        document.querySelectorAll('#crColumnsArea input[type=checkbox]').forEach(function (cb) {
          if (cb.checked) { var name = cb.getAttribute('data-col'); var valInput = document.querySelector('#crColumnsArea input[data-valfor="' + name + '"]'); request.columns.push({ name: name, value: valInput ? valInput.value : '' }); }
        });
      } else if (cmd === 'UPDATE') {
        request.updates = [];
        document.querySelectorAll('#crColumnsArea input[type=checkbox]').forEach(function (cb) {
          if (cb.checked) { var name = cb.getAttribute('data-col'); var valInput = document.querySelector('#crColumnsArea input[data-valfor="' + name + '"]'); request.updates.push({ column: name, value: valInput ? valInput.value : '' }); }
        });
        request.filterGroup = { conditions: (window.__crFilters || []).slice() };
      } else if (cmd === 'DELETE') {
        request.filterGroup = { conditions: (window.__crFilters || []).slice() };
      }
      var result = window.APSQL_CR.buildCrQuery(engine, request, currentDialect());
      if (result.status === 'rejected') {
        msgs.innerHTML = alertBox('error', result.message);
        window.APSQL_SUGGEST.buildSuggestions(result.message).forEach(function (s) { msgs.innerHTML += alertBox('info', s); });
        $('crOutput').textContent = '-- Query could not be generated.';
        return;
      }
      if (result.warnings && result.warnings.length) msgs.innerHTML = result.warnings.map(function (w) { return alertBox('warn', w); }).join('');
      $('crOutput').textContent = window.APSQL_CR.SAFETY_BANNER + '\n\n' + result.sql;
    });
  }

  // =======================================================================
  // Error Rectifier
  // =======================================================================
  function initRectifier() {
    $('btnDetectDialect').addEventListener('click', function () {
      var detected = window.APSQL_ERROR_RECTIFIER.detectDialectFromError($('rectError').value);
      if (detected) $('rectDialect').value = detected;
    });
    $('btnRectify').addEventListener('click', function () {
      var result = window.APSQL_ERROR_RECTIFIER.rectify($('rectSql').value, $('rectError').value, engine, $('rectDialect').value);
      var out = $('rectResult'); clearNode(out);
      out.innerHTML = (result.changed ? alertBox('ok', 'Correction applied.') : alertBox('info', 'No automatic change was made.'));
      out.innerHTML += '<div class="kv mt8"><div>Identified issue</div><div>' + esc(result.errorIdentified) + '</div><div>Correction applied</div><div>' + esc(result.correctionApplied) + '</div></div>';
      var pre = el('pre', { class: 'sql-output mt8', text: result.correctedSql });
      out.appendChild(pre);
    });
  }

  // =======================================================================
  // Update Schema tab
  // =======================================================================
  function renderSchemaEntries() {
    var area = $('schemaEntries'); clearNode(area);
    var entries = schemaStore.listEntries();
    if (!entries.length) { area.innerHTML = alertBox('info', 'No schema loaded yet.'); }
    entries.forEach(function (e) {
      var state = schemaStore.getSchemaState(e.id);
      var wrap = el('div', { class: 'schema-entry' });
      wrap.appendChild(el('div', {}, [
        el('div', { class: 'name', text: e.name }),
        el('div', { class: 'meta', text: 'v' + (e.schema.schema_version || '0.0') + ' · ' + (e.schema.tables || []).length + ' tables · source: ' + e.source })
      ]));
      wrap.appendChild(el('span', { class: 'chip state-' + state, text: state.charAt(0).toUpperCase() + state.slice(1) }));
      var actions = el('div', { class: 'actions' });
      if (state !== 'default') {
        var setDefaultBtn = el('button', { class: 'btn secondary sm', text: 'Set as default' });
        setDefaultBtn.addEventListener('click', function () { schemaStore.setDefaultId(e.id); refreshEngine(); afterSchemaChange(); });
        actions.appendChild(setDefaultBtn);
      }
      var toggleActiveBtn = el('button', { class: 'btn secondary sm', text: state === 'inactive' ? 'Activate' : 'Deactivate' });
      toggleActiveBtn.disabled = state === 'default';
      toggleActiveBtn.addEventListener('click', function () { schemaStore.setEntryActive(e.id, state === 'inactive'); refreshEngine(); afterSchemaChange(); });
      actions.appendChild(toggleActiveBtn);
      var removeBtn = el('button', { class: 'btn danger sm', text: 'Remove' });
      removeBtn.addEventListener('click', function () { if (confirm('Remove schema "' + e.name + '"?')) { schemaStore.removeEntry(e.id); refreshEngine(); afterSchemaChange(); } });
      actions.appendChild(removeBtn);
      wrap.appendChild(actions);
      area.appendChild(wrap);
    });
  }

  function populateSchemaMergeTarget() {
    var sel = $('schemaMergeTarget'); clearNode(sel);
    schemaStore.listEntries().forEach(function (e) { sel.appendChild(el('option', { value: e.id, text: e.name })); });
  }

  function initSchemaTab() {
    $('btnAddSchemaEntry').addEventListener('click', function () {
      var file = $('schemaUploadFile').files[0];
      var msgs = $('schemaUploadMsgs'); clearNode(msgs);
      if (!file) { msgs.innerHTML = alertBox('warn', 'Choose a .csv or .json schema file first.'); return; }
      window.APSQL_SCHEMA_TOOLS.fileToTables(file).then(function (tables) {
        var check = window.APSQL_SCHEMA_TOOLS.validateSchema(tables);
        if (!check.valid) { msgs.innerHTML = check.errors.map(function (er) { return alertBox('error', er); }).join(''); return; }
        var name = $('schemaUploadName').value.trim() || file.name;
        schemaStore.addEntry({ name: name, schema: { schema_name: name, schema_version: '1.0', last_updated: new Date().toISOString().slice(0, 10), tables: tables }, source: 'upload' });
        refreshEngine(); afterSchemaChange();
        msgs.innerHTML = alertBox('ok', 'Added new schema entry "' + name + '" with ' + tables.length + ' table(s).');
      }).catch(function (err) { msgs.innerHTML = alertBox('error', err.message); });
    });
    $('btnMergeSchemaEntry').addEventListener('click', function () {
      var file = $('schemaUploadFile').files[0];
      var msgs = $('schemaUploadMsgs'); clearNode(msgs);
      if (!file) { msgs.innerHTML = alertBox('warn', 'Choose a .csv or .json schema file first.'); return; }
      var targetId = $('schemaMergeTarget').value;
      var target = schemaStore.getEntry(targetId);
      if (!target) { msgs.innerHTML = alertBox('warn', 'Choose a schema to merge into.'); return; }
      window.APSQL_SCHEMA_TOOLS.fileToTables(file).then(function (tables) {
        var merged = window.APSQL_SCHEMA_TOOLS.mergeSchemas(target.schema, tables, file.name);
        schemaStore.updateEntry(target.id, { schema: merged.schema });
        refreshEngine(); afterSchemaChange();
        msgs.innerHTML = alertBox('ok', 'Merged into "' + target.name + '": ' + merged.addedTables.length + ' new table(s), ' + merged.addedColumns.length + ' new column(s).');
      }).catch(function (err) { msgs.innerHTML = alertBox('error', err.message); });
    });
    $('btnDownloadSampleCsv').addEventListener('click', function () { downloadBlob(window.APSQL_SCHEMA_TOOLS.buildSampleCsvBlob(), 'ap-sql-schema-template.csv'); });
    $('btnExportCurrentJson').addEventListener('click', function () {
      var def = schemaStore.getDefaultEntry(); if (!def) return;
      downloadBlob(window.APSQL_SCHEMA_TOOLS.buildCurrentSchemaJsonBlob(def.schema), def.name.replace(/\s+/g, '_') + '.json');
    });
    $('btnAddRelationship').addEventListener('click', function () {
      var ft = $('relFromTable').value.trim(), fc = $('relFromColumn').value.trim(), tt = $('relToTable').value.trim(), tc = $('relToColumn').value.trim();
      if (!ft || !fc || !tt || !tc) return;
      relationshipStore.setManualRelationship(ft, fc, tt, tc);
      ['relFromTable', 'relFromColumn', 'relToTable', 'relToColumn'].forEach(function (id) { $(id).value = ''; });
      alert('Relationship saved for this session: ' + ft + '.' + fc + ' ↔ ' + tt + '.' + tc);
    });

    var syncSel = $('syncScheduleSelect'); clearNode(syncSel);
    window.APSQL_SYNC_SCHEDULE.OPTIONS.forEach(function (o) { syncSel.appendChild(el('option', { value: o.id, text: o.label })); });
    syncSel.value = window.APSQL_SYNC_SCHEDULE.loadSelectedOptionId();
    $('syncScheduleNote').textContent = 'Current: ' + (window.APSQL_SYNC_SCHEDULE.getOption(syncSel.value) || {}).label;
    $('btnSaveSyncSchedule').addEventListener('click', function () {
      window.APSQL_SYNC_SCHEDULE.saveSelectedOptionId(undefined, syncSel.value);
      $('syncScheduleNote').textContent = 'Saved: ' + (window.APSQL_SYNC_SCHEDULE.getOption(syncSel.value) || {}).label;
    });

    $('btnChangePassword').addEventListener('click', function () {
      var msgs = $('pwMsgs'); clearNode(msgs);
      passwordManager.changePassword($('pwCurrent').value, $('pwNew').value, $('pwConfirm').value).then(function (res) {
        if (!res.ok) { msgs.innerHTML = alertBox('error', res.error); return; }
        msgs.innerHTML = alertBox('ok', 'Operational password changed successfully.');
        ['pwCurrent', 'pwNew', 'pwConfirm'].forEach(function (id) { $(id).value = ''; });
      });
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  function afterSchemaChange() {
    renderHeaderStatus(); renderSchemaEntries(); populateSchemaMergeTarget();
    renderTableList(); renderColumnList(); renderFilterList(); renderFilterExistsHierarchy();
    populateCrTableSelect();
  }

  // =======================================================================
  // GitHub Sync & Vault
  // =======================================================================
  function loadGithubConfigIntoForm() {
    var cfg = githubConfigStore.loadConfig() || {};
    $('ghOwner').value = cfg.owner || ''; $('ghRepo').value = cfg.repo || '';
    $('ghBranch').value = cfg.branch || ''; $('ghPath').value = cfg.path || 'schema/shared-schema.json';
    $('githubStatusHint').textContent = window.APSQL_GITHUB_SYNC.describeGitHubSyncStatus({ configured: window.APSQL_GITHUB_SYNC.isReadConfigComplete(cfg), owner: cfg.owner, repo: cfg.repo, path: cfg.path, branch: cfg.branch }).text;
  }
  function readGithubFormConfig() {
    return { owner: $('ghOwner').value.trim(), repo: $('ghRepo').value.trim(), branch: $('ghBranch').value.trim() || 'main', path: $('ghPath').value.trim() || 'schema/shared-schema.json', token: $('ghToken').value };
  }
  function initSyncTab() {
    loadGithubConfigIntoForm();
    $('btnGhSaveConfig').addEventListener('click', function () {
      var cfg = readGithubFormConfig(); githubConfigStore.saveConfig(cfg);
      $('ghMsgs').innerHTML = alertBox('ok', 'GitHub configuration saved for this browser.');
      loadGithubConfigIntoForm();
    });
    $('btnGhFetch').addEventListener('click', function () {
      var cfg = readGithubFormConfig(); var msgs = $('ghMsgs'); clearNode(msgs);
      window.APSQL_GITHUB_SYNC.fetchRemoteSchema(cfg).then(function (res) {
        if (!res.exists) { msgs.innerHTML = alertBox('warn', 'No schema file exists yet at that path.'); return; }
        var name = res.schema.schema_name || 'GitHub Schema';
        schemaStore.addEntry({ name: name, schema: res.schema, source: 'github' });
        refreshEngine(); afterSchemaChange();
        msgs.innerHTML = alertBox('ok', 'Fetched and added schema "' + name + '" from GitHub.');
      }).catch(function (err) { msgs.innerHTML = alertBox('error', err.message); });
    });
    $('btnGhPush').addEventListener('click', function () {
      var cfg = readGithubFormConfig(); var msgs = $('ghMsgs'); clearNode(msgs);
      var def = schemaStore.getDefaultEntry(); if (!def) { msgs.innerHTML = alertBox('warn', 'No default schema to push.'); return; }
      window.APSQL_GITHUB_SYNC.fetchRemoteSchema(cfg).catch(function () { return { exists: false }; }).then(function (existing) {
        return window.APSQL_GITHUB_SYNC.pushSchemaToGitHub(cfg, def.schema, existing && existing.sha);
      }).then(function () { msgs.innerHTML = alertBox('ok', 'Pushed the default schema to GitHub.'); }).catch(function (err) { msgs.innerHTML = alertBox('error', err.message); });
    });
    $('btnEncryptVault').addEventListener('click', function () {
      var cfg = readGithubFormConfig(); var pass = $('vaultPass1').value; var msgs = $('vaultMsgs'); clearNode(msgs);
      if (!pass) { msgs.innerHTML = alertBox('warn', 'Enter a vault passphrase first.'); return; }
      window.APSQL_VAULT.buildVaultBlob(cfg, pass).then(function (blobText) {
        downloadBlob(new Blob([blobText], { type: 'application/json' }), 'shared-schema.vault.json');
        msgs.innerHTML = alertBox('ok', 'Vault file generated. Place it at schema/shared-schema.vault.json alongside index.html to publish it, then use "Fetch & unlock vault" on any device with the passphrase.');
      }).catch(function (err) { msgs.innerHTML = alertBox('error', err.message); });
    });
    $('btnFetchUnlockVault').addEventListener('click', function () {
      var pass = $('vaultPass2').value; var msgs = $('vaultMsgs'); clearNode(msgs);
      if (!pass) { msgs.innerHTML = alertBox('warn', 'Enter the vault passphrase first.'); return; }
      fetch('schema/shared-schema.vault.json', { cache: 'no-store' }).then(function (res) {
        if (res.status === 404) throw new Error('No vault file was found at schema/shared-schema.vault.json. Ask an administrator to publish one first.');
        if (!res.ok) throw new Error('Could not read the vault file (HTTP ' + res.status + ').');
        return res.json();
      }).then(function (vaultObj) { return window.APSQL_VAULT.decryptConfig(vaultObj, pass); }).then(function (cfg) {
        githubConfigStore.saveConfig(cfg); loadGithubConfigIntoForm();
        msgs.innerHTML = alertBox('ok', 'Vault unlocked and GitHub configuration loaded.');
      }).catch(function (err) { msgs.innerHTML = alertBox('error', err.message); });
    });
  }

  // =======================================================================
  // Guided Walkthrough (clamped to viewport)
  // =======================================================================
  var TOUR_STEPS = [
    { id: 'card-describe', title: '1. Describe What You Need', text: 'Type your request in plain language and click "Build Query". The engine understands intent, resolves it against the active schema, and fills in the sections below.' },
    { id: 'card-generated-sql', title: '2. Generated SQL', text: 'Validated, schema-aware SQL appears here, along with a plain-English explanation of tables, filters, and assumptions used.' },
    { id: 'mqc-table', title: '3a. Select Table', text: 'Fine-tune or build manually: search and tick one or more tables. The list scrolls independently so the page never stretches.' },
    { id: 'mqc-column', title: '3b. Select Column', text: 'Pick the columns you need. Columns with a governed CASE/DECODE definition show a DECODE badge — click the gear to manage it.' },
    { id: 'mqc-filters', title: '3c. Filters', text: 'Add one or more filter conditions, combine with AND/OR, then generate SQL from this manual configuration at any time.' },
    { id: 'tabbar', title: 'More tools', text: 'Switch tabs for the CR Query Builder, Error Rectifier, multi-schema management, and secure GitHub sync — all built on the same governed schema.' }
  ];
  var tourIndex = 0;
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function showTourStep(i) {
    clearTourHighlight();
    if (i < 0 || i >= TOUR_STEPS.length) { endTour(); return; }
    tourIndex = i;
    var step = TOUR_STEPS[i];
    var targetTab = document.querySelector('#tabbar button[data-tab="readonly"]');
    if (targetTab && !targetTab.classList.contains('active')) targetTab.click();
    var target = $(step.id);
    if (!target) { showTourStep(i + 1); return; }
    target.classList.add('tour-highlight');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('tourScrim').style.display = 'block';
    var tooltip = $('tourTooltip');
    tooltip.style.display = 'block';
    tooltip.innerHTML =
      '<div class="tt-title">' + esc(step.title) + '</div>' +
      '<div>' + esc(step.text) + '</div>' +
      '<div class="tt-actions">' +
      '<span class="tt-progress">' + (i + 1) + ' / ' + TOUR_STEPS.length + '</span>' +
      '<span>' +
      (i > 0 ? '<button class="btn secondary sm" id="tourPrev">Back</button> ' : '') +
      '<button class="btn secondary sm" id="tourSkip">Skip</button> ' +
      '<button class="btn sm" id="tourNext">' + (i === TOUR_STEPS.length - 1 ? 'Finish' : 'Next') + '</button>' +
      '</span></div>';
    setTimeout(function () { positionTooltip(target, tooltip); }, 60);
    var nextBtn = document.getElementById('tourNext'); if (nextBtn) nextBtn.addEventListener('click', function () { showTourStep(i + 1); });
    var prevBtn = document.getElementById('tourPrev'); if (prevBtn) prevBtn.addEventListener('click', function () { showTourStep(i - 1); });
    var skipBtn = document.getElementById('tourSkip'); if (skipBtn) skipBtn.addEventListener('click', endTour);
  }
  function positionTooltip(target, tooltip) {
    var rect = target.getBoundingClientRect();
    var tw = tooltip.offsetWidth || 320, th = tooltip.offsetHeight || 140;
    var vw = window.innerWidth, vh = window.innerHeight;
    var top = rect.bottom + 12;
    var left = rect.left;
    if (top + th > vh - 10) top = clamp(rect.top - th - 12, 10, vh - th - 10);
    left = clamp(left, 10, vw - tw - 10);
    top = clamp(top, 10, vh - th - 10);
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }
  function clearTourHighlight() { document.querySelectorAll('.tour-highlight').forEach(function (n) { n.classList.remove('tour-highlight'); }); }
  function endTour() { clearTourHighlight(); $('tourScrim').style.display = 'none'; $('tourTooltip').style.display = 'none'; }
  function initTour() {
    $('btnStartTour').addEventListener('click', function () { showTourStep(0); });
    $('tourScrim').addEventListener('click', endTour);
    window.addEventListener('resize', function () { if ($('tourTooltip').style.display === 'block') { var step = TOUR_STEPS[tourIndex]; var target = $(step && step.id); if (target) positionTooltip(target, $('tourTooltip')); } });
  }

  // =======================================================================
  // Boot
  // =======================================================================
  function boot() {
    bootstrapSchemaStoreIfEmpty();
    refreshEngine();
    initTabs();
    initReadOnlyBuilder();
    initCrBuilder();
    initRectifier();
    initSchemaTab();
    initSyncTab();
    initTour();
    $('globalDialect').addEventListener('change', function () { /* dialect applies at generation time */ });
    afterSchemaChange();
    renderSqlResult({ status: 'clarification_needed', message: 'Describe what you need above, or configure a query manually below.' });

    // Offer to load a live shared schema if one is published alongside this app.
    window.APSQL_SHARED_SCHEMA.fetchSharedSchema('schema/shared-schema.json').then(function (res) {
      if (res && res.found) {
        var already = schemaStore.listEntries().some(function (e) { return e.source === 'shared' && JSON.stringify(e.schema) === JSON.stringify(res.schema); });
        if (!already) {
          schemaStore.addEntry({ name: (res.schema.schema_name || 'Shared Schema') + ' (live)', schema: res.schema, source: 'shared' });
          refreshEngine(); afterSchemaChange();
        }
      }
    }).catch(function () { /* no shared schema published — silently ignore */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
