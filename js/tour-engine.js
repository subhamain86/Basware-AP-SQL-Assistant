/**
 * tour-engine.js — AP-SQL Assistant V11.8.2
 * ---------------------------------------------------------------------------
 * Interactive, context-aware Guided Walkthrough engine.
 *
 * Uses the DOM elements already present in index.html (#tourOverlay,
 * #tourSpotlight, #tourPopup, #tourStepLabel, #tourTitle, #tourBody,
 * #tourDots, #tourPrev, #tourNext, #tourSkip) — no other HTML changes
 * are required for the walkthrough overlay itself.
 *
 * Features:
 *  - Step counter ("Step X of Y") + progress dots
 *  - Context-aware starting point (starts on the current page/view)
 *  - Automatic cross-page navigation (clicks the same nav links the app
 *    already uses, then waits a tick for the view to render)
 *  - Auto-scroll + viewport-clamped tooltip positioning
 *  - Keyboard controls (Esc / Left / Right)
 *  - Graceful skip when a step's target element isn't present
 *  - Restartable at any time via APSQL_TOUR.start()
 */
(function (root) {
  'use strict';

  var STEPS = [
    { view: null, selector: '.navbar .navbar-toggler', title: 'Menu', body: 'Open the hamburger menu at any time to jump between Quick Start, the Query Builders, Schema pages, the Error Rectifier, and Theme settings.' },
    { view: 'quickstart', selector: '#qsExampleGrid', title: 'Quick Start', body: 'Click any example card here to instantly load a working query into the Read Only Query Builder — a great way to see the engine in action.' },
    { view: 'quickstart', selector: '#qsModuleChips', title: 'Schema areas', body: 'These chips summarize every module and table currently covered by the active schema.' },
    { view: 'builder', selector: '#promptInput', title: 'Describe What You Need', body: 'Type your requirement in plain language — e.g. "Show all active suppliers" — and click Build Query. Works alone, alongside manual selections, or not at all.' },
    { view: 'builder', selector: '#resultBody', title: 'Generated SQL', body: 'Your validated, schema-grounded SQL appears here, along with the tables, columns, and filters that were used to build it.' },
    { view: 'builder', selector: '#tableListGrid', title: 'Select Tables', body: 'Manually tick any number of tables here. Use the module dropdown or search box to narrow a long list down quickly.' },
    { view: 'builder', selector: '#columnListBody', title: 'Select Columns', body: 'Pick a table above, then tick the columns you want in your result. Give any column a friendly alias, or turn on CASE/DECODE to translate coded values into labels.' },
    { view: 'builder', selector: '#readOnlyFilterGroup', title: 'Filters', body: 'Add one or more WHERE conditions here. "Is one of" / "Is not one of" accept a comma-separated list of values.' },
    { view: 'builder', selector: '#optimizeBtn', title: 'AI Optimize', body: 'Once a query is built, click Optimize for schema-grounded performance suggestions — like removing a redundant DISTINCT or flagging a missing WHERE clause.' },
    { view: 'builder', selector: '#aiReviewBtn', title: 'AI Self-Review', body: 'This runs an automatic, schema-grounded check confirming every table/column referenced genuinely exists and that the SQL matches your original request.' },
    { view: 'cr', selector: '#crQueryTypeGroup', title: 'Query Builder for CR', body: 'Choose INSERT, UPDATE, or DELETE. This builder only ever produces SQL text for review — it never executes anything against a real database.' },
    { view: 'cr', selector: '#crWhereSafeguard', title: 'WHERE safeguard', body: 'UPDATE and DELETE require an explicit WHERE condition by default, to prevent accidentally affecting every row. Tick the override only if you are certain.', dataTour: 'cr-where-safeguard' },
    { view: 'cr', selector: '#crDecodePanel', title: 'CASE/DECODE', body: 'Configure a coded column (e.g. STATUS) to translate stored codes into friendly labels directly in the generated SQL.', dataTour: 'cr-decode' },
    { view: 'usedschema', selector: '#schemaStoreList', title: 'Stored Schemas', body: 'AP-SQL Assistant can store multiple named schemas side-by-side. Exactly one is always the Default; any number of others can also be Active at the same time.' },
    { view: 'usedschema', selector: '#schemaAiAskBtn', title: 'AI Schema Assistant', body: 'Ask a plain-language question about any table or column — every answer is grounded strictly in the active schema\u2019s own documented descriptions.' },
    { view: 'updateschema', selector: '#smartImportBox', title: 'Update Schema', body: 'Password-protected administrator actions live here: import a new schema file, preview the detected changes, and apply the update.', dataTour: 'update-schema' },
    { view: 'errorrectifier', selector: '#errorRectifierForm', title: 'Error Rectifier', body: 'Paste a database error and the SQL that produced it — the engine identifies the likely cause and proposes a schema-aware correction.' },
    { view: null, selector: '[data-theme]', title: 'Theme', body: 'Switch between System Default, Light, and Dark at any time from the menu.', dataTour: 'theme-toggle' }
  ];

  var state = { active: false, index: 0, onNavigate: null };

  function $(id) { return document.getElementById(id); }
  function findTarget(step) {
    if (step.dataTour) {
      var byAttr = document.querySelector('[data-tour="' + step.dataTour + '"]');
      if (byAttr) return byAttr;
    }
    return step.selector ? document.querySelector(step.selector) : null;
  }

  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  function positionForTarget(el) {
    var overlay = $('tourOverlay');
    var spotlight = $('tourSpotlight');
    var popup = $('tourPopup');
    if (!el) { spotlight.style.display = 'none'; return; }
    var rect = el.getBoundingClientRect();
    spotlight.style.display = 'block';
    spotlight.style.left = (rect.left - 6) + 'px';
    spotlight.style.top = (rect.top - 6) + 'px';
    spotlight.style.width = (rect.width + 12) + 'px';
    spotlight.style.height = (rect.height + 12) + 'px';
    var popupWidth = popup.offsetWidth || 340;
    var popupHeight = popup.offsetHeight || 160;
    var left = rect.left;
    var top = rect.bottom + 14;
    if (top + popupHeight > window.innerHeight - 12) top = Math.max(12, rect.top - popupHeight - 14);
    left = clamp(left, 12, Math.max(12, window.innerWidth - popupWidth - 12));
    top = clamp(top, 12, Math.max(12, window.innerHeight - popupHeight - 12));
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  function renderDots(total, current) {
    var wrap = $('tourDots');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var dot = document.createElement('i');
      if (i === current) dot.className = 'on';
      wrap.appendChild(dot);
    }
  }

  function showStepAtIndex(idx, attemptsLeft) {
    attemptsLeft = attemptsLeft == null ? STEPS.length : attemptsLeft;
    if (idx < 0) idx = 0;
    if (idx >= STEPS.length) { stop(); return; }
    var step = STEPS[idx];
    if (step.view && state.onNavigate) state.onNavigate(step.view);
    setTimeout(function () {
      var el = findTarget(step);
      if (!el && attemptsLeft > 0) {
        // Missing target: skip gracefully to the next step instead of getting stuck.
        showStepAtIndex(idx + 1, attemptsLeft - 1);
        return;
      }
      state.index = idx;
      $('tourStepLabel').textContent = 'Step ' + (idx + 1) + ' of ' + STEPS.length;
      $('tourTitle').textContent = step.title;
      $('tourBody').textContent = step.body;
      renderDots(STEPS.length, idx);
      $('tourPrev').disabled = idx === 0;
      $('tourNext').textContent = (idx === STEPS.length - 1) ? 'Finish' : 'Next';
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(function () { positionForTarget(el); }, 220);
    }, step.view ? 60 : 0);
  }

  function start(onNavigate) {
    if (onNavigate) state.onNavigate = onNavigate;
    state.active = true;
    $('tourOverlay').classList.add('show');
    showStepAtIndex(0);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onResize);
  }
  function stop() {
    state.active = false;
    $('tourOverlay').classList.remove('show');
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onResize);
  }
  function next() { showStepAtIndex(state.index + 1); }
  function prev() { showStepAtIndex(state.index - 1); }
  function onKeydown(e) {
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  }
  function onResize() { if (state.active) positionForTarget(findTarget(STEPS[state.index])); }

  function wireButtons() {
    var nextBtn = $('tourNext'), prevBtn = $('tourPrev'), skipBtn = $('tourSkip');
    if (nextBtn) nextBtn.addEventListener('click', function () { if (state.index === STEPS.length - 1) stop(); else next(); });
    if (prevBtn) prevBtn.addEventListener('click', prev);
    if (skipBtn) skipBtn.addEventListener('click', stop);
    var overlay = $('tourOverlay');
    if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) stop(); });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireButtons);
    else wireButtons();
  }

  var API = { start: start, stop: stop, next: next, prev: prev, STEPS: STEPS };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_TOUR = API;
})(typeof window !== 'undefined' ? window : this);
