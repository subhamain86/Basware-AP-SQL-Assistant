import type { SchemaModel, CrRequirement, CrQueryType, CrValuePair, FilterCondition, TableDef } from '../types';
import { makeId } from '../utils/id';
function detectIntent(text: string): CrQueryType | null { const lower = text.toLowerCase(); if (/\b(update|change|set|mark)\b/.test(lower)) return 'UPDATE'; if (/\b(insert|add|create)\b/.test(lower)) return 'INSERT'; if (/\b(delete|remove)\b/.test(lower)) return 'DELETE'; return null; }
function findTargetTable(text: string, schema: SchemaModel): TableDef | null {
  const upper = text.toUpperCase();
  for (const t of schema.tables) if (upper.includes(t.name)) return t;
  return null;
}
function extractWhereCondition(text: string, table: TableDef): FilterCondition[] {
  const pk = table.columns.find((c) => c.isPrimaryKey);
  const numMatch = text.match(/\b(?:for|where)\b.*?(\d[\d]*)/i);
  if (pk && numMatch) return [{ id: makeId('filt'), table: table.name, column: pk.name, operator: '=', combinator: 'AND', value: numMatch[1] }];
  return [];
}
export function parseCrRequirement(rawText: string, schema: SchemaModel): CrRequirement {
  const notes: string[] = []; const text = rawText.trim();
  if (!text) return { rawText, queryType: null, matchedTable: null, values: [], filters: [], notes: ['No requirement text was provided.'], confidence: 0 };
  const queryType = detectIntent(text);
  if (!queryType) { notes.push('Could not determine INSERT/UPDATE/DELETE.'); return { rawText, queryType: null, matchedTable: null, values: [], filters: [], notes, confidence: 0.1 }; }
  const table = findTargetTable(text, schema);
  if (!table) { notes.push('Could not identify a target table.'); return { rawText, queryType, matchedTable: null, values: [], filters: [], notes, confidence: 0.2 }; }
  const values: CrValuePair[] = [];
  const filters = extractWhereCondition(text, table);
  const confidence = Math.min(1, 0.3 + (filters.length ? 0.3 : 0));
  return { rawText, queryType, matchedTable: table.name, values, filters, notes, confidence };
}
