import type { SchemaModel, CrRequirement, CrQueryType, CrValuePair, FilterCondition, TableDef } from '../types';
import { makeId } from '../utils/id';

// ============================================================================
// crNlpEngine — parses a natural-language Change Request description, e.g.
// "Update the payment status to PAID for invoice 12345.", into a structured
// CrRequirement: target table, column/value pairs, and a WHERE filter.
// Schema-grounded like the read-only NLP engine — never invents a
// table/column.
// ============================================================================

function detectIntent(text: string): CrQueryType | null {
  const lower = text.toLowerCase();
  if (/\b(update|change|set|mark)\b/.test(lower)) return 'UPDATE';
  if (/\b(insert|add|create)\b/.test(lower)) return 'INSERT';
  if (/\b(delete|remove)\b/.test(lower)) return 'DELETE';
  return null;
}

function findTargetTable(text: string, schema: SchemaModel): TableDef | null {
  const upper = text.toUpperCase();
  const ALIASES: Record<string, string> = { INVOICE: 'INVOICE_HEADER', 'PURCHASE ORDER': 'PO_HEADER', PO: 'PO_HEADER', VENDOR: 'VENDOR', SUPPLIER: 'VENDOR' };
  for (const t of schema.tables) if (upper.includes(t.name) || upper.includes(t.name.replace(/_/g, ' '))) return t;
  for (const [alias, tableName] of Object.entries(ALIASES)) if (upper.includes(alias)) { const t = schema.tables.find((tb) => tb.name === tableName); if (t) return t; }
  return null;
}

function extractValueAssignment(text: string, table: TableDef): CrValuePair[] {
  const values: CrValuePair[] = [];
  const lower = text.toLowerCase();
  for (const col of table.columns) {
    const decode = col.decode;
    if (decode) {
      for (const d of decode) { if (lower.includes(d.label.toLowerCase())) { values.push({ id: makeId('crv'), column: col.name, value: d.rawValue }); return values; } }
    }
    const colPhrase = col.name.toLowerCase().replace(/_/g, ' ');
    const labelPhrase = col.label.toLowerCase();
    const idx = lower.indexOf(colPhrase) !== -1 ? lower.indexOf(colPhrase) : lower.indexOf(labelPhrase);
    if (idx !== -1) {
      const after = text.slice(idx);
      const toMatch = after.match(/\bto\s+([A-Za-z0-9_.\-]+)/i);
      if (toMatch) values.push({ id: makeId('crv'), column: col.name, value: toMatch[1] });
    }
  }
  return values;
}

function extractWhereCondition(text: string, table: TableDef): FilterCondition[] {
  const pk = table.columns.find((c) => c.isPrimaryKey);
  const numMatch = text.match(/\b(?:for|where)\b.*?(\d[\d]*)/i);
  if (pk && numMatch) return [{ id: makeId('filt'), table: table.name, column: pk.name, operator: '=', combinator: 'AND', value: numMatch[1] }];
  return [];
}

export function parseCrRequirement(rawText: string, schema: SchemaModel): CrRequirement {
  const notes: string[] = [];
  const text = rawText.trim();
  if (!text) return { rawText, queryType: null, matchedTable: null, values: [], filters: [], notes: ['No requirement text was provided.'], confidence: 0 };

  const queryType = detectIntent(text);
  if (!queryType) { notes.push('Could not determine whether this is an INSERT, UPDATE, or DELETE. Try starting with "Update...", "Insert...", or "Delete...".'); return { rawText, queryType: null, matchedTable: null, values: [], filters: [], notes, confidence: 0.1 }; }
  notes.push(`Detected intent: ${queryType}.`);

  const table = findTargetTable(text, schema);
  if (!table) { notes.push('Could not identify a target table from the active schema.'); return { rawText, queryType, matchedTable: null, values: [], filters: [], notes, confidence: 0.2 }; }
  notes.push(`Target table: ${table.name}.`);

  const values = queryType === 'DELETE' ? [] : extractValueAssignment(text, table);
  if (values.length) notes.push(`Detected ${values.length} column/value assignment(s).`);
  const filters = extractWhereCondition(text, table);
  if (filters.length) notes.push(`Detected a WHERE condition on ${filters[0].table}.${filters[0].column}.`);
  else notes.push('No WHERE condition detected — you must add one manually before this can be saved (mandatory for UPDATE/DELETE).');

  const confidence = Math.min(1, 0.3 + (values.length ? 0.3 : 0) + (filters.length ? 0.3 : 0));
  return { rawText, queryType, matchedTable: table.name, values, filters, notes, confidence };
}
