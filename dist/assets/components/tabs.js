export function renderTabs(container, tabs, initialId, tourAttr, onTabChange) {
    let activeId = initialId || tabs[0]?.id;
    function draw() {
        container.innerHTML = `<div class="tabs-strip">${tabs.map((t) => `<button type="button" class="tab-btn ${t.id === activeId ? 'active' : ''}" data-tab="${t.id}" ${tourAttr?.[t.id] ? `data-tour="${tourAttr[t.id]}"` : ''}>${t.label}</button>`).join('')}</div><div id="tabPanel"></div>`;
        container.querySelectorAll('.tab-btn').forEach((btn) => { btn.addEventListener('click', () => { activeId = btn.dataset.tab; onTabChange?.(activeId); draw(); }); });
        const panel = container.querySelector('#tabPanel');
        const active = tabs.find((t) => t.id === activeId);
        active?.render(panel);
    }
    draw();
}
