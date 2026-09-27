import type { SchemaModel, RelationshipDef } from '../types';

// ============================================================================
// joinAutoEngine — V14.2 (spec sections 2-5). Determines the JOIN clauses
// needed to connect a set of selected tables, using ONLY the Active
// Schema's declared primary-key/foreign-key relationships — never an
// invented or arbitrary guess.
//
// Algorithm, per pair of tables that need connecting:
//   1. Direct relationship — look for RelationshipDef entries connecting
//      the two tables directly (in either direction). If more than one
//      exists, that pair is AMBIGUOUS (multiple valid FK paths between the
//      same two tables) and must be surfaced to the user rather than
//      silently picking one (spec section 5).
//   2. One-hop bridge — if no direct relationship exists, search the WHOLE
//      schema (not just the selected tables) for a third table that has a
//      relationship to BOTH tables in the pair (e.g. INVOICE_HEADER and
//      ORGANIZATION connect via VENDOR: INVOICE_HEADER -> VENDOR ->
//      ORGANIZATION). If multiple distinct bridge tables satisfy this,
//      that's also ambiguous. The bridge table is added to the query's
//      FROM/JOIN clauses automatically, even though the user never
//      explicitly selected it — this is what makes "Invoice -> Supplier ->
//      Organization" work purely from a Natural Language or manual
//      2-table selection, per the spec's own worked example.
//   3. No path found — do NOT emit a guessed/arbitrary join. Instead report
//      a clear warning so the user can add an explicit manual join if they
//      know one is needed. (V14.1 previously emitted an "ON 1=1" fallback
//      guess here — that was a real bug; a arbitrary/always-true join
//      condition is worse than no join at all, so V14.2 removes it.)
// ============================================================================

export interface JoinPathOption {
  id: string;               // stable identifier for this option, used as the joinPathChoices value
  label: string;            // human-readable description shown in the ambiguity-resolution UI
  bridgeTable: string | null; // non-null when this option requires an intermediate table
  relationships: RelationshipDef[]; // the 1 or 2 relationship(s) this option is built from
}
export interface JoinPathResolution {
  pairKey: string;          // "TableA|TableB", tables sorted alphabetically
  tableA: string;
  tableB: string;
  options: JoinPathOption[];
  isAmbiguous: boolean;
  chosenOptionId: string | null; // null until the user picks one (or auto-picked if only 1 option)
}
export interface AutoJoinPlan {
  joinLines: string[];        // ready-to-emit "INNER JOIN X ON ..." lines, in a safe order
  bridgeTablesUsed: string[]; // tables pulled in automatically that the user didn't explicitly select
  resolutions: JoinPathResolution[]; // one entry per connected pair, including unresolved-ambiguous ones
  unresolvedWarnings: string[]; // pairs with NO relationship found at all — no join emitted for these
}

function pairKey(a: string, b: string): string { return [a, b].sort().join('|'); }

function directRelationships(schema: SchemaModel, a: string, b: string): RelationshipDef[] {
  return schema.relationships.filter((r) => (r.fromTable === a && r.toTable === b) || (r.fromTable === b && r.toTable === a));
}

function bridgeTablesBetween(schema: SchemaModel, a: string, b: string, excludeTables: Set<string>): { bridge: string; relA: RelationshipDef; relB: RelationshipDef }[] {
  const results: { bridge: string; relA: RelationshipDef; relB: RelationshipDef }[] = [];
  for (const t of schema.tables) {
    if (t.name === a || t.name === b || excludeTables.has(t.name)) continue;
    const relsToA = directRelationships(schema, t.name, a);
    const relsToB = directRelationships(schema, t.name, b);
    if (relsToA.length > 0 && relsToB.length > 0) {
      // Only take the first relationship on each side for this bridge —
      // if the bridge itself has multiple relationships to A or B, that
      // inner ambiguity is rare enough to not need a second UI layer; the
      // bridge is still reported as one candidate "path option".
      results.push({ bridge: t.name, relA: relsToA[0], relB: relsToB[0] });
    }
  }
  return results;
}

