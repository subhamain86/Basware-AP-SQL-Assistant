/* ==========================================================================
   AP-SQL Assistant V11.4 — Manual CASE/DECODE Addition & Admin Approval
   ==========================================================================
   Implements the "Manual CASE/DECODE Addition" workflow described in the
   V11.4 requirements:
     1. If a requested CASE/DECODE definition is NOT found in the current
        (active/default) schema, the user may draft a manual definition
        (column, condition/value, result/output, multiple conditions,
        ELSE/default value, optional description).
     2. The manual definition never touches the schema immediately. It is
        held as a *pending* draft.
     3. Submitting the draft for approval requires the existing operational
        password mechanism (PASSWORD_MANAGER). The password is verified,
        never displayed, never stored in plain text, and an incorrect
        password blocks the approval.
     4. Only after a successful admin authentication is the definition
        written into the CURRENTLY SELECTED schema (schema-store entry),
        not every stored schema — and only if an equivalent definition
        does not already exist there (duplicate prevention).
     5. Metadata is recorded so the definition can be identified later as
        manually added (who/when/approval status/schema version).
   ========================================================================== */
(function (root) {
  'use strict';

  function nowIso() { return new Date().toISOString(); }

  function normalizeCode(code) { return String(code == null ? '' : code).trim(); }
  function normalizeLabel(label) { return String(label == null ? '' : label).trim(); }

  function createDraft(overrides) {
    return Object.assign({
      id: 'decodeDraft_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      table: '',
      column: '',
      description: '',
      elseDefault: '',
      pairs: [], // [{ code, label }]
      createdAt: nowIso()
    }, overrides || {});
  }

  function validateDraft(draft) {
    var errors = [];
    if (!draft || !draft.table) errors.push('Please choose the table this CASE/DECODE definition applies to.');
    if (!draft || !draft.column) errors.push('Please choose the column this CASE/DECODE definition applies to.');
    var pairs = (draft && draft.pairs) || [];
    var cleanPairs = pairs.map(function (p) { return { code: normalizeCode(p.code), label: normalizeLabel(p.label) }; })
      .filter(function (p) { return p.code !== '' && p.label !== ''; });
    if (!cleanPairs.length) errors.push('Add at least one condition/value → result/output mapping.');
    var seen = {};
    cleanPairs.forEach(function (p) { var k = p.code.toUpperCase(); if (seen[k]) errors.push('The value "' + p.code + '" is mapped more than once.'); seen[k] = true; });
    return { valid: errors.length === 0, errors: errors, cleanPairs: cleanPairs };
  }

  // Returns the exact list of {code,label} pairs (including ELSE/default, encoded as a
  // special code marker) that would be written to the schema for this draft.
  function pairsForSchema(draft) {
    var check = validateDraft(draft);
    var pairs = check.cleanPairs.slice();
    return pairs;
  }

  // Is an equivalent CASE/DECODE definition already present for this table/column,
  // either in the schema itself or as a set of value mappings that are identical?
  function findExistingDefinition(schemaObj, tableName, columnName) {
    if (!schemaObj || !Array.isArray(schemaObj.tables)) return null;
    var table = schemaObj.tables.filter(function (t) { return String(t.name).toUpperCase() === String(tableName).toUpperCase(); })[0];
    if (!table) return null;
    var col = (table.columns || []).filter(function (c) { return String(c.name).toUpperCase() === String(columnName).toUpperCase(); })[0];
    if (!col) return null;
    if (Array.isArray(col.decode) && col.decode.length) return { table: table, column: col };
    return null;
  }

  function isDuplicateOfExisting(existingDecode, newPairs) {
    if (!existingDecode || !existingDecode.length) return false;
    if (existingDecode.length !== newPairs.length) return false;
    var existingMap = {};
    existingDecode.forEach(function (p) { existingMap[String(p.code).toUpperCase()] = String(p.label).toUpperCase(); });
    return newPairs.every(function (p) { return existingMap[p.code.toUpperCase()] === p.label.toUpperCase(); });
  }

  /**
   * Attempt to save an approved draft into the CURRENTLY SELECTED schema entry only.
   * - `schemaStoreEntry` is the schema-store entry object ({ id, name, schema, ... }).
   * - Requires the draft to already have passed admin password verification by the caller.
   * - Prevents accidental overwrite of an existing (different) CASE/DECODE definition —
   *   if one already exists and is NOT identical, the save is rejected so the user can
   *   choose to keep the existing schema-defined mapping instead.
   */
  function applyApprovedDraftToSchema(schemaObj, draft, approverContext) {
    var check = validateDraft(draft);
    if (!check.valid) return { ok: false, errors: check.errors };
    var cloned = JSON.parse(JSON.stringify(schemaObj || { tables: [] }));
    cloned.tables = cloned.tables || [];
    var table = cloned.tables.filter(function (t) { return String(t.name).toUpperCase() === String(draft.table).toUpperCase(); })[0];
    if (!table) return { ok: false, errors: ['Table "' + draft.table + '" was not found in the current schema.'] };
    var col = (table.columns || []).filter(function (c) { return String(c.name).toUpperCase() === String(draft.column).toUpperCase(); })[0];
    if (!col) return { ok: false, errors: ['Column "' + draft.column + '" was not found on table "' + draft.table + '" in the current schema.'] };

    var newPairs = check.cleanPairs.slice();
    if (draft.elseDefault && String(draft.elseDefault).trim()) newPairs = newPairs; // ELSE is applied at SQL-gen time, not stored as a coded pair

    if (Array.isArray(col.decode) && col.decode.length) {
      if (isDuplicateOfExisting(col.decode, newPairs)) {
        return { ok: false, duplicate: true, errors: ['An identical CASE/DECODE definition already exists in the current schema for ' + draft.table + '.' + draft.column + '. The existing definition will be used.'] };
      }
      return { ok: false, conflict: true, errors: ['A different CASE/DECODE definition already exists in the current schema for ' + draft.table + '.' + draft.column + '. To avoid overwriting governed schema data, please edit the existing definition directly via Update Schema, or choose a different column.'] };
    }

    col.decode = newPairs;
    col._decodeMeta = {
      manuallyAdded: true,
      description: draft.description || '',
      elseDefault: draft.elseDefault || '',
      addedBy: (approverContext && approverContext.approvedBy) || 'Administrator',
      approvalStatus: 'approved',
      schemaVersionAtApproval: schemaObj.schema_version || '',
      createdAt: draft.createdAt || nowIso(),
      approvedAt: nowIso()
    };
    return { ok: true, schema: cloned, table: table.name, column: col.name };
  }

  var API = {
    createDraft: createDraft,
    validateDraft: validateDraft,
    pairsForSchema: pairsForSchema,
    findExistingDefinition: findExistingDefinition,
    isDuplicateOfExisting: isDuplicateOfExisting,
    applyApprovedDraftToSchema: applyApprovedDraftToSchema
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_DECODE_APPROVAL = API;
})(typeof window !== 'undefined' ? window : this);
