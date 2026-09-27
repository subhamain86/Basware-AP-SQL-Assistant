import { parseRequirement, filterToKnownTables, filterToKnownColumns } from '../engines/nlpEngine.js';
import { parseCrRequirement } from '../engines/crNlpEngine.js';
import { tryOnlineNlp, isBrowserOnline } from './onlineNlpService.js';
export function validateActiveSchemaAvailability(schema) {
    if (!schema)
        return { available: false, reason: 'No Active Schema is currently set.' };
    if (!Array.isArray(schema.tables) || schema.tables.length === 0)
        return { available: false, reason: `Active Schema "${schema.name}" has no tables defined yet.` };
    return { available: true };
}
function buildRichSchemaContext(schema) {
    const parts = [`SCHEMA: ${schema.name} (version ${schema.versionMeta?.version ?? schema.version})`];
    const moduleGroups = new Map();
    schema.tables.forEach((t) => { const list = moduleGroups.get(t.module) || []; list.push(t); moduleGroups.set(t.module, list); });
    moduleGroups.forEach((tables, module) => {
        parts.push(`MODULE: ${module}`);
        tables.forEach((t) => {
            const kind = t.objectType === 'VIEW' ? 'VIEW' : 'TABLE';
            const cols = t.columns.map((c) => {
                const flags = [];
                if (c.isPrimaryKey)
                    flags.push('PK');
                if (c.isForeignKey && c.references)
                    flags.push(`FK->${c.references.table}.${c.references.column}`);
                if (c.decode?.length)
                    flags.push('DECODE');
                return `${c.name}:${c.type}${flags.length ? `[${flags.join(',')}]` : ''}`;
            }).join(', ');
            parts.push(`  ${kind} ${t.name} (${t.description}) — columns: ${cols}`);
        });
    });
    if (schema.relationships.length)
        parts.push(`RELATIONSHIPS: ${schema.relationships.map((r) => `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`).join('; ')}`);
    return parts.join('\n');
}
export async function orchestrateReadOnlyNlp(rawText, schema) {
    const availability = validateActiveSchemaAvailability(schema);
    const offlineResult = parseRequirement(rawText, schema);
    if (!availability.available) {
        offlineResult.notes.unshift(`Active Schema unavailable: ${availability.reason}`);
        return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: availability.reason };
    }
    if (!rawText.trim())
        return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
    if (!isBrowserOnline())
        return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
    const online = await tryOnlineNlp(rawText, buildRichSchemaContext(schema));
    if (!online)
        return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
    const { known: knownTables, unknown: unknownTables } = filterToKnownTables(online.tables || [], schema);
    const onlineColumnPairs = (online.columns || []).map((c) => ({ table: c.table, column: c.column }));
    const { unknown: unknownColumns } = filterToKnownColumns(onlineColumnPairs, schema);
    const notes = [...offlineResult.notes, `Active Schema used for this request: "${schema.name}" (v${schema.versionMeta?.version ?? schema.version}) — schema-validated online response.`];
    if (unknownTables.length)
        notes.push(`Online AI/NLP referenced table(s) not present in the Active Schema and they were discarded: ${unknownTables.join(', ')}.`);
    if (unknownColumns.length)
        notes.push(`Online AI/NLP referenced column(s) not present in the Active Schema and they were discarded: ${unknownColumns.map((c) => `${c.table}.${c.column}`).join(', ')}.`);
    const merged = { ...offlineResult, matchedTables: knownTables.length ? knownTables : offlineResult.matchedTables, notes, unresolvedTerms: [...offlineResult.unresolvedTerms, ...unknownTables, ...unknownColumns.map((c) => `${c.table}.${c.column}`)] };
    return { result: merged, engineUsed: 'online', onlineAttempted: true };
}
export async function orchestrateCrNlp(rawText, schema) {
    const availability = validateActiveSchemaAvailability(schema);
    const offlineResult = parseCrRequirement(rawText, schema);
    if (!availability.available) {
        offlineResult.notes.unshift(`Active Schema unavailable: ${availability.reason}`);
        return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: availability.reason };
    }
    if (!rawText.trim())
        return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false };
    if (!isBrowserOnline())
        return { result: offlineResult, engineUsed: 'offline', onlineAttempted: false, onlineError: 'Browser reports offline.' };
    const online = await tryOnlineNlp(rawText, buildRichSchemaContext(schema));
    if (!online)
        return { result: offlineResult, engineUsed: 'offline', onlineAttempted: true, onlineError: 'No online AI/NLP endpoint configured or reachable.' };
    return { result: offlineResult, engineUsed: 'online', onlineAttempted: true };
}
