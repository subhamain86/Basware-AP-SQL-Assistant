import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="page page-about" data-tour="about-panel">
      <h1 class="page-title">${icon('info')} About SQL Assistant</h1>
      <div class="builder-panel narrow">
        <p>SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing
        deep, memorized knowledge of the underlying database schema.</p>
        <p><strong>Version 14.2</strong> adds: a more polished, professional navbar logo (static — no hover/focus
        appearance changes — select it any time to return to Quick Start); automatic JOIN generation from schema
        primary/foreign key relationships, including through an intermediate table, with a clear resolution UI
        when more than one valid path exists; a fixed, focus-preserving Select Columns search; per-column Alias and
        DECODE controls that only appear once a column is selected (Raw Column / Schema DECODE / Manual DECODE);
        a single "Build Query" action beneath Manual Selectors; a substantially expanded Advanced Options area
        (WITH/CTEs, GROUP BY, HAVING, ORDER BY, LIMIT, DISTINCT, aggregates, CASE/DECODE, and View support); and a
        Secret Vault that unlocks with the same Admin Password already used for Settings — no separate passphrase,
        and non-secret repository details pre-filled automatically so only a personal GitHub token needs to be
        supplied on each new machine.</p>
        <pre class="sql-output">UI (pages/, components/ — static-shell + targeted re-render pattern)
  down
Application State (state/store.ts — mergeReadOnlyFromNlp for AND/OR, joinPathChoices)
  down
Service Layer (aiService, schemaService, passwordService, secretVaultService,
               syncService, githubApiService, onlineNlpService, nlpOrchestrator)
  down
Engines (sqlEngine [CTE + join integration], joinAutoEngine [NEW], nlpEngine [schema-aware],
         crNlpEngine, validationEngine, errorRectifierEngine, optimizeEngine, decodeEngine,
         filterEngine, schemaIntegrityEngine, schemaVersionEngine [reused for conflicts])
  down
cryptoService (PBKDF2 + AES-GCM, Web Crypto API only)</pre>
        <p><strong>Current AI provider:</strong> ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
        <p>Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only
        blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations,
        the last requiring the Admin Password (never shown anywhere in the UI); the GitHub access token lives only
        in the Secret Vault, always shown masked, and is never synchronized (each authorized user supplies their
        own, by design — a static client-only app has no secure way to share that specific secret automatically).</p>
        <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p>
      </div>
    </section>`;
}
