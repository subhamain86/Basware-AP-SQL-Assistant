import type { SchemaModel, QueryRequirement, CrRequirement, NlpOrchestrationResult } from '../types';
import { parseRequirement, filterToKnownTables, filterToKnownColumns } from '../engines/nlpEngine';
import { parseCrRequirement } from '../engines/crNlpEngine';
import { tryOnlineNlp, isBrowserOnline } from './onlineNlpService';
export interface ActiveSchemaAvailability { available: boolean; reason?: string; }
export function validateActiveSchemaAvailability(schema: SchemaModel | null | undefined): ActiveSchemaAvailability {
  if (!schema) return { available: false, reason: 'No Active Schema is currently set.' };
  if (!Array.isArray(schema.tables) || schema.tables.length === 0) return { available: false, reason: `Active Schema "${schema.name}" has no tables defined yet.` };
  return { available: true };
}
/** V15.5 — builds the rich schema context string sent to the Online AI/NLP
 * endpoint (per requirement #22: "the online AI must receive/use the
 * relevant schema context before generating SQL... must not generate SQL
 * based solely on general AI knowledge"). Extended to also surface
 * DECODE-as-CASE metadata explicitly, and cached per-schema-checksum so an
 * unchanged Active Schema is not needlessly re-serialized on every
 * keystroke/build (V15.5 performance requirement — "avoid repeatedly
 * sending the same schema context to an online endpoint when unnecessary"). */
let cachedContextChecksum: string | null = null;
let cachedContextString: string | null = null;
function buildRichSchemaContext(schema: SchemaModel): string {
  const checksum = `${schema.id}:${schema.versionMeta?.checksum || schema.updatedAt}`;
  if (cachedContextChecksum === checksum && cachedContextString) return cachedContextString;
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
        if (c.decode?.length) flags.push(`CASE-MAPPING:${c.decode.map((d) => `${d.rawValue}=${d.label}`).join('|')}`);
        return `${c.name}:${c.type}${flags.length ? `[${flags.join(',')}]` : ''}`;
      }).join(', ');
      parts.push(`  ${kind} ${t.name} (${t.description}) — columns: ${cols}`);
    });
  });
  if (schema.relationships.length) parts.push(`RELATIONSHIPS: ${schema.relationships.map((r) => `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`).join('; ')}`);
  parts.push('NOTE: Any column with a CASE-MAPPING must be rendered as a CASE WHEN...THEN...ELSE...END expression, never as a database-specific DECODE() function call.');
  const result = parts.join('\n');
  cachedContextChecksum = checksum; cachedContextString = result;
  return result;
}
export async function orchestrateReadOnlyNlp(rawText: string, schema: SchemaModel): Promise<NlpOrchestrationResult<QueryRequirement>> {
  const availability = validateActiveSchemaAvailability(schema);
  const offlineResult = parseRequirement(rawText, schema);
  if (!availability.available) { offlineResult.notes.unshift(`Active Schema unavailable: ${availability.reason}`); return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: availability.reason }; }
  if (!rawText.trim()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
  if (!isBrowserOnline()) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
  const online = await tryOnlineNlp(rawText, buildRichSchemaContext(schema));
  if (!online) return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
  const { known: knownTables, unknown: unknownTables } = filterToKnownTables(online.tables || [], schema);
  const onlineColumnPairs = (online.columns || []).map((c) => ({ table: c.table, column: c.column }));
  const { unknown: unknownColumns } = filterToKnownColumns(onlineColumnPairs, schema);
  const notes = [...offlineResult.notes, `Active Schema used for this request: "${schema.name}" (v${schema.versionMeta?.version ?? schema.version}) — schema-validated online response.`];
  if (unknownTables.length) notes.push(`Online AI/NLP referenced table(s) not present in the Active Schema and they were discarded: ${unknownTables.join(', ')}.`);
  if (unknownColumns.length) notes.push(`Online AI/NLP referenced column(s) not present in the Active Schema and they were discarded: ${unknownColumns.map((c) => `${c.table}.${c.column}`).join(', ')}.`);
  // V15.5 — the online engine is only ever used to CORROBORATE/expand table
  // and column identification against the Active Schema (never to inject
  // raw SQL text directly and never to override the offline pipeline's
  // aggregation/GROUP BY/HAVING/related-condition resolution, which stays
  // fully schema-grounded regardless of engine source).
  const merged: QueryRequirement = { ...offlineResult, matchedTables: knownTables.length ? knownTables : offlineResult.matchedTables, notes, unresolvedTerms: [...offlineResult.unresolvedTerms, ...unknownTables, ...unknownColumns.map((c) => `${c.table}.${c.column}`)] };
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