function relationshipJoinLine(rel: RelationshipDef, alreadyIncluded: string, joining: string): string {
  // Emits the join FROM the table already in scope TO the new table,
  // regardless of which side of the relationship declares the FK.
  if (rel.fromTable === alreadyIncluded) return `INNER JOIN ${joining} ON ${alreadyIncluded}.${rel.fromColumn} = ${joining}.${rel.toColumn}`;
  return `INNER JOIN ${joining} ON ${joining}.${rel.fromColumn} = ${alreadyIncluded}.${rel.toColumn}`;
}

/** Computes the full join plan for a primary table plus a list of other
 * tables that must be connected to it (directly or transitively). Table
 * order matters: `primaryTable` is assumed already in FROM; each entry in
 * `otherTables` is connected against whichever tables are already in
 * scope (primary + previously resolved ones + any bridge tables pulled in
 * along the way), preferring the primary table first. */
export function computeAutoJoinPlan(schema: SchemaModel, primaryTable: string, otherTables: string[], joinPathChoices: Record<string, string>): AutoJoinPlan {
  const joinLines: string[] = [];
  const bridgeTablesUsed: string[] = [];
  const resolutions: JoinPathResolution[] = [];
  const unresolvedWarnings: string[] = [];
  const inScope = new Set<string>([primaryTable]);
  const joinedPairs = new Set<string>(); // avoid emitting the same physical join line twice

  for (const target of otherTables) {
    if (inScope.has(target)) continue;

    // Try connecting `target` to EACH table already in scope, preferring
    // the primary table first (most natural/readable SQL), then whichever
    // was added most recently.
    const scopeList = [primaryTable, ...Array.from(inScope).filter((t) => t !== primaryTable)];
    let resolved = false;

    for (const anchor of scopeList) {
      const key = pairKey(anchor, target);
      if (joinedPairs.has(key)) { resolved = true; break; }

      const direct = directRelationships(schema, anchor, target);
      const bridges = direct.length === 0 ? bridgeTablesBetween(schema, anchor, target, inScope) : [];

      const options: JoinPathOption[] = [
        ...direct.map((rel, idx) => ({ id: `direct:${rel.id}`, label: `Direct: ${anchor}.${rel.fromTable === anchor ? rel.fromColumn : rel.toColumn} = ${target}.${rel.fromTable === target ? rel.fromColumn : rel.toColumn}`, bridgeTable: null, relationships: [rel] })),
        ...bridges.map((b) => ({ id: `bridge:${b.bridge}`, label: `Via ${b.bridge}: ${anchor} → ${b.bridge} → ${target}`, bridgeTable: b.bridge, relationships: [b.relA, b.relB] }))
      ];

      if (options.length === 0) continue; // try the next anchor in scope

      const isAmbiguous = options.length > 1;
      let chosenId = joinPathChoices[key] && options.some((o) => o.id === joinPathChoices[key]) ? joinPathChoices[key] : (isAmbiguous ? null : options[0].id);

      resolutions.push({ pairKey: key, tableA: anchor, tableB: target, options, isAmbiguous, chosenOptionId: chosenId });

      if (chosenId) {
        const chosen = options.find((o) => o.id === chosenId)!;
        if (chosen.bridgeTable && !inScope.has(chosen.bridgeTable)) {
          joinLines.push(relationshipJoinLine(chosen.relationships[0], anchor, chosen.bridgeTable));
          inScope.add(chosen.bridgeTable);
          bridgeTablesUsed.push(chosen.bridgeTable);
          joinLines.push(relationshipJoinLine(chosen.relationships[1], chosen.bridgeTable, target));
        } else if (!chosen.bridgeTable) {
          joinLines.push(relationshipJoinLine(chosen.relationships[0], anchor, target));
        }
        inScope.add(target);
        joinedPairs.add(key);
      }
      resolved = true;
      break;
    }

    if (!resolved) {
      unresolvedWarnings.push(`No relationship path found between "${target}" and the other selected table(s) in the active schema — no JOIN was generated for it. Add an explicit manual join if one is needed, or update the schema's relationship metadata.`);
      inScope.add(target); // still allow it into scope so a cartesian-comment can be added, but never emit a guessed condition
    }
  }

  return { joinLines, bridgeTablesUsed, resolutions, unresolvedWarnings };
}
