import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="page page-about" data-tour="about-panel">
      <h1 class="page-title">${icon('info')} About AP-SQL Assistant</h1>
      <div class="builder-panel narrow">
        <p>AP-SQL Assistant is a self-contained tool that helps AP and P2P support teams construct accurate SQL
        without needing deep, memorized knowledge of the underlying database schema.</p>
        <p><strong>Version 13.2</strong> evolves V13.1: the Navbar now carries only two Schema Sync selectors
        (Sync Source, Sync Time); Manual Schema Update moved exclusively inside password-protected Settings; the
        Settings password (and a separate Vault Passphrase for sync credentials) are encrypted at rest using
        PBKDF2 + AES-GCM via the browser's Web Crypto API; and the AI Query Builder understands relative dates,
        AND/OR logic, asks for clarification when ambiguous, and shows its query plan before generating SQL.</p>
        <pre class="sql-output">UI (pages/, components/)
  down
Application State (state/store.ts, includes Settings lock session)
  down
Service Layer (aiService, schemaService, passwordService, vaultService, syncService)
  down
Engines (sqlEngine, crEngine, nlpEngine, crNlpEngine, validationEngine, errorRectifierEngine,
         optimizeEngine, decodeEngine, filterEngine, schemaIntegrityEngine, schemaVersionEngine)
  down
cryptoService (PBKDF2 + AES-GCM, Web Crypto API only)</pre>
        <p><strong>Current AI provider:</strong> ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
        <p>Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only
        blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations,
        the last requiring the operational password.</p>
        <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p>
      </div>
    </section>`;
}
