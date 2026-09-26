import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="page page-about" data-tour="about-panel">
      <h1 class="page-title">${icon('info')} About SQL Assistant</h1>
      <div class="builder-panel narrow">
        <p>SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing
        deep, memorized knowledge of the underlying database schema.</p>
        <p><strong>Version 14.1</strong> is a stability, usability, and synchronization upgrade: the root cause of
        the "page refresh" behavior has been eliminated (table/column pickers and search boxes now use a
        static-shell rendering pattern instead of tearing down and rebuilding on every interaction); the offline
        NLP engine is now genuinely schema-aware, reading table/column descriptions to map business terminology
        (e.g. "who approved this invoice") to the correct schema objects; Natural Language and Manual Selectors now
        truly merge as AND/OR options instead of one replacing the other; every column in Select Columns has inline
        CASE/DECODE controls beside it; and schemas can now be synchronized to a real GitHub repository (via the
        Contents API) so the same schema is available across every machine, with conflict detection reusing the
        existing schema versioning/checksum engine rather than a second competing system.</p>
        <pre class="sql-output">UI (pages/, components/ — static-shell + targeted re-render pattern)
  down
Application State (state/store.ts — mergeReadOnlyFromNlp for AND/OR)
  down
Service Layer (aiService, schemaService, passwordService, vaultService,
               syncService, githubApiService, onlineNlpService, nlpOrchestrator)
  down
Engines (sqlEngine, crEngine, nlpEngine [schema-aware], crNlpEngine, validationEngine,
         errorRectifierEngine, optimizeEngine, decodeEngine, filterEngine,
         schemaIntegrityEngine, schemaVersionEngine [reused for conflicts])
  down
cryptoService (PBKDF2 + AES-GCM, Web Crypto API only)</pre>
        <p><strong>Current AI provider:</strong> ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
        <p>Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only
        blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations,
        the last requiring the Admin Password (never shown anywhere in the UI); GitHub access tokens live only in
        the encrypted Vault, never rendered as plain text.</p>
        <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p>
      </div>
    </section>`;
}
