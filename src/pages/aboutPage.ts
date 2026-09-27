import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `
    <section class="page page-about" data-tour="about-panel">
      <h1 class="page-title">${icon('info')} About SQL Assistant</h1>
      <div class="builder-panel narrow">
        <p>SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing
        deep, memorized knowledge of the underlying database schema.</p>
        <p><strong>Version 14.6</strong> is a targeted bug-fix release addressing two issues reported after V14.5:
        a synchronization ping-pong loop and a schema-validation crash that could still occur on data the earlier
        fix didn't cover.</p>
        <h3 class="mt">Bug 1 — Infinite synchronization loop, fixed</h3>
        <p><strong>Root cause:</strong> after a successful push, the app called <code>markAllSynced()</code> to
        stamp "last synced" timestamps — but that is itself a schema mutation, which re-notified the automatic
        sync listener, which scheduled ANOTHER push, which called <code>markAllSynced()</code> again — forever,
        firing roughly every 1-2 seconds regardless of the "Sync Time" setting. <strong>Fix:</strong> a new
        <code>syncCoordination.ts</code> module tracks whether a sync operation the app itself started is
        currently in flight; any schema mutation caused by that operation (marking synced, applying a pulled
        schema, resolving a conflict) is now correctly recognized as self-inflicted and does not trigger another
        automatic push. The "Sync Time" dropdown remains the only thing that starts a periodic timer, and it
        defaults to Manual (no timer at all).</p>
        <h3 class="mt">Bug 2 — "Cannot read properties of undefined (reading 'trim')", fully fixed</h3>
        <p><strong>Root cause:</strong> the earlier fix only hardened the Secret Vault/sync configuration layer.
        The actual crash site was schema VALIDATION — <code>schemaIntegrityEngine.ts</code> called
        <code>.trim()</code> directly on table names, column names, decode values, and FK references with no
        guard that the value was really a string. Any schema with a missing/undefined name — from a manual JSON
        import, an edited row, or a schema synced in from another device — crashed the entire app instantly on
        whichever device processed it next (during import, during a pull, or during any edit). <strong>Fix:</strong>
        every such call site now goes through <code>safeTrim</code>/<code>safeUpperTrim</code>, reporting a clear
        validation issue instead of crashing. A second, independent layer — <code>sanitizeIncomingSchema()</code> —
        additionally normalizes every schema the moment it enters the system (import, pull, shared-folder sync),
        guaranteeing no downstream code can ever receive an undefined string field for these properties again.</p>
        <pre class="sql-output">UI (pages/, components/ — static-shell + targeted re-render pattern)
  down
Application State (state/store.ts — sync-independent, prune-only-invalid-refs on schema change)
  down
Service Layer (aiService, schemaService [+ sanitizeIncomingSchema], passwordService,
               secretVaultService [cross-device bootstrap],
               autoSyncService [checks syncCoordination before auto-push — LOOP FIX],
               syncService [wraps pull/push in beginInternalSync/endInternalSync — LOOP FIX],
               syncCoordination [NEW — shared in-flight-sync flag], onlineNlpService,
               nlpOrchestrator [Active Schema availability check + rich context])
  down
Engines (sqlEngine, joinAutoEngine, nlpEngine, crNlpEngine, validationEngine,
         errorRectifierEngine, optimizeEngine, decodeEngine [TRIM FIX],
         filterEngine, schemaIntegrityEngine [TRIM FIX — root cause], schemaVersionEngine,
         sqlSchemaValidator)
  down
utils/validation.ts (safeTrim/safeString/safeUpperTrim + sanitizeIncomingSchema + assertSyncConfigOrError)
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
