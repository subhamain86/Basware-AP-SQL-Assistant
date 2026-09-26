import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="page page-about" data-tour="about-panel">
      <h1 class="page-title">${icon('info')} About SQL Assistant</h1>
      <div class="builder-panel narrow">
        <p>SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing
        deep, memorized knowledge of the underlying database schema.</p>
        <p><strong>Version 14</strong> introduces a hybrid Online AI/NLP + Offline local NLP engine (schema-grounded
        in both cases, with automatic fallback and clear on-screen indication of which engine ran), Module → Search
        → Select flows across the Query Builder / Schema / Manual Schema Update pages, Manual CASE and Manual
        DECODE column builders, a CR Query Builder visually and functionally aligned with the Read Only Query
        Builder, a fixed Hamburger Menu submenu collapse/expand behavior, a simplified main Schema page (Add/Import
        moved into Settings → Schema Management), and a corrected Settings password section that no longer shows a
        persistent message — plus the Admin Password default is never displayed anywhere in the UI.</p>
        <pre class="sql-output">UI (pages/, components/)
  down
Application State (state/store.ts)
  down
Service Layer (aiService, schemaService, passwordService, vaultService, syncService,
               onlineNlpService, nlpOrchestrator)
  down
Engines (sqlEngine, crEngine, nlpEngine, crNlpEngine, validationEngine, errorRectifierEngine,
         optimizeEngine, decodeEngine, filterEngine, schemaIntegrityEngine, schemaVersionEngine)
  down
cryptoService (PBKDF2 + AES-GCM, Web Crypto API only)</pre>
        <p><strong>Current AI provider:</strong> ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
        <p>Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only
        blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations,
        the last requiring the Admin Password (never shown anywhere in the UI).</p>
        <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p>
      </div>
    </section>`;
}
