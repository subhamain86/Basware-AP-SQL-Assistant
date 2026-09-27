import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="page page-about" data-tour="about-panel">
      <h1 class="page-title">${icon('info')} About SQL Assistant</h1>
      <div class="builder-panel narrow">
        <p>SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing
        deep, memorized knowledge of the underlying database schema.</p>
        <p><strong>Version 14.5</strong> is a focused stability, synchronization, schema persistence, AI/NLP, and
        Select Columns upgrade. Every created, imported, updated, or renamed schema is automatically persisted to
        the shared repository and synchronized across authorized devices — no manual Pull Request, Pull, or GitHub
        configuration is required from the end user. A single, comprehensive validation gate
        (<code>assertSyncConfigOrError</code>) now checks every synchronization input by name before any value is
        touched, completely resolving the "Cannot read properties of undefined (reading 'trim')" crash class rather
        than suppressing individual symptoms. The Secret Vault synchronizes its protected configuration across
        machines as encrypted ciphertext only — access tokens and other credentials are never written to the
        repository, logs, or UI in plaintext. The Online AI/NLP engine now explicitly validates Active Schema
        availability before every request, and an independent validator scans the final generated SQL text
        itself for any table or column reference not present in the Active Schema. Select Columns search was
        re-verified end-to-end and a "Select All" control was added that always selects every column for the
        selected table(s), completely independent of the current search filter — and repository synchronization,
        including newly-arrived schemas, never clears or resets the Query Builder's current selections.</p>
        <pre class="sql-output">UI (pages/, components/ — static-shell + targeted re-render pattern)
  down
Application State (state/store.ts — sync-independent, prune-only-invalid-refs on schema change)
  down
Service Layer (aiService [+ sqlSchemaValidator], schemaService, passwordService,
               secretVaultService [cross-device bootstrap], autoSyncService [automatic discovery],
               syncService [assertSyncConfigOrError gate + sync log], onlineNlpService,
               nlpOrchestrator [Active Schema availability check + rich context])
  down
Engines (sqlEngine, joinAutoEngine, nlpEngine, crNlpEngine, validationEngine,
         errorRectifierEngine, optimizeEngine, decodeEngine, filterEngine,
         schemaIntegrityEngine, schemaVersionEngine, sqlSchemaValidator)
  down
utils/validation.ts (safeTrim/safeString + assertSyncConfigOrError comprehensive gate)
  down
cryptoService (PBKDF2 + AES-GCM, Web Crypto API only)</pre>
        <p><strong>Current AI provider:</strong> ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
        <p>Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only
        blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations,
        the last requiring the Admin Password (never shown anywhere in the UI); the GitHub access token lives only
        as encrypted ciphertext, always shown masked in the UI, and is never synchronized in plaintext.</p>
        <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p>
      </div>
    </section>`;
}
