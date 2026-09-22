/**
 * tour-engine.js — AP-SQL Assistant V11.8.2
 * ---------------------------------------------------------------------------
 * Interactive, context-aware Guided Walkthrough engine.
 *
 * DROP-IN REPLACEMENT for the inline "TOURS / tour" block that currently
 * lives near the end of js/app.js. It reuses the EXACT SAME DOM elements
 * already present in index.html (#tourOverlay, #tourSpotlight, #tourPopup,
 * #tourStepLabel, #tourTitle, #tourBody, #tourDots, #tourPrev, #tourNext,
 * #tourSkip, #tourBtn) so NO HTML changes are required to those elements.
 *
 * See docs/INTEGRATION-GUIDE.md for the two small steps needed to wire
 * this file in (removing the old inline block from app.js + adding one
 * <script> tag).
 *
 * Design goals (per V11.8.2 spec):
 *  - Step-by-step, covers every major page + control listed in the spec.
 *  - Highlights the ACTUAL element being explained (never a generic popup).
 *  - Dims the rest of the UI while a step is active.
 *  - Next / Back / Skip / Exit controls, always reachable.
 *  - "Step X of Y" progress label + progress dots.
 *  - Automatically switches page/view when a step belongs elsewhere.
 *  - Automatically scrolls so the highlighted element is visible.
 *  - Never renders the tooltip outside the viewport.
 *  - Restartable at any time from the hamburger menu.
 *  - Works down to small mobile widths.
 *  - Context-aware starting point (see buildSequence() below).
 */
