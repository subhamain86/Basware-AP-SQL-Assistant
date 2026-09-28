import type { ReadOnlyQueryState, SchemaModel, SelectedColumnSpec } from '../types';
import { renderFilterClause } from './filterEngine';
import { buildSchemaDecodeExpression } from './decodeEngine';
import { computeAutoJoinPlan } from './joinAutoEngine';
import { buildRelatedFilterClause, buildRelatedCountSelect, buildHierarchyBlock } from './relatedEngine';
import { validateAlias } from '../utils/sqlIdentifier';

function renderColumn(spec: SelectedColumnSpec, schema: SchemaModel, dialect: ReadOnlyQueryState['dialect']): string {
  if (spec.manualExpr) return spec.manualExpr;
  const base = spec.aggregate ? `${spec.aggregate}(${spec.table}.${spec.column})` : `${spec.table}.${spec.column}`;
  if (spec.displayMode === 'schema-decode') {
    const table = schema.tables.find((t) => t.name === spec.table);
    const col = table?.columns.find((c) => c.name === spec.column);
    if (col && col.decode?.length) {
      // V15.5 — DECODE is CASE-based functionality: the default alias when
      // the user hasn't typed a custom one is now simply the column's own
      // name (matching the spec's own examples, e.g. "END AS status"),
      // rather than an auto-suffixed "_DESC" — the CASE expression fully
      // replaces the raw value under the column's own identity.
      const alias = spec.alias || spec.column;
      return buildSchemaDecodeExpression(`${spec.table}.${spec.column}`, col, alias, dialect);
    }
  }
  return spec.alias ? `${base} AS ${spec.alias}` : base;
}

function buildWhereClauseFromFilters(state: ReadOnlyQueryState): string {
  if (state.filters.length === 0) return '';
  const parts = state.filters.map((f, idx) => {
    const clause = renderFilterClause(f.table, f.column, f.operator, f.value, f.value2);
    return idx === 0 ? clause : `${f.combinator} ${clause}`;
  });
  return parts.join('\n  ');
}

/** V15.5 — resolves the display expression used to reference a SELECT-list
 * entry from ORDER BY / HAVING: if the column was given an alias, ORDER BY
 * should use the alias (cleaner, and required when the entry is an
 * aggregate/CASE expression that has no bare column reference); otherwise
 * fall back to the fully-qualified table.column form exactly as before. */
function resolveOrderByRef(sortAlias: string | undefined, table: string, column: string): string {
  return sortAlias ? sortAlias : `${table}.${column}`;
}

