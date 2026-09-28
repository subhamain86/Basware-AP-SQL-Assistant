/**
 * M365 Copilot Enterprise adapter for "Describe What You Need" (unchanged
 * from V16.0). Read-only with respect to the schema; only ever returns a
 * plain data object that is later filtered through filterToKnownTables /
 * filterToKnownColumns before touching SQL generation.
 */
import type { M365CopilotConfig } from './secretVaultService';
import { acquireCopilotToken } from './msalAuthService';
import type { OnlineNlpResponse } from './onlineNlpService';

const TIMEOUT_MS = 8000;

export function isCopilotConfigured(config: M365CopilotConfig | null | undefined): boolean {
  return !!config && config.enabled && !!config.tenantId && !!config.clientId && !!config.agentEndpoint && !!config.scope;
}

export async function tryM365Copilot(config: M365CopilotConfig, prompt: string, minimalSchemaContext: string): Promise<OnlineNlpResponse | null> {
  if (!isCopilotConfigured(config)) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  let token: string;
  try {
    token = await acquireCopilotToken({ tenantId: config.tenantId, clientId: config.clientId, scope: config.scope });
  } catch {
    return null;
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

export function buildMinimalSchemaContext(promptText: string, schema: { tables: { name: string; module: string; description: string; columns: { name: string; type: string; description: string }[] }[]; relationships: { fromTable: string; fromColumn: string; toTable: string; toColumn: string }[] }): string {
  const words = new Set((promptText.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2));
  const overlap = (text: string): number => { let hits = 0; const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) || []); for (const t of tokens) if (words.has(t)) hits++; return hits; };
  const scored = schema.tables.map((t) => ({ t, score: overlap(`${t.name} ${t.module} ${t.description}`) })).sort((a, b) => b.score - a.score);
  const relevant = scored.filter((s) => s.score > 0).slice(0, 6).map((s) => s.t);
  const chosen = relevant.length ? relevant : schema.tables.slice(0, 3);
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
