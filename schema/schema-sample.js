(function (root) {
  'use strict';
  var schema = {
    schema_name: 'AP-SQL Assistant Embedded Schema',
    schema_version: '7.1',
    last_updated: '2026-09-21',
    source_documents: ['Embedded sample — replace via Schema > Update Schema'],
    module_labels: { IA: 'Invoice Automation', OM: 'Order Management', PP: 'Purchase Process', PE: 'Payment Execution', ADM: 'Administration' },
    tables: [
      { name: 'IA_INVOICE', module: 'IA', notes: 'Header-level invoice information', columns: [
        { name: 'INVOICE_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the invoice', decode: null },
        { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'IA_SUPPLIER', column: 'SUPPLIER_ID' }, alias: '', description: 'Supplier who issued this invoice', decode: null },
        { name: 'COMPANY_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'ADM_COMPANY', column: 'COMPANY_ID' }, alias: '', description: 'Company / legal entity the invoice belongs to', decode: null },
        { name: 'INVOICE_NUMBER', type: 'VARCHAR(50)', nullable: false, primary_key: false, foreign_key: null, alias: 'InvoiceNumber', description: 'Supplier-provided invoice number', decode: null },
        { name: 'GROSS_SUM', type: 'NUMBER(19,2)', nullable: false, primary_key: false, foreign_key: null, alias: 'Amount', description: 'Total invoice amount including tax', decode: null },
        { name: 'CURRENCY_CODE', type: 'VARCHAR(3)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'ISO currency code', decode: null },
        { name: 'DUE_DATE', type: 'DATE', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Payment due date', decode: null },
        { name: 'STATUS', type: 'NUMBER(5)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Workflow status of the invoice', decode: [{ code: '0', label: 'Draft' }, { code: '10', label: 'Received' }, { code: '40', label: 'Approved' }, { code: '90', label: 'Transferred' }] },
        { name: 'CREATED_DATE', type: 'DATE', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Date the invoice was created / received in the system', decode: null }
      ] },
      { name: 'IA_INVOICE_LINE', module: 'IA', notes: 'Coding / accounting split lines for an invoice', columns: [
        { name: 'LINE_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the invoice line', decode: null },
        { name: 'INVOICE_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'IA_INVOICE', column: 'INVOICE_ID' }, alias: '', description: 'Parent invoice', decode: null },
        { name: 'ACCOUNT_CODE', type: 'VARCHAR(30)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'GL account code', decode: null },
        { name: 'COST_CENTER_CODE', type: 'VARCHAR(30)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Cost center code', decode: null },
        { name: 'NET_SUM', type: 'NUMBER(19,2)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Net amount for this coding line', decode: null }
      ] },
      { name: 'IA_SUPPLIER', module: 'IA', notes: 'Supplier master data', columns: [
        { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the supplier', decode: null },
        { name: 'SUPPLIER_NAME', type: 'VARCHAR(250)', nullable: false, primary_key: false, foreign_key: null, alias: 'Name', description: 'Name of the supplier company', decode: null },
        { name: 'SUPPLIER_CODE', type: 'VARCHAR(30)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Supplier reference code', decode: null },
        { name: 'IS_ACTIVE', type: 'NUMBER(1)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Whether the supplier is currently active', decode: [{ code: '0', label: 'No' }, { code: '1', label: 'Yes' }] },
        { name: 'PARENT_SUPPLIER_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'IA_SUPPLIER', column: 'SUPPLIER_ID' }, alias: '', description: 'Parent company in the supplier hierarchy', decode: null },
        { name: 'SUPPLIER_EMAIL', type: 'VARCHAR(150)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Supplier contact email address', decode: null }
      ] },
      { name: 'OM_ORDER', module: 'OM', notes: 'Purchase order header', columns: [
        { name: 'ORDER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the order', decode: null },
        { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'IA_SUPPLIER', column: 'SUPPLIER_ID' }, alias: '', description: 'Supplier for this order', decode: null },
        { name: 'ORDER_NUMBER', type: 'VARCHAR(50)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Order reference number', decode: null },
        { name: 'ORDER_STATUS', type: 'NUMBER(5)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Order workflow status', decode: [{ code: '0', label: 'Draft' }, { code: '20', label: 'Sent' }, { code: '50', label: 'Confirmed' }, { code: '80', label: 'Closed' }] }
      ] },
      { name: 'OM_ORDER_LINE', module: 'OM', notes: 'Order line items', columns: [
        { name: 'ORDER_LINE_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the order line', decode: null },
        { name: 'ORDER_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'OM_ORDER', column: 'ORDER_ID' }, alias: '', description: 'Parent order', decode: null },
        { name: 'ITEM_DESCRIPTION', type: 'VARCHAR(250)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Description of the ordered item', decode: null },
        { name: 'QUANTITY', type: 'NUMBER(12,2)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Ordered quantity', decode: null },
        { name: 'UNIT_PRICE', type: 'NUMBER(19,4)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Price per unit', decode: null }
      ] },
      { name: 'PP_PAYMENT_PLAN', module: 'PP', notes: 'Grouped payment plans for approved invoices', columns: [
        { name: 'PAYMENT_PLAN_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the payment plan', decode: null },
        { name: 'PAYMENT_PLAN_NUMBER', type: 'VARCHAR(50)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Payment plan reference number', decode: null },
        { name: 'STATUS', type: 'NUMBER(5)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Payment plan status', decode: [{ code: '0', label: 'Draft' }, { code: '30', label: 'Approved' }, { code: '70', label: 'Paid' }] },
        { name: 'TOTAL_AMOUNT', type: 'NUMBER(19,2)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Total amount of the payment plan', decode: null }
      ] },
      { name: 'PP_PAYMENT_PLAN_LINE', module: 'PP', notes: 'Invoices included in a payment plan', columns: [
        { name: 'PLAN_LINE_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the payment plan line', decode: null },
        { name: 'PAYMENT_PLAN_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'PP_PAYMENT_PLAN', column: 'PAYMENT_PLAN_ID' }, alias: '', description: 'Parent payment plan', decode: null },
        { name: 'INVOICE_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'IA_INVOICE', column: 'INVOICE_ID' }, alias: '', description: 'Invoice included in this plan', decode: null }
      ] },
      { name: 'PE_PAYMENT', module: 'PE', notes: 'Executed / transferred payments', columns: [
        { name: 'PAYMENT_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the payment', decode: null },
        { name: 'PAYMENT_PLAN_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'PP_PAYMENT_PLAN', column: 'PAYMENT_PLAN_ID' }, alias: '', description: 'Payment plan this payment was executed from', decode: null },
        { name: 'COMPANY_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'ADM_COMPANY', column: 'COMPANY_ID' }, alias: '', description: 'Company the payment was executed from', decode: null },
        { name: 'PAYMENT_REFERENCE', type: 'VARCHAR(50)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Bank / payment reference number', decode: null },
        { name: 'PAYMENT_METHOD', type: 'NUMBER(5)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Method used to execute the payment', decode: [{ code: '0', label: 'Bank Transfer' }, { code: '1', label: 'Cheque' }, { code: '2', label: 'Direct Debit' }] },
        { name: 'PAYMENT_STATUS', type: 'NUMBER(5)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Status of the executed payment', decode: [{ code: '0', label: 'Pending' }, { code: '20', label: 'Sent to Bank' }, { code: '60', label: 'Settled' }, { code: '90', label: 'Failed' }] },
        { name: 'EXECUTED_DATE', type: 'DATE', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Date the payment was executed', decode: null },
        { name: 'AMOUNT', type: 'NUMBER(19,2)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Amount transferred', decode: null }
      ] },
      { name: 'ADM_COMPANY', module: 'ADM', notes: 'Legal entities / companies configured in the system', columns: [
        { name: 'COMPANY_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the company / legal entity', decode: null },
        { name: 'COMPANY_NAME', type: 'VARCHAR(200)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Name of the company / legal entity', decode: null },
        { name: 'COUNTRY_CODE', type: 'VARCHAR(2)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'ISO country code of the company', decode: null },
        { name: 'IS_ACTIVE', type: 'NUMBER(1)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Whether the company is currently active', decode: [{ code: '0', label: 'No' }, { code: '1', label: 'Yes' }] }
      ] },
      { name: 'ADM_USER_DATA', module: 'ADM', notes: 'Application user accounts', columns: [
        { name: 'USER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the user', decode: null },
        { name: 'USER_NAME', type: 'VARCHAR(100)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Login name of the user', decode: null },
        { name: 'FULL_NAME', type: 'VARCHAR(200)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Full display name of the user', decode: null },
        { name: 'COMPANY_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'ADM_COMPANY', column: 'COMPANY_ID' }, alias: '', description: 'Home company of this user', decode: null },
        { name: 'SUPERVISOR_USER_ID', type: 'INTEGER', nullable: true, primary_key: false, foreign_key: { table: 'ADM_USER_DATA', column: 'USER_ID' }, alias: '', description: "This user's supervisor (self-referencing hierarchy)", decode: null },
        { name: 'IS_ACTIVE', type: 'NUMBER(1)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Whether the user account is active', decode: [{ code: '0', label: 'No' }, { code: '1', label: 'Yes' }] },
        { name: 'LOGIN_ALLOWED', type: 'NUMBER(1)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Whether this user is permitted to log in (login allowed)', decode: [{ code: '0', label: 'No' }, { code: '1', label: 'Yes' }] },
        { name: 'LOGIN_TYPE', type: 'NUMBER(5)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'How this user authenticates', decode: [{ code: '0', label: 'Forms' }, { code: '1', label: 'Windows Domain (deprecated)' }, { code: '2', label: 'Alusta Single-Sign-On' }, { code: '4', label: 'Basware Access' }, { code: '99', label: 'Inherited from home organization unit' }] }
      ] },
      { name: 'ADM_USER_GROUP', module: 'ADM', notes: 'Named groups users can belong to (e.g. Finance, IT, Sales)', columns: [
        { name: 'USER_GROUP_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for the user group', decode: null },
        { name: 'USER_GROUP_NAME', type: 'VARCHAR(100)', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Name of the user group (e.g. Finance, IT, Sales)', decode: null },
        { name: 'DESCRIPTION', type: 'VARCHAR(250)', nullable: true, primary_key: false, foreign_key: null, alias: '', description: 'Description of the user group', decode: null }
      ] },
      { name: 'ADM_USER_GROUP_MEMBER', module: 'ADM', notes: 'Links users to the user groups they belong to (many-to-many)', columns: [
        { name: 'MEMBER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique identifier for this group membership', decode: null },
        { name: 'USER_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'ADM_USER_DATA', column: 'USER_ID' }, alias: '', description: 'User who is a member of the group', decode: null },
        { name: 'USER_GROUP_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'ADM_USER_GROUP', column: 'USER_GROUP_ID' }, alias: '', description: 'User group this membership belongs to', decode: null }
      ] }
    ]
  };
  if (typeof module === 'object' && module.exports) module.exports = schema;
  if (typeof root !== 'undefined') root.__AP_SCHEMA__ = schema;
})(typeof window !== 'undefined' ? window : this);
