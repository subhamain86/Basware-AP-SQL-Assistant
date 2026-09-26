import type { ReadOnlyQueryState, SchemaModel, TableDef, Dialect, SelectedColumnSpec } from '../types';
import { buildWhereClause } from './filterEngine';
import { buildDecodeExpression } from './decodeEngine';
function findTable(schema: SchemaModel, name: string): TableDef | undefined { return schema.tables.find((t) => t.name === name); }
function limitClause(dialect: Dialect, limit: number | null): { top: string; tail: string } {
  if (!limit || limit <= 0) return { top: '', tail: '' };
  switch (dialect) {
    case 'SQL Server': return { top: `TOP ${limit} `, tail: '' };
    case 'Oracle': return { top: '', tail: `\nFETCH FIRST ${limit} ROWS ONLY` };
    default: return { top: '', tail: `\nLIMIT ${limit}` };
  }
}
function renderColumn(sc: SelectedColumnSpec, schema: SchemaModel, dialect: Dialect): string {
  if (sc.manualExpr) return `  ${sc.manualExpr}`; // V14 — manual CASE/DECODE columns carry a pre-built raw expression
  const table = findTable(schema, sc.table); const col = table?.columns.find((c) => c.name === sc.column);
  if (!col) return `${sc.table}.${sc.column}`;
  let expr = `${sc.table}.${sc.column}`;
  if (sc.aggregate) expr = `${sc.aggregate}(${expr})`;
  if (sc.useDecode && col.decode && col.decode.length > 0 && !sc.aggregate) return `  ${buildDecodeExpression(col, sc.table, dialect, sc.alias || undefined)}`;
  const alias = sc.alias ? ` AS ${sc.alias}` : sc.aggregate ? ` AS ${sc.aggregate}_${sc.column}` : '';
  return `  ${expr}${alias}`;
}
function autoInferJoins(primaryTable: string, otherTables: string[], schema: SchemaModel): string[] {
  const lines: string[] = [];
  otherTables.forEach((t) => {
    const rel = schema.relationships.find((r) => (r.fromTable === primaryTable && r.toTable === t) || (r.fromTable === t && r.toTable === primaryTable));
    if (rel) { if (rel.fromTable === primaryTable) lines.push(`INNER JOIN ${t} ON ${primaryTable}.${rel.fromColumn} = ${t}.${rel.toColumn}`); else lines.push(`INNER JOIN ${t} ON ${t}.${rel.fromColumn} = ${primaryTable}.${rel.toColumn}`); }
    else {
      const primary = findTable(schema, primaryTable); const target = findTable(schema, t);
      const sharedFk = target?.columns.find((c) => c.isForeignKey && c.references?.table === primaryTable);
      const primaryPk = primary?.columns.find((c) => c.isPrimaryKey);
      if (sharedFk && primaryPk) lines.push(`INNER JOIN ${t} ON ${primaryTable}.${primaryPk.name} = ${t}.${sharedFk.name}`);
      else lines.push(`INNER JOIN ${t} ON /* TODO: no declared relationship between ${primaryTable} and ${t} — verify join condition */ 1=1`);
    }
  });
  return lines;
}
export function buildSelectSQL(state: ReadOnlyQueryState, schema: SchemaModel): string {
  if (state.selectedTables.length === 0) return '-- Select at least one table (or describe your requirement above) to generate SQL.';
  const primaryTable = state.selectedTables[0]; const primary = findTable(schema, primaryTable);
  if (!primary) return `-- Unknown table: ${primaryTable}`;
  const { top, tail } = limitClause(state.dialect, state.advanced.limit);
  const selectCols = state.selectedColumns.length ? state.selectedColumns.map((sc) => renderColumn(sc, schema, state.dialect)).join(',\n') : `  ${primaryTable}.*`;
  const explicitJoinLines = state.joins.map((j) => `${j.joinType} ${j.table} ON ${j.onLeftTable}.${j.onLeftColumn} = ${j.table}.${j.onRightColumn}`);
  const otherSelectedTables = state.selectedTables.filter((t) => t !== primaryTable && !state.joins.some((j) => j.table === t));
  const autoJoinLines = autoInferJoins(primaryTable, otherSelectedTables, schema);
  const joinLines = [...explicitJoinLines, ...autoJoinLines].join('\n');
  const whereClause = buildWhereClause(state.filters);
  const orderClause = state.sorts.length ? state.sorts.map((s) => `${s.table}.${s.column} ${s.direction}`).join(', ') : '';
  const groupByClause = state.advanced.groupByColumns.length ? state.advanced.groupByColumns.join(', ') : '';
  let core = `SELECT ${top}${state.advanced.distinct ? 'DISTINCT\n' : '\n'}${selectCols}\nFROM ${primaryTable}`;
  if (joinLines) core += `\n${joinLines}`;
  if (whereClause) core += `\nWHERE ${whereClause}`;
  if (groupByClause) core += `\nGROUP BY ${groupByClause}`;
  if (state.advanced.havingClause.trim()) core += `\nHAVING ${state.advanced.havingClause.trim()}`;
  if (orderClause) core += `\nORDER BY ${orderClause}`;
  core += tail;
  if (state.advanced.recursive) {
    const pk = primary.columns.find((c) => c.isPrimaryKey)?.name || 'ID';
    core = `WITH RECURSIVE hierarchy AS (\n  SELECT ${primaryTable}.*, 0 AS depth\n  FROM ${primaryTable}\n  WHERE ${primaryTable}.${pk} = :root_id\n  UNION ALL\n  SELECT child.*, hierarchy.depth + 1\n  FROM ${primaryTable} child\n  JOIN hierarchy ON child.PARENT_ID = hierarchy.${pk}\n)\nSELECT * FROM hierarchy` + tail;
  }
  if (state.advanced.saveAsView && state.advanced.saveAsView.trim()) return `WITH ${state.advanced.saveAsView.trim()} AS (\n${core.split('\n').map((l) => '  ' + l).join('\n')}\n)\nSELECT * FROM ${state.advanced.saveAsView.trim()}${tail}`;
  return core;
}