(function (root) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------------
  // 1. STEP CONTENT
  //    Every step targets a real, existing selector. Prefer real element
  //    IDs already used by app.js. Where no stable ID exists yet, target
  //    via a `[data-tour="..."]` attribute — see INTEGRATION-GUIDE.md for
  //    the short list of attributes to sprinkle into index.html.
  // ---------------------------------------------------------------------

  function step(sel, title, what, why, doText, next, place) {
    return {
      sel: sel,
      title: title,
      what: what, why: why, doText: doText, next: next,
      place: place || 'bottom'
    };
  }

  // Steps shown once, regardless of which page the tour started on.
  var GLOBAL_STEPS = [
    step('[data-tour="hamburger"]', 'Hamburger Menu',
      'Opens the main navigation drawer for the whole application.',
      'Every page — Quick Start, both Query Builders, Schema screens, and the Error Rectifier — is reachable from here, so it is your home base.',
      'Select it any time to jump to another section, change the theme, or restart this walkthrough.',
      'The menu will stay open only while you need it — selecting a link or the background closes it automatically.'),
    step('[data-tour="theme-toggle"]', 'Theme Settings',
      'Switches the interface between System Default, Light, and Dark.',
      'Pick whatever is easiest on your eyes — the choice is remembered for next time, in this browser.',
      'Select Light, Dark, or System Default from the Theme submenu.',
      'Every screen — including this walkthrough — respects your chosen theme immediately.')
  ];

  var PAGE_META = {
    quickstart: 'Quick Start',
    builder: 'Read Only Query Builder',
    crbuilder: 'Query Builder for CR',
    usedschema: 'Used Schema',
    updateschema: 'Update Schema',
    errorrectifier: 'Error Rectifier'
  };

  var PAGE_ORDER = ['quickstart', 'builder', 'crbuilder', 'usedschema', 'updateschema', 'errorrectifier'];

  var STEPS_BY_PAGE = {

    quickstart: [
      step('#qsExampleGrid', 'Try an Example',
        'A set of ready-made requests you can run with one selection.',
        'They are the fastest way to see the AI turn a plain-language request into working SQL.',
        'Select any card to jump into the Read Only Query Builder with that request already filled in.',
        'You will land on the Read Only Query Builder, where the same request box lives.'),
      step('#qsModuleChips', 'Areas Covered by the Active Schema',
        'Shows every business module (e.g. Invoice Automation, Order Management) available in your active schema.',
        'It is a quick way to confirm the right schema is loaded before you start building queries.',
        'Hover or select a chip to see how many tables belong to that module.',
        'Next, we will look at the Read Only Query Builder.')
    ],

    builder: [
      step('#promptInput', 'Describe What You Need',
        'A plain-English box where you describe the report you want.',
        'The AI reads this text and automatically works out which tables, columns, joins, and filters are needed — no SQL knowledge required.',
        'Type a request such as "show active suppliers with their email" and select Build Query.',
        'Your generated SQL will appear immediately to the right (or below, on mobile).'),
      step('#resultBody', 'Generated SQL',
        'Displays the validated SQL produced from your description and/or manual selections.',
        'Every table and column referenced here has already been checked against the active schema, so the query is safe to copy and run.',
        'Use Copy Result to copy it, AI Self-Review to have the AI double-check it, or Explain This Query for a plain-language breakdown.',
        'Next we will look at the Manual Selectors, for when you want more direct control.'),
      step('#manualTabs', 'Manual Selectors',
        'Three tabs that let you build (or fine-tune) a query by hand: Tables & Columns, Advanced Options, and Selected/Described Requirements.',
        'Useful when you want precise control instead of — or in addition to — describing your request in plain language.',
        'Select a tab below to explore Select Tables, Select Columns, Filters, and more.',
        'Let\u2019s look at Select Tables first.'),
      step('#tableListGrid', 'Select Tables',
        'Every table in the active schema, filterable by module or by search.',
        'This is where you manually choose which tables your query should pull from.',
        'Tick one or more tables, or use Select All (filtered) / Clear Selection.',
        'Once a table is selected, its columns become available in Select Columns.'),
      step('#columnListBody', 'Select Columns',
        'Lists every column on the table currently chosen in the dropdown above.',
        'Tick exactly the columns you need in your results, and optionally rename (alias) or decode them.',
        'Tick a column, optionally set an alias, and tick Decode to turn coded values into readable labels (e.g. 0 \u2192 Draft).',
        'Next: Filters, so you can narrow down which rows are returned.'),
      step('#readOnlyFilterGroup', 'Filters',
        'Conditions that narrow down which rows are included in the results.',
        'Without filters, a query returns every row in the selected table(s) — filters let you ask for exactly the records you need.',
        'Select Add Filter, then choose a column, an operator (equals, contains, between, is one of, etc.), and a value.',
        'Next, the Advanced Options tab covers joins, sorting, limits, and more.'),
      step('#manualTabs .nav-link[data-tab="advanced"]', 'Advanced Options',
        'Fine-tune joins, sorting, result limits, named views, related-table checks, related counts, HAVING conditions, and hierarchy walks.',
        'These options mirror advanced SQL features (JOIN type, ORDER BY, TOP/LIMIT, EXISTS, correlated COUNT, HAVING, recursive CTEs) without requiring you to write any SQL.',
        'Open this tab any time you need one of those specific behaviors.',
        'Finally, the Selected/Described Requirements tab summarizes everything before you build.'),
      step('#manualTabs .nav-link[data-tab="requirements"]', 'Selected/Described Requirements',
        'A live plain-language summary of your natural-language request, selected tables/columns, filters, and advanced options.',
        'It is the best place to sanity-check exactly what will be built before you select Build Query.',
        'Review the summary, then return to Describe What You Need or Build Query when ready.',
        'That covers the Read Only Query Builder — next, let\u2019s look at the CR (Change Request) Query Builder.')
    ],

    crbuilder: [
      step('#crCommandSelector', 'Query Type: INSERT / UPDATE / DELETE',
        'Chooses which kind of Change Request SQL you are drafting.',
        'INSERT, UPDATE, and DELETE each need different information, so this choice shapes the rest of the form.',
        'Select INSERT, UPDATE, or DELETE to begin.',
        'Note the safety banner: this application only ever generates SQL text — it never executes changes against a database.'),
      step('#crDescriptionInput', 'Describe What You Need (CR)',
        'Describe your change request in plain language, the same way as the Read Only builder.',
        'The AI can pre-fill the query type, table, columns/values, and WHERE conditions from your description.',
        'Type something like "update invoice status to Approved where invoice id is 500" and select Build Query.',
        'Always review the generated WHERE clause carefully before treating this as final.'),
      step('[data-tour="cr-where-safeguard"]', 'WHERE-Condition Safeguard',
        'A built-in guard that blocks UPDATE/DELETE queries with no WHERE condition, so you never accidentally affect every row.',
        'This is the single most important safety feature in the CR builder.',
        'Add at least one filter condition, or explicitly tick the override checkbox only if you are certain no WHERE condition is required.',
        'Next, CASE/DECODE lets you translate coded values for UPDATE statements too.'),
      step('[data-tour="cr-decode"]', 'CASE/DECODE',
        'Lets you map coded column values (e.g. STATUS = 40) to their readable labels (e.g. "Approved") directly inside the generated SQL.',
        'This keeps generated SQL self-documenting for anyone reviewing the Change Request later.',
        'Select a column, then define or reuse its code-to-label mapping.',
        'That\u2019s the CR Query Builder — next, let\u2019s look at how schemas are managed.')
    ],

    usedschema: [
      step('#usedSchemaSummary', 'Currently Active Schema',
        'A summary of the schema currently powering every query you build: its name, version, module/table/column counts, and last-updated date.',
        'Always worth a glance before building an important query, to confirm you are working against the right schema.',
        'Review the summary card.',
        'Below it, the AI Schema Assistant lets you ask questions about this schema directly.'),
      step('#schemaAssistantInput', 'AI Schema Assistant',
        'A plain-language question box for asking about any table, column, or relationship.',
        'Every answer is grounded strictly in your schema\u2019s own documented metadata — nothing is invented.',
        'Ask something like "What is IA_INVOICE used for?" or "How are IA_INVOICE and IA_SUPPLIER related?"',
        'Answers are tagged so you can tell schema-derived facts apart from AI interpretation.'),
      step('#schemaSearchInput', 'Browse the Schema Tree',
        'A searchable, expandable tree of every module, table, and column in the active schema.',
        'Useful for exploring what data is available without leaving this page.',
        'Type to search, or select a module/table to expand it.',
        'Next: how to store and manage multiple schemas, and how synchronization works.')
    ],

    updateschema: [
      step('#updateSchemaPasswordInput', 'Operational Password',
        'A password gate that protects every schema-changing action on this page.',
        'This keeps accidental or unauthorized schema edits from happening.',
        'Enter the operational password and select Unlock to proceed.',
        'Forgot it? Use "Forgot password? Reset to default" further down this page.'),
      step('#targetSchemaSelect', 'Stored Schemas',
        'A dropdown of every schema currently stored in this browser — you can add, update, or delete each one independently.',
        'Multiple schemas let different teams or environments keep their own definitions without interfering with each other.',
        'Choose which stored schema you are working with, or select "+ Add New Schema" to create another.',
        'Below, Default and Active Schema selection controls which schema(s) actually power query generation.'),
      step('#defaultSchemaChoices', 'Default Schema',
        'Exactly one schema is the Default at any time — it is always Active, and is the target for Live Shared Schema, linked-file, and GitHub sync.',
        'Having a single Default keeps synchronization behavior unambiguous.',
        'Select the radio button next to the schema that should be Default.',
        'The Default schema can be changed at any time without losing any other stored schema.'),
      step('#activeSchemaChoices', 'Active Schema',
        'Lets you choose any number of stored schemas to merge together for SQL generation, on top of the always-included Default.',
        'Useful when your queries need to span tables that live in more than one stored schema.',
        'Tick the schemas you want Active, then select Save Active Schema Selection.',
        'This takes effect immediately — no password required for this specific step.'),
      step('#syncScheduleSelect', 'Schema Synchronization Schedule',
        'Controls how often every configured schema automatically checks its source (Live Shared Schema, linked file, or GitHub) for updates.',
        'Keeps everyone\u2019s browser up to date with the latest approved schema without manual re-uploading.',
        'Choose a synchronization interval from the dropdown; it applies to every stored schema.',
        'That completes schema management — last stop: the AI Error Rectifier.')
    ],

    errorrectifier: [
      step('#errErrorInput', 'Paste the Database Error',
        'The exact error message your database returned.',
        'The AI uses this text to identify the dialect and the likely root cause.',
        'Paste the error message here.',
        'Next, paste the SQL statement that caused it.'),
      step('#errSqlInput', 'Paste the Original SQL',
        'The SQL statement that produced the error above.',
        'The AI cross-checks this SQL against your active schema to find the exact mismatch.',
        'Paste the SQL, then select AI Rectify SQL.',
        'The dialect is auto-detected from the error where possible, but you can override it.'),
      step('#errRectifiedSqlBody', 'Rectified SQL & Explanation',
        'The corrected query, together with a plain-language explanation of exactly what changed and why.',
        'This keeps every automatic correction fully transparent and reviewable before you use it.',
        'Review the "What Changed" section, then select Copy SQL once you are satisfied.',
        'Remember: this application only ever generates SQL for review — it never executes it.')
    ]
  };

  // ---------------------------------------------------------------------
  // 2. SEQUENCE BUILDING (context-aware)
  // ---------------------------------------------------------------------

  function buildSequence(startPage) {
    var seq = [];
    GLOBAL_STEPS.forEach(function (s) { seq.push(withPage(s, null)); });

    var isOverviewStart = !startPage || startPage === 'quickstart' || startPage === 'about';

    if (isOverviewStart) {
      PAGE_ORDER.forEach(function (p) {
        (STEPS_BY_PAGE[p] || []).forEach(function (s) { seq.push(withPage(s, p)); });
      });
    } else {
      (STEPS_BY_PAGE[startPage] || []).forEach(function (s) { seq.push(withPage(s, startPage)); });
      PAGE_ORDER.filter(function (p) { return p !== startPage; }).forEach(function (p) {
        (STEPS_BY_PAGE[p] || []).forEach(function (s) { seq.push(withPage(s, p)); });
      });
    }
    return seq;
  }

  function withPage(s, page) {
    var copy = {};
    Object.keys(s).forEach(function (k) { copy[k] = s[k]; });
    copy.page = page;
    return copy;
  }

  // ---------------------------------------------------------------------
  // 3. ENGINE (positioning, dimming, scrolling, navigation, controls)
  // ---------------------------------------------------------------------

  var sequence = [];
  var idx = 0;
  var open = false;
  var currentPageGetter = function () { return null; };
  var goToPageFn = function () {};

  function els() {
    return {
      overlay: $('tourOverlay'), spotlight: $('tourSpotlight'), popup: $('tourPopup'),
      stepLabel: $('tourStepLabel'), title: $('tourTitle'), body: $('tourBody'),
      dots: $('tourDots'), prev: $('tourPrev'), next: $('tourNext'), skip: $('tourSkip')
    };
  }

  function clampToViewport(top, left, w, h) {
    var vw = window.innerWidth, vh = window.innerHeight, margin = 12;
    return {
      top: Math.min(Math.max(margin, top), Math.max(margin, vh - h - margin)),
      left: Math.min(Math.max(margin, left), Math.max(margin, vw - w - margin))
    };
  }

  function renderBody(step) {
    var parts = [];
    if (step.what) parts.push('<p class="mb-1"><strong>What it does:</strong> ' + step.what + '</p>');
    if (step.why) parts.push('<p class="mb-1"><strong>Why it helps:</strong> ' + step.why + '</p>');
    if (step.doText) parts.push('<p class="mb-1"><strong>What to do:</strong> ' + step.doText + '</p>');
    if (step.next) parts.push('<p class="mb-0 text-body-secondary"><strong>What happens next:</strong> ' + step.next + '</p>');
    return parts.join('');
  }

  function positionCurrentStep(retriesLeft) {
    var e = els();
    if (!e.overlay) return;
    var st = sequence[idx];
    if (!st) { endTour(); return; }

    // Navigate to the right page first if needed.
    if (st.page && currentPageGetter() !== st.page) {
      goToPageFn(st.page);
      setTimeout(function () { positionCurrentStep(6); }, 220);
      return;
    }

    var target = document.querySelector(st.sel);
    if (!target) {
      // Element not present yet (e.g. schema locked, panel collapsed, or
      // the optional data-tour attribute was not added). Skip gracefully
      // instead of leaving the user stuck.
      if (retriesLeft && retriesLeft > 0) {
        setTimeout(function () { positionCurrentStep(retriesLeft - 1); }, 150);
        return;
      }
      if (idx < sequence.length - 1) { idx++; positionCurrentStep(6); return; }
      endTour();
      return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () {
      var r = target.getBoundingClientRect();
      var pad = 8;
      e.spotlight.style.top = (r.top - pad) + 'px';
      e.spotlight.style.left = (r.left - pad) + 'px';
      e.spotlight.style.width = (r.width + pad * 2) + 'px';
      e.spotlight.style.height = (r.height + pad * 2) + 'px';

      var popW = Math.min(e.popup.offsetWidth || 360, window.innerWidth - 24);
      var popH = Math.min(e.popup.offsetHeight || 240, window.innerHeight - 24);
      var vh = window.innerHeight;
      var place = st.place || 'bottom';
      if (place === 'bottom' && r.bottom + popH + 20 > vh) place = 'top';
      if (place === 'top' && r.top - popH - 20 < 0) place = 'bottom';

      var rawTop, rawLeft;
      if (place === 'bottom') { rawTop = r.bottom + 14; rawLeft = r.left; }
      else if (place === 'top') { rawTop = r.top - popH - 14; rawLeft = r.left; }
      else if (place === 'left') { rawLeft = r.left - popW - 14; rawTop = r.top; }
      else { rawLeft = r.right + 14; rawTop = r.top; }

      var clamped = clampToViewport(rawTop, rawLeft, popW, popH);
      e.popup.style.top = clamped.top + 'px';
      e.popup.style.left = clamped.left + 'px';

      e.stepLabel.textContent = 'Step ' + (idx + 1) + ' of ' + sequence.length +
        (st.page ? (' \u2014 ' + (PAGE_META[st.page] || st.page)) : '');
      e.title.textContent = st.title;
      e.body.innerHTML = renderBody(st);
      e.dots.innerHTML = sequence.map(function (_, i) {
        return '<i class="' + (i === idx ? 'on' : '') + '"></i>';
      }).join('');
      e.prev.disabled = idx === 0;
      e.next.textContent = idx === sequence.length - 1 ? 'Done' : 'Next';
      e.prev.setAttribute('aria-label', 'Previous step');
      e.next.setAttribute('aria-label', idx === sequence.length - 1 ? 'Finish walkthrough' : 'Next step');
    }, 260);
  }

  function startTour(startPage) {
    sequence = buildSequence(startPage);
    idx = 0;
    open = true;
    var e = els();
    if (!e.overlay) return;
    e.overlay.classList.add('show');
    e.overlay.setAttribute('role', 'dialog');
    e.overlay.setAttribute('aria-modal', 'true');
    positionCurrentStep(6);
  }

  function endTour() {
    open = false;
    var e = els();
    if (e.overlay) e.overlay.classList.remove('show');
  }

  function nextStep() {
    if (idx < sequence.length - 1) { idx++; positionCurrentStep(6); }
    else endTour();
  }
  function prevStep() {
    if (idx > 0) { idx--; positionCurrentStep(6); }
  }

  function wire() {
    var e = els();
    if (!e.overlay) return; // markup not present on this page/build
    if (e.next) e.next.addEventListener('click', nextStep);
    if (e.prev) e.prev.addEventListener('click', prevStep);
    if (e.skip) e.skip.addEventListener('click', endTour);
    e.overlay.addEventListener('click', function (ev) { if (ev.target === e.overlay) endTour(); });
    document.addEventListener('keydown', function (ev) {
      if (!open) return;
      if (ev.key === 'Escape') endTour();
      else if (ev.key === 'ArrowRight') nextStep();
      else if (ev.key === 'ArrowLeft') prevStep();
    });
    window.addEventListener('resize', function () { if (open) positionCurrentStep(0); });

    var startBtn = $('tourBtn');
    if (startBtn) startBtn.addEventListener('click', function () { startTour(currentPageGetter()); });

    document.querySelectorAll('[data-tour-trigger]').forEach(function (b) {
      b.addEventListener('click', function () { startTour(currentPageGetter()); });
    });
  }

  /**
   * init(config)
   *   config.getCurrentPage(): () => string   — must return the current
   *     view key ('quickstart' | 'builder' | 'crbuilder' | 'usedschema' |
   *     'updateschema' | 'errorrectifier'), matching the ids already used
   *     by app.js's own showView()/currentView.
   *   config.goToPage(pageKey): (pageKey) => void — must switch the app to
   *     that view. Simplest safe implementation:
   *       function (pageKey) {
   *         var link = document.querySelector('[data-view="' + pageKey + '"]');
   *         if (link) link.click();
   *       }
   *     This reuses the exact same click handling app.js already wires up
   *     to its nav links, so no internal app.js functions need to be
   *     exposed or modified.
   */
  function init(config) {
    config = config || {};
    if (typeof config.getCurrentPage === 'function') currentPageGetter = config.getCurrentPage;
    if (typeof config.goToPage === 'function') goToPageFn = config.goToPage;
    wire();
  }

  var API = { init: init, start: startTour, end: endTour, next: nextStep, prev: prevStep };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_TOUR = API;
})(typeof window !== 'undefined' ? window : this);
