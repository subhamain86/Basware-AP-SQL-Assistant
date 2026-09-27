import type { SchemaModel, QueryRequirement, CrRequirement, NlpOrchestrationResult } from '../types';
import { parseRequirement, filterToKnownTables } from '../engines/nlpEngine';
import { parseCrRequirement } from '../engines/crNlpEngine';
import { tryOnlineNlp, isBrowserOnline } from './onlineNlpService';
export interface ActiveSchemaAvailability { available: boolean; reason?: string; }
export function validateActiveSchemaAvailability(schema: SchemaModel | null | undefined): ActiveSchemaAvailability {
  if (!schema) return { available: false, reason: 'No Active Schema is currently set.' };
  if (!Array.isArray(schema.tables) || schema.tables.length === 0) return { available: false, reason: `Active Schema "${schema.name}" has no tables defined yet.` };
  return { available: true };
}
function buildRichSchemaContext(schema: SchemaModel): string {
  const parts: string[] = [`SCHEMA: ${schema.name}`];
  schema.tables.forEach((t) => { parts.push(`TABLE ${t.name} (${t.description}) — columns: ${t.columns.map((c) => c.name).join(', ')}`); });
  return parts.join('\n');
}
export async function orchestrateReadOnlyNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<QueryRequirement>> {
  const availability = validateActiveSchemaAvailability(schema);
  const offlineResult = parseRequirement(rawText, schema);
  if (!availability.available) { offlineResult.notes.unshift(`Active Schema unavailable: ${availability.reason}`); return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: availability.reason }; }
  if (!rawText.trim()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
  if (!isBrowserOnline()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
  const online = await tryOnlineNlp(rawText, buildRichSchemaContext(schema));
  if (!online) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
  const { known: knownTables } = filterToKnownTables(online.tables || [], schema);
  const merged: QueryRequirement = { ...offlineResult, matchedTables: knownTables.length ? knownTables : offlineResult.matchedTables };
  return { result: merged, engineUsed: 'online', onlineAttempted: true };
}
export async function orchestrateCrNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<CrRequirement>> {
  const availability = validateActiveSchemaAvailability(schema);
  const offlineResult = parseCrRequirement(rawText, schema);
  if (!availability.available) { offlineResult.notes.unshift(`Active Schema unavailable: ${availability.reason}`); return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: availability.reason }; }
  if (!rawText.trim()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
  if (!isBrowserOnline()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
  const online = await tryOnlineNlp(rawText, buildRichSchemaContext(schema));
  if (!online) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
  return { result: offlineResult, engineUsed: 'online', onlineAttempted: true };
}
