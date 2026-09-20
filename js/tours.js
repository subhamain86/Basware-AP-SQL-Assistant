/* ==========================================================================
   AP-SQL Assistant — Page-specific Guided Walkthrough content (V10.8)
   Each view registers its own short, plain-language tour with the
   walkthrough engine (js/walkthrough-engine.js). Every step follows the
   same simple structure: what it does, why it helps, what to do, and what
   happens next — so the tour stays consistent and easy to follow.
   ========================================================================== */
(function () {
  'use strict';
  if (!window.APSQL_TOUR) return;
  var T = window.APSQL_TOUR;

  T.registerTour('quickstart', [
    {
      selector: '#openMenuBtn', title: 'Welcome to AP-SQL Assistant',
      what: 'This is your Home page — a starting point that shows the schema areas available to you and a few ready-made examples.',
      why: 'It gives you a quick overview before you dive into building queries, so you know what data is available.',
      doThis: 'Click the menu button any time to jump to the Read Only Query Builder, Query Builder for CR, Error Rectifier, or Schema pages.',
      then: 'The side menu opens, letting you navigate to any page in the application.'
    },
    { selector: '#qsModuleChips', title: 'Areas covered by your schema',
      what: 'These chips list every module (business area) documented in the currently active schema, such as Invoice Automation or Order Management.',
      why: 'It tells you at a glance what kind of data you can query without opening the full schema browser.',
      doThis: 'Just review the list — no action is required here.',
      then: 'Nothing changes on screen; this is an at-a-glance summary only.' },
    { selector: '#qsExampleGrid', title: 'Try a ready-made example',
      what: 'Each card is a pre-written example request, from a simple filter to a full recursive hierarchy walk.',
      why: 'Examples are the fastest way to see how the Describe What You Need engine turns plain language into validated SQL.',
      doThis: 'Click any example card that looks interesting.',
      then: 'You will be taken to the Read Only Query Builder with that example already filled in and built.' }
  ]);

  T.registerTour('builder', [
    { selector: '#promptInput', title: 'Describe What You Need',
      what: 'A free-text box where you describe your requirement in plain language — e.g. "active suppliers with their email, sorted by name".',
      why: 'It saves you from having to know every table and column name up front; the schema-aware engine works it out for you.',
      doThis: 'Type your requirement, then press Ctrl+Enter or click Build Query.',
      then: 'The engine identifies the relevant tables, columns, filters, and sorting, and fills in the manual controls below automatically.' },
    { selector: '#dialectSel', title: 'SQL dialect',
      what: 'Chooses which database flavor the generated SQL should target (Oracle, SQL Server, PostgreSQL, MySQL, or Generic).',
      why: 'Different databases use slightly different syntax for things like row limits and data-type conversions.',
      doThis: 'Pick the dialect that matches your target database before building.',
      then: 'All subsequent SQL generated on this page will use the syntax rules for that dialect.' },
    { selector: '#pane-tables', title: 'Tables & Columns',
      what: 'Lets you manually pick which tables and columns to include, as an alternative or a complement to the description box above.',
      why: 'Gives you precise, direct control whenever you already know exactly what you need.',
      doThis: 'Tick the tables you need on the left, then choose a table from the dropdown to pick its columns.',
      then: 'Your selections combine with anything already identified from your description, ready for Build Query.' },
    { selector: '#pane-advanced', title: 'Advanced Options', doThis: 'Click this tab to see join behavior, sorting, limits, EXISTS/related-count filters, and hierarchy walks.',
      what: 'Groups every "extra" query capability — joins, sorting, limits, named views, related-record checks, and recursive hierarchy walks.',
      why: 'Keeps the main screen simple while still giving you full power when a query needs it.',
      then: 'Opens the Advanced Options panel where you can fine-tune exactly how the query is built.' },
    { selector: '#generateBtn', title: 'Build Query',
      what: 'Generates the final, validated SQL from everything selected or described above.',
      why: 'This is the single action that turns your requirements into ready-to-use SQL text.',
      doThis: 'Click it whenever you are ready to see the generated SQL.',
      then: 'The Generated SQL panel on the right updates immediately with your query, or with guidance if something needs to be fixed first.' },
    { selector: '#resultBody', title: 'Generated SQL',
      what: 'Shows the validated, ready-to-copy SQL text, along with the tables, columns, and filters that were used.',
      why: 'Lets you review exactly what will run before you take it to your database tooling.',
      doThis: 'Use Copy Result to copy the SQL, Optimize for performance suggestions, or Explain This Query for a plain-language summary.',
      then: 'The SQL is copied to your clipboard, or an additional report appears below the query.' }
  ]);

  T.registerTour('cr', [
    { selector: '#crDescriptionInput', title: 'Describe the change',
      what: 'A free-text box for describing an INSERT, UPDATE, or DELETE requirement in plain language.',
      why: 'Speeds up drafting Change Request SQL without needing to remember exact column names.',
      doThis: 'Describe the change, choose INSERT/UPDATE/DELETE, and click Build Query.',
      then: 'The relevant table, columns, values, and WHERE conditions are filled in automatically below.' },
    { selector: '#crCommandOptions', title: 'Query type',
      what: 'Selects whether you are drafting an INSERT, UPDATE, or DELETE statement.',
      why: 'Each type has different safeguards — for example, UPDATE and DELETE require a WHERE condition to protect against unintended changes.',
      doThis: 'Click the query type you need.',
      then: 'The Values & Filters panel updates to show the right fields for that command.' },
    { selector: '#crWherePanel', title: 'WHERE Conditions',
      what: 'Defines exactly which records an UPDATE or DELETE will target.',
      why: 'A missing WHERE condition on UPDATE/DELETE is one of the most common causes of accidental mass changes — this panel exists to prevent that.',
      doThis: 'Add at least one filter condition, or explicitly confirm that no WHERE condition is needed.',
      then: 'The Build Query action will be allowed to proceed once a condition (or explicit confirmation) is in place.' },
    { selector: '#crBuildBtn', title: 'Build Query',
      what: 'Generates the final Change Request SQL text.',
      why: 'This is a text generator only — it never executes anything against a real database.',
      doThis: 'Click it once your values and filters are ready.',
      then: 'The generated SQL appears on the right, ready to copy into your normal Change Request process.' }
  ]);

  T.registerTour('errorrectifier', [
    { selector: '#errErrorInput', title: 'Database Error',
      what: 'Paste the exact error message returned by your database.',
      why: 'The wording of the error is what the engine uses to identify the likely cause and dialect.',
      doThis: 'Paste the full error text here.',
      then: 'The dialect dropdown may be updated automatically based on wording it recognizes.' },
    { selector: '#errSqlInput', title: 'SQL That Caused It',
      what: 'The exact SQL statement that produced the error above.',
      why: 'The correction engine needs the original SQL to know what to adjust.',
      doThis: 'Paste the SQL statement here, then click Rectify SQL.',
      then: 'A corrected version of the SQL appears on the right, along with a plain-language explanation.' },
    { selector: '#errRectifiedSqlBody', title: 'Rectified SQL & Explanation',
      what: 'Shows the corrected SQL plus what was wrong and what was changed.',
      why: 'Understanding *why* something failed helps you avoid the same mistake next time.',
      doThis: 'Review the correction, then use Copy SQL or Copy Explanation as needed.',
      then: 'The corrected SQL or explanation text is copied to your clipboard.' }
  ]);

  T.registerTour('usedschema', [
    { selector: '#usedSchemaSummary', title: 'Schema summary',
      what: 'A quick summary of the active schema — its version, module count, table count, and last update date.',
      why: 'Confirms exactly which schema version every query on this device is currently built against.',
      doThis: 'Review the summary values.',
      then: 'Nothing changes on screen; this is a status view only.' },
    { selector: '#schemaStoreList', title: 'Stored Schemas',
      what: 'Lists every schema stored in this browser and lets you switch which one is active.',
      why: 'Useful when you work across multiple systems or environments that each have their own schema.',
      doThis: 'Click "Set Active" on any schema to switch to it.',
      then: 'All query builders immediately start using the newly selected schema.' },
    { selector: '#schemaSearchInput', title: 'Search the schema',
      what: 'A live search box across every table, column, and description in the active schema.',
      why: 'Much faster than scrolling through every module when you are looking for one specific field.',
      doThis: 'Type any table name, column name, or keyword.',
      then: 'The tree below filters to show only matching modules, tables, and columns, highlighted in place.' }
  ]);

  T.registerTour('updateschema', [
    { selector: '#updateSchemaPasswordStep', title: 'Administrator access',
      what: 'Update Schema is a password-protected administrator action that never connects to a production database.',
      why: 'Protects your organization\u2019s approved schema from accidental or unauthorized changes.',
      doThis: 'Enter the operational password and click Unlock.',
      then: 'The full schema-management area below becomes available for this browser session.' },
    { selector: '#targetSchemaSelect', title: 'Manage Stored Schemas',
      what: 'Lets you choose which stored schema you are currently editing, add a new one, or delete one.',
      why: 'Supports working with multiple schemas (e.g. per environment or per client) without mixing them up.',
      doThis: 'Pick a schema from the dropdown before importing or downloading.',
      then: 'All actions below (import, download, delete) apply to the schema selected here.' },
    { selector: '#updateSchemaFileInput', title: 'Smart Schema Import Engine',
      what: 'Reads a JSON or CSV file describing your database schema and merges it into the selected stored schema.',
      why: 'Lets you keep the schema up to date as your database evolves, without editing anything by hand.',
      doThis: 'Choose a file, click Process File, review the preview, then Apply Schema Update.',
      then: 'The new tables/columns are merged in, and a version-bumped schema becomes active immediately.' },
    { selector: '#githubSyncConfigForm', title: 'GitHub-Hosted Schema Sync',
      what: 'Connects this browser to a schema file hosted in a GitHub repository, so every device can share the same schema automatically.',
      why: 'Removes the need to manually re-import the schema on every machine.',
      doThis: 'Fill in the repository details and a Personal Access Token, then click Connect & Sync Now.',
      then: 'The active schema is synced with the GitHub-hosted file, and future changes push and pull automatically.' },
    { selector: '#vaultControls', title: 'Secure GitHub Connection Vault',
      what: 'Encrypts your GitHub connection details (including the access token) behind a passphrase, so they can be safely shared and reused on other machines.',
      why: 'Avoids sending or storing the raw Personal Access Token anywhere in plain text.',
      doThis: 'Enter a passphrase and click Encrypt & Publish Vault, or enter a passphrase and click Fetch & Unlock Vault on another machine.',
      then: 'The encrypted vault is published to (or read from) GitHub, and the connection fields are filled in automatically once unlocked.' }
  ]);
})();
