(function (root) {
  'use strict';
  // Default operational password for Update Schema / Admin Approval is "admin123" (documented
  // in README). This can be changed at any time via Update Schema > Operational Password.
  var HARDCODED_PASSWORD_SHA256 = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';
  function sha256Fallback(asciiOrBytes) {
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bytes;
    if (typeof asciiOrBytes === 'string') { var utf8 = unescape(encodeURIComponent(asciiOrBytes)); bytes = new Uint8Array(utf8.length); for (var i = 0; i < utf8.length; i++) bytes[i] = utf8.charCodeAt(i); }
    else bytes = asciiOrBytes;
    var bitLen = bytes.length * 8;
    var withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    withOne.set(bytes); withOne[bytes.length] = 0x80;
    var dv = new DataView(withOne.buffer);
    dv.setUint32(withOne.length - 4, bitLen >>> 0, false);
    dv.setUint32(withOne.length - 8, Math.floor(bitLen / 4294967296), false);
    var w = new Array(64);
    for (var chunk = 0; chunk < withOne.length; chunk += 64) {
      for (var t = 0; t < 16; t++) w[t] = dv.getUint32(chunk + t * 4, false);
      for (t = 16; t < 64; t++) { var s0 = rotr(w[t-15],7) ^ rotr(w[t-15],18) ^ (w[t-15] >>> 3); var s1 = rotr(w[t-2],17) ^ rotr(w[t-2],19) ^ (w[t-2] >>> 10); w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0; }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (t = 0; t < 64; t++) { var S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25); var ch = (e & f) ^ ((~e) & g); var temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0; var S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22); var maj = (a & b) ^ (a & c) ^ (b & c); var temp2 = (S0 + maj) >>> 0; h=g; g=f; f=e; e=(d+temp1)>>>0; d=c; c=b; b=a; a=(temp1+temp2)>>>0; }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0; H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    return H.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }
  function sha256Hex(text) {
    var hasSubtle = typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function';
    if (hasSubtle) { var enc = new TextEncoder().encode(text); return crypto.subtle.digest('SHA-256', enc).then(function (buf) { var arr = Array.from(new Uint8Array(buf)); return arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }).catch(function () { return sha256Fallback(text); }); }
    return Promise.resolve(sha256Fallback(text));
  }
  function verifyPassword(inputPassword) { return sha256Hex(String(inputPassword || '')).then(function (hash) { return hash === HARDCODED_PASSWORD_SHA256; }); }
  var SAMPLE_HEADER = ['Module', 'Table Name', 'Table Description', 'Column Name', 'Column Description', 'Data Type', 'Length', 'Precision', 'Nullable', 'Alias', 'Decode', 'Primary Key', 'Foreign Key', 'Relationship'];
  function normalizeHeader(label) { return String(label || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  var HEADER_ALIASES = { module: 'module', tablename: 'tableName', table: 'tableName', tabledescription: 'tableDescription', columnname: 'columnName', column: 'columnName', field: 'columnName', columndescription: 'columnDescription', description: 'columnDescription', datatype: 'dataType', type: 'dataType', length: 'length', precision: 'precision', nullable: 'nullable', alias: 'alias', decode: 'decode', primarykey: 'primaryKey', pk: 'primaryKey', foreignkey: 'foreignKey', fk: 'foreignKey', relationship: 'relationship' };
  function classifyHeaderRow(headerCells) { var map = {}; (headerCells || []).forEach(function (label, idx) { var norm = normalizeHeader(label); var mapped = HEADER_ALIASES[norm]; if (mapped && map[mapped] === undefined) map[mapped] = idx; }); return map; }
  function truthy(cellText) { var v = String(cellText || '').trim().toUpperCase(); return v === 'Y' || v === 'YES' || v === 'TRUE' || v === '1'; }
  function parseRelationshipText(text) { if (!text) return null; var m = String(text).match(/([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)/); if (m) return { table: m[1].toUpperCase(), column: m[2].toUpperCase() }; return null; }
  function parseDecodeText(text) { if (!text || !String(text).trim()) return null; var pairs = []; String(text).split(/[;,]/).forEach(function (segment) { var m = segment.trim().match(/^(.+?)\s*=\s*(.+)$/); if (m) pairs.push({ code: m[1].trim(), label: m[2].trim() }); }); return pairs.length ? pairs : null; }
  function buildTablesFromFlatRows(headerCells, dataRows) {
    var colMap = classifyHeaderRow(headerCells);
    if (colMap.columnName === undefined || colMap.tableName === undefined) return { error: 'The uploaded file is missing required schema information (Table Name / Column Name columns).' };
    var tablesByName = {}, order = [];
    dataRows.forEach(function (row) {
      if (!row || !row.length) return;
      var tableName = String(row[colMap.tableName] || '').trim().toUpperCase();
      var columnName = String(row[colMap.columnName] || '').trim().toUpperCase();
      if (!tableName || !columnName) return;
      if (!tablesByName[tableName]) { tablesByName[tableName] = { name: tableName, module: colMap.module !== undefined ? String(row[colMap.module] || 'OTHER').trim() : 'OTHER', notes: colMap.tableDescription !== undefined ? String(row[colMap.tableDescription] || '') : '', columns: [] }; order.push(tableName); }
      var fkText = colMap.foreignKey !== undefined ? row[colMap.foreignKey] : (colMap.relationship !== undefined ? row[colMap.relationship] : '');
      tablesByName[tableName].columns.push({ name: columnName, type: colMap.dataType !== undefined ? String(row[colMap.dataType] || 'Not specified') : 'Not specified', nullable: colMap.nullable !== undefined ? (String(row[colMap.nullable] || '').trim().toUpperCase() !== 'N') : true, primary_key: colMap.primaryKey !== undefined ? truthy(row[colMap.primaryKey]) : false, foreign_key: parseRelationshipText(fkText), alias: colMap.alias !== undefined ? String(row[colMap.alias] || '') : '', description: colMap.columnDescription !== undefined ? String(row[colMap.columnDescription] || '') : '', decode: colMap.decode !== undefined ? parseDecodeText(row[colMap.decode]) : null });
    });
    return { tables: order.map(function (n) { return tablesByName[n]; }) };
  }
  function parseCsvText(text) {
    var rows = [], row = [], field = '', inQuotes = false;
    var t = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (inQuotes) { if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += ch; }
      else if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r[0] || '').trim() !== ''; });
  }
  function csvToTables(text) { var rows = parseCsvText(text); if (rows.length < 2) throw new Error('The uploaded file could not be processed. Please check that it follows the expected schema structure.'); var result = buildTablesFromFlatRows(rows[0], rows.slice(1)); if (result.error) throw new Error(result.error); return result.tables; }
  function csvFileToTables(file) { return file.text().then(function (text) { return csvToTables(text); }); }
  function rowsToCsvBlob(rows) { var csv = rows.map(function (row) { return row.map(function (cell) { var s = String(cell == null ? '' : cell); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\r\n'); return new Blob([csv], { type: 'text/csv' }); }
  function normalizeJsonInput(parsed) { var tables = Array.isArray(parsed) ? parsed : parsed.tables; if (!Array.isArray(tables)) throw new Error('The uploaded file could not be processed. Please check that it follows the expected schema structure.'); return tables; }
  function jsonFileToTables(file) { return file.text().then(function (text) { var parsed; try { parsed = JSON.parse(text); } catch (e) { throw new Error('The uploaded file could not be processed. Please check that it follows the expected schema structure.'); } var tables = normalizeJsonInput(parsed); tables.forEach(function (t) { if (!t.name || !Array.isArray(t.columns)) throw new Error('A table name could not be identified in the uploaded file.'); t.columns.forEach(function (c) { if (!c.name) throw new Error('One or more columns could not be associated with a table.'); }); }); return tables; }); }
  var SUPPORTED_EXTENSIONS = ['.json', '.csv'];
  function detectFormat(filename) { var lower = String(filename || '').toLowerCase(); for (var i = 0; i < SUPPORTED_EXTENSIONS.length; i++) { if (lower.endsWith(SUPPORTED_EXTENSIONS[i])) return SUPPORTED_EXTENSIONS[i]; } return null; }
  function fileToTables(file) { var format = detectFormat(file.name); if (!format) return Promise.reject(new Error('Unsupported file format. Please upload a .json or .csv file.')); switch (format) { case '.json': return jsonFileToTables(file); case '.csv': return csvFileToTables(file); default: return Promise.reject(new Error('Unsupported file format.')); } }
  function buildSampleRows() {
    return [
      ['Invoice Automation', 'IA_INVOICE', 'Invoice information', 'INVOICE_ID', 'Unique identifier for the invoice', 'INTEGER', '', '', 'N', '', '', 'Y', '', ''],
      ['Invoice Automation', 'IA_INVOICE', 'Invoice information', 'SUPPLIER_ID', 'Identifier of the supplier who issued this invoice', 'INTEGER', '', '', 'Y', '', '', 'N', 'IA_SUPPLIER.SUPPLIER_ID', 'IA_SUPPLIER.SUPPLIER_ID'],
      ['Invoice Automation', 'IA_INVOICE', 'Invoice information', 'STATUS', 'Workflow status of the invoice', 'NUMBER', '5', '', 'N', '', '0=Draft;10=Received;40=Approved;90=Transferred', 'N', '', '']
    ];
  }
  function buildSampleCsvBlob() { return rowsToCsvBlob([SAMPLE_HEADER].concat(buildSampleRows())); }
  function buildSampleJsonBlob() { return new Blob([JSON.stringify({ schema_name: 'Sample Schema', schema_version: '1.0', tables: [] }, null, 2)], { type: 'application/json' }); }
  function splitTypeIntoLengthPrecision(typeStr) { var m = String(typeStr || '').match(/^([A-Za-z0-9_]+)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?\s*$/); if (!m) return { base: typeStr || 'Not specified', length: '', precision: '' }; return { base: m[1], length: m[2] || '', precision: m[3] || '' }; }
  function formatDecodeForExport(decode) { if (!decode || !Array.isArray(decode) || decode.length === 0) return ''; return decode.map(function (pair) { return pair.code + '=' + pair.label; }).join(';'); }
  function buildCurrentSchemaFlatRows(schema) {
    var moduleLabels = schema.module_labels || {}; var rows = [];
    schema.tables.forEach(function (t) { var moduleLabel = moduleLabels[t.module] || t.module || 'OTHER'; t.columns.forEach(function (c) { var typeParts = splitTypeIntoLengthPrecision(c.type); var fk = c.foreign_key ? (c.foreign_key.table + '.' + c.foreign_key.column) : ''; rows.push([moduleLabel, t.name, t.notes || '', c.name, c.description || '', typeParts.base, typeParts.length, typeParts.precision, c.nullable === false ? 'N' : 'Y', c.alias || '', formatDecodeForExport(c.decode), c.primary_key ? 'Y' : 'N', fk, fk]); }); });
    return { header: SAMPLE_HEADER.slice(), rows: rows };
  }
  function buildCurrentSchemaJsonBlob(schema) { return new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' }); }
  function buildCurrentSchemaCsvBlob(schema) { var f = buildCurrentSchemaFlatRows(schema); return rowsToCsvBlob([f.header].concat(f.rows)); }
  function validateSchema(candidateTables) {
    var errors = [];
    if (!Array.isArray(candidateTables)) return { valid: false, errors: ['The schema could not be activated because validation failed. (Expected an array of tables.)'] };
    var seenTables = {};
    candidateTables.forEach(function (t) {
      if (!t.name) { errors.push('A table with no name was found.'); return; }
      var upper = String(t.name).toUpperCase();
      if (seenTables[upper]) errors.push('Duplicate table name detected: ' + t.name);
      seenTables[upper] = true;
      if (!Array.isArray(t.columns) || !t.columns.length) { errors.push('Table "' + t.name + '" has no documented columns.'); return; }
      var seenCols = {};
      t.columns.forEach(function (c) { if (!c.name) { errors.push('Table "' + t.name + '" has a column with no name.'); return; } var cu = String(c.name).toUpperCase(); if (seenCols[cu]) errors.push('Duplicate column "' + c.name + '" in table "' + t.name + '".'); seenCols[cu] = true; });
    });
    return { valid: errors.length === 0, errors: errors };
  }
  function bumpVersion(versionStr) { var m = String(versionStr || '11.3').match(/^(\d+)\.(\d+)$/); if (!m) return '11.4'; return m[1] + '.' + (parseInt(m[2], 10) + 1); }
  function computeDiff(currentSchema, incomingTables) {
    var currentByName = {}; currentSchema.tables.forEach(function (t) { currentByName[t.name.toUpperCase()] = t; });
    var incomingByName = {}; incomingTables.forEach(function (t) { incomingByName[String(t.name).toUpperCase()] = t; });
    var addedTables = [], updatedTables = [], addedColumnCount = 0, updatedColumnCount = 0;
    Object.keys(incomingByName).forEach(function (name) {
      var incoming = incomingByName[name], existing = currentByName[name];
      if (!existing) { addedTables.push(name); addedColumnCount += incoming.columns.length; return; }
      var existingCols = {}; existing.columns.forEach(function (c) { existingCols[c.name.toUpperCase()] = true; });
      var newCols = incoming.columns.filter(function (c) { return !existingCols[String(c.name).toUpperCase()]; });
      if (newCols.length) { updatedTables.push({ name: name, addedColumns: newCols }); updatedColumnCount += newCols.length; }
    });
    return { currentTableCount: currentSchema.tables.length, currentColumnCount: currentSchema.tables.reduce(function (s, t) { return s + t.columns.length; }, 0), newVersion: bumpVersion(currentSchema.schema_version), newTableCount: Object.keys(currentByName).concat(Object.keys(incomingByName)).filter(function (v, i, a) { return a.indexOf(v) === i; }).length, addedTableCount: addedTables.length, addedColumnCount: addedColumnCount, updatedTableCount: updatedTables.length, updatedColumnCount: updatedColumnCount, addedTables: addedTables, updatedTables: updatedTables };
  }
  function mergeSchemas(baseSchema, incomingTables, incomingSourceLabel) {
    var byNameUpper = {}; baseSchema.tables.forEach(function (t) { byNameUpper[t.name.toUpperCase()] = t; });
    var addedTables = [], addedColumns = [];
    incomingTables.forEach(function (incoming) {
      var upper = String(incoming.name).toUpperCase(); var existing = byNameUpper[upper];
      if (!existing) { byNameUpper[upper] = incoming; addedTables.push(incoming.name); incoming.columns.forEach(function (c) { addedColumns.push(incoming.name + '.' + c.name); }); }
      else { var existingCols = {}; existing.columns.forEach(function (c) { existingCols[c.name.toUpperCase()] = true; }); incoming.columns.forEach(function (c) { if (!existingCols[String(c.name).toUpperCase()]) { existing.columns.push(c); addedColumns.push(existing.name + '.' + c.name); } }); }
    });
    var newSchema = { schema_name: baseSchema.schema_name, schema_version: bumpVersion(baseSchema.schema_version), last_updated: new Date().toISOString().slice(0, 10), source_documents: (baseSchema.source_documents || []).concat([incomingSourceLabel || 'Imported file']), module_labels: baseSchema.module_labels, tables: Object.keys(byNameUpper).map(function (k) { return byNameUpper[k]; }) };
    return { schema: newSchema, addedTables: addedTables, addedColumns: addedColumns };
  }
  function buildEmptySchema(baseSchema) { return { schema_name: baseSchema.schema_name, schema_version: '0.0', last_updated: new Date().toISOString().slice(0, 10), source_documents: (baseSchema.source_documents || []).concat(['Schema deleted by administrator on ' + new Date().toISOString().slice(0, 10)]), module_labels: baseSchema.module_labels, tables: [] }; }
  var API = { HARDCODED_PASSWORD_SHA256: HARDCODED_PASSWORD_SHA256, sha256Hex: sha256Hex, sha256Fallback: sha256Fallback, verifyPassword: verifyPassword, parseCsvText: parseCsvText, csvToTables: csvToTables, csvFileToTables: csvFileToTables, rowsToCsvBlob: rowsToCsvBlob, buildTablesFromFlatRows: buildTablesFromFlatRows, classifyHeaderRow: classifyHeaderRow, parseDecodeText: parseDecodeText, parseRelationshipText: parseRelationshipText, normalizeJsonInput: normalizeJsonInput, jsonFileToTables: jsonFileToTables, detectFormat: detectFormat, fileToTables: fileToTables, SUPPORTED_EXTENSIONS: SUPPORTED_EXTENSIONS, buildSampleRows: buildSampleRows, SAMPLE_HEADER: SAMPLE_HEADER, buildSampleJsonBlob: buildSampleJsonBlob, buildSampleCsvBlob: buildSampleCsvBlob, validateSchema: validateSchema, computeDiff: computeDiff, mergeSchemas: mergeSchemas, bumpVersion: bumpVersion, buildEmptySchema: buildEmptySchema, buildCurrentSchemaFlatRows: buildCurrentSchemaFlatRows, splitTypeIntoLengthPrecision: splitTypeIntoLengthPrecision, formatDecodeForExport: formatDecodeForExport, buildCurrentSchemaJsonBlob: buildCurrentSchemaJsonBlob, buildCurrentSchemaCsvBlob: buildCurrentSchemaCsvBlob };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_TOOLS = API;
})(typeof window !== 'undefined' ? window : this);
