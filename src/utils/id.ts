let counter = 0;
export function makeId(prefix = 'id'): string { counter += 1; return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`; }
