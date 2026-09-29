import type { SchemaModel, SchemaConflict } from '../types';
import { detectConflict } from './schemaVersionEngine';

/**
 * V16.4 — root-cause fix for "Schema Sync and Active Schema Sync across
 * devices is not working."
 * V16.5 — the V16.4 fix only applied the Active Schema pointer on the
 * AUTHENTICATED pull path (`pullRegistryFromGitHub`), which only runs once
 * per session after the user manually unlocks Settings with the Admin
 * Password (Settings' unlock state is session-only and is NOT persisted
 * across page reloads). In practice, most users never open Settings just
 * to browse or run a query — they just use Read Only Query Builder / CR
 * Builder directly. That meant the Active Schema pointer effectively never
 * synchronized for the common flow, even though schema CONTENT already
 * synchronizes automatically and silently on every app load via the
 * unauthenticated `discoverPublicRegistry()` path. V16.5 closes this gap:
 * see syncService.ts, where `discoverPublicRegistry()` now also applies
 * the same Active Schema pointer arbitration below — using the exact same
 * public, unauthenticated GitHub read that already syncs schema content,
 * so there is no new trust boundary crossed and no new credential
 * requirement introduced.
 *
 * These are deliberately PURE functions (no network, no crypto, no vault,
 * no localStorage) so the actual decision logic can be unit-tested
 * directly and exhaustively, and so the same logic is reused identically
 * by the pull path, the pre-push merge step, and the now-fixed background
 * discovery path — guaranteeing all three behave consistently instead of
 * drifting apart (which is exactly how this class of bug creeps in).
 *
 * ---------------------------------------------------------------------
 * Schema Sync — push was a blind overwrite.
 * ---------------------------------------------------------------------
 * Previously, `pushRegistryToGitHub()` serialized ONLY the local registry
 * and PUT it to GitHub, unconditionally replacing the remote file. If
 * Device B had already pushed a new/changed schema that Device A had never
 * pulled, Device A's next push would silently erase Device B's schema from
 * the central store — even though nothing on Device A's screen ever
 * indicated a problem. `planSchemaMerge()` is now run BEFORE every push:
 * any schema that exists remotely but not locally is folded into the local
 * registry first (via schemaService.addSchemaFromRemote, which this
 * function's 'add' verdict drives), so the push payload can never again
 * accidentally drop a schema that only exists on another device. Any
 * schema that exists on both sides but has actually diverged is flagged
 * 'conflict' (unchanged from the existing pull-side conflict-resolution
 * design — the user still explicitly picks Local or Remote via the
 * existing conflict banner) rather than one side blindly winning.
 *
 * ---------------------------------------------------------------------
 * Active Schema Sync — the pointer needs its own timestamp to compare.
 * ---------------------------------------------------------------------
 * Every individual SchemaModel already carries version metadata
 * (`versionMeta.checksum`) so ITS OWN content can be compared across
 * devices. Which schema was ACTIVE is stored as `activeSchemaId` paired
 * with `activeSchemaUpdatedAt` (stamped fresh, in schemaService.ts, every
 * time a user explicitly switches the Active Schema).
 * `shouldApplyRemoteActiveSchema()` is a small, explicit last-write-wins
 * comparison using that timestamp — the same pattern already used for
 * individual schema conflict detection, just applied to the "which one is
 * active" pointer instead of schema content. This is what makes
 * cross-device Active Schema sync possible AT ALL, while still satisfying
 * "must not unexpectedly revert" (a remote pointer is only ever applied
 * when it is strictly newer than the local one, and only once the
 * referenced schema is confirmed to exist locally).
 */

export type SchemaMergeActionKind = 'add' | 'conflict' | 'unchanged';
export interface SchemaMergeAction { kind: SchemaMergeActionKind; schema: SchemaModel; conflict?: SchemaConflict; }

/**
 * Decide, for every schema present in a (sanitized, already-validated)
 * remote registry, what the local schema store should do with it:
 *   - 'add'       : unknown locally -> safe to add without asking anyone.
 *   - 'conflict'  : known locally AND remote content differs (per
 *                   checksum) -> defer to the existing user-facing
 *                   conflict-resolution UI; never auto-pick a winner here.
 *   - 'unchanged' : known locally and checksums match -> nothing to do.
 * This intentionally mirrors the exact conflict semantics
 * `detectConflict()` already used for the pull path in V16.1-V16.3 — no
 * new conflict-resolution behaviour is introduced, only where the check is
 * invoked from (now shared by pull, push-pre-merge, AND background
 * discovery).
 */
export function planSchemaMerge(localSchemas: SchemaModel[], remoteSchemas: SchemaModel[]): SchemaMergeAction[] {
  return remoteSchemas.map((remoteSchema) => {
    const local = localSchemas.find((s) => s.id === remoteSchema.id);
    if (!local) return { kind: 'add', schema: remoteSchema };
    const conflict = detectConflict(local, remoteSchema);
    if (!conflict.hasConflict) return { kind: 'unchanged', schema: remoteSchema };
    return { kind: 'conflict', schema: remoteSchema, conflict };
  });
}

export interface ActiveSchemaPointer { activeSchemaId: string; activeSchemaUpdatedAt: string | null; }

/**
 * Last-write-wins arbitration for the Active Schema selection itself.
 *   - No remote pointer at all                              -> false (nothing to apply).
 *   - Remote points at the same schema already active locally -> false (no-op, already in sync).
 *   - Local has never explicitly stamped a pointer time       -> true  (adopt remote; this is the
 *                                                                        common "brand-new device,
 *                                                                        or pre-V16.4 local data"
 *                                                                        case — there is no local
 *                                                                        preference to protect yet).
 *   - Remote has no timestamp but local does                  -> false (never let an untimed
 *                                                                        pointer silently override
 *                                                                        a timed, deliberate local
 *                                                                        choice).
 *   - Both timed                                              -> apply remote only if its
 *                                                                 timestamp is strictly newer.
 * This is the exact rule that satisfies "the Active Schema must not
 * unexpectedly revert to another schema simply because the application is
 * opened on another device" — a revert can only ever happen when the
 * remote selection is demonstrably MORE RECENT than the local one.
 */
export function shouldApplyRemoteActiveSchema(local: ActiveSchemaPointer, remote: ActiveSchemaPointer): boolean {
  if (!remote.activeSchemaId) return false;
  if (remote.activeSchemaId === local.activeSchemaId) return false;
  if (!local.activeSchemaUpdatedAt) return true;
  if (!remote.activeSchemaUpdatedAt) return false;
  return new Date(remote.activeSchemaUpdatedAt).getTime() > new Date(local.activeSchemaUpdatedAt).getTime();
}
