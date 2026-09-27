export function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  return fallback;
}
export function safeTrim(value: unknown, fallback = ''): string {
  return safeString(value, fallback).trim();
}
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
export interface NameValidationResult { valid: boolean; message?: string; }
export function validateSchemaName(rawName: unknown, existingNames: string[], excludeName?: string | null): NameValidationResult {
  const name = safeTrim(rawName);
  if (!name) return { valid: false, message: 'Schema name is required.' };
  if (name.length > 80) return { valid: false, message: 'Schema name must be 80 characters or fewer.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _\-.]*$/.test(name)) return { valid: false, message: 'Schema name may only contain letters, digits, spaces, underscores, hyphens, and periods, and must start with a letter or digit.' };
  const normalizedExisting = existingNames.map((n) => safeTrim(n).toLowerCase());
  const excludeNormalized = excludeName ? safeTrim(excludeName).toLowerCase() : null;
  const clash = normalizedExisting.some((n) => n === name.toLowerCase() && n !== excludeNormalized);
  if (clash) return { valid: false, message: `A schema named "${name}" already exists — schema names must be unique.` };
  return { valid: true };
}
export interface SyncConfigCheckField { key: string; label: string; value: unknown; required: boolean; sensitive?: boolean; }
export interface SyncConfigCheckResult { ok: boolean; missingFields: string[]; message: string | null; }
export function assertSyncConfigOrError(fields: SyncConfigCheckField[]): SyncConfigCheckResult {
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    if (!isNonEmptyString(f.value)) missing.push(f.label);
  }
  if (missing.length === 0) return { ok: true, missingFields: [], message: null };
  const message = `Repository synchronization configuration is incomplete. Please verify the required configuration in Secret Vault. Missing: ${missing.join(', ')}.`;
  return { ok: false, missingFields: missing, message };
}
