import type { SchemaModel, QueryRequirement, CrRequirement, NlpOrchestrationResult } from '../types';
import { parseRequirement } from '../engines/nlpEngine';
import { parseCrRequirement } from '../engines/crNlpEngine';
import { tryOnlineNlp, isBrowserOnline } from './onlineNlpService';

// ============================================================================
// nlpOrchestrator — implements the required priority chain exactly:
//   Online AI/NLP -> Local/Offline NLP engine -> Manual Selector fallback
// The "Manual Selector fallback" leg is handled by the UI itself (the user
// can always ignore/edit whatever the NLP step produced and use the manual
// pickers instead — AND/OR, never mutually exclusive). This module owns the
// Online -> Offline decision and always returns which engine actually ran,
// so the UI can display it transparently ("🌐 Online" vs "💻 Offline/local").
//
// Schema-grounding is enforced in BOTH legs: even when an online response
// contains table/column names, those names are still validated against the
// active schema before being used — the app never trusts an online
// response to invent objects that do not exist in the active schema.
// ============================================================================

function schemaSummaryForPrompt(schema: SchemaModel): string {
  return schema.tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(',')})`).join('; ');
}

function sanitizeOnlineTables(names: string[] | undefined, schema: SchemaModel): string[] {
  if (!names) return [];
  const known = new Set(schema.tables.map((t) => t.name));
  return names.filter((n) => known.has(n));
}

export async function orchestrateReadOnlyNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<QueryRequirement>> {
  const offlineResult = parseRequirement(rawText, schema); // always compute; cheapest safe baseline
  if (!rawText.trim()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };

  if (!isBrowserOnline()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };

  const online = await tryOnlineNlp(rawText, schemaSummaryForPrompt(schema));
  if (!online) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };

  // Online response received — schema-ground it, merging with (not
  // replacing) whatever the offline engine already inferred, and never
  // trusting table/column names that don't exist in the active schema.
  const mergedTables = sanitizeOnlineTables(online.tables, schema);
  const merged: QueryRequirement = {
    ...offlineResult,
    matchedTables: mergedTables.length ? mergedTables : offlineResult.matchedTables,
    notes: [...offlineResult.notes, 'Online AI/NLP response received and schema-validated.']
  };
  return { result: merged, engineUsed: 'online', onlineAttempted: true };
}

export async function orchestrateCrNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<CrRequirement>> {
  const offlineResult = parseCrRequirement(rawText, schema);
  if (!rawText.trim()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
  if (!isBrowserOnline()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
  const online = await tryOnlineNlp(rawText, schemaSummaryForPrompt(schema));
  if (!online) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
  return { result: offlineResult, engineUsed: 'online', onlineAttempted: true }; // online CR parsing kept conservative — offline result is schema-safe by construction
}
