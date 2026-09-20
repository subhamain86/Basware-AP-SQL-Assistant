(function (root) {
  'use strict';
  // NOTE (V11.3.1): All password/credential hashing logic has been moved to the
  // dedicated password-auth-engine.js + password-manager-engine.js modules, so
  // there is exactly ONE password-validation mechanism used everywhere in the
  // application. This file only contains generic, non-password schema/file
  // utilities (CSV/JSON parsing, ZIP building, document export, schema diffing).
  var CRC_TABLE = (function () { var table = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0; } return table; })();
  function crc32(bytes) { var crc = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; }
  function writeZip(fileEntries) {
    var localParts = [], centralParts = []; var offset = 0;
    fileEntries.forEach(function (e) {
      var nameBuf = new TextEncoder().encode(e.name); var data = e.data; var crc = crc32(data);
      var lfh = new Uint8Array(30 + nameBuf.length); var lv = new DataView(lfh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBuf.length, true); lv.setUint16(28, 0, true);
      lfh.set(nameBuf, 30);
      var localEntry = new Uint8Array(lfh.length + data.length); localEntry.set(lfh, 0); localEntry.set(data, lfh.length);
      var localOffset = offset; localParts.push(localEntry); offset += localEntry.length;
      var cdh = new Uint8Array(46 + nameBuf.length); var cv = new DataView(cdh.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBuf.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, localOffset, true);
      cdh.set(nameBuf, 46); centralParts.push(cdh);
    });
    var localTotal = localParts.reduce(function (s, p) { return s + p.length; }, 0);
    var centralTotal = centralParts.reduce(function (s, p) { return s + p.length; }, 0);
    var eocd = new Uint8Array(22); var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, fileEntries.length, true); ev.setUint16(10, fileEntries.length, true); ev.setUint32(12, centralTotal, true); ev.setUint32(16, localTotal, true);
    var out = new Uint8Array(localTotal + centralTotal + 22); var pos = 0;
    localParts.forEach(function (p) { out.set(p, pos); pos += p.length; }); centralParts.forEach(function (p) { out.set(p, pos); pos += p.length; }); out.set(eocd, pos);
    return out;
  }
  var SAMPLE_HEADER = ['Module', 'Table Name', 'Table Description', 'Column Name', 'Column Description', 'Data Type', 'Length', 'Precision', 'Nullable', 'Alias', 'Decode', 'Primary Key', 'Foreign Key', 'Relationship'];
  function normalizeHeader(label) { return String(label || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  var HEADER_ALIASES = { module: 'module', tablename: 'tableName', table: 'tableName', tabledescription: 'tableDescription', tabledesc: 'tableDescription', columnname: 'columnName', column: 'columnName', field: 'columnName', columndescription: 'columnDescription', columndesc: 'columnDescription', description: 'columnDescription', desc: 'columnDescription', datatype: 'dataType', type: 'dataType', length: 'length', datalength: 'length', precision: 'precision', dataprecision: 'precision', nullable: 'nullable', null: 'nullable', alias: 'alias', decode: 'decode', primarykey: 'primaryKey', pk: 'primaryKey', foreignkey: 'foreignKey', fk: 'foreignKey', relationship: 'relationship', relatedto: 'relationship', references: 'relationship' };
  function classifyHeaderRow(headerCells) { var map = {}; (headerCells || []).forEach(function (label, idx) { var norm = normalizeHeader(label); var mapped = HEADER_ALIASES[norm]; if (mapped && map[mapped] === undefined) map[mapped] = idx; }); return map; }
  function truthy(cellText) { var v = String(cellText || '').trim().toUpperCase(); return v === 'Y' || v === 'YES' || v === 'TRUE' || v === '1'; }
  function parseRelationshipText(text) { if (!text) return null; var m = String(text).match(/([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)/); if (m) return { table: m[1].toUpperCase(), column: m[2].toUpperCase() }; return null; }
  function parseDecodeText(text) { if (!text || !String(text).trim()) return null; var pairs = []; String(text).split(/[;,]/).forEach(function (segment) { var m = segment.trim().match(/^(.+?)\s*=\s*(.+)$/); if (m) pairs.push({ code: m[1].trim(), label: m[2].trim() }); }); return pairs.length ? pairs : null; }
  function buildTablesFromFlatRows(headerCells, dataRows) {
    var colMap = classifyHeaderRow(headerCells);
    if (colMap.columnName === undefined || colMap.tableName === undefined) return { error: 'The uploaded file is missing required schema information (Table Name / Column Name columns). Please check the sample format and try again.' };
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
  function escXml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function buildDocxBlob(header, rows, title) {
    function cellXml(text) { return '<w:tc><w:p><w:r><w:t xml:space="preserve">' + escXml(text) + '</w:t></w:r></w:p></w:tc>'; }
    var headerRowXml = '<w:tr>' + header.map(cellXml).join('') + '</w:tr>';
    var dataRowsXml = rows.map(function (r) { return '<w:tr>' + r.map(cellXml).join('') + '</w:tr>'; }).join('');
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + escXml(title || 'Database Schema') + '</w:t></w:r></w:p><w:tbl>' + headerRowXml + dataRowsXml + '</w:tbl><w:sectPr/></w:body></w:document>';
    var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
    var rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    var enc = new TextEncoder();
    var zipBytes = writeZip([{ name: '[Content_Types].xml', data: enc.encode(contentTypesXml) }, { name: '_rels/.rels', data: enc.encode(rootRelsXml) }, { name: 'word/document.xml', data: enc.encode(documentXml) }]);
    return new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  function buildXlsxBlob(header, rows) {
    var allRows = [header].concat(rows);
    function colLetter(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
    var sharedStrings = [], sstMap = {};
    function sstIdx(text) { if (Object.prototype.hasOwnProperty.call(sstMap, text)) return sstMap[text]; var i = sharedStrings.length; sharedStrings.push(text); sstMap[text] = i; return i; }
    var sheetRowsXml = allRows.map(function (row, r) { var cellsXml = row.map(function (cell, c) { return '<c r="' + colLetter(c) + (r + 1) + '" t="s"><v>' + sstIdx(String(cell == null ? '' : cell)) + '</v></c>'; }).join(''); return '<row r="' + (r + 1) + '">' + cellsXml + '</row>'; }).join('');
    var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + sheetRowsXml + '</sheetData></worksheet>';
    var sstXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + sharedStrings.length + '" uniqueCount="' + sharedStrings.length + '">' + sharedStrings.map(function (s) { return '<si><t xml:space="preserve">' + escXml(s) + '</t></si>'; }).join('') + '</sst>';
    var workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Schema" sheetId="1" r:id="rId1"/></sheets></workbook>';
    var workbookRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
    var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>';
    var rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    var enc = new TextEncoder();
    var zipBytes = writeZip([{ name: '[Content_Types].xml', data: enc.encode(contentTypesXml) }, { name: '_rels/.rels', data: enc.encode(rootRelsXml) }, { name: 'xl/workbook.xml', data: enc.encode(workbookXml) }, { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRelsXml) }, { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml) }, { name: 'xl/sharedStrings.xml', data: enc.encode(sstXml) }]);
    return new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function rtfEscape(text) { return String(text || '').replace(/\\/g, '\\\\').replace(/[^\x00-\x7F]/g, function (ch) { return '\\u' + ch.charCodeAt(0) + '?'; }); }
  function buildRtfTable(headerCells, dataRows) {
    var allRows = [headerCells].concat(dataRows); var numCols = headerCells.length; var cellWidthTwips = Math.floor(9000 / numCols);
    var parts = ['{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\fs20'];
    allRows.forEach(function (row) { var rowDef = '\\trowd\\trgaph108'; for (var c = 0; c < numCols; c++) rowDef += '\\cellx' + (cellWidthTwips * (c + 1)); parts.push(rowDef); for (var ci = 0; ci < numCols; ci++) parts.push(rtfEscape(row[ci] || '') + '\\cell'); parts.push('\\row'); });
    parts.push('}'); return parts.join('\n');
  }
  function buildDocBlob(header, rows) { return new Blob([buildRtfTable(header, rows)], { type: 'application/msword' }); }
  var SUPPORTED_EXTENSIONS = ['.json', '.csv'];
  function detectFormat(filename) { var lower = String(filename || '').toLowerCase(); for (var i = 0; i < SUPPORTED_EXTENSIONS.length; i++) { if (lower.endsWith(SUPPORTED_EXTENSIONS[i])) return SUPPORTED_EXTENSIONS[i]; } return null; }
  function fileToTables(file) { var format = detectFormat(file.name); if (!format) return Promise.reject(new Error('Unsupported file format. Please upload a .json or .csv file.')); switch (format) { case '.json': return jsonFileToTables(file); case '.csv': return csvFileToTables(file); default: return Promise.reject(new Error('Unsupported file format. Please upload a .json or .csv file.')); } }
  function buildSampleRows() {
    return [
      ['Invoice Automation', 'IA_INVOICE', 'Invoice information', 'INVOICE_ID', 'Unique identifier for the invoice', 'INTEGER', '', '', 'N', '', '', 'Y', '', ''],
      ['Invoice Automation', 'IA_INVOICE', 'Invoice information', 'SUPPLIER_ID', 'Identifier of the supplier who issued this invoice', 'INTEGER', '', '', 'Y', '', '', 'N', 'IA_SUPPLIER.SUPPLIER_ID', 'IA_SUPPLIER.SUPPLIER_ID'],
      ['Invoice Automation', 'IA_INVOICE', 'Invoice information', 'GROSS_SUM', 'Total invoice amount including tax', 'NUMBER', '19', '2', 'Y', 'Amount', '', 'N', '', ''],
      ['Invoice Automation', 'IA_INVOICE', 'Invoice information', 'STATUS', 'Workflow status of the invoice', 'NUMBER', '5', '', 'N', '', '0=Draft;10=Received;40=Approved;90=Transferred', 'N', '', ''],
      ['Invoice Automation', 'IA_SUPPLIER', 'Supplier master data', 'SUPPLIER_ID', 'Unique identifier for the supplier', 'INTEGER', '', '', 'N', '', '', 'Y', '', ''],
      ['Invoice Automation', 'IA_SUPPLIER', 'Supplier master data', 'SUPPLIER_NAME', 'Name of the supplier company', 'VARCHAR', '250', '', 'Y', 'Name', '', 'N', '', '']
    ];
  }
  function buildSampleCsvBlob() { return rowsToCsvBlob([SAMPLE_HEADER].concat(buildSampleRows())); }
  function buildSampleDocxBlob() { return buildDocxBlob(SAMPLE_HEADER, buildSampleRows(), 'Sample Database Schema Description'); }
  function buildSampleXlsxBlob() { return buildXlsxBlob(SAMPLE_HEADER, buildSampleRows()); }
  function buildSampleDocBlob() { return buildDocBlob(SAMPLE_HEADER, buildSampleRows()); }
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
  function buildCurrentSchemaDocxBlob(schema) { var f = buildCurrentSchemaFlatRows(schema); return buildDocxBlob(f.header, f.rows, (schema.schema_name || 'Database Schema') + ' - Version ' + (schema.schema_version || '')); }
  function buildCurrentSchemaXlsxBlob(schema) { var f = buildCurrentSchemaFlatRows(schema); return buildXlsxBlob(f.header, f.rows); }
  function buildCurrentSchemaDocBlob(schema) { var f = buildCurrentSchemaFlatRows(schema); return buildDocBlob(f.header, f.rows); }
  function validateSchema(candidateTables) {
    var errors = [];
    if (!Array.isArray(candidateTables)) return { valid: false, errors: ['The schema could not be activated because validation failed. The existing active schema has not been changed. (Expected an array of tables.)'] };
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
    var removedTables = Object.keys(currentByName).filter(function (n) { return !incomingByName[n]; });
    return { currentModuleCount: new Set(currentSchema.tables.map(function (t) { return t.module; })).size, currentTableCount: currentSchema.tables.length, currentColumnCount: currentSchema.tables.reduce(function (s, t) { return s + t.columns.length; }, 0), newVersion: bumpVersion(currentSchema.schema_version), newModuleCount: new Set(incomingTables.map(function (t) { return t.module; }).concat(currentSchema.tables.map(function (t) { return t.module; }))).size, newTableCount: Object.keys(currentByName).concat(Object.keys(incomingByName)).filter(function (v, i, a) { return a.indexOf(v) === i; }).length, newColumnCount: currentSchema.tables.reduce(function (s, t) { return s + t.columns.length; }, 0) + addedColumnCount + updatedColumnCount, addedTableCount: addedTables.length, addedColumnCount: addedColumnCount, updatedTableCount: updatedTables.length, updatedColumnCount: updatedColumnCount, removedTableCount: removedTables.length, removedColumnCount: 0, addedTables: addedTables, updatedTables: updatedTables };
  }
  function bumpVersion(versionStr) { var m = String(versionStr || '10.7').match(/^(\d+)\.(\d+)$/); if (!m) return '10.8'; return m[1] + '.' + (parseInt(m[2], 10) + 1); }
  function mergeSchemas(baseSchema, incomingTables, incomingSourceLabel) {
    var previousSchemaBackup = JSON.parse(JSON.stringify(baseSchema));
    var byNameUpper = {}; baseSchema.tables.forEach(function (t) { byNameUpper[t.name.toUpperCase()] = t; });
    var addedTables = [], addedColumns = [];
    incomingTables.forEach(function (incoming) {
      var upper = String(incoming.name).toUpperCase(); var existing = byNameUpper[upper];
      if (!existing) { byNameUpper[upper] = incoming; addedTables.push(incoming.name); incoming.columns.forEach(function (c) { addedColumns.push(incoming.name + '.' + c.name); }); }
      else { var existingCols = {}; existing.columns.forEach(function (c) { existingCols[c.name.toUpperCase()] = true; }); incoming.columns.forEach(function (c) { if (!existingCols[String(c.name).toUpperCase()]) { existing.columns.push(c); addedColumns.push(existing.name + '.' + c.name); } }); }
    });
    var newSchema = { schema_name: baseSchema.schema_name, schema_version: bumpVersion(baseSchema.schema_version), last_updated: new Date().toISOString().slice(0, 10), source_documents: (baseSchema.source_documents || []).concat([incomingSourceLabel || 'Imported file']), module_labels: baseSchema.module_labels, tables: Object.keys(byNameUpper).map(function (k) { return byNameUpper[k]; }) };
    return { schema: newSchema, previousSchemaBackup: previousSchemaBackup, addedTables: addedTables, addedColumns: addedColumns };
  }
  function buildEmptySchema(baseSchema) { return { schema_name: baseSchema.schema_name, schema_version: '0.0', last_updated: new Date().toISOString().slice(0, 10), source_documents: (baseSchema.source_documents || []).concat(['Schema deleted by administrator on ' + new Date().toISOString().slice(0, 10) + ' — awaiting new upload']), module_labels: baseSchema.module_labels, tables: [] }; }
  function saveRelationshipToSchema(baseSchema, fromTable, fromColumn, toTable, toColumn) {
    var cloned = JSON.parse(JSON.stringify(baseSchema));
    var fromTableUpper = String(fromTable).toUpperCase(); var toTableUpper = String(toTable).toUpperCase();
    var fromColumnUpper = String(fromColumn).toUpperCase(); var toColumnUpper = String(toColumn).toUpperCase();
    var tFrom = cloned.tables.filter(function (t) { return String(t.name).toUpperCase() === fromTableUpper; })[0];
    if (!tFrom) throw new Error('Table "' + fromTable + '" was not found in the active schema.');
    var tTo = cloned.tables.filter(function (t) { return String(t.name).toUpperCase() === toTableUpper; })[0];
    if (!tTo) throw new Error('Table "' + toTable + '" was not found in the active schema.');
    var colFrom = tFrom.columns.filter(function (c) { return String(c.name).toUpperCase() === fromColumnUpper; })[0];
    if (!colFrom) throw new Error('Column "' + fromColumn + '" was not found on table "' + fromTable + '".');
    var colTo = tTo.columns.filter(function (c) { return String(c.name).toUpperCase() === toColumnUpper; })[0];
    if (!colTo) throw new Error('Column "' + toColumn + '" was not found on table "' + toTable + '".');
    colFrom.foreign_key = { table: tTo.name, column: colTo.name };
    cloned.schema_version = bumpVersion(cloned.schema_version);
    cloned.last_updated = new Date().toISOString().slice(0, 10);
    cloned.source_documents = (cloned.source_documents || []).concat(['Relationship added by administrator on ' + cloned.last_updated + ': ' + tFrom.name + '.' + colFrom.name + ' -> ' + tTo.name + '.' + colTo.name]);
    return cloned;
  }
  var API = { writeZip: writeZip, crc32: crc32, parseCsvText: parseCsvText, csvToTables: csvToTables, csvFileToTables: csvFileToTables, rowsToCsvBlob: rowsToCsvBlob, buildTablesFromFlatRows: buildTablesFromFlatRows, classifyHeaderRow: classifyHeaderRow, parseDecodeText: parseDecodeText, parseRelationshipText: parseRelationshipText, normalizeJsonInput: normalizeJsonInput, jsonFileToTables: jsonFileToTables, detectFormat: detectFormat, fileToTables: fileToTables, SUPPORTED_EXTENSIONS: SUPPORTED_EXTENSIONS, buildSampleRows: buildSampleRows, SAMPLE_HEADER: SAMPLE_HEADER, buildSampleJsonBlob: buildSampleJsonBlob, buildSampleCsvBlob: buildSampleCsvBlob, buildSampleDocxBlob: buildSampleDocxBlob, buildSampleXlsxBlob: buildSampleXlsxBlob, buildSampleDocBlob: buildSampleDocBlob, validateSchema: validateSchema, computeDiff: computeDiff, mergeSchemas: mergeSchemas, bumpVersion: bumpVersion, buildEmptySchema: buildEmptySchema, saveRelationshipToSchema: saveRelationshipToSchema, buildCurrentSchemaFlatRows: buildCurrentSchemaFlatRows, splitTypeIntoLengthPrecision: splitTypeIntoLengthPrecision, formatDecodeForExport: formatDecodeForExport, buildCurrentSchemaJsonBlob: buildCurrentSchemaJsonBlob, buildCurrentSchemaCsvBlob: buildCurrentSchemaCsvBlob, buildCurrentSchemaDocxBlob: buildCurrentSchemaDocxBlob, buildCurrentSchemaXlsxBlob: buildCurrentSchemaXlsxBlob, buildCurrentSchemaDocBlob: buildCurrentSchemaDocBlob };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SCHEMA_TOOLS = API;
})(typeof window !== 'undefined' ? window : this);
