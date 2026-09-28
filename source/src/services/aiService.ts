import type { SchemaModel, QueryRequirement, SQLGenerationResult, ValidationResult, RectifyResult, ReadOnlyQueryState, SelectedColumnSpec, FilterCondition, ColumnDef, CrRequirement } from '../types';
import { parseRequirement } from '../engines/nlpEngine';
import { parseCrRequirement } from '../engines/crNlpEngine';
import { buildSelectSQL } from '../engines/sqlEngine';
import { validateReadOnlySql } from '../engines/validationEngine';
import { rectify } from '../engines/errorRectifierEngine';
import { validateSqlAgainstSchema } from '../engines/sqlSchemaValidator';
export interface AIService {
  generateSQL(requirement: QueryRequirement, schema: SchemaModel, state: ReadOnlyQueryState): SQLGenerationResult;
  planQuery(nlText: string, schema: SchemaModel): QueryRequirement;
  planCrQuery(nlText: string, schema: SchemaModel): CrRequirement;
  validateSQL(sql: string): ValidationResult;
  rectifySQL(errorText: string, sql: string): RectifyResult;
  recommendTables(nlText: string, schema: SchemaModel): string[];
  recommendColumns(nlText: string, tables: string[], schema: SchemaModel): SelectedColumnSpec[];
  recommendFilters(nlText: string, schema: SchemaModel): FilterCondition[];
  assistCaseDecode(column: ColumnDef): { rawValue: string; label: string }[];
  readonly isAvailable: boolean; readonly providerName: string;
}
function mergeRequirementIntoState(requirement: QueryRequirement, state: ReadOnlyQueryState): ReadOnlyQueryState {
  const tableSet = new Set(state.selectedTables);
  requirement.matchedTables.forEach((t) => tableSet.add(t));
  const colKey = (c: SelectedColumnSpec) => c.manualExpr ? `manual:${c.id}` : `${c.table}::${c.column}::${c.aggregate || ''}`;
  const existingColKeys = new Set(state.selectedColumns.map(colKey));
  const mergedColumns = [...state.selectedColumns];
  requirement.matchedColumns.forEach((c) => { const k = colKey(c); if (!existingColKeys.has(k)) { mergedColumns.push(c); existingColKeys.add(k); } });
  requirement.matchedAggregates.forEach((a) => {
    const spec: SelectedColumnSpec = { id: `agg_${a.table}_${a.column}_${a.func}`, table: a.table, column: a.column, alias: a.alias, aggregate: a.func, useDecode: false, displayMode: 'raw' };
    const k = colKey(spec);
    if (!existingColKeys.has(k)) { mergedColumns.push(spec); existingColKeys.add(k); }
  });
  const filterKey = (f: FilterCondition) => `${f.table}::${f.column}::${f.operator}::${f.value}`;
  const existingFilterKeys = new Set(state.filters.map(filterKey));
  const mergedFilters = [...state.filters];
  requirement.matchedFilters.forEach((f) => { const k = filterKey(f); if (!existingFilterKeys.has(k)) { mergedFilters.push(f); existingFilterKeys.add(k); } });
  const sortKey = (s: typeof state.sorts[number]) => `${s.table}::${s.column}`;
  const existingSortKeys = new Set(state.sorts.map(sortKey));
  const mergedSorts = [...state.sorts];
  requirement.matchedSorts.forEach((s) => { const k = sortKey(s); if (!existingSortKeys.has(k)) { mergedSorts.push(s); existingSortKeys.add(k); } });
  const mergedGroupBy = Array.from(new Set([...state.advanced.groupByColumns, ...requirement.matchedGroupBy]));
  const existingRelatedKeys = new Set(state.advanced.relatedFilters.map((r) => `${r.relatedTable}::${r.mode}`));
  const mergedRelatedFilters = [...state.advanced.relatedFilters];
  requirement.matchedRelatedConditions.forEach((rc) => {
    const k = `${rc.relatedTable}::${rc.mode}`;
    if (!existingRelatedKeys.has(k)) { mergedRelatedFilters.push({ id: `relnlp_${rc.relatedTable}_${rc.mode}`, relatedTable: rc.relatedTable, mode: rc.mode, relationshipId: null }); existingRelatedKeys.add(k); }
  });
  return {
    ...state,
    selectedTables: Array.from(tableSet),
    selectedColumns: mergedColumns,
    filters: mergedFilters,
    sorts: mergedSorts,
    advanced: {
      ...state.advanced,
      groupByColumns: mergedGroupBy,
      havingClause: state.advanced.havingClause.trim() ? state.advanced.havingClause : (requirement.matchedHaving ? `${requirement.matchedHaving.aggregateExpr} ${requirement.matchedHaving.operator} ${requirement.matchedHaving.value}` : state.advanced.havingClause),
      limit: state.advanced.limit ?? requirement.limit,
      distinct: state.advanced.distinct || requirement.distinct,
      relatedFilters: mergedRelatedFilters
    }
  };
}
export class LocalRuleBasedAIService implements AIService {
  readonly isAvailable = true; readonly providerName = 'Hybrid Online/Offline Engine (schema-grounded)';
  planQuery(nlText: string, schema: SchemaModel): QueryRequirement { return parseRequirement(nlText, schema); }
  planCrQuery(nlText: string, schema: SchemaModel): CrRequirement { return parseCrRequirement(nlText, schema); }
  generateSQL(requirement: QueryRequirement, schema: SchemaModel, state: ReadOnlyQueryState): SQLGenerationResult {
    const mergedState = mergeRequirementIntoState(requirement, state);
    let sql = buildSelectSQL(mergedState, schema);
    const safety = validateReadOnlySql(sql);
    const warnings: string[] = [];
    if (!safety.valid) { warnings.push('AI self-review rejected the generated statement (destructive keyword detected) — falling back to a safe placeholder.'); sql = '-- AI self-review blocked this generated statement for safety. Please refine your request or use the manual selectors.'; }
    if (requirement.confidence < 0.5) warnings.push('Low confidence interpretation — please review the manual selectors before relying on this SQL.');
    if (requirement.unresolvedTerms.length) warnings.push(`The following requested term(s) were not found in the active schema: ${requirement.unresolvedTerms.join(', ')}.`);
    const schemaCheck = validateSqlAgainstSchema(sql, schema);
    if (!schemaCheck.valid) warnings.push(...schemaCheck.warnings.map((w) => `Schema validation: ${w}`));
    return { sql, requirement, warnings, ok: requirement.matchedTables.length > 0 && safety.valid && schemaCheck.valid };
  }
  validateSQL(sql: string): ValidationResult { return validateReadOnlySql(sql); }
  rectifySQL(errorText: string, sql: string): RectifyResult { return rectify(errorText, sql); }
  recommendTables(nlText: string, schema: SchemaModel): string[] { return parseRequirement(nlText, schema).matchedTables; }
  recommendColumns(nlText: string, tables: string[], schema: SchemaModel): SelectedColumnSpec[] { const req = parseRequirement(nlText, schema); return req.matchedColumns.filter((c) => tables.length === 0 || tables.includes(c.table)); }
  recommendFilters(nlText: string, schema: SchemaModel): FilterCondition[] { return parseRequirement(nlText, schema).matchedFilters; }
  assistCaseDecode(column: ColumnDef): { rawValue: string; label: string }[] {
    const nameUpper = column.name.toUpperCase();
    if (/STATUS/.test(nameUpper)) return [{ rawValue: 'A', label: 'Active' }, { rawValue: 'I', label: 'Inactive' }, { rawValue: 'P', label: 'Pending' }];
    if (/FLAG/.test(nameUpper)) return [{ rawValue: 'Y', label: 'Yes' }, { rawValue: 'N', label: 'No' }];
    return [{ rawValue: '1', label: 'Suggested label 1' }, { rawValue: '2', label: 'Suggested label 2' }];
  }
}
export const aiService: AIService = new LocalRuleBasedAIService();
