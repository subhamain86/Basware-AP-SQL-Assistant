import { icon } from '../components/icons';
import { schemaService } from '../services/schemaService';
import type { Route } from '../types';
export function renderQuickstartPage(container: HTMLElement, onNavigate: (r: Route) => void): void {
  const schema = schemaService.getActiveSchema();
  const modules = Array.from(new Set(schema.tables.map((t) => t.module)));
  container.innerHTML = `<div class="page">
    <div class="hero-card">
      <h1>Welcome — what does this tool do?</h1>
      <p class="lead">SQL Assistant helps you describe what you need in plain language — or make manual selections, or combine both. Every request, online or offline, always uses your currently saved Active Schema as the single source of truth, which is kept identical across every authorized device automatically. When you create, import, or update a schema, it is automatically synchronized to the shared repository once the Secret Vault is unlocked.</p>
      <h3 class="mt">${icon('database')} Active schema: ${schema.name}</h3>
      <div class="chip-row">${modules.map((m) => `<span class="chip">${m}</span>`).join('')}</div>
    </div>
    <h2 class="section-title">${icon('play')} Try an example</h2>
    <div class="card-grid">
      <div class="feature-card" data-nav="readonly">
        <div class="feature-icon">${icon('table', 22)}</div>
        <h3>Read Only Query Builder</h3>
        <p>Try "Show invoices with their organization" — joins are generated for you.</p>
        <span class="card-link">Open ${icon('arrow-right', 16)}</span>
      </div>
      <div class="feature-card" data-nav="cr">
        <div class="feature-icon">${icon('code', 22)}</div>
        <h3>Query Builder for CR</h3>
        <p>Build INSERT / UPDATE / DELETE SQL, with mandatory-WHERE safeguards.</p>
        <span class="card-link">Open ${icon('arrow-right', 16)}</span>
      </div>
      <div class="feature-card" data-nav="settings">
        <div class="feature-icon">${icon('settings', 22)}</div>
        <h3>Settings 🔒</h3>
        <p>Password-protected: Manual Schema Update, Schema Management, Secret Vault (cross-device).</p>
        <span class="card-link">Open ${icon('arrow-right', 16)}</span>
      </div>
      <div class="feature-card" data-nav="error-rectifier">
        <div class="feature-icon">${icon('bug', 22)}</div>
        <h3>Error Rectifier</h3>
        <p>Paste a database error and the SQL that caused it to get a corrected query, shown side by side.</p>
        <span class="card-link">Open ${icon('arrow-right', 16)}</span>
      </div>
    </div>
    <p class="hint mt">${icon('shield', 16)} No execution, ever. SQL Assistant only ever produces SQL text for you to review and copy.</p>
  </div>`;
  container.querySelectorAll<HTMLElement>('[data-nav]').forEach((c) => c.addEventListener('click', () => onNavigate(c.dataset.nav as Route)));
}
