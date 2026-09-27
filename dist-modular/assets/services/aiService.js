import { parseRequirement } from '../engines/nlpEngine.js';
import { parseCrRequirement } from '../engines/crNlpEngine.js';
import { buildSelectSQL } from '../engines/sqlEngine.js';
import { validateReadOnlySql } from '../engines/validationEngine.js';
import { rectify } from '../engines/errorRectifierEngine.js';
import { validateSqlAgainstSchema } from '../engines/sqlSchemaValidator.js';
export class LocalRuleBasedAIService {
    constructor() {
        this.isAvailable = true;
        this.providerName = 'Hybrid Online/Offline Engine (schema-grounded)';
    }
    planQuery(nlText, schema) { return parseRequirement(nlText, schema); }
    planCrQuery(nlText, schema) { return parseCrRequirement(nlText, schema); }
    generateSQL(requirement, schema, state) {
        const mergedState = { ...state, selectedTables: requirement.matchedTables.length ? requirement.matchedTables : state.selectedTables, selectedColumns: requirement.matchedColumns.length ? requirement.matchedColumns : state.selectedColumns, filters: requirement.matchedFilters.length ? requirement.matchedFilters : state.filters, sorts: requirement.matchedSorts.length ? requirement.matchedSorts : state.sorts, advanced: { ...state.advanced, limit: requirement.limit ?? state.advanced.limit, distinct: requirement.distinct || state.advanced.distinct } };
        let sql = buildSelectSQL(mergedState, schema);
        const safety = validateReadOnlySql(sql);
        const warnings = [];
        if (!safety.valid) {
            warnings.push('AI self-review rejected the generated statement (destructive keyword detected) — falling back to a safe placeholder.');
            sql = '-- AI self-review blocked this generated statement for safety. Please refine your request or use the manual selectors.';
        }
        if (requirement.confidence < 0.5)
            warnings.push('Low confidence interpretation — please review the manual selectors before relying on this SQL.');
        if (requirement.unresolvedTerms.length)
            warnings.push(`The following requested term(s) were not found in the active schema: ${requirement.unresolvedTerms.join(', ')}.`);
        const schemaCheck = validateSqlAgainstSchema(sql, schema);
        if (!schemaCheck.valid)
            warnings.push(...schemaCheck.warnings.map((w) => `Schema validation: ${w}`));
        return { sql, requirement, warnings, ok: requirement.matchedTables.length > 0 && safety.valid && schemaCheck.valid };
    }
    validateSQL(sql) { return validateReadOnlySql(sql); }
    rectifySQL(errorText, sql) { return rectify(errorText, sql); }
    recommendTables(nlText, schema) { return parseRequirement(nlText, schema).matchedTables; }
    recommendColumns(nlText, tables, schema) { const req = parseRequirement(nlText, schema); return req.matchedColumns.filter((c) => tables.length === 0 || tables.includes(c.table)); }
    recommendFilters(nlText, schema) { return parseRequirement(nlText, schema).matchedFilters; }
    assistCaseDecode(column) {
        const nameUpper = column.name.toUpperCase();
        if (/STATUS/.test(nameUpper))
            return [{ rawValue: 'A', label: 'Active' }, { rawValue: 'I', label: 'Inactive' }, { rawValue: 'P', label: 'Pending' }];
        if (/FLAG/.test(nameUpper))
            return [{ rawValue: 'Y', label: 'Yes' }, { rawValue: 'N', label: 'No' }];
        return [{ rawValue: '1', label: 'Suggested label 1' }, { rawValue: '2', label: 'Suggested label 2' }];
    }
}
export const aiService = new LocalRuleBasedAIService();
