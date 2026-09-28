import type { SchemaModel, RelationshipDef, RelatedFilterSpec, RelatedCountSpec, HierarchySpec, Dialect } from '../types';

export function relationshipsInvolving(schema: SchemaModel, table: string): RelationshipDef[] {
  return schema.relationships.filter((r) => r.fromTable === table || r.toTable === table);
}

/** Tables reachable via a direct PK/FK relationship from any of the currently
 * selected tables, but not already selected themselves — used to populate
 * the "related table" pickers for EXISTS / related-count so the user is
 * never asked to hand-write a JOIN condition when the Active Schema already
 * knows the relationship. */
export function relatableTables(schema: SchemaModel, selectedTables: string[]): { table: string; relationshipId: string }[] {
  const seen = new Map<string, string>();
  selectedTables.forEach((t) => {
    relationshipsInvolving(schema, t).forEach((r) => {
      const other = r.fromTable === t ? r.toTable : r.fromTable;
      if (!selectedTables.includes(other) && !seen.has(other)) seen.set(other, r.id);
    });
  });
  return Array.from(seen.entries()).map(([table, relationshipId]) => ({ table, relationshipId }));
}

function relationshipById(schema: SchemaModel, id: string | null): RelationshipDef | undefined {
  if (!id) return undefined;
  return schema.relationships.find((r) => r.id === id);
}
function findRelationship(schema: SchemaModel, relationshipId: string | null, anchorTable: string, otherTable: string): RelationshipDef | undefined {
  return relationshipById(schema, relationshipId) || schema.relationships.find((r) => (r.fromTable === anchorTable && r.toTable === otherTable) || (r.toTable === anchorTable && r.fromTable === otherTable));
}
function correlationCondition(rel: RelationshipDef, anchorTable: string, innerTable: string): string {
  if (rel.toTable === innerTable) return `${anchorTable}.${rel.fromColumn} = ${innerTable}.${rel.toColumn}`;
  return `${anchorTable}.${rel.toColumn} = ${innerTable}.${rel.fromColumn}`;
}

/** Correlated EXISTS/NOT EXISTS predicate for "only show records connected
 * to another table". Silently skipped by the caller if the relationship no
 * longer resolves (e.g. after an Active Schema switch). */
export function buildRelatedFilterClause(spec: RelatedFilterSpec, anchorTable: string, schema: SchemaModel): string | null {
  const rel = findRelationship(schema, spec.relationshipId, anchorTable, spec.relatedTable);
  if (!rel) return null;
  const cond = correlationCondition(rel, anchorTable, spec.relatedTable);
  return `${spec.mode} (SELECT 1 FROM ${spec.relatedTable} WHERE ${cond})`;
}

/** Correlated `(SELECT COUNT(*) ...) AS alias` scalar subquery for "show a
 * related count". */
export function buildRelatedCountSelect(spec: RelatedCountSpec, anchorTable: string, schema: SchemaModel): string | null {
  const rel = findRelationship(schema, spec.relationshipId, anchorTable, spec.relatedTable);
  if (!rel) return null;
  const cond = correlationCondition(rel, anchorTable, spec.relatedTable);
  const alias = spec.alias.trim() || `${spec.relatedTable.toLowerCase()}_count`;
  return `(\n    SELECT COUNT(*)\n    FROM ${spec.relatedTable}\n    WHERE ${cond}\n  ) AS ${alias}`;
}

export interface HierarchyBlock { cteLines: string[]; fromClause: string | null; usesRecursiveKeyword: boolean; selectColumns: string; }

/** Recursive hierarchy / "org chart" block. Standard dialects get a proper
 * `WITH RECURSIVE` CTE (with a `depth` tracking column so an optional max
 * depth can be enforced); Oracle gets `CONNECT BY PRIOR` instead, the
 * dialect-idiomatic form for hierarchical queries. */
export function buildHierarchyBlock(hierarchy: HierarchySpec, dialect: Dialect): HierarchyBlock {
  if (!hierarchy.enabled || !hierarchy.table || !hierarchy.parentColumn || !hierarchy.childColumn) {
    return { cteLines: [], fromClause: null, usesRecursiveKeyword: false, selectColumns: '*' };
  }
  const t = hierarchy.table; const parent = hierarchy.parentColumn; const child = hierarchy.childColumn;
  const rootFilter = hierarchy.rootValue.trim() ? `${t}.${child} = ${hierarchy.rootValue.trim()}` : `${t}.${parent} IS NULL`;
  if (dialect === 'Oracle') {
    const depthClause = hierarchy.maxDepth ? ` AND LEVEL <= ${hierarchy.maxDepth}` : '';
    return {
      cteLines: [],
      fromClause: `${t}\nSTART WITH ${rootFilter}\nCONNECT BY PRIOR ${t}.${child} = ${t}.${parent}${depthClause}`,
      usesRecursiveKeyword: false,
      selectColumns: `${t}.*, LEVEL AS depth`
    };
  }
  const name = (hierarchy.cteName || 'org_hierarchy').trim() || 'org_hierarchy';
  const depthGuard = hierarchy.maxDepth ? `\n  WHERE h.depth < ${hierarchy.maxDepth}` : '';
  const cteLines = [
    `${name} AS (`,
    `  SELECT ${t}.*, 1 AS depth`,
    `  FROM ${t}`,
    `  WHERE ${rootFilter}`,
    `  UNION ALL`,
    `  SELECT ${t}.*, h.depth + 1`,
    `  FROM ${t}`,
    `  INNER JOIN ${name} h ON ${t}.${parent} = h.${child}${depthGuard}`,
    `)`
  ];
  return { cteLines, fromClause: name, usesRecursiveKeyword: true, selectColumns: '*' };
}
