/* =========================================================================
   SQL Assistant — V16.0
   Baseline note: no V15.6/V15.7 build exists in the source enterprise
   store at package time; this build is based on the latest confirmed
   working baseline (V15.5) plus the V16.0 "Describe What You Need" +
   M365 Copilot Enterprise enhancement described in the V16.0 upgrade spec.
   Single-file, no build step, works over HTTP and via file://.
   ========================================================================= */
(function () {
  'use strict';

  /* ================== SCHEMA (Active Schema — source of truth) ========= */
  var CORE_SCHEMA = {
    id: 'schema-core-ap-p2p',
    name: 'AP / P2P Core',
    version: '1.0',
    status: 'active',
    updatedAt: new Date().toISOString(),
    lastSyncedAt: null,
    tables: [
      { name: 'ORGANIZATION', module: 'Master Data', description: 'Organizational units / companies.',
        columns: [
          { name: 'ORG_ID', label: 'Org ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'ORG_NAME', label: 'Organization Name', type: 'VARCHAR', length: 120, nullable: false, description: 'Legal entity / organization name.' },
          { name: 'COUNTRY', label: 'Country', type: 'VARCHAR', length: 2, nullable: true, description: 'ISO country code.' }
        ]},
      { name: 'VENDOR', module: 'Vendors', description: 'Supplier / vendor master data.',
        columns: [
          { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'VENDOR_NAME', label: 'Vendor Name', type: 'VARCHAR', length: 120, nullable: false, description: 'Legal or trading name / supplier name.' },
          { name: 'DUNS_NUMBER', label: 'DUNS Number', type: 'VARCHAR', length: 15, nullable: true, description: 'D-U-N-S identifier.' },
          { name: 'ORG_ID', label: 'Org ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'ORGANIZATION', column: 'ORG_ID' }, description: 'Owning organization.' },
          { name: 'COUNTRY', label: 'Country', type: 'VARCHAR', length: 2, nullable: true, description: 'Supplier country (ISO code).' },
          { name: 'IS_ACTIVE', label: 'Is Active', type: 'FLAG', nullable: false, description: 'Whether the vendor is currently active (1/0).' }
        ]},
      { name: 'PO_HEADER', module: 'Purchasing', description: 'Purchase order header.',
        columns: [
          { name: 'PO_ID', label: 'PO ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' }, description: 'Vendor / supplier this PO was raised against.' },
          { name: 'PO_DATE', label: 'PO Date', type: 'DATE', nullable: false, description: 'Date the purchase order was created.' },
          { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'O', label: 'Open' }, { rawValue: 'C', label: 'Closed' }, { rawValue: 'X', label: 'Cancelled' }], description: 'PO lifecycle status.' }
        ]},
      { name: 'PO_LINE', module: 'Purchasing', description: 'Purchase order line items.',
        columns: [
          { name: 'PO_LINE_ID', label: 'PO Line ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'PO_ID', label: 'PO ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'PO_HEADER', column: 'PO_ID' }, description: 'Parent purchase order.' },
          { name: 'QTY', label: 'Quantity', type: 'NUMBER', nullable: false, description: 'Ordered quantity.' },
          { name: 'UNIT_PRICE', label: 'Unit Price', type: 'NUMBER', nullable: false, description: 'Price per unit.' },
          { name: 'GL_ACCOUNT_ID', label: 'GL Account ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'GL_ACCOUNT', column: 'ACCOUNT_ID' }, description: 'Cost allocation account.' }
        ]},
      { name: 'INVOICE_HEADER', module: 'Invoices', description: 'One row per supplier invoice.',
        columns: [
          { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' }, description: 'Vendor who issued the invoice / supplier.' },
          { name: 'PO_ID', label: 'PO ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'PO_HEADER', column: 'PO_ID' }, description: 'Matched purchase order, if any.' },
          { name: 'INVOICE_DATE', label: 'Invoice Date', type: 'DATE', nullable: false, description: 'Date on the invoice document / created date.' },
          { name: 'DUE_DATE', label: 'Due Date', type: 'DATE', nullable: true, description: 'Date the invoice is due for payment.' },
          { name: 'POSTING_DATE', label: 'Posting Date', type: 'DATE', nullable: true, description: 'Date the invoice was posted to the ledger.' },
          { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'P', label: 'Pending' }, { rawValue: 'A', label: 'Approved' }, { rawValue: 'R', label: 'Rejected' }, { rawValue: 'D', label: 'Paid' }], description: 'Invoice lifecycle status.' },
          { name: 'INVOICE_AMOUNT', label: 'Invoice Amount', type: 'NUMBER', nullable: false, description: 'Invoice total value / amount.' },
          { name: 'CURRENCY', label: 'Currency', type: 'VARCHAR', length: 3, nullable: false, description: 'ISO currency code.' }
        ]},
      { name: 'INVOICE_LINE', module: 'Invoices', description: 'Line items belonging to a supplier invoice.',
        columns: [
          { name: 'LINE_ID', label: 'Line ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'INVOICE_HEADER', column: 'INVOICE_ID' }, description: 'Parent invoice.' },
          { name: 'LINE_NO', label: 'Line No', type: 'NUMBER', nullable: false, description: 'Sequence within the invoice.' },
          { name: 'DESCRIPTION', label: 'Description', type: 'VARCHAR', length: 240, nullable: true, description: 'Free-text line description.' },
          { name: 'AMOUNT', label: 'Amount', type: 'NUMBER', nullable: false, description: 'Line amount.' },
          { name: 'GL_ACCOUNT_ID', label: 'GL Account ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'GL_ACCOUNT', column: 'ACCOUNT_ID' }, description: 'Cost allocation account.' }
        ]},
      { name: 'GL_ACCOUNT', module: 'Finance', description: 'General ledger account master.',
        columns: [
          { name: 'ACCOUNT_ID', label: 'Account ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'ACCOUNT_CODE', label: 'Account Code', type: 'VARCHAR', length: 20, nullable: false, description: 'Chart-of-accounts code.' },
          { name: 'ACCOUNT_NAME', label: 'Account Name', type: 'VARCHAR', length: 120, nullable: false, description: 'Human-readable account / cost center name.' }
        ]},
      { name: 'APP_USER', module: 'Admin', description: 'Application / approver users.',
        columns: [
          { name: 'USER_ID', label: 'User ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'FULL_NAME', label: 'Full Name', type: 'VARCHAR', length: 120, nullable: false, description: 'User full name.' },
          { name: 'EMAIL', label: 'Email', type: 'VARCHAR', length: 160, nullable: true, description: 'User email address.' }
        ]},
      { name: 'APPROVAL_HISTORY', module: 'Invoices', description: 'Approval / rejection / escalation actions taken on invoices.',
        columns: [
          { name: 'APPROVAL_ID', label: 'Approval ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'INVOICE_HEADER', column: 'INVOICE_ID' }, description: 'Invoice being approved/rejected.' },
          { name: 'APPROVER_ID', label: 'Approver ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'APP_USER', column: 'USER_ID' }, description: 'User who approved or rejected the invoice.' },
          { name: 'APPROVAL_DATE', label: 'Approval Date', type: 'DATE', nullable: false, description: 'Date/time of the approval action.' },
          { name: 'ACTION', label: 'Action', type: 'VARCHAR', length: 3, nullable: false, decode: [{ rawValue: 'APP', label: 'Approved' }, { rawValue: 'REJ', label: 'Rejected' }, { rawValue: 'ESC', label: 'Escalated' }], description: 'Action taken by the approver.' }
        ]},
      { name: 'VW_OPEN_INVOICES', module: 'Invoices', description: 'Read-only view of currently open (not yet paid) invoices with their vendor.', objectType: 'VIEW',
        columns: [
          { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, description: 'Invoice identifier.' },
          { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, description: 'Vendor identifier.' },
          { name: 'INVOICE_AMOUNT', label: 'Invoice Amount', type: 'NUMBER', nullable: false, description: 'Invoice total value.' },
          { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, description: 'Invoice status (always non-Paid in this view).' }
        ]}
    ],
    relationships: [
      { id: 'r1', fromTable: 'PO_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' },
      { id: 'r2', fromTable: 'PO_LINE', fromColumn: 'PO_ID', toTable: 'PO_HEADER', toColumn: 'PO_ID', kind: 'many-to-one' },
      { id: 'r3', fromTable: 'INVOICE_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' },
      { id: 'r4', fromTable: 'INVOICE_HEADER', fromColumn: 'PO_ID', toTable: 'PO_HEADER', toColumn: 'PO_ID', kind: 'many-to-one' },
      { id: 'r5', fromTable: 'INVOICE_LINE', fromColumn: 'INVOICE_ID', toTable: 'INVOICE_HEADER', toColumn: 'INVOICE_ID', kind: 'many-to-one' },
      { id: 'r6', fromTable: 'APPROVAL_HISTORY', fromColumn: 'INVOICE_ID', toTable: 'INVOICE_HEADER', toColumn: 'INVOICE_ID', kind: 'many-to-one' },
      { id: 'r7', fromTable: 'APPROVAL_HISTORY', fromColumn: 'APPROVER_ID', toTable: 'APP_USER', toColumn: 'USER_ID', kind: 'many-to-one' },
      { id: 'r8', fromTable: 'VENDOR', fromColumn: 'ORG_ID', toTable: 'ORGANIZATION', toColumn: 'ORG_ID', kind: 'many-to-one' },
      { id: 'r9', fromTable: 'PO_LINE', fromColumn: 'GL_ACCOUNT_ID', toTable: 'GL_ACCOUNT', toColumn: 'ACCOUNT_ID', kind: 'many-to-one' },
      { id: 'r10', fromTable: 'INVOICE_LINE', fromColumn: 'GL_ACCOUNT_ID', toTable: 'GL_ACCOUNT', toColumn: 'ACCOUNT_ID', kind: 'many-to-one' }
    ]
  };

  var EXTENDED_SCHEMA = {
    id: 'schema-extended-p2p',
    name: 'AP / P2P Extended (with Contracts)',
    version: '1.0',
    status: 'inactive',
    updatedAt: new Date().toISOString(),
    lastSyncedAt: null,
    tables: CORE_SCHEMA.tables.concat([
      { name: 'CONTRACT', module: 'Contracts', description: 'Master service / supply contracts with vendors.',
        columns: [
          { name: 'CONTRACT_ID', label: 'Contract ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
          { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' }, description: 'Contracted vendor.' },
          { name: 'START_DATE', label: 'Start Date', type: 'DATE', nullable: false, description: 'Contract start date.' },
          { name: 'END_DATE', label: 'End Date', type: 'DATE', nullable: true, description: 'Contract end date.' },
          { name: 'CONTRACT_VALUE', label: 'Contract Value', type: 'NUMBER', nullable: false, description: 'Total contracted value.' },
          { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'A', label: 'Active' }, { rawValue: 'E', label: 'Expired' }, { rawValue: 'D', label: 'Draft' }], description: 'Contract status.' }
        ]}
    ]),
    relationships: CORE_SCHEMA.relationships.concat([
      { id: 'r11', fromTable: 'CONTRACT', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' }
    ])
  };

  var DEFAULT_ACTIVE_SCHEMA_ID = CORE_SCHEMA.id;

  /* ========================================================= UTILS ===== */
  var Utils = {};
  Utils.makeId = function (prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  };
  Utils.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  Utils.safeTrim = function (v) { return (v == null ? '' : String(v)).trim(); };
  Utils.quoteLiteral = function (v) { return "'" + String(v).replace(/'/g, "''") + "'"; };
  Utils.isNumeric = function (v) { return /^-?\d+(\.\d+)?$/.test(Utils.safeTrim(v)); };
  Utils.safeLocalStorageSet = function (k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  };
  Utils.safeLocalStorageGet = function (k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  };

  window.SQLA = window.SQLA || {};
  window.SQLA.CORE_SCHEMA = CORE_SCHEMA;
  window.SQLA.EXTENDED_SCHEMA = EXTENDED_SCHEMA;
  window.SQLA.DEFAULT_ACTIVE_SCHEMA_ID = DEFAULT_ACTIVE_SCHEMA_ID;
  window.SQLA.Utils = Utils;
})();
