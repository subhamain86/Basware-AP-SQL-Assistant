/**
 * schema-sample.js — AP-SQL Assistant
 * Embedded default schema shipped with the application, covering a small
 * Invoice Automation (AP/P2P) and Administration module set used across
 * Quick Start examples, tests, and the "Try an example" cards.
 */
(function (root) {
  'use strict';
  var schema = {
    schema_name: 'Default Schema',
    schema_version: '1.0',
    last_updated: '2026-01-01',
    source_documents: ['Embedded default schema'],
    module_labels: {
      IA: 'Invoice Automation',
      ADM: 'Administration',
      PE: 'Payments'
    },
    tables: [
      {
        name: 'IA_INVOICE',
        module: 'IA',
        notes: 'Holds one row per invoice processed through Invoice Automation, including its workflow status and total amount.',
        columns: [
          { name: 'INVOICE_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the invoice.', decode: null },
          { name: 'INVOICE_NUMBER', type: 'VARCHAR(50)', nullable: false, primary_key: false, foreign_key: null, alias: 'Invoice Number', description: 'The supplier-assigned invoice number.', decode: null },
          { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'IA_SUPPLIER', column: 'SUPPLIER_ID' }, alias: '', description: 'Identifier of the supplier who issued this invoice.', decode: null },
          { name: 'GROSS_SUM', type: 'NUMBER(19,2)', nullable: true, primary_key: false, foreign_key: null, alias: 'Amount', description: 'Total invoice amount including tax.', decode: null },
          { name: 'STATUS', type: 'NUMBER(5)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Workflow status of the invoice.', decode: [{ code: '0', label: 'Draft' }, { code: '10', label: 'Received' }, { code: '40', label: 'Approved' }, { code: '90', label: 'Transferred' }] },
          { name: 'CREATED_DATE', type: 'DATE', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Date the invoice was created in the system.', decode: null },
          { name: 'DUE_DATE', type: 'DATE', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Date the invoice payment is due.', decode: null }
        ]
      },
      {
        name: 'IA_SUPPLIER',
        module: 'IA',
        notes: 'Supplier master data used across invoices and change requests.',
        columns: [
          { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the supplier.', decode: null },
          { name: 'SUPPLIER_NAME', type: 'VARCHAR(250)', nullable: true, primary_key: false, foreign_key: null, alias: 'Name', description: 'Name of the supplier company.', decode: null },
          { name: 'SUPPLIER_CODE', type: 'VARCHAR(50)', nullable: true, primary_key: false, foreign_key: null, alias: 'Code', description: 'Internal supplier code, used for grouping (e.g. Gold/Silver tiers).', decode: null },
          { name: 'SUPPLIER_EMAIL', type: 'VARCHAR(250)', nullable: true, primary_key: false, foreign_key: null, alias: 'Email', description: 'Primary contact email address for the supplier.', decode: null },
          { name: 'IS_ACTIVE', type: 'NUMBER(1)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Whether this supplier is currently active.', decode: [{ code: '1', label: 'Active' }, { code: '0', label: 'Inactive' }] }
        ]
      },
      {
        name: 'ADM_USER_DATA',
        module: 'ADM',
        notes: 'Application user accounts, including login configuration and reporting hierarchy.',
        columns: [
          { name: 'USER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the user.', decode: null },
          { name: 'USER_NAME', type: 'VARCHAR(100)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Full name of the user.', decode: null },
          { name: 'EMAIL', type: 'VARCHAR(250)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Email address used for login and notifications.', decode: null },
          { name: 'LOGIN_TYPE', type: 'NUMBER(2)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Login mechanism used by this user.', decode: [{ code: '0', label: 'Forms' }, { code: '1', label: 'SSO' }] },
          { name: 'IS_LOGIN_ALLOWED', type: 'NUMBER(1)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Whether this user is currently allowed to log in.', decode: [{ code: '1', label: 'Allowed' }, { code: '0', label: 'Disallowed' }] },
          { name: 'USER_GROUP_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'ADM_USER_GROUP', column: 'USER_GROUP_ID' }, alias: '', description: 'The user group this user belongs to.', decode: null },
          { name: 'SUPERVISOR_USER_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'ADM_USER_DATA', column: 'USER_ID' }, alias: '', description: 'The direct supervisor of this user, used for the reporting hierarchy.', decode: null }
        ]
      },
      {
        name: 'ADM_USER_GROUP',
        module: 'ADM',
        notes: 'Named groups used to organize users and control feature access.',
        columns: [
          { name: 'USER_GROUP_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the user group.', decode: null },
          { name: 'GROUP_NAME', type: 'VARCHAR(100)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Display name of the user group.', decode: null }
        ]
      },
      {
        name: 'PE_PAYMENT',
        module: 'PE',
        notes: '',
        columns: [
          { name: 'PAYMENT_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the payment.', decode: null },
          { name: 'INVOICE_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'IA_INVOICE', column: 'INVOICE_ID' }, alias: '', description: 'The invoice this payment settles.', decode: null },
          { name: 'PAYMENT_AMOUNT', type: 'NUMBER(19,2)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Amount paid.', decode: null },
          { name: 'PAYMENT_DATE', type: 'DATE', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Date the payment was made.', decode: null }
        ]
      }
    ]
  };
  if (typeof module === 'object' && module.exports) module.exports = schema;
  if (typeof root !== 'undefined') root.__AP_SCHEMA__ = schema;
})(typeof window !== 'undefined' ? window : this);
