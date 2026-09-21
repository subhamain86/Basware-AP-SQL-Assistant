(function (root) {
  'use strict';
  var RULES = [
    { match: function (m) { return /Table "[^"]*" does not exist in the active schema/.test(m); }, suggest: 'Double-check the table name — open the "Select Table" search box and confirm it matches exactly, or browse Used Schema to see every available table.' },
    { match: function (m) { return /Column "[^"]*" does not exist on table/.test(m); }, suggest: 'Double-check the column name and the table it belongs to — use the "Select Column" search box, or browse Used Schema to confirm the exact column name.' },
    { match: function (m) { return /No documented relationship was found to join/.test(m); }, suggest: 'One or more of your selected tables have no documented path connecting them. Define the matching columns manually in Filters/Advanced Options, or save that relationship to the schema permanently (requires the operational password).' },
    { match: function (m) { return /At least one table must be selected/.test(m); }, suggest: 'Go to Select Table and choose at least one table, describe your requirement in the text box and click Build Query, or use both together.' },
    { match: function (m) { return /A WHERE condition is required/.test(m); }, suggest: 'Add at least one filter condition so the database knows exactly which records to change, or tick the explicit override checkbox if you are certain you want no WHERE condition.' },
    { match: function (m) { return /At least one column must be selected for INSERT/.test(m); }, suggest: 'Tick at least one column in Select Column and provide a value for it.' },
    { match: function (m) { return /At least one column to update must be selected/.test(m); }, suggest: 'Tick at least one column to update and provide its new value.' },
    { match: function (m) { return /has no self-referencing relationship/.test(m); }, suggest: 'This table has no parent/child (self-referencing) relationship documented in the schema, so a hierarchy walk is not possible here.' },
    { match: function (m) { return /which is not related to the selected table\(s\)/.test(m); }, suggest: 'This filter references a table that is not connected to your selected tables. Either add that table, or choose a filter column from one of your selected tables instead.' },
    { match: function (m) { return /Could not identify any tables/.test(m); }, suggest: 'Try naming a specific concept from your data (e.g. "invoices", "suppliers", "users"), or select tables manually in Select Table.' }
  ];
  function buildSuggestions(message) {
    var text = String(message || ''); var out = [];
    RULES.forEach(function (rule) { if (rule.match(text)) out.push(rule.suggest); });
    if (!out.length) out.push('Review your table, column, and filter selections, then try building the query again. If the problem continues, check Used Schema to confirm the tables/columns you need actually exist.');
    return out;
  }
  var API = { buildSuggestions: buildSuggestions };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SUGGEST = API;
})(typeof window !== 'undefined' ? window : this);
