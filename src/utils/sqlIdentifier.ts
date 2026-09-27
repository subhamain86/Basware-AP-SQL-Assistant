// V14.2 — alias syntax validation (spec section 7: "Validate alias syntax
// where possible"). A conservative, dialect-agnostic check: must start
// with a letter or underscore, followed by letters/digits/underscores
// only, and must not collide with a short list of common reserved words
// that would break generated SQL if used unquoted as an alias.
const RESERVED_WORDS = new Set(['select', 'from', 'where', 'group', 'order', 'having', 'join', 'on', 'and', 'or', 'not', 'null', 'as', 'distinct', 'case', 'when', 'then', 'else', 'end', 'with', 'union', 'insert', 'update', 'delete', 'table', 'view']);
export interface AliasValidationResult { valid: boolean; message?: string; }
export function validateAlias(alias: string): AliasValidationResult {
  const trimmed = alias.trim();
  if (trimmed === '') return { valid: true }; // empty alias is always fine — simply means "no alias"
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return { valid: false, message: 'Alias must start with a letter or underscore, and contain only letters, digits, and underscores (no spaces or symbols).' };
  if (RESERVED_WORDS.has(trimmed.toLowerCase())) return { valid: false, message: `"${trimmed}" is a reserved SQL keyword and cannot be used as an alias.` };
  return { valid: true };
}
