/**
 * tour-engine.js — AP-SQL Assistant V11.9
 * -----------------------------------------------------------------------
 * Guided Walkthrough — full redesign (detailed edition)
 *
 * DROP-IN REPLACEMENT for the inline "var TOURS = { ... }" block that
 * currently lives near the end of js/app.js (the last IIFE in the file,
 * immediately before js/password-manager-engine.js begins in the bundle).
 *
 * It reuses the EXACT SAME DOM elements already present in index.html:
 *   #tourOverlay, #tourSpotlight, #tourPopup, #tourStepLabel, #tourTitle,
 *   #tourBody, #tourDots, #tourPrev, #tourNext, #tourSkip, #tourBtn
 * so NO HTML/CSS changes are required for the walkthrough overlay itself
 * (its CSS already ships in css/styles.css).
 *
 * NOTHING ELSE in the application is touched: no engine logic, no schema
 * handling, no SQL generation, no security/password code, no GitHub sync,
 * no CSS, no layout. This file only adds a richer, page-by-page tour.
 *
 * ------------------------------------------------------------------------
 * WHAT'S NEW IN V11.9 vs the V11.8.1 walkthrough
 * ------------------------------------------------------------------------
 *  - Goes from a handful of static, single-page tips to 70+ granular
 *    steps covering every page and almost every control in the app:
 *    Navbar & Hamburger Menu, Quick Start, Read Only Query Builder
 *    (Describe What You Need, Generated SQL, Tables & Columns, Filters,
 *    Advanced Options incl. joins/sort/limit/HAVING/EXISTS/recursion,
 *    Selected/Described Requirements), Query Builder for CR (query type,
 *    CASE/DECODE, WHERE safeguard), Used Schema (AI Schema Assistant,
 *    Stored/Active/Default schemas), Update Schema (password, add/delete
 *    schema, Live Shared Schema, Cross-Device Sync, GitHub Sync, the
 *    encrypted Secure GitHub Connection Vault, Smart Schema Import,
 *    Danger Zone), Error Rectifier (error input, AI analysis, rectified
 *    SQL, explanation), and Theme.
 *  - "Step X of Y" counter + progress dots (uses the existing #tourDots
 *    element already styled in styles.css).
 *  - Context-aware start: launching the tour while already on a page
 *    (e.g. Update Schema) begins right there instead of forcing the user
 *    back to Quick Start.
 *  - Automatic cross-page navigation: if the next/previous step lives on
 *    a different page, the engine clicks the same nav link the app
 *    already uses (data-view="...") and waits for the view to become
 *    active before continuing.
 *  - Automatic scroll-into-view + viewport-safe tooltip clamping, so the
 *    popup can never render off-screen at any width (phones to desktop).
 *  - Keyboard support: Esc closes, ← / → go Back / Next.
 *  - Graceful degradation: if a step's target element is missing (e.g. an
 *    optional data-tour anchor was not added to index.html — see
 *    docs/DATA-TOUR-ANCHORS.md), the engine logs a console notice and
 *    silently skips to the next available step. The tour never gets stuck.
 *  - Restartable at any time by calling APSQL_TOUR.start() — wire this to
 *    the existing "Guided Walkthrough" navbar button (#tourBtn) and to a
 *    "Restart Guided Walkthrough" menu entry if you have one.
 *
 * See docs/INTEGRATION-GUIDE-V11.9.md for the two small edits needed in
 * app.js and index.html.
 * -----------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Step catalogue                                                   *
   * ------------------------------------------------------------------ *
   * Each step:
   *   view     : the data-view name the step's target lives on, or null
   *              for steps that are visible regardless of view (navbar).
   *   selector : CSS selector for the element to spotlight. The engine
   *              tries every selector in order and uses the first match,
   *              so a confirmed real ID can be listed first with a
   *              data-tour fallback second (see DATA-TOUR-ANCHORS.md).
   *   title    : short step heading.
   *   body     : plain-language explanation shown in the popup.
   *   place    : preferred popup placement relative to the target
   *              ('auto' | 'top' | 'bottom' | 'left' | 'right').
   * ------------------------------------------------------------------ */
  var STEPS = [
    // ---------------------------------------------------------------- //
    // 0. Welcome
    // ---------------------------------------------------------------- //
    { view: null, selector: ['.hero-brand-row', '.navbar-brand'], title: 'Welcome to AP-SQL Assistant',
      body: 'This short guided walkthrough will show you every major area of the app — the navbar, Quick Start, both Query Builders, Schema management, and the Error Rectifier. You can go Back, Next, Skip, or press Esc at any time.', place: 'bottom' },

    // ---------------------------------------------------------------- //
    // Navbar & Hamburger Menu
    // ---------------------------------------------------------------- //
    { view: null, selector: ['[data-tour="hamburger"]', '.navbar-toggler'], title: 'Hamburger Menu',
      body: 'Open this menu at any time to jump between Quick Start, the Query Builders, Schema pages, Error Rectifier, Theme, and About.', place: 'bottom' },
    { view: null, selector: ['.sync-schedule-row', '#syncScheduleSelect'], title: 'Schema Synchronization Schedule',
      body: 'Choose how often every stored schema automatically checks its source (Live Shared Schema, linked file, or GitHub) for updates. This applies app-wide.', place: 'bottom' },
    { view: null, selector: ['.ai-badge'], title: 'AI-Powered',
      body: 'Wherever you see this badge, an AI-assisted feature is available — natural-language query building, self-review, optimization, or error rectification. AI suggestions are always grounded in your active schema and are never applied without your review.', place: 'bottom' },
    { view: null, selector: ['#tourBtn'], title: 'Guided Walkthrough Button',
      body: 'You are using it right now! You can restart this walkthrough from here any time you want a refresher.', place: 'bottom' },
    { view: null, selector: ['.creator-signature-wrap'], title: 'Crafted By',
      body: 'A quick credit to the creator of AP-SQL Assistant.', place: 'top' },

    // ---------------------------------------------------------------- //
    // Quick Start
    // ---------------------------------------------------------------- //
    { view: 'quickstart', selector: ['#view-quickstart h2', '.builder-heading'], title: 'Quick Start — What This Tool Does',
      body: 'AP-SQL Assistant writes both read-only report SQL and Change Request (CR) SQL for you, using your organization\'s approved schema as the single source of truth. It never connects to or executes against a production database.', place: 'bottom' },
    { view: 'quickstart', selector: ['#qsModuleChips'], title: 'Areas Covered by the Active Schema',
      body: 'These chips summarize every module (e.g. Invoice Automation, Order Management, Purchase Process) available in whichever schema is currently Active.', place: 'bottom' },
    { view: 'quickstart', selector: ['#qsExampleGrid'], title: 'Try an Example',
      body: 'Click any example card to jump straight into the Read Only Query Builder with that requirement pre-filled — a great way to see the engine in action immediately.', place: 'top' },
    { view: 'quickstart', selector: ['[data-view="builder"]'], title: 'Read Only Query Builder',
      body: 'Describe what you need in plain language and click Build Query — tables, joins, filters, and aggregations are found automatically.', place: 'right' },
    { view: 'quickstart', selector: ['[data-view="cr"]'], title: 'Query Builder for CR',
      body: 'Describe the change you need (an INSERT, UPDATE, or DELETE) in plain language, or use the manual controls — every CR query still requires a WHERE safeguard.', place: 'right' },
    { view: 'quickstart', selector: ['[data-view="errorrectifier"]'], title: 'Error Rectifier',
      body: 'Paste a database error together with the SQL that caused it, and get an AI-analyzed, corrected query plus a plain-language explanation of what went wrong.', place: 'right' },
    { view: 'quickstart', selector: ['[data-view="usedschema"]'], title: 'Multiple Schemas (Since V10.7)',
      body: 'Store several schemas side by side and choose which ones are Active at any time — every builder and AI engine automatically uses the merged Active schema(s).', place: 'right' },

    // ---------------------------------------------------------------- //
    // Read Only Query Builder
    // ---------------------------------------------------------------- //
    { view: 'builder', selector: ['#promptInput'], title: 'Describe What You Need',
      body: 'Type your requirement in plain English. The AI-assisted engine identifies relevant tables, columns, joins, filters, and aggregations automatically — you can also combine this with the manual selectors below.', place: 'bottom' },
    { view: 'builder', selector: ['#dialectSel'], title: 'SQL Dialect',
      body: 'Choose Generic, Oracle, SQL Server, PostgreSQL, or MySQL — the generated SQL syntax adapts automatically (e.g. TOP vs LIMIT vs FETCH FIRST).', place: 'bottom' },
    { view: 'builder', selector: ['[data-view-action="build"]', '.btn:has(+ *)', '#buildQueryBtn'], title: 'Build Query / Start Over',
      body: 'Click Build Query to generate SQL from your description, manual selections, or both together. Start Over clears the current requirement so you can begin again.', place: 'top' },
    { view: 'builder', selector: ['#resultBody'], title: 'Generated SQL',
      body: 'Your validated, read-only SQL appears here, along with the tables used, columns used, filters applied, and any assumptions the engine made.', place: 'left' },
    { view: 'builder', selector: ['#copyBtn'], title: 'Copy Result',
      body: 'Copies the generated SQL to your clipboard in one click.', place: 'top' },
    { view: 'builder', selector: ['#optimizeBtn'], title: 'AI Optimize',
      body: 'Asks the AI engine to review the generated SQL for performance improvements and applies safe changes automatically, with a report of what changed.', place: 'top' },
    { view: 'builder', selector: ['#aiReviewBtn'], title: 'AI Self-Review',
      body: 'Runs an independent AI pass that checks schema correctness, relationship correctness, and whether the SQL logic matches your original request.', place: 'top' },
    { view: 'builder', selector: ['#manualTabs'], title: 'Manual Selectors',
      body: 'Three tabs let you fine-tune or fully manually build your query: Tables & Columns, Advanced Options, and Selected/Described Requirements.', place: 'bottom' },
    { view: 'builder', selector: ['#tableListGrid'], title: 'Select Tables',
      body: 'Browse or search every table in the active schema and tick the ones you need. Use Select All (filtered) or Clear Selection for speed.', place: 'right' },
    { view: 'builder', selector: ['#moduleFilterSel', '#tableSearchInput'], title: 'Filter & Search Tables',
      body: 'Narrow the table list by module, or search by table name/description.', place: 'bottom' },
    { view: 'builder', selector: ['#columnListBody'], title: 'Select Columns',
      body: 'Once a table is selected, tick the columns you want, optionally give each one a friendly alias, and search columns by name or description.', place: 'right' },
    { view: 'builder', selector: ['.col-decode', '[data-tour="decode-toggle"]'], title: 'CASE/DECODE Values',
      body: 'Turn on Decode for a column to translate coded values (e.g. status "40") into readable labels — schema-defined decodes are detected automatically, or you can add your own manually or let AI propose values from a plain-language description.', place: 'right' },
    { view: 'builder', selector: ['#readOnlyFilterGroup'], title: 'Filters',
      body: 'Add one or more filter conditions. Use "Is one of" / "Is not one of" with comma-separated values for SQL IN / NOT IN.', place: 'right' },
    { view: 'builder', selector: ['#readOnlyAddFilterBtn', '#readOnlyClearFiltersBtn'], title: 'Add / Clear Filters',
      body: 'Add Filter appends a new condition; Clear all removes every filter you\'ve added so far.', place: 'top' },
    { view: 'builder', selector: ['#joinOptionCard'], title: 'How Tables Are Connected',
      body: 'Choose whether only fully matching records should be shown (INNER JOIN) or unmatched records should also be included (LEFT JOIN). This appears once two or more tables are selected.', place: 'right' },
    { view: 'builder', selector: ['#joinPreviewBox'], title: 'Join Preview',
      body: 'See exactly how your selected tables will be connected. If a connection can\'t be found automatically, a "Define Relationship" panel lets you specify it manually, use it just for this query, or save it permanently to the schema.', place: 'right' },
    { view: 'builder', selector: ['#sortRowsContainer', '#addSortRowBtn'], title: 'Sort Order',
      body: 'Add one or more columns to control result ordering (smallest/earliest first, or largest/latest first).', place: 'right' },
    { view: 'builder', selector: ['#optLimit'], title: 'Limit Results',
      body: 'Cap the number of rows returned — translated automatically to TOP, LIMIT, or FETCH FIRST depending on your chosen dialect.', place: 'right' },
    { view: 'builder', selector: ['#optView'], title: 'Named Query (WITH)',
      body: 'Give this query a friendly name to wrap it as a WITH (CTE) block — handy when building on top of it later.', place: 'right' },
    { view: 'builder', selector: ['#existsRowsContainer', '#addExistsRowBtn'], title: 'Related-Table Checks (EXISTS)',
      body: 'Only show records that do — or, using the "Opposite" toggle, do not — have a match in another table, generating an EXISTS / NOT EXISTS subquery.', place: 'right' },
    { view: 'builder', selector: ['#scalarRowsContainer', '#addScalarRowBtn'], title: 'Related Counts',
      body: 'Add a correlated COUNT(*) subquery to show how many related records exist in another table.', place: 'right' },
    { view: 'builder', selector: ['#optHaving'], title: 'Filter on Totals (HAVING)',
      body: 'Filter on an aggregated value after grouping — generates a SQL HAVING clause.', place: 'right' },
    { view: 'builder', selector: ['#optHierarchy'], title: 'Org Chart / Hierarchy',
      body: 'Pick a self-referencing table (like a supervisor chain) to walk the entire hierarchy in one query using WITH RECURSIVE.', place: 'right' },
    { view: 'builder', selector: ['#requirementsSummaryBody'], title: 'Selected/Described Requirements',
      body: 'A plain-language summary of everything you\'ve described or selected — your natural-language prompt, tables, columns, filters, and advanced options — so you can sanity-check the full requirement before building.', place: 'left' },

    // ---------------------------------------------------------------- //
    // Query Builder for CR
    // ---------------------------------------------------------------- //
    { view: 'cr', selector: ['.cr-safety-banner'], title: 'Generated SQL Only',
      body: 'This application never executes database changes — it only drafts INSERT, UPDATE, or DELETE text for you to review and run through your own approved channels. AI assistance never bypasses the WHERE-condition safeguard.', place: 'bottom' },
    { view: 'cr', selector: ['.cr-command-selector', '[data-tour="cr-query-type"]'], title: 'Query Type',
      body: 'Choose INSERT, UPDATE, or DELETE — the rest of the builder adapts to match (e.g. Filters and the WHERE safeguard only apply to UPDATE/DELETE).', place: 'bottom' },
    { view: 'cr', selector: ['[data-tour="cr-describe"]', '.cr-query-type-card + textarea'], title: 'Describe the Change',
      body: 'Describe the change you need in plain language, or use the manual controls below — both can be combined.', place: 'bottom' },
    { view: 'cr', selector: ['[data-tour="cr-generated-sql"]'], title: 'Generated SQL (CR)',
      body: 'The drafted CR SQL appears here, with Copy Result and AI Optimize available just like the Read Only builder.', place: 'left' },
    { view: 'cr', selector: ['[data-tour="cr-select-table"]'], title: 'Select Table',
      body: 'CR queries operate on a single table at a time — pick it here.', place: 'right' },
    { view: 'cr', selector: ['[data-tour="cr-decode"]'], title: 'CASE/DECODE',
      body: 'Select a column to configure its decode, exactly like in the Read Only builder — useful when writing UPDATE values that map to coded statuses.', place: 'right' },
    { view: 'cr', selector: ['[data-tour="cr-select-columns"]'], title: 'Select Columns',
      body: 'Choose which columns this INSERT/UPDATE/DELETE statement should reference.', place: 'right' },
    { view: 'cr', selector: ['[data-tour="cr-where-safeguard"]'], title: 'Filters & WHERE Safeguard',
      body: 'A WHERE condition is required to identify which records should be updated or deleted. You may explicitly confirm no WHERE condition instead, but this is intentionally a deliberate, visible choice — never a default.', place: 'right' },

    // ---------------------------------------------------------------- //
    // Used Schema
    // ---------------------------------------------------------------- //
    { view: 'usedschema', selector: ['[data-tour="ai-schema-assistant"]', '.ai-assistant-box'], title: 'AI Schema Assistant',
      body: 'Ask about any table, column, or relationship — answers are grounded strictly in the active schema\'s own descriptions and structure, and every fact is labeled with where it came from (schema vs. AI narration).', place: 'bottom' },
    { view: 'usedschema', selector: ['#schemaStoreList'], title: 'Stored Schemas (Since V10.7)',
      body: 'Every schema stored in this browser. Tick which ones should be Active — this takes effect immediately, no password required, and the merged Active schema(s) are used consistently everywhere: SQL generation, both builders, AI engines, and the Error Rectifier.', place: 'right' },
    { view: 'usedschema', selector: ['#schemaSearchNoResults', '.schema-tree-module'], title: 'Schema Search',
      body: 'Search across every stored schema for a table or column by name.', place: 'right' },

    // ---------------------------------------------------------------- //
    // Update Schema
    // ---------------------------------------------------------------- //
    { view: 'updateschema', selector: ['#currentPasswordInput', '.password-change-box'], title: 'Password-Protected Section',
      body: 'Update Schema is a password-protected administrator action. It never connects to a production database, and AI recommendations are never saved to the schema without this password.', place: 'bottom' },
    { view: 'updateschema', selector: ['#targetSchemaSelect'], title: 'Working With',
      body: 'Choose which stored schema you\'re currently editing — updating one schema never affects any other stored schema.', place: 'bottom' },
    { view: 'updateschema', selector: ['#showAddSchemaFormBtn', '#deleteTargetSchemaBtn'], title: 'Manage Stored Schemas',
      body: 'Add a brand-new named schema, or delete the one you\'re currently working with (at least one schema must always remain).', place: 'bottom' },
    { view: 'updateschema', selector: ['#defaultSchemaChoices'], title: 'Select Default Schema (Since V11.1)',
      body: 'Exactly one schema is the Default at a time — it is always Active and is the target for Live Shared Schema, linked-file, and GitHub sync.', place: 'right' },
    { view: 'updateschema', selector: ['#activeSchemaChoices', '#saveActiveSchemaSelectionBtn'], title: 'Select Active Schemas (Since V11.1)',
      body: 'Choose any number of schemas to include (merged) in SQL generation. The Default schema is always included.', place: 'right' },
    { view: 'updateschema', selector: ['#syncScheduleCurrentNote'], title: 'Schema Synchronization Schedule',
      body: 'This reflects the schedule set in the navbar dropdown — it controls how often every stored schema checks its source for updates.', place: 'bottom' },
    { view: 'updateschema', selector: ['#schemaSyncStatusBody', '#schemaSyncActionsBody'], title: 'Live Shared Schema — Zero Setup',
      body: 'Makes the active schema available automatically on every device and browser by checking a well-known relative path on every page load. Click Check Now to verify immediately.', place: 'right' },
    { view: 'updateschema', selector: ['[data-tour="cross-device-sync"]', '.schema-sync-actions'], title: 'Cross-Device Schema Sync (Option A)',
      body: 'Link the schema you\'re working with to a single shared file — SharePoint, OneDrive, or a network drive. Requires a Chromium-based browser (File System Access API).', place: 'right' },
    { view: 'updateschema', selector: ['#githubOwnerInput', '.github-sync-form'], title: 'GitHub-Hosted Schema Sync (Option B)',
      body: 'Connect with your repository owner, name, branch, file path, and a fine-grained Personal Access Token (Contents: Read and write, scoped to one repo only). The token is stored only in this browser and sent only to api.github.com over HTTPS.', place: 'right' },
    { view: 'updateschema', selector: ['#vaultPassphraseInput', '#publishVaultBtn'], title: 'Secure GitHub Connection Vault (Since V10.7)',
      body: 'Encrypt the GitHub connection above (owner, repo, branch, path, token) with a passphrase using AES-256-GCM, and publish it as an encrypted vault file — any authorized user on any machine can unlock the exact same connection just by knowing the passphrase, without ever seeing the token.', place: 'right' },
    { view: 'updateschema', selector: ['#unlockVaultBtn', '#vaultUnlockPassphraseInput'], title: 'Fetch & Unlock Vault',
      body: 'On a new machine, fetch the published vault and unlock it with the shared passphrase — the GitHub connection fields are filled in automatically, ready to Connect & Sync Now.', place: 'right' },
    { view: 'updateschema', selector: ['[data-tour="download-schema"]', '.card:has(#currentSchemaJsonBtn)'], title: 'Download Current Schema',
      body: 'Export the current schema as JSON, CSV, DOCX, XLSX, or DOC for backup, review, or sharing.', place: 'right' },
    { view: 'updateschema', selector: ['[data-tour="schema-import"]'], title: 'Smart Schema Import Engine',
      body: 'Upload a file matching the expected structure (Module, Table Name, Column Name, Data Type, Decode, etc.) to preview and apply schema changes with a full diff before anything is saved.', place: 'right' },
    { view: 'updateschema', selector: ['#changePasswordBtn', '#forgotPasswordBtn'], title: 'Operational Password (Since V10.7)',
      body: 'Change the password required to unlock this Update Schema section in this browser, or reset it to the documented default if forgotten.', place: 'right' },
    { view: 'updateschema', selector: ['.danger-zone-card'], title: 'Danger Zone',
      body: 'Permanently remove every table, column, and relationship from the schema you\'re currently working with. A backup is downloaded automatically first, and this never affects any other stored schema.', place: 'top' },

    // ---------------------------------------------------------------- //
    // Error Rectifier
    // ---------------------------------------------------------------- //
    { view: 'errorrectifier', selector: ['[data-tour="er-input"]', '.sql-editor-textarea'], title: 'Original SQL & Error',
      body: 'Paste the database error message and the SQL statement that caused it. The SQL dialect is auto-detected from the error where possible.', place: 'bottom' },
    { view: 'errorrectifier', selector: ['[data-tour="er-rectify-btn"]'], title: 'Rectify SQL',
      body: 'Click to have the AI engine analyze the error against your active schema and propose a corrected query.', place: 'bottom' },
    { view: 'errorrectifier', selector: ['[data-tour="er-analysis"]'], title: 'AI Analysis',
      body: 'A brief, plain-language analysis of the likely cause of the error appears here.', place: 'right' },
    { view: 'errorrectifier', selector: ['[data-tour="er-rectified-sql"]', '.error-editor-textarea'], title: 'Rectified SQL',
      body: 'The corrected, schema-validated SQL — copy it with one click.', place: 'left' },
    { view: 'errorrectifier', selector: ['[data-tour="er-explanation"]'], title: 'Explanation',
      body: 'A clear explanation of exactly what was wrong and what was changed, so you learn from every correction.', place: 'left' },
    { view: 'errorrectifier', selector: ['.what-changed-box'], title: 'What Changed',
      body: 'A side-by-side, line-level view of every change made between your original SQL and the rectified version.', place: 'left' },

    // ---------------------------------------------------------------- //
    // Theme & About
    // ---------------------------------------------------------------- //
    { view: null, selector: ['[data-tour="theme-toggle"]', '#themeMenuToggle'], title: 'Theme',
      body: 'Choose System Default, Light, or Dark. Your choice is remembered in this browser and automatically follows your OS setting when set to System Default.', place: 'right' },
    { view: null, selector: ['[data-view="about"]'], title: 'About',
      body: 'Open About any time for a summary of the current version and what\'s new.', place: 'right' },
    { view: null, selector: ['.hero-brand-row', '.navbar-brand'], title: 'You\'re All Set!',
      body: 'That covers every major area of AP-SQL Assistant. Restart this walkthrough any time from the Guided Walkthrough button in the navbar. Happy querying!', place: 'bottom' }
  ];

  /* ------------------------------------------------------------------ *
   * 2. Small DOM helpers                                                *
   * ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  function qsFirst(selectors) {
    var list = Array.isArray(selectors) ? selectors : [selectors];
    for (var i = 0; i < list.length; i++) {
      try {
        var el = document.querySelector(list[i]);
        if (el && el.offsetParent !== null) return el;
      } catch (e) { /* invalid/unsupported selector (e.g. :has in old browsers) — skip */ }
    }
    // Second pass: accept hidden-but-present elements rather than skip entirely,
    // in case the step's own navigation hasn't rendered the view yet.
    for (var j = 0; j < list.length; j++) {
      try {
        var el2 = document.querySelector(list[j]);
        if (el2) return el2;
      } catch (e) {}
    }
    return null;
  }
  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* ------------------------------------------------------------------ *
   * 3. Cross-page navigation                                            *
   * ------------------------------------------------------------------ */
  function currentView() {
    var active = document.querySelector('.app-view.active');
    return active ? active.id.replace(/^view-/, '') : null;
  }
  function navigateToView(view, cb) {
    if (!view || currentView() === view) { cb(); return; }
    var link = document.querySelector('[data-view="' + view + '"]');
    if (link) {
      link.click();
      // Wait a tick for the view-swap + any render calls to complete.
      setTimeout(cb, 60);
    } else {
      cb(); // No nav link found (shouldn't happen) — proceed anyway.
    }
  }

  /* ------------------------------------------------------------------ *
   * 4. Tour state & rendering                                           *
   * ------------------------------------------------------------------ */
  var state = { index: 0, resolvedSteps: null, active: false };

  function buildResolvedSteps() {
    // Filter out steps whose target genuinely does not exist anywhere in
    // the DOM (e.g. an optional data-tour anchor was never added) so the
    // step counter and dots reflect only steps that can actually show.
    return STEPS.map(function (step, i) { return { step: step, origIndex: i }; })
      .filter(function (entry) {
        var el = qsFirst(entry.step.selector);
        return !!el;
      });
  }

  function clampToViewport(popup, targetRect, place) {
    var margin = 12;
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = popup.offsetWidth, ph = popup.offsetHeight;
    var top, left;
    var prefs = place === 'auto' ? ['bottom', 'top', 'right', 'left'] : [place, 'bottom', 'top', 'right', 'left'];
    var chosen = prefs[0];
    for (var i = 0; i < prefs.length; i++) {
      var p = prefs[i];
      if (p === 'bottom' && targetRect.bottom + ph + margin < vh) { chosen = p; break; }
      if (p === 'top' && targetRect.top - ph - margin > 0) { chosen = p; break; }
      if (p === 'right' && targetRect.right + pw + margin < vw) { chosen = p; break; }
      if (p === 'left' && targetRect.left - pw - margin > 0) { chosen = p; break; }
    }
    if (chosen === 'bottom') { top = targetRect.bottom + margin; left = targetRect.left; }
    else if (chosen === 'top') { top = targetRect.top - ph - margin; left = targetRect.left; }
    else if (chosen === 'right') { top = targetRect.top; left = targetRect.right + margin; }
    else { top = targetRect.top; left = targetRect.left - pw - margin; }
    // Clamp fully inside viewport.
    top = Math.max(margin, Math.min(top, vh - ph - margin));
    left = Math.max(margin, Math.min(left, vw - pw - margin));
    popup.style.top = (top + window.scrollY) + 'px';
    popup.style.left = (left + window.scrollX) + 'px';
  }

  function renderDots(resolved) {
    var dotsEl = $('tourDots');
    if (!dotsEl) return;
    dotsEl.innerHTML = '';
    resolved.forEach(function (entry, i) {
      var dot = document.createElement('i');
      if (i === state.index) dot.className = 'on';
      dotsEl.appendChild(dot);
    });
  }

  function renderStep() {
    var resolved = state.resolvedSteps;
    if (!resolved || !resolved.length) { closeTour(); return; }
    if (state.index < 0) state.index = 0;
    if (state.index >= resolved.length) { closeTour(); return; }

    var entry = resolved[state.index];
    var step = entry.step;

    navigateToView(step.view, function () {
      var target = qsFirst(step.selector);
      if (!target || !isVisible(target)) {
        // Target vanished/hidden at render time — skip forward gracefully.
        console.info('[AP-SQL Guided Walkthrough] Skipping step "' + step.title + '" — target not found or not visible.');
        var forward = state._dir !== 'back';
        state.index += forward ? 1 : -1;
        renderStep();
        return;
      }

      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });

      setTimeout(function () {
        var overlay = $('tourOverlay');
        var spotlight = $('tourSpotlight');
        var popup = $('tourPopup');
        var stepLabel = $('tourStepLabel');
        var titleEl = $('tourTitle');
        var bodyEl = $('tourBody');
        var prevBtn = $('tourPrev');
        var nextBtn = $('tourNext');

        if (!overlay || !spotlight || !popup) return;

        overlay.classList.add('show');
        var r = target.getBoundingClientRect();
        var pad = 6;
        spotlight.style.top = (r.top - pad + window.scrollY) + 'px';
        spotlight.style.left = (r.left - pad + window.scrollX) + 'px';
        spotlight.style.width = (r.width + pad * 2) + 'px';
        spotlight.style.height = (r.height + pad * 2) + 'px';

        if (stepLabel) stepLabel.textContent = 'Step ' + (state.index + 1) + ' of ' + resolved.length;
        if (titleEl) titleEl.textContent = step.title;
        if (bodyEl) bodyEl.textContent = step.body;
        if (prevBtn) prevBtn.disabled = state.index === 0;
        if (nextBtn) nextBtn.textContent = state.index === resolved.length - 1 ? 'Finish' : 'Next';

        renderDots(resolved);

        // Popup must be visible (but off-screen-positioned) to measure size.
        popup.style.visibility = 'hidden';
        popup.style.display = 'block';
        requestAnimationFrame(function () {
          clampToViewport(popup, r, step.place || 'auto');
          popup.style.visibility = 'visible';
        });
      }, 260); // allow the smooth scroll to settle before measuring
    });
  }

  function startingIndexForContextAwareLaunch(resolved) {
    var view = currentView();
    if (!view) return 0;
    for (var i = 0; i < resolved.length; i++) {
      if (resolved[i].step.view === view) return i;
    }
    return 0; // Fallback: view has no dedicated steps yet (e.g. already past it) — start from the top.
  }

  function openTour(fromContext) {
    state.resolvedSteps = buildResolvedSteps();
    if (!state.resolvedSteps.length) {
      console.warn('[AP-SQL Guided Walkthrough] No steps resolved — check that index.html contains the expected element IDs / data-tour anchors.');
      return;
    }
    state.index = fromContext ? startingIndexForContextAwareLaunch(state.resolvedSteps) : 0;
    state.active = true;
    renderStep();
  }

  function closeTour() {
    state.active = false;
    var overlay = $('tourOverlay');
    if (overlay) overlay.classList.remove('show');
  }

  function nextStep() {
    state._dir = 'forward';
    state.index += 1;
    renderStep();
  }
  function prevStep() {
    state._dir = 'back';
    state.index -= 1;
    if (state.index < 0) state.index = 0;
    renderStep();
  }

  /* ------------------------------------------------------------------ *
   * 5. Wiring: buttons + keyboard                                       *
   * ------------------------------------------------------------------ */
  function wireControls() {
    var startBtn = $('tourBtn');
    var nextBtn = $('tourNext');
    var prevBtn = $('tourPrev');
    var skipBtn = $('tourSkip');

    if (startBtn) startBtn.addEventListener('click', function () { openTour(true); });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      var resolved = state.resolvedSteps || [];
      if (state.index >= resolved.length - 1) closeTour(); else nextStep();
    });
    if (prevBtn) prevBtn.addEventListener('click', prevStep);
    if (skipBtn) skipBtn.addEventListener('click', closeTour);

    document.addEventListener('keydown', function (e) {
      if (!state.active) return;
      if (e.key === 'Escape') { closeTour(); }
      else if (e.key === 'ArrowRight') { var r = state.resolvedSteps || []; if (state.index >= r.length - 1) closeTour(); else nextStep(); }
      else if (e.key === 'ArrowLeft') { prevStep(); }
    });

    window.addEventListener('resize', function () { if (state.active) renderStep(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireControls);
  } else {
    wireControls();
  }

  /* ------------------------------------------------------------------ *
   * 6. Public API                                                       *
   * ------------------------------------------------------------------ */
  var API = {
    start: function () { openTour(false); },        // always from the very first step (e.g. "Restart Guided Walkthrough")
    startHere: function () { openTour(true); },     // context-aware — begins on the current page
    close: closeTour,
    STEP_COUNT: STEPS.length
  };
  if (typeof root !== 'undefined') root.APSQL_TOUR = API;
})(typeof window !== 'undefined' ? window : this);
