/* schema-tools.js — hashing, schema validation, sample generators, CSV helpers */
(function (root) {
  'use strict';

  // Default operational password (per V11.5 spec): P@assw0rd
  // Hash below is SHA-256("P@assw0rd") hex-encoded. Never store/display plaintext.
  var HARDCODED_PASSWORD_SHA256 = '38f5e4c36d78b20b31756f83a239388e84086a06de2835f82835685283815bd2'; // SHA-256("P@assw0rd")

  function bufToHex(buf) {
    var bytes = new Uint8Array(buf);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      if (h.length < 2) h = '0' + h;
      hex += h;
    }
    return hex;
  }

  function sha256Hex(str) {
    str = String(str == null ? '' : str);
    // Browser (Web Crypto)
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      var data = new TextEncoder().encode(str);
      return crypto.subtle.digest('SHA-256', data).then(bufToHex);
    }
    // Node.js fallback
    try {
      var nodeCrypto = require('crypto');
      var hash = nodeCrypto.createHash('sha256').update(str, 'utf8').digest('hex');
      return Promise.resolve(hash);
    } catch (e) {
      return Promise.reject(new Error('No SHA-256 implementation available in this environment.'));
    }
  }

  var DEFAULT_PASSWORD_PLAINTEXT = 'P@assw0rd';
  var _defaultHashCache = null;
  function ensureDefaultHash() {
    if (_defaultHashCache) return _defaultHashCache;
    _defaultHashCache = sha256Hex(DEFAULT_PASSWORD_PLAINTEXT);
    return _defaultHashCache;
  }

  // ---------------- Schema validation ----------------
  var VALID_TYPES = ['INTEGER', 'NUMBER', 'DECIMAL', 'FLOAT', 'VARCHAR', 'CHAR', 'TEXT', 'DATE', 'DATETIME', 'TIMESTAMP', 'BOOLEAN', 'CLOB', 'BLOB'];

  function validateSchema(tables) {
    var errors = [];
    var warnings = [];
    if (!Array.isArray(tables) || tables.length === 0) {
      return { valid: false, errors: ['Schema must contain at least one table.'], warnings: [] };
    }
    var tableNames = {};
    tables.forEach(function (t, ti) {
      if (!t || !t.name) { errors.push('Table at index ' + ti + ' is missing a name.'); return; }
      var upperName = String(t.name).toUpperCase();
      if (tableNames[upperName]) errors.push('Duplicate table name: ' + t.name);
      tableNames[upperName] = true;
      if (!Array.isArray(t.columns) || t.columns.length === 0) {
        errors.push('Table "' + t.name + '" has no columns.');
        return;
      }
      var colNames = {};
      var hasPk = false;
      t.columns.forEach(function (c, ci) {
        if (!c || !c.name) { errors.push('Table "' + t.name + '" column at index ' + ci + ' is missing a name.'); return; }
        var upperCol = String(c.name).toUpperCase();
        if (colNames[upperCol]) errors.push('Duplicate column "' + c.name + '" in table "' + t.name + '".');
        colNames[upperCol] = true;
        if (!c.type) warnings.push('Column "' + t.name + '.' + c.name + '" has no data type specified.');
        else if (VALID_TYPES.indexOf(String(c.type).toUpperCase()) === -1) warnings.push('Column "' + t.name + '.' + c.name + '" has an unrecognized type "' + c.type + '".');
        if (c.primary_key) hasPk = true;
        if (c.foreign_key && (!c.foreign_key.table || !c.foreign_key.column)) {
          errors.push('Column "' + t.name + '.' + c.name + '" has an incomplete foreign_key definition.');
        }
      });
      if (!hasPk) warnings.push('Table "' + t.name + '" has no primary key defined.');
    });
    // Validate FK targets exist
    tables.forEach(function (t) {
      (t.columns || []).forEach(function (c) {
        if (c && c.foreign_key) {
          var targetTable = tables.filter(function (tt) { return tt.name && String(tt.name).toUpperCase() === String(c.foreign_key.table).toUpperCase(); })[0];
          if (!targetTable) {
            errors.push('Column "' + t.name + '.' + c.name + '" references unknown table "' + c.foreign_key.table + '" in its foreign_key.');
          } else {
            var hasCol = (targetTable.columns || []).some(function (tc) { return tc.name && String(tc.name).toUpperCase() === String(c.foreign_key.column).toUpperCase(); });
            if (!hasCol) errors.push('Column "' + t.name + '.' + c.name + '" references unknown column "' + c.foreign_key.table + '.' + c.foreign_key.column + '" in its foreign_key.');
          }
        }
      });
    });
    return { valid: errors.length === 0, errors: errors, warnings: warnings };
  }

  // ---------------- Diff / preview ----------------
  function diffSchemas(current, next) {
    var cur = (current && current.tables) || [];
    var nxt = (next && next.tables) || [];
    var curMap = {}; cur.forEach(function (t) { curMap[String(t.name).toUpperCase()] = t; });
    var nxtMap = {}; nxt.forEach(function (t) { nxtMap[String(t.name).toUpperCase()] = t; });
    var added = [], removed = [], changed = [];
    Object.keys(nxtMap).forEach(function (k) { if (!curMap[k]) added.push(nxtMap[k].name); });
    Object.keys(curMap).forEach(function (k) { if (!nxtMap[k]) removed.push(curMap[k].name); });
    Object.keys(nxtMap).forEach(function (k) {
      if (curMap[k]) {
        var a = JSON.stringify(curMap[k].columns || []);
        var b = JSON.stringify(nxtMap[k].columns || []);
        if (a !== b) changed.push(nxtMap[k].name);
      }
    });
    return { added: added, removed: removed, changed: changed, hasChanges: (added.length + removed.length + changed.length) > 0 };
  }

  // ---------------- Sample format generators ----------------
  function sampleSchemaObject() {
    return {
      schema_name: 'Sample AP Schema',
      schema_version: '1.0',
      last_updated: new Date().toISOString().slice(0, 10),
      module_labels: { IA: 'Invoice Automation', PP: 'Purchase Process' },
      tables: [
        {
          name: 'IA_INVOICE', module: 'IA', notes: 'Header-level invoice information',
          columns: [
            { name: 'INVOICE_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: 'INV', description: 'Unique identifier for the invoice', decode: null },
            { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: false, primary_key: false, foreign_key: { table: 'IA_SUPPLIER', column: 'SUPPLIER_ID' }, alias: '', description: 'Supplier who issued this invoice', decode: null },
            { name: 'STATUS', type: 'VARCHAR', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Invoice processing status', decode: { cases: [{ when: '1', then: 'Pending' }, { when: '2', then: 'Approved' }], else_value: 'Unknown' } }
          ]
        },
        {
          name: 'IA_SUPPLIER', module: 'IA', notes: 'Supplier master',
          columns: [
            { name: 'SUPPLIER_ID', type: 'INTEGER', nullable: false, primary_key: true, foreign_key: null, alias: '', description: 'Unique supplier identifier', decode: null },
            { name: 'SUPPLIER_NAME', type: 'VARCHAR', nullable: false, primary_key: false, foreign_key: null, alias: '', description: 'Supplier display name', decode: null }
          ]
        }
      ]
    };
  }

  function sampleJson() { return JSON.stringify(sampleSchemaObject(), null, 2); }

  function tablesToCsvRows(tables) {
    var rows = [['table', 'module', 'column', 'type', 'nullable', 'primary_key', 'fk_table', 'fk_column', 'alias', 'description']];
    (tables || []).forEach(function (t) {
      (t.columns || []).forEach(function (c) {
        rows.push([
          t.name, t.module || '', c.name, c.type || '', c.nullable ? 'TRUE' : 'FALSE',
          c.primary_key ? 'TRUE' : 'FALSE', c.foreign_key ? c.foreign_key.table : '', c.foreign_key ? c.foreign_key.column : '',
          c.alias || '', (c.description || '').replace(/\n/g, ' ')
        ]);
      });
    });
    return rows;
  }

  function csvEscape(v) {
    v = String(v == null ? '' : v);
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function rowsToCsvString(rows) {
    return rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\r\n');
  }

  function sampleCsv() { return rowsToCsvString(tablesToCsvRows(sampleSchemaObject().tables)); }

  function parseCsvString(str) {
    // Minimal RFC4180-ish CSV parser
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    str = String(str || '').replace(/\r\n/g, '\n');
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (inQuotes) {
        if (ch === '"') {
          if (str[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r[0] && r[0] !== ''); });
  }

  function csvRowsToTables(rows) {
    if (!rows.length) return [];
    var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var idx = {};
    header.forEach(function (h, i) { idx[h] = i; });
    var tableMap = {};
    var order = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row[idx.table]) continue;
      var tname = row[idx.table];
      if (!tableMap[tname]) { tableMap[tname] = { name: tname, module: row[idx.module] || '', columns: [] }; order.push(tname); }
      var isTrue = function (v) { return String(v).trim().toUpperCase() === 'TRUE' || String(v).trim() === '1'; };
      var fkTable = idx.fk_table !== undefined ? row[idx.fk_table] : '';
      var fkCol = idx.fk_column !== undefined ? row[idx.fk_column] : '';
      tableMap[tname].columns.push({
        name: row[idx.column],
        type: idx.type !== undefined ? row[idx.type] : '',
        nullable: idx.nullable !== undefined ? isTrue(row[idx.nullable]) : true,
        primary_key: idx.primary_key !== undefined ? isTrue(row[idx.primary_key]) : false,
        foreign_key: (fkTable && fkCol) ? { table: fkTable, column: fkCol } : null,
        alias: idx.alias !== undefined ? (row[idx.alias] || '') : '',
        description: idx.description !== undefined ? (row[idx.description] || '') : '',
        decode: null
      });
    }
    return order.map(function (n) { return tableMap[n]; });
  }

  function parseCsvToSchema(str, meta) {
    var rows = parseCsvString(str);
    var tables = csvRowsToTables(rows);
    return {
      schema_name: (meta && meta.schema_name) || 'Imported Schema',
      schema_version: (meta && meta.schema_version) || '1.0',
      last_updated: new Date().toISOString().slice(0, 10),
      module_labels: (meta && meta.module_labels) || {},
      tables: tables
    };
  }

  var API = {
    HARDCODED_PASSWORD_SHA256: HARDCODED_PASSWORD_SHA256,
    DEFAULT_PASSWORD_PLAINTEXT: DEFAULT_PASSWORD_PLAINTEXT,
    ensureDefaultHash: ensureDefaultHash,
    sha256Hex: sha256Hex,
    validateSchema: validateSchema,
    diffSchemas: diffSchemas,
    sampleSchemaObject: sampleSchemaObject,
    sampleJson: sampleJson,
    sampleCsv: sampleCsv,
    tablesToCsvRows: tablesToCsvRows,
    rowsToCsvString: rowsToCsvString,
    csvEscape: csvEscape,
    parseCsvString: parseCsvString,
    csvRowsToTables: csvRowsToTables,
    parseCsvToSchema: parseCsvToSchema,
    VALID_TYPES: VALID_TYPES
  };

  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_TOOLS = API;
})(typeof window !== 'undefined' ? window : this);
