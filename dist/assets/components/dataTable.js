import { icon } from './icons.js';
export function renderDataTable(container, opts) {
    const pageSize = opts.pageSize ?? 50;
    let allRows = opts.rows;
    let searchTerm = opts.initialSearch || '';
    let sortKey = null;
    let sortDir = 'asc';
    let page = 0;
    let selectedId = opts.selectedRowId ?? null;
    function filteredSortedRows() {
        let rows = allRows;
        if (searchTerm)
            rows = rows.filter((r) => opts.searchPredicate?.(r, searchTerm.toLowerCase()));
        if (sortKey) {
            const col = opts.columns.find((c) => c.key === sortKey);
            if (col?.sortValue)
                rows = [...rows].sort((a, b) => { const av = col.sortValue(a); const bv = col.sortValue(b); const cmp = av < bv ? -1 : av > bv ? 1 : 0; return sortDir === 'asc' ? cmp : -cmp; });
        }
        return rows;
    }
    function renderBodyAndPagination() {
        const tbody = container.querySelector('tbody');
        const paginationLabel = container.querySelector('.dt-page-label');
        const countEl = container.querySelector('.data-table-count');
        const prevBtn = container.querySelector('#dtPrevBtn');
        const nextBtn = container.querySelector('#dtNextBtn');
        const theadRow = container.querySelector('thead tr');
        if (!tbody)
            return;
        const filtered = filteredSortedRows();
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        page = Math.min(page, totalPages - 1);
        const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);
        tbody.innerHTML = pageRows.length ? pageRows.map((row) => { const rid = opts.getRowId(row); return `<tr data-row-id="${rid}" class="${rid === selectedId ? 'is-selected' : ''}">${opts.columns.map((c) => `<td>${c.render ? c.render(row) : String(row[c.key] ?? '')}</td>`).join('')}</tr>`; }).join('') : `<tr><td colspan="${opts.columns.length}" class="data-table-empty">${opts.emptyMessage || 'No rows found.'}</td></tr>`;
        if (countEl)
            countEl.textContent = `${filtered.length} row(s)${searchTerm ? ` matching "${searchTerm}"` : ''}`;
        if (paginationLabel)
            paginationLabel.textContent = `Page ${page + 1} of ${totalPages}`;
        if (prevBtn)
            prevBtn.disabled = page === 0;
        if (nextBtn)
            nextBtn.disabled = page >= totalPages - 1;
        if (theadRow)
            theadRow.querySelectorAll('th.sortable').forEach((th) => { const key = th.dataset.key; const base = th.dataset.label || th.textContent?.replace(/[▲▼]/g, '').trim() || ''; th.textContent = sortKey === key ? `${base} ${sortDir === 'asc' ? '▲' : '▼'}` : base; });
        tbody.querySelectorAll('tr[data-row-id]').forEach((tr) => { tr.addEventListener('click', () => { const rid = tr.dataset.rowId; selectedId = rid; const row = allRows.find((r) => opts.getRowId(r) === rid); if (row)
            opts.onRowClick?.(row); renderBodyAndPagination(); }); });
    }
    function renderShellOnce() {
        container.innerHTML = `<div class="data-table-toolbar">${icon('search', 14)}<input class="data-table-search" placeholder="Search..." value="${opts.initialSearch || ''}"/><span class="data-table-count"></span></div><div class="data-table-scroll-wrap"><table class="data-table"><thead><tr>${opts.columns.map((c) => `<th class="sortable" data-key="${c.key}" data-label="${c.label}" style="${c.width ? `width:${c.width};` : ''}">${c.label}</th>`).join('')}</tr></thead><tbody></tbody></table></div><div class="data-table-pagination"><button class="btn btn-ghost btn-sm" id="dtPrevBtn" type="button">${icon('chevron-left', 14)} Prev</button><span class="dt-page-label"></span><button class="btn btn-ghost btn-sm" id="dtNextBtn" type="button">Next ${icon('chevron-right', 14)}</button></div>`;
        const searchInput = container.querySelector('.data-table-search');
        searchInput.value = searchTerm;
        searchInput.addEventListener('input', (e) => { searchTerm = e.target.value; page = 0; renderBodyAndPagination(); });
        container.querySelectorAll('th.sortable').forEach((th) => { th.addEventListener('click', () => { const key = th.dataset.key; if (sortKey === key)
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else {
            sortKey = key;
            sortDir = 'asc';
        } renderBodyAndPagination(); }); });
        container.querySelector('#dtPrevBtn')?.addEventListener('click', () => { page = Math.max(0, page - 1); renderBodyAndPagination(); });
        container.querySelector('#dtNextBtn')?.addEventListener('click', () => { const filtered = filteredSortedRows(); const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); page = Math.min(totalPages - 1, page + 1); renderBodyAndPagination(); });
        renderBodyAndPagination();
    }
    renderShellOnce();
    return { refresh: (rows) => { allRows = rows; renderBodyAndPagination(); }, getSelectedId: () => selectedId, setSearch: (term) => { searchTerm = term; const input = container.querySelector('.data-table-search'); if (input)
            input.value = term; page = 0; renderBodyAndPagination(); } };
}
