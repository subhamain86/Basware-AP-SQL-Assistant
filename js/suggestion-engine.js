(function (root) {
  'use strict';
  var RULES = [
    { match: function (m) { return /Table "[^"]*" does not exist in the active schema/.test(m); },
      suggest: 'Double-check the table name — open the "Pick Tables" search box and confirm it matches exactly, or browse Used Schema to see every available table.' },
    { match: function (m) { return /Column "[^"]*" does not exist on table/.test(m); },
      suggest: 'Double-check the column name and the table it belongs to — use the "Pick Columns" search box, or browse Used Schema to confirm the exact column name.' },
    { match: function (m) { return /No relationship was found between/.test(m); },
      suggest: 'These two tables have no documented relationship in the active schema. In Advanced Options, the join preview lets you define which columns connect them so the query can be built right away, and optionally save that relationship permanently to the schema.' },
    { match: function (m) { return /No documented relationship was found to join/.test(m); },
      suggest: 'One or more of your selected tables have no documented path connecting them to the rest. In Advanced Options, look for "Could not automatically connect" under the join preview \u2014 you can define the matching columns yourself to build the query now, or save that relationship to the schema permanently (requires the operational password).' },
    { match: function (m) { return /At least one table must be selected/.test(m); },
      suggest: 'Go to the Tables & Columns tab and select at least one table, describe your requirement in the text box and click Build Query, or use both together.' },
    { match: function (m) { return /needs both a from and a to value/.test(m); },
      suggest: 'Fill in both the "from" and "to" values for your Between filter, or switch to a different condition if you only have one value.' },
    { match: function (m) { return /needs at least one value/.test(m); },
      suggest: 'For "Is one of" / "Is not one of", enter a comma-separated list of values (e.g. 10, 20, 40) into the value box.' },
    { match: function (m) { return /A WHERE condition is required/.test(m); },
      suggest: 'Add at least one filter condition in the Filters card so the database knows exactly which records to change, or tick the explicit override checkbox if you are certain you want no WHERE condition.' },
    { match: function (m) { return /At least one column must be selected for INSERT/.test(m); },
      suggest: 'Tick at least one column in Pick Columns and provide a value for it.' },
    { match: function (m) { return /At least one column to update must be selected/.test(m); },
      suggest: 'Tick at least one column to update in Pick Columns and provide its new value.' },
    { match: function (m) { return /has no self-referencing relationship/.test(m); },
      suggest: 'This table has no parent/child (self-referencing) relationship documented in the schema, so a hierarchy walk isn\u2019t possible here. Choose a different table, or clear the Hierarchy option.' },
    { match: function (m) { return /has no primary key documented/.test(m); },
      suggest: 'This table has no primary key documented in the schema, which the hierarchy walk needs. This would need to be added to the schema first, via Update Schema.' },
    { match: function (m) { return /which is not related to the selected table\(s\)/.test(m); },
      suggest: 'This filter references a table that isn\u2019t connected to your selected tables. Either add that table to your selection, or choose a filter column from one of your selected tables instead.' },
    { match: function (m) { return /Could not identify any tables/.test(m); },
      suggest: 'Try naming a specific concept from your data (e.g. "invoices", "suppliers", "users"), or select tables manually on the Tables & Columns tab.' },
    { match: function (m) { return /No column was specified/.test(m); },
      suggest: 'Make sure every filter row has a column chosen — an empty column selector will block the query from being built.' }
  ];
  function buildSuggestions(message) {
    var text = String(message || '');
    var out = [];
    RULES.forEach(function (rule) { if (rule.match(text)) out.push(rule.suggest); });
    if (!out.length) out.push('Review your table and column selections and filters, then try building the query again. If the problem continues, check Used Schema to confirm the tables/columns you need actually exist.');
    return out;
  }
  var API = { buildSuggestions: buildSuggestions };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.APSQL_SUGGEST = API;
})(typeof window !== 'undefined' ? window : this);