export function buildSelectSQL(state: ReadOnlyQueryState, schema: SchemaModel): string {
  const hierarchy = state.advanced.hierarchy;
  const hierarchyActive = !!(hierarchy && hierarchy.enabled && hierarchy.table && hierarchy.parentColumn && hierarchy.childColumn);
  if (state.selectedTables.length === 0 && !hierarchyActive) return '-- Select at least one table (or describe your requirement above) to generate SQL.';
  const primaryTable = hierarchyActive ? hierarchy.table! : state.selectedTables[0];
  const otherTables = hierarchyActive ? [] : state.selectedTables.slice(1);
  const explicitJoinTables = new Set(state.joins.map((j) => j.table));
  const autoJoinTargets = otherTables.filter((t) => !explicitJoinTables.has(t));
  const autoPlan = hierarchyActive ? { joinLines: [] as string[], unresolvedWarnings: [] as string[] } : computeAutoJoinPlan(schema, primaryTable, autoJoinTargets, state.joinPathChoices);

  const hierarchyBlock = hierarchyActive ? buildHierarchyBlock(hierarchy, state.dialect) : null;

  const selectList = state.selectedColumns.length
    ? state.selectedColumns.map((c) => renderColumn(c, schema, state.dialect)).join(',\n  ')
    : (hierarchyBlock ? hierarchyBlock.selectColumns : '*');

  const relatedCountParts = (hierarchyActive ? [] : (state.advanced.relatedCounts || []))
    .map((spec) => buildRelatedCountSelect(spec, primaryTable, schema))
    .filter((v): v is string => !!v);
  const fullSelectList = [selectList, ...relatedCountParts].filter((v) => v && v !== '*').length
    ? [selectList === '*' && relatedCountParts.length ? `${primaryTable}.*` : selectList, ...relatedCountParts].join(',\n  ')
    : selectList;

  const bodyLines: string[] = [];
  const cteParts: string[] = [];
  if (state.advanced.ctes.length) {
    cteParts.push(...state.advanced.ctes.filter((c) => c.name.trim() && c.body.trim()).map((c) => `${c.name} AS (\n  ${c.body}\n)`));
  }
  if (hierarchyBlock && hierarchyBlock.cteLines.length) cteParts.push(hierarchyBlock.cteLines.join('\n'));
  const usesRecursive = state.advanced.recursive || !!(hierarchyBlock && hierarchyBlock.usesRecursiveKeyword);

  bodyLines.push(`SELECT ${state.advanced.distinct ? 'DISTINCT ' : ''}${state.advanced.limit && state.dialect === 'SQL Server' ? `TOP ${state.advanced.limit} ` : ''}${fullSelectList}`);
  if (hierarchyActive && hierarchyBlock) {
    bodyLines.push(`FROM ${hierarchyBlock.fromClause}`);
  } else {
    bodyLines.push(`FROM ${primaryTable}`);
    autoPlan.joinLines.forEach((jl) => bodyLines.push(jl));
    state.joins.forEach((j) => bodyLines.push(`${j.joinType} ${j.table} ON ${j.onLeftTable}.${j.onLeftColumn} = ${j.table}.${j.onRightColumn}`));
  }
  const whereParts: string[] = [];
  const filterWhere = buildWhereClauseFromFilters(state);
  if (filterWhere) whereParts.push(filterWhere);
  (hierarchyActive ? [] : (state.advanced.relatedFilters || [])).forEach((spec) => {
    const clause = buildRelatedFilterClause(spec, primaryTable, schema);
    if (clause) whereParts.push(clause);
  });
  if (whereParts.length) bodyLines.push(`WHERE ${whereParts.join('\n  AND ')}`);
  if (state.advanced.groupByColumns.length) bodyLines.push(`GROUP BY ${state.advanced.groupByColumns.join(', ')}`);
  if (state.advanced.havingClause.trim()) bodyLines.push(`HAVING ${state.advanced.havingClause.trim()}`);
  if (state.sorts.length) bodyLines.push(`ORDER BY ${state.sorts.map((s) => `${resolveOrderByRef(s.alias, s.table, s.column)} ${s.direction}`).join(', ')}`);
  if (state.advanced.limit && state.dialect !== 'SQL Server') {
    if (state.dialect === 'Oracle') bodyLines.push(`FETCH FIRST ${state.advanced.limit} ROWS ONLY`);
    else bodyLines.push(`LIMIT ${state.advanced.limit}`);
  }

  const friendlyName = (state.advanced.saveAsView || '').trim();
  const nameCheck = friendlyName ? validateAlias(friendlyName) : { valid: true };
  if (friendlyName && nameCheck.valid) {
    cteParts.push(`${friendlyName} AS (\n  ${bodyLines.join('\n  ')}\n)`);
    const finalLines = [`WITH ${usesRecursive ? 'RECURSIVE ' : ''}${cteParts.join(',\n')}`, `SELECT * FROM ${friendlyName}`];
    return finalLines.join('\n') + ';';
  }
  const lines = cteParts.length ? [`WITH ${usesRecursive ? 'RECURSIVE ' : ''}${cteParts.join(',\n')}`, ...bodyLines] : bodyLines;
  return lines.join('\n') + ';';
}
