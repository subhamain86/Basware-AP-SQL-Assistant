(function (root) {
  'use strict';

  function createRelationshipStore() {
    var manual = {};
    function key(a, b) { return [String(a).toUpperCase(), String(b).toUpperCase()].sort().join('__'); }

    function setManualRelationship(fromTable, fromColumn, toTable, toColumn) {
      manual[key(fromTable, toTable)] = {
        fromTable: String(fromTable).toUpperCase(), fromColumn: String(fromColumn).toUpperCase(),
        toTable: String(toTable).toUpperCase(), toColumn: String(toColumn).toUpperCase()
      };
    }
    function getManualRelationship(a, b) { return manual[key(a, b)] || null; }
    function hasManualRelationship(a, b) { return !!manual[key(a, b)]; }
    function clearManualRelationship(a, b) { delete manual[key(a, b)]; }
    function clearAll() { manual = {}; }
    function listManualRelationships() { return Object.keys(manual).map(function (k) { return manual[k]; }); }

    return {
      setManualRelationship: setManualRelationship,
      getManualRelationship: getManualRelationship,
      hasManualRelationship: hasManualRelationship,
      clearManualRelationship: clearManualRelationship,
      clearAll: clearAll,
      listManualRelationships: listManualRelationships
    };
  }

  function createEffectiveEngine(baseEngine, relationshipStore) {
    var wrapped = {};
    Object.keys(baseEngine).forEach(function (k) { wrapped[k] = baseEngine[k]; });
    wrapped.findRelationship = function (tableA, tableB) {
      var real = baseEngine.findRelationship(tableA, tableB);
      if (real) return real;
      return relationshipStore ? relationshipStore.getManualRelationship(tableA, tableB) : null;
    };
    return wrapped;
  }

  var API = { createRelationshipStore: createRelationshipStore, createEffectiveEngine: createEffectiveEngine };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_RELATIONSHIPS = API;
})(typeof window !== 'undefined' ? window : this);
