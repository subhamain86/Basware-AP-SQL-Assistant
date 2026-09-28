/**
 * nlpOrchestrator.ts — Describe What You Need orchestration.
 * Priority: M365 Copilot Enterprise (if enabled+configured) -> generic
 * Online AI/NLP Endpoint (if configured) -> offline engine only. Both online
 * tiers' suggested tables/columns are passed through filterToKnownTables /
 * filterToKnownColumns before ever reaching SQL generation.
 */
import type { SchemaModel, QueryRequirement, CrRequirement, NlpOrchestrationResult } from '../types';
import { parseRequirement, filterToKnownTables, filterToKnownColumns } from '../engines/nlpEngine';
import { parseCrRequirement } from '../engines/crNlpEngine';
import { tryOnlineNlp, isBrowserOnline } from './onlineNlpService';
import { tryM365Copilot, isCopilotConfigured, buildMinimalSchemaContext } from './copilotNlpService';
import { secretVaultService } from './secretVaultService';

export interface ActiveSchemaAvailability { available: boolean; reason?: string; }
export function validateActiveSchemaAvailability(schema: SchemaModel | null | undefined): ActiveSchemaAvailability {
  if (!schema) return { available: false, reason: 'No Active Schema is currently set.' };
  if (!Array.isArray(schema.tables) || schema.tables.length === 0) return { available: false, reason: `Active Schema "${schema.name}" has no tables defined yet.` };
  return { available: true };
}

function buildRichSchemaContext(schema: SchemaModel): string {
  const parts: string[] = [`SCHEMA: ${schema.name} (version ${schema.versionMeta?.version ?? schema.version})`];
  const moduleGroups = new Map<string, typeof schema.tables>();
  schema.tables.forEach((t) => { const list = moduleGroups.get(t.module) || []; list.push(t); moduleGroups.set(t.module, list); });
  moduleGroups.forEach((tables, module) => {
    parts.push(`MODULE: ${module}`);
    tables.forEach((t) => {
      const kind = t.objectType === 'VIEW' ? 'VIEW' : 'TABLE';
      const cols = t.columns.map((c) => {
        const flags: string[] = [];
        if (c.isPrimaryKey) flags.push('PK');
        if (c.isForeignKey && c.references) flags.push(`FK->${c.references.table}.${c.references.column}`);
        if (c.decode?.length) flags.push('DECODE');
        return `${c.name}:${c.type}${flags.length ? `[${flags.join(',')}]` : ''}`;
      }).join(', ');
      parts.push(`  ${kind} ${t.name} (${t.description}) — columns: ${cols}`);
    });
  });
  if (schema.relationships.length) parts.push(`RELATIONSHIPS: ${schema.relationships.map((r) => `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`).join('; ')}`);
  return parts.join('\n');
}

async function tryEnterpriseNlp(rawText: string, schema: SchemaModel): Promise<{ response: NonNullable<Awaited<ReturnType<typeof tryOnlineNlp>>>; source: 'copilot' | 'online' } | null> {
  const vaultConfig = secretVaultService.isUnlocked() ? secretVaultService.getConfig() : null;
  const copilotConfig = vaultConfig?.m365Copilot ?? null;
  if (isCopilotConfigured(copilotConfig)) {
    const minimalContext = buildMinimalSchemaContext(rawText, schema);
    const copilotResponse = await tryM365Copilot(copilotConfig!, rawText, minimalContext);
    if (copilotResponse) return { response: copilotResponse, source: 'copilot' };
  }
  if (!isBrowserOnline()) return null;
  const onlineResponse = await tryOnlineNlp(rawText, buildRichSchemaContext(schema));
  if (onlineResponse) return { response: onlineResponse, source: 'online' };
  return null;
}

export async function orchestrateReadOnlyNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<QueryRequirement>> {
  const availability = validateActiveSchemaAvailability(schema);
  const offlineResult = parseRequirement(rawText, schema);
  if (!availability.available) { offlineResult.notes.unshift(`Active Schema unavailable: ${availability.reason}`); return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: availability.reason }; }
  if (!rawText.trim()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
  if (!isBrowserOnline()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
  const enterprise = await tryEnterpriseNlp(rawText, schema);
  if (!enterprise) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
  const { response: online, source } = enterprise;
  const { known: knownTables, unknown: unknownTables } = filterToKnownTables(online.tables || [], schema);
  const onlineColumnPairs = (online.columns || []).map((c) => ({ table: c.table, column: c.column }));
  const { unknown: unknownColumns } = filterToKnownColumns(onlineColumnPairs, schema);
  const engineLabel = source === 'copilot' ? 'M365 Copilot Enterprise' : 'generic Online AI/NLP Endpoint';
  const notes = [...offlineResult.notes, `Active Schema used for this request: "${schema.name}" (v${schema.versionMeta?.version ?? schema.version}) — schema-validated ${engineLabel} response.`];
  if (unknownTables.length) notes.push(`${engineLabel} referenced table(s) not present in the Active Schema and they were discarded: ${unknownTables.join(', ')}.`);
  if (unknownColumns.length) notes.push(`${engineLabel} referenced column(s) not present in the Active Schema and they were discarded: ${unknownColumns.map((c) => `${c.table}.${c.column}`).join(', ')}.`);
  const merged: QueryRequirement = { ...offlineResult, matchedTables: knownTables.length ? knownTables : offlineResult.matchedTables, notes, unresolvedTerms: [...offlineResult.unresolvedTerms, ...unknownTables, ...unknownColumns.map((c) => `${c.table}.${c.column}`)] };
  return { result: merged, engineUsed: source, onlineAttempted: true };
}

export async function orchestrateCrNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<CrRequirement>> {
  const availability = validateActiveSchemaAvailability(schema);
  const offlineResult = parseCrRequirement(rawText, schema);
  if (!availability.available) { offlineResult.notes.unshift(`Active Schema unavailable: ${availability.reason}`); return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: availability.reason }; }
  if (!rawText.trim()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
  if (!isBrowserOnline()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
  const enterprise = await tryEnterpriseNlp(rawText, schema);
  if (!enterprise) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
  return { result: offlineResult, engineUsed: enterprise.source, onlineAttempted: true };
}
