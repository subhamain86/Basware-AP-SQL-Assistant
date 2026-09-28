/**
 * V16.0 — M365 Copilot Enterprise adapter for "Describe What You Need".
 *
 * Role in the architecture (per the V16.0 upgrade brief):
 *   Natural language -> M365 Copilot Enterprise -> intent/requirement extraction
 *   -> offline SQL/NLP engine -> Active Schema resolution -> SQL generation -> validation
 *
 * Copilot is used ONLY for natural-language interpretation. It never sees the
 * full schema (only the minimal relevant context passed in), never determines
 * the final database structure, and its response is passed through the SAME
 * `filterToKnownTables` / `filterToKnownColumns` schema-authoritative filter
 * that the existing generic Online AI/NLP Endpoint already uses in
 * nlpOrchestrator.ts — so it is structurally impossible for Copilot to inject
 * a table or column that is not in the Active Schema.
 *
 * Read-only with respect to the schema: this module has no schema-mutation
 * capability at all — it only ever returns a plain data object.
 */
import type { M365CopilotConfig } from './secretVaultService';
import { acquireCopilotToken } from './msalAuthService';
import type { OnlineNlpResponse } from './onlineNlpService';

const TIMEOUT_MS = 8000;

export function isCopilotConfigured(config: M365CopilotConfig | null | undefined): boolean {
  return !!config && config.enabled && !!config.tenantId && !!config.clientId && !!config.agentEndpoint && !!config.scope;
}

/**
 * Calls the organization's own M365 Copilot Enterprise agent / declarative
 * agent endpoint (configured by the admin — see CONFIGURATION.md), passing
 * only the user's text and a minimal, keyword-relevant schema summary.
 * Returns null (never throws) on any failure so the orchestrator can fall
 * back to the offline engine transparently, exactly like the existing
 * generic Online AI/NLP Endpoint already does.
 */
export async function tryM365Copilot(config: M365CopilotConfig, prompt: string, minimalSchemaContext: string): Promise<OnlineNlpResponse | null> {
  if (!isCopilotConfigured(config)) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  let token: string;
  try {
    token = await acquireCopilotToken({ tenantId: config.tenantId, clientId: config.clientId, scope: config.scope });
  } catch {
    return null; // sign-in failed/cancelled/unavailable -> silent fallback, per spec section 5
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(config.agentEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt, schemaContext: minimalSchemaContext }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data as OnlineNlpResponse;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Builds the MINIMUM relevant schema context to send externally: only the
 * table/column names, types, and relationships whose name or description
 * overlaps with a keyword in the user's request — never the full schema,
 * never Secret Vault contents, never other users' data.
 */
export function buildMinimalSchemaContext(promptText: string, schema: { tables: { name: string; module: string; description: string; columns: { name: string; type: string; description: string }[] }[]; relationships: { fromTable: string; fromColumn: string; toTable: string; toColumn: string }[] }): string {
  const words = new Set((promptText.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2));
  const overlap = (text: string): number => { let hits = 0; const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) || []); for (const t of tokens) if (words.has(t)) hits++; return hits; };
  const scored = schema.tables.map((t) => ({ t, score: overlap(`${t.name} ${t.module} ${t.description}`) })).sort((a, b) => b.score - a.score);
  const relevant = scored.filter((s) => s.score > 0).slice(0, 6).map((s) => s.t);
  const chosen = relevant.length ? relevant : schema.tables.slice(0, 3); // never send zero context, but keep it small
  const names = new Set(chosen.map((t) => t.name));
  const parts: string[] = [];
  chosen.forEach((t) => {
    const cols = t.columns.map((c) => `${c.name}:${c.type}`).join(', ');
    parts.push(`TABLE ${t.name} (${t.module}) — ${t.description} — columns: ${cols}`);
  });
  const relevantRels = schema.relationships.filter((r) => names.has(r.fromTable) && names.has(r.toTable));
  if (relevantRels.length) parts.push(`RELATIONSHIPS: ${relevantRels.map((r) => `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`).join('; ')}`);
  return parts.join('\n');
}
