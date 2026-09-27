import type { SchemaModel } from '../types';
export const CORE_SCHEMA: SchemaModel = {
  id: 'schema-core-ap-p2p', name: 'AP / P2P Core', version: '1.0', status: 'active',
  updatedAt: new Date().toISOString(), lastSyncedAt: null,
  tables: [
    { name: 'PO_HEADER', module: 'Purchase Orders', description: 'One row per purchase order.',
      columns: [
        { name: 'PO_ID', label: 'PO ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
        { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' }, description: 'Vendor on the PO.' },
        { name: 'PO_DATE', label: 'PO Date', type: 'DATE', nullable: false, description: 'Date the PO was raised.' },
        { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'O', label: 'Open' }, { rawValue: 'C', label: 'Closed' }], description: 'PO lifecycle status.' },
        { name: 'TOTAL_AMOUNT', label: 'Total Amount', type: 'NUMBER', nullable: false, description: 'PO total value.' }
      ]},
    { name: 'VENDOR', module: 'Vendors', description: 'Supplier / vendor master data.',
      columns: [
        { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
        { name: 'VENDOR_NAME', label: 'Vendor Name', type: 'VARCHAR', length: 120, nullable: false, description: 'Legal or trading name.' },
        { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'A', label: 'Active' }, { rawValue: 'I', label: 'Inactive' }], description: 'Vendor account status.' }
      ]},
    { name: 'INVOICE_HEADER', module: 'Invoices', description: 'One row per supplier invoice.',
      columns: [
        { name: 'INVOICE_ID', label: 'Invoice ID', type: 'NUMBER', nullable: false, isPrimaryKey: true, description: 'Primary key.' },
        { name: 'VENDOR_ID', label: 'Vendor ID', type: 'NUMBER', nullable: false, isForeignKey: true, references: { table: 'VENDOR', column: 'VENDOR_ID' }, description: 'Vendor.' },
        { name: 'PO_ID', label: 'PO ID', type: 'NUMBER', nullable: true, isForeignKey: true, references: { table: 'PO_HEADER', column: 'PO_ID' }, description: 'Matched PO.' },
        { name: 'INVOICE_DATE', label: 'Invoice Date', type: 'DATE', nullable: false, description: 'Invoice date.' },
        { name: 'STATUS', label: 'Status', type: 'VARCHAR', length: 1, nullable: false, decode: [{ rawValue: 'P', label: 'Pending' }, { rawValue: 'A', label: 'Approved' }, { rawValue: 'D', label: 'Paid' }], description: 'Invoice status.' },
        { name: 'INVOICE_AMOUNT', label: 'Invoice Amount', type: 'NUMBER', nullable: false, description: 'Invoice value.' }
      ]}
  ],
  relationships: [
    { id: 'r1', fromTable: 'PO_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' },
    { id: 'r3', fromTable: 'INVOICE_HEADER', fromColumn: 'VENDOR_ID', toTable: 'VENDOR', toColumn: 'VENDOR_ID', kind: 'many-to-one' },
    { id: 'r4', fromTable: 'INVOICE_HEADER', fromColumn: 'PO_ID', toTable: 'PO_HEADER', toColumn: 'PO_ID', kind: 'many-to-one' }
  ]
};
export const EXTENDED_SCHEMA: SchemaModel = { ...CORE_SCHEMA, id: 'schema-extended-p2p', name: 'AP / P2P Extended', status: 'inactive' };
export const DEFAULT_SCHEMAS: SchemaModel[] = [CORE_SCHEMA, EXTENDED_SCHEMA];
export const DEFAULT_ACTIVE_SCHEMA_ID = CORE_SCHEMA.id;
