import { icon } from '../components/icons';
import { schemaService } from '../services/schemaService';
import type { Route } from '../types';
export function renderQuickstartPage(container: HTMLElement, onNavigate: (r: Route) => void): void {
  const schema = schemaService.getActiveSchema(); const modules = Array.from(new Set(schema.tables.map((t) => t.module)));
  container.innerHTML = `
    <section class="page page-quickstart">
      <div class="hero-card">
        <h1>Welcome — what does this tool do?</h1>
        <p class="lead">AP-SQL Assistant · Version 13.2. Describe what you need in plain language — including
        relative dates like "this month" or "last week" — or make manual selections, or combine both. Navigation
        lives in the hamburger menu; Sync Source and Sync Time are always one click away in the navbar; detailed
        configuration and Manual Schema Update now live behind password-protected Settings.</p>
      </div>
      <h2 class="section-title">${icon('database')} Active schema: ${schema.name}</h2>
      <div class="chip-row">${modules.map((m) => `<span class="chip">${m}</span>`).join('')}</div>
      <h2 class="section-title">${icon('play')} Try an example</h2>
      <div class="card-grid">
        <div class="feature-card" data-nav="readonly"><div class="feature-icon">${icon('table', 22)}</div><h3>Read Only Query Builder</h3><p>Natural language or manual selectors — try "Show invoices this month over 10000".</p><span class="card-link">Open ${icon('arrow-right', 16)}</span></div>
        <div class="feature-card" data-nav="cr"><div class="feature-icon">${icon('code', 22)}</div><h3>Query Builder for CR <span class="badge">CR</span></h3><p>Build INSERT / UPDATE / DELETE SQL, with mandatory-WHERE safeguards.</p><span class="card-link">Open ${icon('arrow-right', 16)}</span></div>
        <div class="feature-card" data-nav="settings"><div class="feature-icon">${icon('settings', 22)}</div><h3>Settings <span class="badge">🔒</span></h3><p>Password-protected: Manual Schema Update, Synchronization, Vault, and Danger Zone.</p><span class="card-link">Open ${icon('arrow-right', 16)}</span></div>
        <div class="feature-card" data-nav="error-rectifier"><div class="feature-icon">${icon('bug', 22)}</div><h3>Error Rectifier</h3><p>Paste a database error and the SQL that caused it to get a corrected query.</p><span class="card-link">Open ${icon('arrow-right', 16)}</span></div>
      </div>
      <div class="note-box">${icon('shield', 16)}<div><strong>No execution, ever.</strong> AP-SQL Assistant only ever produces SQL text for you to review and copy.</div></div>
    </section>`;
  container.querySelectorAll<HTMLElement>('[data-nav]').forEach((c) => c.addEventListener('click', () => onNavigate(c.dataset.nav as Route)));
}
