import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { changePassword, resetPasswordToDefault, verifyPassword } from '../services/passwordService';
import { secretVaultService, maskToken, DEFAULT_BOOTSTRAP_CONFIG } from '../services/secretVaultService';
import { syncService } from '../services/syncService';
import { handleVaultUnlocked } from '../services/autoSyncService';
import { getConfiguredEndpoint, setConfiguredEndpoint } from '../services/onlineNlpService';
import { clearCachedCopilotToken } from '../services/msalAuthService';
import { renderSchemaManagementSection } from './schemaPage';
import { renderSchemaEditorSection } from './schemaEditorSection';
import { renderConflictBanner } from '../components/conflictBanner';
import { renderSyncLogPanel } from '../components/syncLogPanel';
import { renderTabs } from '../components/tabs';
import { downloadBlob, formatBytes } from '../utils/dom';
import { estimateStringBytes } from '../utils/validation';
import type { SyncTimeOption } from '../types';

export function renderSettingsPage(container: HTMLElement): void {
  function draw(): void {
    if (!store.settingsUnlocked) { renderLockScreen(); return; }
    renderUnlockedSettings();
  }
  function renderLockScreen(): void {
    // #settingsPwError starts as a completely empty container — no markup,
    // no `hidden` attribute, nothing for any stylesheet to ever have an
    // opinion about. The error markup is only ever written into it at the
    // exact moment verifyPassword() returns false for a real, submitted
    // password attempt, and is erased again the instant the user edits the
    // field. An element that contains nothing cannot be visible, in any
    // browser, under any stylesheet, in any embedding context.
    container.innerHTML = `<div class="page-settings-lock"><div class="settings-lock-card" data-tour="settings-lock-screen"><div class="settings-lock-icon">${icon('lock', 32)}</div><h2>Settings</h2><p class="hint">Settings — including Schema Management, the Secret Vault, and cross-device synchronization — are protected.</p><label class="block-label">Enter Admin Password<input id="settingsPwInput" type="password"/></label><div id="settingsPwError"></div><div class="row-actions"><button id="settingsCancelBtn" class="btn btn-ghost" type="button">Cancel</button><button id="settingsUnlockBtn" class="btn btn-primary" type="button">${icon('unlock', 15)} Unlock</button></div></div></div>`;
    const input = container.querySelector<HTMLInputElement>('#settingsPwInput')!;
    const errBox = container.querySelector<HTMLElement>('#settingsPwError')!;
    async function tryUnlock(): Promise<void> {
      const candidate = input.value; const ok = await verifyPassword(candidate);
      if (!ok) { errBox.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} Incorrect password.</div>`; return; }
      const bootstrapResult = await secretVaultService.tryAutoUnlock(candidate);
      store.unlockSettings();
      if (bootstrapResult.ok) {
        const sourceMsg = bootstrapResult.source === 'repository' ? 'Secret Vault configuration retrieved securely from the repository.' : bootstrapResult.source === 'created-fresh' ? 'Secret Vault created with default configuration.' : 'Secret Vault unlocked.';
        store.pushToast('success', sourceMsg); handleVaultUnlocked().catch(() => {});
      } else store.pushToast('warning', bootstrapResult.error || 'Could not unlock the Secret Vault automatically.');
      draw();
    }
    container.querySelector('#settingsUnlockBtn')?.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
    input.addEventListener('input', () => { errBox.innerHTML = ''; });
    container.querySelector('#settingsCancelBtn')?.addEventListener('click', () => { window.location.hash = 'quickstart'; });
  }
  function renderUnlockedSettings(): void {
    container.innerHTML = `<div class="page"><div class="settings-header-row"><h1 class="page-title">${icon('settings')} Settings Unlocked</h1><button id="lockSettingsBtn" class="btn btn-outline btn-sm" type="button">${icon('lock', 14)} Lock Settings</button></div><p class="page-subtitle">Everything previously available under "Admin" lives here — same Admin Password, encrypted at rest, synchronized securely across authorized devices.</p><div class="settings-tabs-scroll"><div id="settingsTabsMount"></div></div></div>`;
    container.querySelector('#lockSettingsBtn')?.addEventListener('click', () => { store.lockSettings(); secretVaultService.lock(); store.pushToast('info', 'Settings locked.'); draw(); });
    const tabsMount = container.querySelector<HTMLElement>('#settingsTabsMount')!;
    renderTabs(tabsMount, [
      { id: 'security', label: 'Security', render: renderSecurityTab },
      { id: 'schema-editor', label: 'Manual Schema Update', render: (panel) => { panel.setAttribute('data-tour', 'schema-editor-panel'); renderSchemaEditorSection(panel); } },
      { id: 'schema-mgmt', label: 'Schema Management', render: (panel) => renderSchemaManagementSection(panel, { allowAddImport: true }, draw) },
      { id: 'secret-vault', label: 'Secret Vault', render: renderSecretVaultTab },
      { id: 'sync', label: 'Synchronization', render: renderSyncTab },
      { id: 'nlp', label: 'AI / NLP Engine', render: renderNlpTab },
      { id: 'danger', label: 'Danger Zone', render: renderDangerTab }
    ], 'security', { security: 'settings-security', danger: 'settings-danger' });
  }
  function renderSecurityTab(panel: HTMLElement): void {
    panel.innerHTML = `<h5>Change Admin Password</h5><p class="hint">This same password also protects the Secret Vault (GitHub configuration, and any configured M365 Copilot Enterprise settings) — changing it will re-encrypt the vault automatically, both locally and on the repository.</p><div class="form-row-2"><label class="block-label">Current password<input id="oldPwInput" type="password"/></label><label class="block-label">New password<input id="newPwInput" type="password"/></label></div><button id="changePwBtn" class="btn btn-primary btn-sm mt" type="button">${icon('key', 14)} Change Password</button><div id="changePwResult"></div><h5 class="mt">Forgot Password</h5><p class="hint">Resets the Admin Password back to its internal default. Note: this does NOT re-encrypt an existing Secret Vault — if you reset the password, you will also need to reset the Secret Vault (Secret Vault tab) since it can no longer be decrypted.</p><button id="resetPwBtn" class="btn btn-outline btn-sm" type="button">${icon('refresh', 14)} Reset to Default</button><div id="resetPwResult"></div><h5 class="mt">Session Security</h5><p class="hint">Settings automatically locks after 5 minutes of inactivity, or immediately via "Lock Settings" (this also re-locks the Secret Vault).</p>`;
    panel.querySelector('#changePwBtn')?.addEventListener('click', async () => {
      const oldPw = (panel.querySelector('#oldPwInput') as HTMLInputElement)?.value || ''; const newPw = (panel.querySelector('#newPwInput') as HTMLInputElement)?.value || '';
      const resultMount = panel.querySelector<HTMLElement>('#changePwResult'); const result = await changePassword(oldPw, newPw); if (!resultMount) return;
      if (result.ok) {
        const reenc = await secretVaultService.reencryptForNewPassword(oldPw, newPw);
        resultMount.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} Password changed successfully.${!reenc.ok ? ` (Note: ${reenc.error})` : ' The Secret Vault was re-encrypted automatically, locally and on the repository.'}</div>`;
        store.pushToast('success', 'Admin password changed.'); (panel.querySelector('#oldPwInput') as HTMLInputElement).value = ''; (panel.querySelector('#newPwInput') as HTMLInputElement).value = '';
      } else resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#resetPwBtn')?.addEventListener('click', () => { resetPasswordToDefault(); const resultMount = panel.querySelector<HTMLElement>('#resetPwResult'); if (resultMount) resultMount.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} Password reset to the internal default.</div>`; store.pushToast('info', 'Password reset to the internal default.'); });
  }
  function renderSecretVaultTab(panel: HTMLElement): void {
    const unlocked = secretVaultService.isUnlocked(); const cfg = secretVaultService.getConfig(); const copilot = cfg?.m365Copilot;
    panel.innerHTML = `<div class="issue-box ${unlocked ? 'ok' : ''} mini">${icon(unlocked ? 'unlock' : 'lock', 14)} Secret Vault ${unlocked ? 'Unlocked' : 'Locked'}</div><p class="hint">The Secret Vault securely stores the GitHub configuration (and, optionally, the M365 Copilot Enterprise configuration below) needed for synchronization and AI integration. It unlocks automatically with the same Admin Password used for Settings.</p>${unlocked ? `
      <h5>GitHub Access Token *</h5>
      <p class="hint">This is the one piece of information each authorized user must supply individually — it's a personal credential and, for security, is never synchronized in plaintext.</p>
      <div class="masked-token-row">${icon('key', 14)} <code>${maskToken(cfg?.githubToken)}</code><button type="button" class="btn btn-outline btn-sm" id="changeTokenBtn">${cfg?.githubToken ? 'Change Token' : 'Set Token'}</button></div>
      <div id="tokenEditRow" hidden class="mt"><label class="block-label">New GitHub Access Token<input type="password" id="newTokenInput"/></label><div class="row-actions"><button id="saveTokenBtn" class="btn btn-primary btn-sm" type="button">${icon('save', 14)} Save Token</button><button id="cancelTokenBtn" class="btn btn-ghost btn-sm" type="button">Cancel</button></div></div>
      <details class="advanced-sync-details mt"><summary>${icon('settings', 14)} Advanced repository settings (optional — a working default is already configured)</summary><div class="form-row-2 mt"><label class="block-label">Repository (owner/repo)<input id="ghRepo" type="text" value="${cfg?.githubRepo || DEFAULT_BOOTSTRAP_CONFIG.githubRepo}"/></label><label class="block-label">Branch<input id="ghBranch" type="text" value="${cfg?.githubBranch || DEFAULT_BOOTSTRAP_CONFIG.githubBranch}"/></label></div><label class="block-label">Schema file path<input id="ghPath" type="text" value="${cfg?.githubSchemaPath || DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath}"/></label><button id="saveRepoConfigBtn" class="btn btn-outline btn-sm" type="button">${icon('save', 14)} Save Repository Settings</button></details>
      <h5 class="mt">${icon('bot', 15)} M365 Copilot Enterprise Integration <span class="chip">Optional</span></h5>
      <p class="hint">Optional — assists "Describe What You Need" with natural-language interpretation only. The offline engine and your Active Schema always determine the final SQL; Copilot can never add a table or column that isn't in your schema, and it cannot modify the schema. Off by default. Sign-in uses the Microsoft identity platform (no password is ever stored by this app) — configure your own Entra ID app registration and Copilot Studio / declarative agent endpoint below.</p>
      <label class="inline-check"><input type="checkbox" id="copilotEnabled" ${copilot?.enabled ? 'checked' : ''}/> Enable M365 Copilot Enterprise for Describe What You Need</label>
      <div class="form-row-2 mt"><label class="block-label">Tenant ID (Entra ID)<input id="copilotTenantId" type="text" value="${copilot?.tenantId || ''}" placeholder="00000000-0000-0000-0000-000000000000"/></label><label class="block-label">Client ID (App Registration)<input id="copilotClientId" type="text" value="${copilot?.clientId || ''}" placeholder="00000000-0000-0000-0000-000000000000"/></label></div>
      <label class="block-label">Agent / Endpoint URL (your Copilot Studio agent or declarative-agent endpoint)<input id="copilotEndpoint" type="text" value="${copilot?.agentEndpoint || ''}" placeholder="https://..."/></label>
      <label class="block-label">Scope (requested from Microsoft identity platform)<input id="copilotScope" type="text" value="${copilot?.scope || ''}" placeholder="api://your-agent-app-id/.default"/></label>
      <div class="row-actions"><button id="saveCopilotBtn" class="btn btn-primary btn-sm" type="button">${icon('save', 14)} Save M365 Copilot Settings</button><button id="clearCopilotSessionBtn" class="btn btn-ghost btn-sm" type="button">${icon('refresh', 14)} Clear cached sign-in</button></div>
      <div id="copilotConfigResult"></div>
      <h5 class="mt">Push Secret Vault to Repository</h5>
      <p class="hint">Pushes the ENCRYPTED vault configuration (never plaintext) to the repository so other authorized machines can retrieve it automatically.</p>
      <button id="pushVaultBtn" class="btn btn-outline btn-sm" type="button">${icon('github', 14)} Push Secret Vault Now</button><div id="pushVaultResult"></div>
      <h5 class="mt">Reset Secret Vault</h5>
      <p class="hint">Permanently discards the LOCAL stored GitHub and M365 Copilot configuration.</p>
      <button id="resetVaultBtn" class="btn btn-danger btn-sm" type="button">${icon('trash', 14)} Reset Secret Vault</button>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} The Secret Vault should already be unlocked automatically — if you're seeing this, try locking and re-unlocking Settings.</div>`}<div id="secretVaultResult"></div>`;
    panel.querySelector('#changeTokenBtn')?.addEventListener('click', () => { const row = panel.querySelector<HTMLElement>('#tokenEditRow'); if (row) row.hidden = !row.hidden; });
    panel.querySelector('#cancelTokenBtn')?.addEventListener('click', () => { const row = panel.querySelector<HTMLElement>('#tokenEditRow'); if (row) row.hidden = true; });
    panel.querySelector('#saveTokenBtn')?.addEventListener('click', async () => {
      const newToken = (panel.querySelector('#newTokenInput') as HTMLInputElement)?.value || '';
      const result = await secretVaultService.saveConfig({ githubToken: newToken }); const resultMount = panel.querySelector<HTMLElement>('#secretVaultResult');
      if (result.ok) { store.pushToast('success', 'GitHub token saved securely and synchronized in the background.'); renderSecretVaultTab(panel); }
      else if (resultMount) resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#saveRepoConfigBtn')?.addEventListener('click', async () => {
      const repo = (panel.querySelector('#ghRepo') as HTMLInputElement)?.value || DEFAULT_BOOTSTRAP_CONFIG.githubRepo; const branch = (panel.querySelector('#ghBranch') as HTMLInputElement)?.value || DEFAULT_BOOTSTRAP_CONFIG.githubBranch; const path = (panel.querySelector('#ghPath') as HTMLInputElement)?.value || DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath;
      const result = await secretVaultService.saveConfig({ githubRepo: repo, githubBranch: branch, githubSchemaPath: path }); const resultMount = panel.querySelector<HTMLElement>('#secretVaultResult');
      if (result.ok) { store.pushToast('success', 'Repository settings saved.'); if (resultMount) resultMount.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} Saved.</div>`; }
      else if (resultMount) resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#saveCopilotBtn')?.addEventListener('click', async () => {
      const enabled = (panel.querySelector('#copilotEnabled') as HTMLInputElement)?.checked || false;
      const tenantId = (panel.querySelector('#copilotTenantId') as HTMLInputElement)?.value.trim() || '';
      const clientId = (panel.querySelector('#copilotClientId') as HTMLInputElement)?.value.trim() || '';
      const agentEndpoint = (panel.querySelector('#copilotEndpoint') as HTMLInputElement)?.value.trim() || '';
      const scope = (panel.querySelector('#copilotScope') as HTMLInputElement)?.value.trim() || '';
      const resultMount = panel.querySelector<HTMLElement>('#copilotConfigResult');
      if (enabled && (!tenantId || !clientId || !agentEndpoint || !scope)) { if (resultMount) resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} To enable M365 Copilot Enterprise, Tenant ID, Client ID, Endpoint URL, and Scope are all required.</div>`; return; }
      const result = await secretVaultService.saveM365CopilotConfig({ enabled, tenantId, clientId, agentEndpoint, scope });
      if (result.ok) { store.pushToast('success', enabled ? 'M365 Copilot Enterprise configuration saved and enabled.' : 'M365 Copilot Enterprise configuration saved (disabled).'); if (resultMount) resultMount.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} Saved. This only affects Describe What You Need — nothing else changes.</div>`; }
      else if (resultMount) resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#clearCopilotSessionBtn')?.addEventListener('click', () => { clearCachedCopilotToken(); store.pushToast('info', 'Cached M365 Copilot sign-in cleared — the next request will prompt for sign-in again.'); });
    panel.querySelector('#pushVaultBtn')?.addEventListener('click', async () => {
      const btn = panel.querySelector<HTMLButtonElement>('#pushVaultBtn')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Pushing…';
      const result = await secretVaultService.pushToRepository(); btn.disabled = false; btn.innerHTML = original;
      const resultMount = panel.querySelector<HTMLElement>('#pushVaultResult'); if (resultMount) resultMount.innerHTML = result.ok ? `<div class="issue-box ok mini">${icon('check', 14)} Encrypted Secret Vault pushed to the repository.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#resetVaultBtn')?.addEventListener('click', () => { if (confirm('This permanently discards the LOCAL stored GitHub and M365 Copilot configuration. Continue?')) { secretVaultService.resetVault(); store.pushToast('info', 'Secret Vault reset.'); renderSecretVaultTab(panel); } });
  }
  function renderSyncTab(panel: HTMLElement): void {
    const cfg = syncService.getConfig();
    panel.innerHTML = `<h5>${icon('folder', 15)} Shared Location</h5><p class="hint">Status: ${syncService.hasConnectedLocation() ? 'Connected' : 'Not connected'}${syncService.isFileSystemAccessSupported() ? '' : ' — this browser does not support the File System Access API; use Import/Export instead.'}</p><button id="connectLocationBtn" class="btn btn-outline btn-sm" type="button">${icon('folder', 14)} Connect Folder</button><div id="locationResult"></div><h5 class="mt">${icon('github', 15)} GitHub Sync</h5><p class="hint">Repository configuration and access token live in Settings → Secret Vault. Schema changes AND the Active Schema selection synchronize automatically in the background — even without unlocking Settings on other devices, since a silent, unauthenticated check runs on every app load. Pushes always merge in any schema found only in the repository first, so nothing is silently lost.</p><button id="simpleSyncBtn2" class="btn btn-outline btn-sm" type="button">${icon('github', 14)} Sync with GitHub Now</button><div id="syncResult2"></div><h5 class="mt">${icon('clock', 15)} Sync Time (controls the periodic background PULL interval only)</h5><p class="hint">The navbar "Sync Time" dropdown is the ONLY thing that starts a recurring background check — it defaults to Manual.</p>${cfg.time === 'custom' ? `<label class="block-label">Time of day<input type="time" id="customTimeInput" value="${cfg.customTime || '20:30'}"/></label><button id="saveCustomTimeBtn" class="btn btn-outline btn-sm" type="button">${icon('save', 14)} Save</button>` : '<p class="hint">Not applicable — current Sync Time (navbar) is not "Custom".</p>'}<h5 class="mt">${icon('shield-alert', 15)} Conflict Management</h5><div id="conflictBannerMountSync"></div><h5 class="mt">${icon('history', 15)} Synchronization Activity Log</h5><div id="syncLogMount"></div>`;
    panel.querySelector('#connectLocationBtn')?.addEventListener('click', async () => { const result = await syncService.connectSharedLocation(); const mount = panel.querySelector<HTMLElement>('#locationResult'); if (mount) mount.innerHTML = result.ok ? `<div class="issue-box ok mini">${icon('check', 14)} Connected: ${result.label}</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; if (result.ok) renderSyncTab(panel); });
    panel.querySelector('#simpleSyncBtn2')?.addEventListener('click', async () => { const btn = panel.querySelector<HTMLButtonElement>('#simpleSyncBtn2')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Syncing…'; const result = await syncService.syncWithGitHubSimple(); btn.disabled = false; btn.innerHTML = original; const resultMount = panel.querySelector<HTMLElement>('#syncResult2'); if (resultMount) resultMount.innerHTML = result.ok ? `<div class="issue-box ok mini">${icon('check', 14)} Synchronized — ${result.newSchemasAdded.length} new, ${result.updatedSchemas.length} updated, ${result.unchanged} unchanged, ${result.conflicts.length} conflict(s)${result.activeSchemaSynced ? ', Active Schema synchronized' : ''}.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; });
    panel.querySelector('#saveCustomTimeBtn')?.addEventListener('click', () => { const t = (panel.querySelector('#customTimeInput') as HTMLInputElement)?.value || '20:30'; syncService.setTime('custom' as SyncTimeOption, t); store.pushToast('success', `Custom sync time saved: ${t}.`); });
    const conflictMount = panel.querySelector<HTMLElement>('#conflictBannerMountSync'); if (conflictMount) renderConflictBanner(conflictMount, () => renderSyncTab(panel));
    const logMount = panel.querySelector<HTMLElement>('#syncLogMount'); if (logMount) renderSyncLogPanel(logMount);
  }
  function renderNlpTab(panel: HTMLElement): void {
    const current = getConfiguredEndpoint();
    panel.innerHTML = `<h5>${icon('cloud', 15)} Online AI/NLP Endpoint</h5><p class="hint">The Query Builder always loads the saved Active Schema fresh, validates its availability, and sends rich metadata to this endpoint — then schema-validates whatever comes back. Falls back to the local offline engine automatically if unset, unreachable, or offline. When M365 Copilot Enterprise (Secret Vault tab) is configured and enabled, it is tried first; this generic endpoint is a second-tier fallback before the offline engine.</p><label class="block-label">Endpoint URL<input id="nlpEndpointInput" type="text" value="${current || ''}"/></label><div class="row-actions"><button id="saveNlpEndpointBtn" class="btn btn-primary btn-sm" type="button">${icon('save', 14)} Save</button><button id="clearNlpEndpointBtn" class="btn btn-ghost btn-sm" type="button">${icon('trash', 14)} Clear (use offline only)</button></div><div id="nlpEndpointResult"></div>`;
    panel.querySelector('#saveNlpEndpointBtn')?.addEventListener('click', () => { const url = (panel.querySelector('#nlpEndpointInput') as HTMLInputElement)?.value || ''; setConfiguredEndpoint(url); const mount = panel.querySelector<HTMLElement>('#nlpEndpointResult'); if (mount) mount.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} Endpoint saved.</div>`; store.pushToast('success', 'Online AI/NLP endpoint saved.'); });
    panel.querySelector('#clearNlpEndpointBtn')?.addEventListener('click', () => { setConfiguredEndpoint(null); renderNlpTab(panel); store.pushToast('info', 'Online endpoint cleared — offline engine will always be used.'); });
  }
  function renderDangerTab(panel: HTMLElement): void {
    const active = schemaService.getActiveSchema(); const health = schemaService.getStorageHealth(); const registrySize = estimateStringBytes(JSON.stringify(schemaService.getRegistry()));
    panel.innerHTML = `<h5>${icon('hard-drive', 15)} Local Storage Health</h5><p class="hint">Schemas are cached in this browser's local storage for offline use and fast loading.</p><div class="issue-box ${health.lastPersistOk ? 'ok' : ''} mini">${icon(health.lastPersistOk ? 'check' : 'alert-triangle', 14)} Last save: ${health.lastPersistOk ? 'OK' : 'FAILED'}${health.lastRecovered ? ' (recovered after cleanup)' : ''}</div><p class="hint">Schema catalogue size: ${formatBytes(registrySize)} · ${schemaService.getAllSchemas().length} schema(s) stored</p>${!health.lastPersistOk && health.lastError ? `<div class="issue-box mini">${icon('alert-triangle', 14)} ${health.lastError}</div>` : ''}<p id="quotaEstimateMount" class="hint">Checking available browser storage…</p><button id="cleanupStorageBtn" class="btn btn-outline btn-sm" type="button">${icon('broom', 14)} Clean Up Duplicate/Stale Schemas</button><div id="cleanupResult"></div><h5 class="mt">Delete Schema Contents</h5><p class="hint">Permanently remove every table, column, and relationship from the active schema (${active.name}). A full backup is downloaded automatically before anything is deleted.</p><button id="wipeSchemaBtn" class="btn btn-danger btn-sm" type="button">${icon('trash', 14)} Delete Schema Contents</button><div id="wipeResult"></div>`;
    if ('storage' in navigator && (navigator as any).storage?.estimate) { (navigator as any).storage.estimate().then((est: any) => { const mount = panel.querySelector<HTMLElement>('#quotaEstimateMount'); if (mount && est.quota) mount.textContent = `Browser storage in use: ${formatBytes(est.usage || 0)} of ${formatBytes(est.quota)} (${Math.round(((est.usage || 0) / est.quota) * 100)}%).`; }).catch(() => { const mount = panel.querySelector<HTMLElement>('#quotaEstimateMount'); if (mount) mount.textContent = 'Browser storage estimate unavailable.'; }); } else { const mount = panel.querySelector<HTMLElement>('#quotaEstimateMount'); if (mount) mount.textContent = 'Browser storage estimate not supported in this browser.'; }
    panel.querySelector('#cleanupStorageBtn')?.addEventListener('click', () => { const result = schemaService.pruneForSpace(); const mount = panel.querySelector<HTMLElement>('#cleanupResult'); if (mount) mount.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} Removed ${result.removedCount} duplicate/stale schema(s), freeing approximately ${formatBytes(result.freedApproxBytes)}.</div>`; store.pushToast('success', `Storage cleanup complete — removed ${result.removedCount} schema(s).`); renderDangerTab(panel); });
    panel.querySelector('#wipeSchemaBtn')?.addEventListener('click', () => {
      const wipeResult = panel.querySelector<HTMLElement>('#wipeResult'); if (!wipeResult) return;
      wipeResult.innerHTML = `<div class="issue-box warn mini">${icon('alert-triangle', 14)} This will permanently remove ALL tables/columns from the active schema. Enter the Admin Password to confirm.</div><label class="block-label">Admin Password<input type="password" id="wipePwInput"/></label><div class="row-actions"><button id="wipeCancelBtn" class="btn btn-ghost btn-sm" type="button">Cancel</button><button id="wipeConfirmBtn" class="btn btn-danger btn-sm" type="button">${icon('trash', 14)} Confirm Delete</button></div>`;
      panel.querySelector('#wipeCancelBtn')?.addEventListener('click', () => { wipeResult.innerHTML = ''; });
      panel.querySelector('#wipeConfirmBtn')?.addEventListener('click', async () => {
        const pw = (panel.querySelector('#wipePwInput') as HTMLInputElement)?.value || ''; const ok = await verifyPassword(pw);
        if (!ok) { wipeResult.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} Incorrect password.</div>`; return; }
        const active2 = schemaService.getActiveSchema(); const backup = schemaService.deleteAllSchemaContents(active2.id);
        downloadBlob(`schema-backup-${active2.id}-${Date.now()}.json`, backup, 'application/json');
        store.pushToast('success', 'Schema contents deleted. A backup was downloaded automatically.'); wipeResult.innerHTML = ''; renderDangerTab(panel);
      });
    });
  }
  draw();
}
