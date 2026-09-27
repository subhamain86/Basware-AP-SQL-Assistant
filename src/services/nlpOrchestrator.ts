import type { SchemaModel, QueryRequirement, CrRequirement, NlpOrchestrationResult } from '../types';
import { parseRequirement } from '../engines/nlpEngine';
import { parseCrRequirement } from '../engines/crNlpEngine';
import { tryOnlineNlp, isBrowserOnline } from './onlineNlpService';
function schemaSummaryForPrompt(schema: SchemaModel): string { return schema.tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(',')})`).join('; '); }
function sanitizeOnlineTables(names: string[] | undefined, schema: SchemaModel): string[] { if (!names) return []; const known = new Set(schema.tables.map((t) => t.name)); return names.filter((n) => known.has(n)); }
export async function orchestrateReadOnlyNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<QueryRequirement>> {
  const offlineResult = parseRequirement(rawText, schema);
  if (!rawText.trim()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
  if (!isBrowserOnline()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
  const online = await tryOnlineNlp(rawText, schemaSummaryForPrompt(schema));
  if (!online) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
  const mergedTables = sanitizeOnlineTables(online.tables, schema);
  const merged: QueryRequirement = { ...offlineResult, matchedTables: mergedTables.length ? mergedTables : offlineResult.matchedTables, notes: [...offlineResult.notes, 'Online AI/NLP response received and schema-validated.'] };
  return { result: merged, engineUsed: 'online', onlineAttempted: true };
}
export async function orchestrateCrNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<CrRequirement>> {
  const offlineResult = parseCrRequirement(rawText, schema);
  if (!rawText.trim()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
  if (!isBrowserOnline()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
  const online = await tryOnlineNlp(rawText, schemaSummaryForPrompt(schema));
  if (!online) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
  return { result: offlineResult, engineUsed: 'online', onlineAttempted: true };
}
