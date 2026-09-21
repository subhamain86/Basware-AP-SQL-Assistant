/* suggestion-engine.js — suggested fixes when a natural-language request or a manual
   selection is rejected (e.g., missing table/column, unresolved relationship). */
(function (root) {
  'use strict';

  function suggestionsForMissingInfo(missingInfo, engine) {
    return (missingInfo || []).map(function (msg) {
      return { message: msg, sampleTables: engine.getAllTables().slice(0, 5).map(function (t) { return t.name; }) };
    });
  }

  function suggestionsForUnresolvedRelationship(tableA, tableB) {
    return [
      'Add an explicit relationship between ' + tableA + ' and ' + tableB + ' in Update Schema.',
      'Check whether a shared key column exists but is not marked as a foreign_key in the schema.',
      'If these tables are not actually related, remove one of them from the request.'
    ];
  }

  var API = { suggestionsForMissingInfo: suggestionsForMissingInfo, suggestionsForUnresolvedRelationship: suggestionsForUnresolvedRelationship };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SUGGESTION = API;
})(typeof window !== 'undefined' ? window : this);
