import type { SchemaModel, QueryRequirement, SQLGenerationResult, ValidationResult, RectifyResult, ReadOnlyQueryState, SelectedColumnSpec, FilterCondition, ColumnDef, CrRequirement } from '../types';
import { parseRequirement } from '../engines/nlpEngine';
import { parseCrRequirement } from '../engines/crNlpEngine';
import { buildSelectSQL } from '../engines/sqlEngine';
import { validateReadOnlySql } from '../engines/validationEngine';
import { rectify } from '../engines/errorRectifierEngine';

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
export class LocalRuleBasedAIService implements AIService {
  readonly isAvailable = true; readonly providerName = 'Hybrid Online/Offline Engine (schema-grounded)';
  planQuery(nlText: string, schema: SchemaModel): QueryRequirement { return parseRequirement(nlText, schema); }
  planCrQuery(nlText: string, schema: SchemaModel): CrRequirement { return parseCrRequirement(nlText, schema); }
  generateSQL(requirement: QueryRequirement, schema: SchemaModel, state: ReadOnlyQueryState): SQLGenerationResult {
    const mergedState: ReadOnlyQueryState = { ...state, selectedTables: requirement.matchedTables.length ? requirement.matchedTables : state.selectedTables, selectedColumns: requirement.matchedColumns.length ? requirement.matchedColumns : state.selectedColumns, filters: requirement.matchedFilters.length ? requirement.matchedFilters : state.filters, sorts: requirement.matchedSorts.length ? requirement.matchedSorts : state.sorts, advanced: { ...state.advanced, limit: requirement.limit ?? state.advanced.limit, distinct: requirement.distinct || state.advanced.distinct } };
    let sql = buildSelectSQL(mergedState, schema);
    const safety = validateReadOnlySql(sql);
    const warnings: string[] = [];
    if (!safety.valid) { warnings.push('AI self-review rejected the generated statement (destructive keyword detected) — falling back to a safe placeholder.'); sql = '-- AI self-review blocked this generated statement for safety. Please refine your request or use the manual selectors.'; }
    if (requirement.confidence < 0.5) warnings.push('Low confidence interpretation — please review the manual selectors before relying on this SQL.');
    if (requirement.unresolvedTerms.length) warnings.push(`The following requested term(s) were not found in the active schema: ${requirement.unresolvedTerms.join(', ')}.`);
    return { sql, requirement, warnings, ok: requirement.matchedTables.length > 0 && safety.valid };
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
