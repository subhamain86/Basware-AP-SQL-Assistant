import type { ReadOnlyQueryState, SchemaModel, TableDef, Dialect, SelectedColumnSpec } from '../types';
import { buildWhereClause } from './filterEngine';
import { buildDecodeExpression } from './decodeEngine';
import { computeAutoJoinPlan, type AutoJoinPlan } from './joinAutoEngine';

function findTable(schema: SchemaModel, name: string): TableDef | undefined { return schema.tables.find((t) => t.name === name); }
function limitClause(dialect: Dialect, limit: number | null): { top: string; tail: string } {
  if (!limit || limit <= 0) return { top: '', tail: '' };
  switch (dialect) {
    case 'SQL Server': return { top: `TOP ${limit} `, tail: '' };
    case 'Oracle': return { top: '', tail: `\nFETCH FIRST ${limit} ROWS ONLY` };
    default: return { top: '', tail: `\nLIMIT ${limit}` };
  }
}

// V14.2 — renderColumn now respects `displayMode` (spec sections 7-11):
// 'raw' -> plain column (+ alias if given); 'schema-decode' -> the
// existing schema-defined DECODE/CASE, aliased; 'manual-decode' -> the
// manualExpr the user built for THIS specific column (converted in place,
// never duplicated alongside the raw column — spec section 11).
function renderColumn(sc: SelectedColumnSpec, schema: SchemaModel, dialect: Dialect): string {
  if (sc.manualExpr) return `  ${sc.manualExpr}`;
  const table = findTable(schema, sc.table); const col = table?.columns.find((c) => c.name === sc.column);
  if (!col) return `  ${sc.table}.${sc.column}`;
  let expr = `${sc.table}.${sc.column}`;
  if (sc.aggregate) expr = `${sc.aggregate}(${expr})`;
  const mode = sc.displayMode ?? (sc.useDecode ? 'schema-decode' : 'raw');
  if (mode === 'schema-decode' && col.decode && col.decode.length > 0 && !sc.aggregate) return `  ${buildDecodeExpression(col, sc.table, dialect, sc.alias || undefined)}`;
  const alias = sc.alias ? ` AS ${sc.alias}` : sc.aggregate ? ` AS ${sc.aggregate}_${sc.column}` : '';
  return `  ${expr}${alias}`;
}

export function buildSelectSQL(state: ReadOnlyQueryState, schema: SchemaModel): string {
  if (state.selectedTables.length === 0) return '-- Select at least one table (or describe your requirement above) to generate SQL.';
  const primaryTable = state.selectedTables[0]; const primary = findTable(schema, primaryTable);
  if (!primary) return `-- Unknown table: ${primaryTable}`;
  const { top, tail } = limitClause(state.dialect, state.advanced.limit);
  const selectCols = state.selectedColumns.length ? state.selectedColumns.map((sc) => renderColumn(sc, schema, state.dialect)).join(',\n') : `  ${primaryTable}.*`;

  // V14.2 — explicit manual joins (added via "Add explicit join") are
  // honored FIRST (they represent a deliberate user override), and the
  // remaining selected tables not already covered by an explicit join are
  // resolved automatically via joinAutoEngine (spec sections 2-5).
  const explicitJoinLines = state.joins.map((j) => `${j.joinType} ${j.table} ON ${j.onLeftTable}.${j.onLeftColumn} = ${j.table}.${j.onRightColumn}`);
  const explicitlyJoinedTables = new Set(state.joins.map((j) => j.table));
  const otherSelectedTables = state.selectedTables.filter((t) => t !== primaryTable && !explicitlyJoinedTables.has(t));
  const autoPlan: AutoJoinPlan = computeAutoJoinPlan(schema, primaryTable, otherSelectedTables, state.joinPathChoices);
  const joinLines = [...explicitJoinLines, ...autoPlan.joinLines].join('\n');

  const whereClause = buildWhereClause(state.filters);
  const orderClause = state.sorts.length ? state.sorts.map((s) => `${s.table}.${s.column} ${s.direction}`).join(', ') : '';
  const groupByClause = state.advanced.groupByColumns.length ? state.advanced.groupByColumns.join(', ') : '';

  let core = `SELECT ${top}${state.advanced.distinct ? 'DISTINCT\n' : '\n'}${selectCols}\nFROM ${primaryTable}`;
  if (joinLines) core += `\n${joinLines}`;
  if (autoPlan.unresolvedWarnings.length) core += autoPlan.unresolvedWarnings.map((w) => `\n-- NOTE: ${w}`).join('');
  if (whereClause) core += `\nWHERE ${whereClause}`;
  if (groupByClause) core += `\nGROUP BY ${groupByClause}`;
  if (state.advanced.havingClause.trim()) core += `\nHAVING ${state.advanced.havingClause.trim()}`;
  if (orderClause) core += `\nORDER BY ${orderClause}`;
  core += tail;

  if (state.advanced.recursive) {
    const pk = primary.columns.find((c) => c.isPrimaryKey)?.name || 'ID';
    core = `WITH RECURSIVE hierarchy AS (\n  SELECT ${primaryTable}.*, 0 AS depth\n  FROM ${primaryTable}\n  WHERE ${primaryTable}.${pk} = :root_id\n  UNION ALL\n  SELECT child.*, hierarchy.depth + 1\n  FROM ${primaryTable} child\n  JOIN hierarchy ON child.PARENT_ID = hierarchy.${pk}\n)\nSELECT * FROM hierarchy` + tail;
  }
  if (state.advanced.saveAsView && state.advanced.saveAsView.trim()) core = `WITH ${state.advanced.saveAsView.trim()} AS (\n${core.split('\n').map((l) => '  ' + l).join('\n')}\n)\nSELECT * FROM ${state.advanced.saveAsView.trim()}${tail}`;

  // V14.2 — WITH / CTE support (spec 13.1). User-defined CTEs are
  // prepended as additional named subqueries ahead of the main query. This
  // composes with (wraps around) the saveAsView case above, since both
  // ultimately use a WITH clause — CTEs come first, then any saveAsView
  // wrapper, keeping exactly one WITH keyword in the final SQL.
  if (state.advanced.ctes.length > 0) {
    const cteBodies = state.advanced.ctes.filter((c) => c.name.trim() && c.body.trim()).map((c) => `  ${c.name.trim()} AS (\n${c.body.trim().split('\n').map((l) => '    ' + l).join('\n')}\n  )`).join(',\n');
    if (cteBodies) {
      if (core.trim().toUpperCase().startsWith('WITH ')) {
        // Already has a WITH (from saveAsView) — merge into one clause.
        core = core.replace(/^WITH /i, `WITH\n${cteBodies},\n`);
      } else {
        core = `WITH\n${cteBodies}\n${core}`;
      }
    }
  }
  return core;
}
