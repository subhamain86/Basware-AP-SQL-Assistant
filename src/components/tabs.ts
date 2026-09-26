export interface TabDef { id: string; label: string; render: (panel: HTMLElement) => void; }
export function renderTabs(container: HTMLElement, tabs: TabDef[], initialId?: string, tourAttr?: Record<string, string>, onTabChange?: (id: string) => void): void {
  let activeId = initialId || tabs[0]?.id;
  function draw(): void {
    container.innerHTML = `
      <div class="tabs-strip" role="tablist">
        ${tabs.map((t) => `<button type="button" class="tab-btn ${t.id === activeId ? 'active' : ''}" data-tab="${t.id}" role="tab" aria-selected="${t.id === activeId}" ${tourAttr && tourAttr[t.id] ? `data-tour="${tourAttr[t.id]}"` : ''}>${t.label}</button>`).join('')}
      </div>
      <div class="tab-panel" id="tabPanel" role="tabpanel"></div>`;
    container.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => { btn.addEventListener('click', () => { activeId = btn.dataset.tab!; onTabChange?.(activeId); draw(); }); });
    const panel = container.querySelector<HTMLElement>('#tabPanel')!; const active = tabs.find((t) => t.id === activeId); active?.render(panel);
  }
  draw();
}
