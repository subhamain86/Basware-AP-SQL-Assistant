import { icon } from '../components/icons';
export function renderSchemaEditorSection(container: HTMLElement): void {
  container.innerHTML = `<div class="hint">${icon('edit', 14)} Manual Schema Update tools are available here. Use Schema Management to add/import full schemas.</div>`;
}
