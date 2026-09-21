/* schema-sample.js — embedded default schema shipped with the app so it is usable out of
   the box. Replace via Schema > Update Schema at any time; this is only a starting point. */
(function (root) {
  'use strict';

  var schema = {
    schema_name: 'AP-SQL Assistant Embedded Schema',
    schema_version: '11.5',
    last_updated: '2026-09-21',
    source_documents: ['Embedded sample — replace via Schema > Update Schema'],
    module_labels: {
      IA: 'Invoice Automation', OM: 'Order Management', PP: 'Purchase Process',
      PE: 'Payment Execution', ADM: 'Administration'
    },
    tables: [
      {
        name: 'IA_INVOICE', module: 'IA', notes: 'Header-level invoice information', alias: 'INV',
        columns: [
          { name: 'INVOICE_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the invoice', decode: null },
          { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'IA_SUPPLIER', column: 'SUPPLIER_ID' }, alias: '', description: 'Supplier who issued this invoice', decode: null },
          { name: 'INVOICE_NUMBER', type: 'VARCHAR', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Supplier-provided invoice number', decode: null },
          { name: 'INVOICE_AMOUNT', type: 'DECIMAL', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Total invoice amount', decode: null },
          { name: 'INVOICE_DATE', type: 'DATE', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Date the invoice was issued', decode: null },
          { name: 'PROCESSED_DATE', type: 'DATE', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Date the invoice finished processing', decode: null },
          { name: 'PAYMENT_DATE', type: 'DATE', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Date the invoice was paid', decode: null },
          { name: 'STATUS', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Invoice processing status code',
            decode: { cases: [{ when: '1', then: 'Pending' }, { when: '2', then: 'Approved' }, { when: '3', then: 'Rejected' }, { when: '4', then: 'Paid' }], else_value: 'Unknown' } },
          { name: 'APPROVED_BY_USER_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'ADM_USER_DATA', column: 'USER_ID' }, alias: '', description: 'User who approved this invoice', decode: null },
          { name: 'WORKFLOW_STEP', type: 'VARCHAR', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Current step name in the approval workflow', decode: null },
          { name: 'PO_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'PP_PURCHASE_ORDER', column: 'PO_ID' }, alias: '', description: 'Linked purchase order, if any', decode: null }
        ]
      },
      {
        name: 'IA_SUPPLIER', module: 'IA', notes: 'Supplier master', alias: 'SUP',
        columns: [
          { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique supplier identifier', decode: null },
          { name: 'SUPPLIER_NAME', type: 'VARCHAR', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Supplier display name', decode: null },
          { name: 'IS_ACTIVE', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Whether the supplier is active',
            decode: { cases: [{ when: '1', then: 'Active' }, { when: '0', then: 'Inactive' }], else_value: 'Unknown' } },
          { name: 'COUNTRY', type: 'VARCHAR', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Supplier country', decode: null }
        ]
      },
      {
        name: 'PP_PURCHASE_ORDER', module: 'PP', notes: 'Purchase order header', alias: 'PO',
        columns: [
          { name: 'PO_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique purchase order identifier', decode: null },
          { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'IA_SUPPLIER', column: 'SUPPLIER_ID' }, alias: '', description: 'Supplier for this PO', decode: null },
          { name: 'PO_AMOUNT', type: 'DECIMAL', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Total PO amount', decode: null },
          { name: 'PO_DATE', type: 'DATE', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Date the PO was raised', decode: null }
        ]
      },
      {
        name: 'ADM_USER_DATA', module: 'ADM', notes: 'Application user accounts', alias: 'USR',
        columns: [
          { name: 'USER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique user identifier', decode: null },
          { name: 'LOGIN_ACCOUNT', type: 'VARCHAR', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Login username', decode: null },
          { name: 'EMAIL_ADDRESS', type: 'VARCHAR', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'User email address', decode: null },
          { name: 'LOGIN_TYPE', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Authentication method',
            decode: { cases: [{ when: '0', then: 'Forms' }, { when: '1', then: 'SSO' }], else_value: 'Unknown' } },
          { name: 'IS_ACTIVE', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Whether the user account is active',
            decode: { cases: [{ when: '1', then: 'Active' }, { when: '0', then: 'Inactive' }], else_value: 'Unknown' } },
          { name: 'MANAGER_USER_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'ADM_USER_DATA', column: 'USER_ID' }, alias: '', description: 'Manager of this user (self-referencing, for org hierarchy)', decode: null }
        ]
      },
      {
        name: 'ADM_USER_GROUP_MEMBER', module: 'ADM', notes: 'Maps users to permission groups', alias: 'UGM',
        columns: [
          { name: 'USER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: { table: 'ADM_USER_DATA', column: 'USER_ID' }, alias: '', description: 'Member user', decode: null },
          { name: 'GROUP_NAME', type: 'VARCHAR', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Permission group name', decode: null }
        ]
      }
    ]
  };

  var API = schema;
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SAMPLE_SCHEMA = API;
})(typeof window !== 'undefined' ? window : this);
