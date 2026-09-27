import { icon } from '../components/icons.js';
import { aiService } from '../services/aiService.js';
export function renderAboutPage(container) {
    container.innerHTML = `<div class="page" data-tour="about-panel">
    <h2>${icon('info')} About SQL Assistant</h2>
    <p>SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing deep, memorized knowledge of the underlying database schema.</p>
    <p>Version 14.7 is a targeted bug-fix release addressing two issues reported after V14.6 shipped: a browser storage quota crash on the schema registry, and a cross-device schema synchronization gap.</p>
    <h4>Bug 1 — "Failed to execute 'setItem' on 'Storage': ... exceeded the quota", fixed</h4>
    <p>Root cause: <code>schemaService.persist()</code> called <code>localStorage.setItem()</code> directly with no error handling. Once the registry — which accumulates every imported/synced schema from every device, forever — grew past the browser's per-origin quota, the write threw an uncaught exception <em>before</em> listeners were notified. That meant the change was silently never saved, the UI never updated, and — critically — no automatic push to the repository was ever scheduled, which is also why other devices never received the update.</p>
    <p>Fix: every localStorage write in the app now goes through a hardened <code>safeLocalStorageSet()</code> helper that automatically prunes duplicate/stale schemas and retries on quota errors, and always notifies listeners afterward so the UI and auto-sync scheduler never silently freeze. Duplicate schemas re-imported under the same name are now updated in place instead of piling up forever — the real source of the unbounded growth. Settings → Danger Zone now also shows live local storage usage and a one-click "Clean Up Duplicate Schemas" action.</p>
    <h4>Bug 2 — cross-device schema sync gap, fixed</h4>
    <p>Root cause: discovering a schema uploaded on another device previously required the Secret Vault to already be unlocked on <em>every</em> device before any pull could happen at all — so a newly uploaded schema silently never appeared elsewhere until someone manually unlocked Settings there. Fix: reading (not writing) from a public GitHub repository does not require authentication, so the app now performs an automatic, read-only, unauthenticated discovery pull on every app load and whenever a schema-related page is opened — closing the gap without requiring the vault to be unlocked just to <em>receive</em> updates. Publishing (pushing) changes still correctly requires the vault to be unlocked, and now gives a clear toast if it is locked instead of failing silently.</p>
    <h4>Architecture</h4>
    <pre class="sql-output">UI (pages/, components/)
  down
Application State (state/store.ts)
  down
Service Layer (aiService, schemaService [+ quota-safe persist, dedup],
               passwordService, secretVaultService [cross-device bootstrap],
               autoSyncService [toast feedback on locked-vault skip],
               syncService [public unauthenticated discovery pull — NEW],
               syncCoordination, onlineNlpService, nlpOrchestrator)
  down
Engines (sqlEngine, joinAutoEngine, nlpEngine, crNlpEngine, validationEngine,
         errorRectifierEngine, optimizeEngine, decodeEngine,
         schemaIntegrityEngine, schemaVersionEngine [+ sameLogicalSchema],
         sqlSchemaValidator)
  down
utils/validation.ts (safeTrim/safeString + sanitizeIncomingSchema +
                     safeLocalStorageSet [NEW] + assertSyncConfigOrError)
  down
cryptoService (PBKDF2 + AES-GCM, Web Crypto API only)</pre>
    <p>Current AI provider: ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
    <p>Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations, the last requiring the Admin Password; the GitHub access token lives only as encrypted ciphertext, always shown masked in the UI, and is never synchronized in plaintext.</p>
    <p class="hint">Crafted by Subham Ain · Senior Support Consultant</p>
  </div>`;
}
