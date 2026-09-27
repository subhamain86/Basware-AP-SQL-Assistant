import type { ReadOnlyQueryState } from '../types';
export function optimizeSuggestions(state: ReadOnlyQueryState): string[] {
  const tips: string[] = [];
  if (state.selectedColumns.length === 0) tips.push('You are selecting every column (SELECT *). List only the columns you need.');
  if (state.advanced.limit === null && state.sorts.length === 0) tips.push('No result limit or ORDER BY is set.');
  if (tips.length === 0) tips.push('No obvious optimization issues detected for this query shape.');
  return tips;
}
