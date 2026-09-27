import { icon } from '../components/icons';
import { schemaService } from '../services/schemaService';
import type { Route } from '../types';
export function renderQuickstartPage(container: HTMLElement, onNavigate: (r: Route) => void): void {
  const schema = schemaService.getActiveSchema(); const modules = Array.from(new Set(schema.tables.map((t) => t.module)));
  container.innerHTML = `
    <section class="page page-quickstart">
      <div class="hero-card">
        <h1>Welcome — what does this tool do?</h1>
        <p class="lead">SQL Assistant. Describe what you need in plain language — even everyday business terms — or
        make manual selections, or combine both. When your requirement touches more than one table, the required
        JOINs are generated automatically from your schema's primary/foreign key relationships — even through an
        intermediate table where needed. Navigation lives in the hamburger menu on the left; select the logo any
        time to return here. Schemas can be synchronized to a real GitHub repository through the Secret Vault, so
        every machine sees the same data without needing to know the technical repository details.</p>
      </div>
      <h2 class="section-title">${icon('database')} Active schema: ${schema.name}</h2>
      <div class="chip-row">${modules.map((m) => `<span class="chip">${m}</span>`).join('')}</div>
      <h2 class="section-title">${icon('play')} Try an example</h2>
      <div class="card-grid">
        <div class="feature-card" data-nav="readonly"><div class="feature-icon">${icon('table', 22)}</div><h3>Read Only Query Builder</h3><p>Try "Show invoices with their organization" — the Invoice → Vendor → Organization joins are generated for you.</p><span class="card-link">Open ${icon('arrow-right', 16)}</span></div>
        <div class="feature-card" data-nav="cr"><div class="feature-icon">${icon('code', 22)}</div><h3>Query Builder for CR <span class="badge">CR</span></h3><p>Build INSERT / UPDATE / DELETE SQL, with mandatory-WHERE safeguards.</p><span class="card-link">Open ${icon('arrow-right', 16)}</span></div>
        <div class="feature-card" data-nav="settings"><div class="feature-icon">${icon('settings', 22)}</div><h3>Settings <span class="badge">🔒</span></h3><p>Password-protected: Manual Schema Update, Schema Management, Secret Vault, Synchronization.</p><span class="card-link">Open ${icon('arrow-right', 16)}</span></div>
        <div class="feature-card" data-nav="error-rectifier"><div class="feature-icon">${icon('bug', 22)}</div><h3>Error Rectifier</h3><p>Paste a database error and the SQL that caused it to get a corrected query.</p><span class="card-link">Open ${icon('arrow-right', 16)}</span></div>
      </div>
      <div class="note-box">${icon('shield', 16)}<div><strong>No execution, ever.</strong> SQL Assistant only ever produces SQL text for you to review and copy.</div></div>
    </section>`;
  container.querySelectorAll<HTMLElement>('[data-nav]').forEach((c) => c.addEventListener('click', () => onNavigate(c.dataset.nav as Route)));
}
