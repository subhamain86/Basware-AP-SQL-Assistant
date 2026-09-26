import { icon } from './icons';
export interface DataTableColumn<T> { key: string; label: string; render?: (row: T) => string; sortValue?: (row: T) => string | number; width?: string; }
export interface DataTableOptions<T> { columns: DataTableColumn<T>[]; rows: T[]; getRowId: (row: T) => string; pageSize?: number; searchPredicate?: (row: T, term: string) => boolean; onRowClick?: (row: T) => void; selectedRowId?: string | null; emptyMessage?: string; }

export function renderDataTable<T>(container: HTMLElement, opts: DataTableOptions<T>): { refresh: (rows: T[]) => void; getSelectedId: () => string | null } {
  const pageSize = opts.pageSize ?? 50;
  let allRows = opts.rows; let searchTerm = ''; let sortKey: string | null = null; let sortDir: 'asc' | 'desc' = 'asc'; let page = 0;
  let selectedId: string | null = opts.selectedRowId ?? null;

  function filteredSortedRows(): T[] {
    let rows = allRows;
    if (searchTerm) rows = rows.filter((r) => opts.searchPredicate?.(r, searchTerm.toLowerCase()));
    if (sortKey) {
      const col = opts.columns.find((c) => c.key === sortKey);
      if (col?.sortValue) rows = [...rows].sort((a, b) => { const av = col.sortValue!(a); const bv = col.sortValue!(b); const cmp = av < bv ? -1 : av > bv ? 1 : 0; return sortDir === 'asc' ? cmp : -cmp; });
    }
    return rows;
  }

  function draw(): void {
    const filtered = filteredSortedRows();
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, totalPages - 1);
    const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);
    container.innerHTML = `
      <div class="data-table-toolbar">
        ${icon('search', 14)}<input type="text" class="data-table-search" placeholder="Search schema…" value="${searchTerm}" />
        <span class="hint data-table-count">${filtered.length} row(s)${searchTerm ? ` matching "${searchTerm}"` : ''}</span>
      </div>
      <div class="data-table-scroll-wrap">
        <table class="data-table">
          <thead><tr>${opts.columns.map((c) => `<th data-key="${c.key}" style="${c.width ? `width:${c.width};` : ''}" class="${c.sortValue ? 'sortable' : ''}">${c.label}${sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
          <tbody>${pageRows.length ? pageRows.map((row) => { const rid = opts.getRowId(row); return `<tr data-row-id="${rid}" class="${rid === selectedId ? 'is-selected' : ''}">${opts.columns.map((c) => `<td>${c.render ? c.render(row) : String((row as any)[c.key] ?? '')}</td>`).join('')}</tr>`; }).join('') : `<tr><td colspan="${opts.columns.length}" class="data-table-empty">${opts.emptyMessage || 'No rows found.'}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="data-table-pagination">
        <button type="button" class="btn btn-outline btn-sm" id="dtPrevBtn" ${page === 0 ? 'disabled' : ''}>${icon('chevron-left', 14)} Prev</button>
        <span class="hint">Page ${page + 1} of ${totalPages}</span>
        <button type="button" class="btn btn-outline btn-sm" id="dtNextBtn" ${page >= totalPages - 1 ? 'disabled' : ''}>Next ${icon('chevron-right', 14)}</button>
      </div>`;
    container.querySelector<HTMLInputElement>('.data-table-search')?.addEventListener('input', (e) => { searchTerm = (e.target as HTMLInputElement).value; page = 0; draw(); const input = container.querySelector<HTMLInputElement>('.data-table-search'); input?.focus(); input?.setSelectionRange(searchTerm.length, searchTerm.length); });
    container.querySelectorAll<HTMLElement>('th.sortable').forEach((th) => { th.addEventListener('click', () => { const key = th.dataset.key!; if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortKey = key; sortDir = 'asc'; } draw(); }); });
    container.querySelectorAll<HTMLElement>('tr[data-row-id]').forEach((tr) => { tr.addEventListener('click', () => { const rid = tr.dataset.rowId!; selectedId = rid; const row = allRows.find((r) => opts.getRowId(r) === rid); if (row) opts.onRowClick?.(row); draw(); }); });
    container.querySelector('#dtPrevBtn')?.addEventListener('click', () => { page = Math.max(0, page - 1); draw(); });
    container.querySelector('#dtNextBtn')?.addEventListener('click', () => { page = Math.min(totalPages - 1, page + 1); draw(); });
  }
  draw();
  return { refresh: (rows: T[]) => { allRows = rows; draw(); }, getSelectedId: () => selectedId };
}
