import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { changePassword, resetPasswordToDefault, verifyPassword } from '../services/passwordService';
import { secretVaultService, maskToken, DEFAULT_BOOTSTRAP_CONFIG } from '../services/secretVaultService';
import { syncService } from '../services/syncService';
import { handleVaultUnlocked } from '../services/autoSyncService';
import { getConfiguredEndpoint, setConfiguredEndpoint } from '../services/onlineNlpService';
import { renderSchemaManagementSection } from './schemaPage';
import { renderSchemaEditorSection } from './schemaEditorSection';
import { renderConflictBanner } from '../components/conflictBanner';
import { renderSyncLogPanel } from '../components/syncLogPanel';
import { renderTabs } from '../components/tabs';
import { downloadBlob } from '../utils/dom';
import type { SyncTimeOption } from '../types';

export function renderSettingsPage(container: HTMLElement): void {
  function draw(): void {
    if (!store.settingsUnlocked) { renderLockScreen(); return; }
    renderUnlockedSettings();
  }

  function renderLockScreen(): void {
    container.innerHTML = `
      <section class="page page-settings-lock" data-tour="settings-lock-screen">
        <div class="settings-lock-card">
          <div class="settings-lock-icon">${icon('lock', 32)}</div>
          <h1>Settings</h1>
          <p class="hint">Settings — including Schema Management, the Secret Vault, and cross-device synchronization — are protected.</p>
          <label class="block-label">Enter Admin Password<input type="password" id="settingsPwInput" autocomplete="off" /></label>
          <div id="settingsPwError" class="issue-box mini" hidden>Incorrect password.</div>
          <div class="row-actions" style="justify-content:center">
            <button type="button" class="btn btn-ghost" id="settingsCancelBtn">Cancel</button>
            <button type="button" class="btn btn-primary" id="settingsUnlockBtn">${icon('unlock', 15)} Unlock</button>
          </div>
        </div>
      </section>`;
    const input = container.querySelector<HTMLInputElement>('#settingsPwInput')!;
    const errBox = container.querySelector<HTMLElement>('#settingsPwError')!;
    async function tryUnlock(): Promise<void> {
      const candidate = input.value;
      const ok = await verifyPassword(candidate);
      if (!ok) { errBox.removeAttribute('hidden'); return; }
      store.unlockSettings();
      const bootstrapResult = await secretVaultService.tryAutoUnlock(candidate);
      if (bootstrapResult.ok) {
        const sourceMsg = bootstrapResult.source === 'repository' ? 'Secret Vault configuration retrieved securely from the repository.' : bootstrapResult.source === 'created-fresh' ? 'Secret Vault created with default configuration.' : 'Secret Vault unlocked.';
        store.pushToast('success', sourceMsg);
        handleVaultUnlocked().catch(() => {});
      } else {
        store.pushToast('warning', bootstrapResult.error || 'Could not unlock the Secret Vault automatically.');
      }
      draw();
    }
    container.querySelector('#settingsUnlockBtn')?.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
    input.addEventListener('input', () => errBox.setAttribute('hidden', ''));
    container.querySelector('#settingsCancelBtn')?.addEventListener('click', () => { window.location.hash = 'quickstart'; });
  }

  function renderUnlockedSettings(): void {
    container.innerHTML = `
      <section class="page page-settings">
        <div class="settings-header-row">
          <h1 class="page-title">${icon('settings')} Settings <span class="chip chip-active">Unlocked</span></h1>
          <button class="btn btn-outline btn-sm" id="lockSettingsBtn">${icon('lock', 14)} Lock Settings</button>
        </div>
        <p class="page-subtitle">Everything previously available under "Admin" lives here — same Admin Password, encrypted at rest, synchronized securely across authorized devices.</p>
        <div id="settingsTabsMount" class="settings-tabs-scroll"></div>
      </section>`;
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
    panel.innerHTML = `
      <div class="builder-panel narrow">
        <h3>Change Admin Password</h3>
        <p class="hint">This same password also protects the Secret Vault (GitHub configuration) — changing it will re-encrypt the vault automatically, both locally and on the repository.</p>
        <label class="block-label">Current password<input type="password" id="oldPwInput" autocomplete="off" /></label>
        <label class="block-label">New password<input type="password" id="newPwInput" autocomplete="off" /></label>
        <div class="row-actions"><button class="btn btn-primary btn-sm" id="changePwBtn">${icon('key', 14)} Change Password</button></div>
        <div id="changePwResult"></div>
        <h3 class="mt">Forgot Password</h3>
        <p class="hint">Resets the Admin Password back to its internal default. Note: this does NOT re-encrypt an existing Secret Vault — if you reset the password, you will also need to reset the Secret Vault (Secret Vault tab) since it can no longer be decrypted.</p>
        <button class="btn btn-outline btn-sm" id="resetPwBtn">${icon('refresh', 14)} Reset to Default</button>
        <div id="resetPwResult"></div>
        <h3 class="mt">Session Security</h3>
        <p class="hint">Settings automatically locks after 5 minutes of inactivity, or immediately via "Lock Settings" (this also re-locks the Secret Vault).</p>
      </div>`;
    panel.querySelector('#changePwBtn')?.addEventListener('click', async () => {
      const oldPw = panel.querySelector<HTMLInputElement>('#oldPwInput')?.value || ''; const newPw = panel.querySelector<HTMLInputElement>('#newPwInput')?.value || '';
      const resultMount = panel.querySelector('#changePwResult'); const result = await changePassword(oldPw, newPw);
      if (!resultMount) return;
      if (result.ok) {
        const reenc = await secretVaultService.reencryptForNewPassword(oldPw, newPw);
        resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Password changed successfully.${!reenc.ok ? ` (Note: ${reenc.error})` : ' The Secret Vault was re-encrypted automatically, locally and on the repository.'}</div>`;
        store.pushToast('success', 'Admin password changed.');
        (panel.querySelector<HTMLInputElement>('#oldPwInput')!).value = ''; (panel.querySelector<HTMLInputElement>('#newPwInput')!).value = '';
      } else resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#resetPwBtn')?.addEventListener('click', () => {
      resetPasswordToDefault();
      const resultMount = panel.querySelector('#resetPwResult');
      if (resultMount) resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Password reset to the internal default.</div>`;
      store.pushToast('info', 'Password reset to the internal default.');
    });
  }

  function renderSecretVaultTab(panel: HTMLElement): void {
    const unlocked = secretVaultService.isUnlocked();
    const cfg = secretVaultService.getConfig();
    panel.innerHTML = `
      <div class="builder-panel narrow">
        <div class="editing-schema-banner">${icon(unlocked ? 'unlock' : 'lock', 14)} Secret Vault ${unlocked ? 'Unlocked' : 'Locked'}</div>
        <p class="hint">The Secret Vault securely stores the GitHub configuration needed for synchronization. It unlocks automatically with the same Admin Password used for Settings, and — on a brand-new authorized machine — is retrieved automatically from the repository (as encrypted ciphertext only, never plaintext) rather than requiring you to reconfigure GitHub access manually.</p>
        ${unlocked ? `
          <h3 class="mt">GitHub Access Token <span class="req">*</span></h3>
          <p class="hint">This is the one piece of information each authorized user must supply individually — it's a personal credential and, for security, is never synchronized in plaintext or auto-guessed.</p>
          <div class="masked-token-row">
            <span class="masked-token-display">${icon('key', 14)} ${maskToken(cfg?.githubToken)}</span>
            <button type="button" class="btn btn-outline btn-sm" id="changeTokenBtn">${cfg?.githubToken ? 'Change Token' : 'Set Token'}</button>
          </div>
          <div id="tokenEditRow" class="mt" hidden>
            <label class="block-label">New GitHub Access Token<input type="password" id="newTokenInput" autocomplete="off" placeholder="ghp_..." /></label>
            <div class="row-actions"><button class="btn btn-primary btn-sm" id="saveTokenBtn">${icon('save', 14)} Save Token</button><button class="btn btn-ghost btn-sm" id="cancelTokenBtn">Cancel</button></div>
          </div>
          <details class="advanced-sync-details mt">
            <summary>${icon('settings', 14)} Advanced repository settings <span class="hint">(optional — a working default is already configured)</span></summary>
            <label class="block-label">Repository (owner/repo)<input type="text" id="ghRepo" value="${cfg?.githubRepo || DEFAULT_BOOTSTRAP_CONFIG.githubRepo}" /></label>
            <label class="block-label">Branch<input type="text" id="ghBranch" value="${cfg?.githubBranch || DEFAULT_BOOTSTRAP_CONFIG.githubBranch}" /></label>
            <label class="block-label">Schema file path<input type="text" id="ghPath" value="${cfg?.githubSchemaPath || DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath}" /></label>
            <button class="btn btn-outline btn-sm mt" id="saveRepoConfigBtn">${icon('save', 14)} Save Repository Settings</button>
          </details>
          <div id="secretVaultResult" class="mt"></div>
          <h3 class="mt">Push Secret Vault to Repository</h3>
          <p class="hint">Pushes the ENCRYPTED vault configuration (never plaintext) to the repository so other authorized machines can retrieve it automatically. Happens automatically after any change above, but you can trigger it explicitly here too.</p>
          <button class="btn btn-outline btn-sm" id="pushVaultBtn">${icon('github', 14)} Push Secret Vault Now</button>
          <div id="pushVaultResult" class="mt"></div>
          <h3 class="mt">Reset Secret Vault</h3>
          <p class="hint">Permanently discards the LOCAL stored GitHub configuration and token. Not the same as recovering a lost password — that is not possible.</p>
          <button class="btn btn-danger btn-sm" id="resetVaultBtn">${icon('trash', 14)} Reset Secret Vault</button>
        ` : `
          <div class="issue-box mini warn">${icon('alert-triangle', 14)} The Secret Vault should already be unlocked automatically — if you're seeing this, try locking and re-unlocking Settings.</div>
        `}
      </div>`;

    panel.querySelector('#changeTokenBtn')?.addEventListener('click', () => { const row = panel.querySelector<HTMLElement>('#tokenEditRow'); if (row) row.hidden = !row.hidden; });
    panel.querySelector('#cancelTokenBtn')?.addEventListener('click', () => { const row = panel.querySelector<HTMLElement>('#tokenEditRow'); if (row) row.hidden = true; });
    panel.querySelector('#saveTokenBtn')?.addEventListener('click', async () => {
      const newToken = panel.querySelector<HTMLInputElement>('#newTokenInput')?.value || '';
      const result = await secretVaultService.saveConfig({ githubToken: newToken });
      const resultMount = panel.querySelector('#secretVaultResult');
      if (result.ok) { store.pushToast('success', 'GitHub token saved securely and synchronized in the background.'); renderSecretVaultTab(panel); } else if (resultMount) resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#saveRepoConfigBtn')?.addEventListener('click', async () => {
      const repo = panel.querySelector<HTMLInputElement>('#ghRepo')?.value || DEFAULT_BOOTSTRAP_CONFIG.githubRepo;
      const branch = panel.querySelector<HTMLInputElement>('#ghBranch')?.value || DEFAULT_BOOTSTRAP_CONFIG.githubBranch;
      const path = panel.querySelector<HTMLInputElement>('#ghPath')?.value || DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath;
      const result = await secretVaultService.saveConfig({ githubRepo: repo, githubBranch: branch, githubSchemaPath: path });
      const resultMount = panel.querySelector('#secretVaultResult');
      if (result.ok) { store.pushToast('success', 'Repository settings saved.'); if (resultMount) resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Saved.</div>`; } else if (resultMount) resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#pushVaultBtn')?.addEventListener('click', async () => {
      const btn = panel.querySelector<HTMLButtonElement>('#pushVaultBtn')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Pushing…';
      const result = await secretVaultService.pushToRepository();
      btn.disabled = false; btn.innerHTML = original;
      const resultMount = panel.querySelector('#pushVaultResult');
      if (resultMount) resultMount.innerHTML = result.ok ? `<div class="issue-box mini ok">${icon('check', 14)} Encrypted Secret Vault pushed to the repository.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#resetVaultBtn')?.addEventListener('click', () => { if (confirm('This permanently discards the LOCAL stored GitHub configuration and token. Continue?')) { secretVaultService.resetVault(); store.pushToast('info', 'Secret Vault reset.'); renderSecretVaultTab(panel); } });
  }

  function renderSyncTab(panel: HTMLElement): void {
    const cfg = syncService.getConfig();
    panel.innerHTML = `
      <div class="builder-grid-top">
        <div class="builder-panel">
          <h3>${icon('folder', 15)} Shared Location</h3>
          <p class="hint">Status: ${syncService.hasConnectedLocation() ? '<span class="sync-ok">Connected</span>' : 'Not connected'}${syncService.isFileSystemAccessSupported() ? '' : ' — this browser does not support the File System Access API; use Import/Export instead.'}</p>
          <button class="btn btn-outline btn-sm" id="connectLocationBtn" ${syncService.isFileSystemAccessSupported() ? '' : 'disabled'}>${icon('folder', 14)} Connect Folder</button>
          <div id="locationResult"></div>
          <h3 class="mt">${icon('github', 15)} GitHub Sync</h3>
          <p class="hint">Repository configuration and access token now live in <strong>Settings → Secret Vault</strong>. Schema changes synchronize automatically in the background — the button below is available for an immediate manual check.</p>
          <button class="btn btn-primary btn-sm" id="simpleSyncBtn2">${icon('github', 14)} Sync with GitHub Now</button>
          <div id="syncResult2" class="mt"></div>
          <div id="conflictBannerMountSync" class="mt"></div>
        </div>
        <div class="builder-panel">
          <h3>${icon('clock', 15)} Custom Sync Time</h3>
          ${cfg.time === 'custom' ? `<label class="block-label">Time of day<input type="time" id="customTimeInput" value="${cfg.customTime || '20:30'}" /></label><button class="btn btn-outline btn-sm" id="saveCustomTimeBtn">${icon('save', 14)} Save</button>` : '<p class="hint">Not applicable — current Sync Time (navbar) is not "Custom".</p>'}
          <h3 class="mt">${icon('shield-alert', 15)} Conflict Management</h3>
          <p class="hint">Reuses the existing schema versioning/checksum mechanism — if a background sync finds a schema that changed both locally and remotely, it appears as a persistent conflict (not just a disappearing toast) here and on the Schema page, with Use Local / Use Remote resolution.</p>
          <h3 class="mt">${icon('history', 15)} Synchronization Activity Log</h3>
          <p class="hint">A live record of automatic discovery/push/pull events — proof that "automatic synchronization" is genuinely happening in the background.</p>
          <div id="syncLogMount"></div>
        </div>
      </div>`;
    panel.querySelector('#connectLocationBtn')?.addEventListener('click', async () => { const result = await syncService.connectSharedLocation(); const mount = panel.querySelector('#locationResult'); if (mount) mount.innerHTML = result.ok ? `<div class="issue-box mini ok">${icon('check', 14)} Connected: ${result.label}</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; if (result.ok) renderSyncTab(panel); });
    panel.querySelector('#simpleSyncBtn2')?.addEventListener('click', async () => {
      const btn = panel.querySelector<HTMLButtonElement>('#simpleSyncBtn2')!; const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Syncing…';
      const result = await syncService.syncWithGitHubSimple();
      btn.disabled = false; btn.innerHTML = original;
      const resultMount = panel.querySelector('#syncResult2');
      if (resultMount) resultMount.innerHTML = result.ok ? `<div class="issue-box mini ok">${icon('check', 14)} Synchronized — ${result.newSchemasAdded.length} new, ${result.unchanged} unchanged, ${result.conflicts.length} conflict(s).</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#saveCustomTimeBtn')?.addEventListener('click', () => { const t = panel.querySelector<HTMLInputElement>('#customTimeInput')?.value || '20:30'; syncService.setTime('custom' as SyncTimeOption, t); store.pushToast('success', `Custom sync time saved: ${t}.`); });
    const conflictMount = panel.querySelector<HTMLElement>('#conflictBannerMountSync'); if (conflictMount) renderConflictBanner(conflictMount, () => renderSyncTab(panel));
    const logMount = panel.querySelector<HTMLElement>('#syncLogMount'); if (logMount) renderSyncLogPanel(logMount);
  }

  function renderNlpTab(panel: HTMLElement): void {
    const current = getConfiguredEndpoint();
    panel.innerHTML = `
      <div class="builder-panel narrow">
        <h3>${icon('cloud', 15)} Online AI/NLP Endpoint</h3>
        <p class="hint">The Query Builder always loads the saved Active Schema fresh, validates its availability, and sends rich metadata (tables, columns, types, descriptions, PK/FK, relationships, decode definitions, view flags) to this endpoint — then schema-validates whatever comes back, including a final pass over the assembled SQL text itself. Falls back to the local offline engine automatically if unset, unreachable, or offline.</p>
        <label class="block-label">Endpoint URL<input type="text" id="nlpEndpointInput" value="${current || ''}" placeholder="https://your-ai-service.example.com/nlp" /></label>
        <div class="row-actions"><button class="btn btn-primary btn-sm" id="saveNlpEndpointBtn">${icon('save', 14)} Save</button><button class="btn btn-outline btn-sm" id="clearNlpEndpointBtn">${icon('trash', 14)} Clear (use offline only)</button></div>
        <div id="nlpEndpointResult"></div>
      </div>`;
    panel.querySelector('#saveNlpEndpointBtn')?.addEventListener('click', () => { const url = panel.querySelector<HTMLInputElement>('#nlpEndpointInput')?.value || ''; setConfiguredEndpoint(url); const mount = panel.querySelector('#nlpEndpointResult'); if (mount) mount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Endpoint saved.</div>`; store.pushToast('success', 'Online AI/NLP endpoint saved.'); });
    panel.querySelector('#clearNlpEndpointBtn')?.addEventListener('click', () => { setConfiguredEndpoint(null); renderNlpTab(panel); store.pushToast('info', 'Online endpoint cleared — offline engine will always be used.'); });
  }

  function renderDangerTab(panel: HTMLElement): void {
    const active = schemaService.getActiveSchema();
    panel.innerHTML = `<div class="builder-panel"><p class="hint">Permanently remove every table, column, and relationship from the active schema (<strong>${active.name}</strong>). A full backup is downloaded automatically before anything is deleted.</p><button class="btn btn-danger btn-sm" id="wipeSchemaBtn">${icon('trash', 14)} Delete Schema Contents</button><div id="wipeResult"></div></div>`;
    panel.querySelector('#wipeSchemaBtn')?.addEventListener('click', () => {
      const wipeResult = panel.querySelector('#wipeResult'); if (!wipeResult) return;
      wipeResult.innerHTML = `<div class="issue-box mini"><div>${icon('alert-triangle', 14)} This will permanently remove ALL tables/columns from the active schema. Enter the Admin Password to confirm.</div><label class="block-label mt">Admin Password<input type="password" id="wipePwInput" autocomplete="off" /></label><div class="row-actions"><button class="btn btn-ghost btn-sm" id="wipeCancelBtn">Cancel</button><button class="btn btn-danger btn-sm" id="wipeConfirmBtn">${icon('trash', 14)} Confirm Delete</button></div></div>`;
      panel.querySelector('#wipeCancelBtn')?.addEventListener('click', () => { wipeResult.innerHTML = ''; });
      panel.querySelector('#wipeConfirmBtn')?.addEventListener('click', async () => { const pw = panel.querySelector<HTMLInputElement>('#wipePwInput')?.value || ''; const ok = await verifyPassword(pw); if (!ok) { wipeResult.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} Incorrect password.</div>`; return; } const active2 = schemaService.getActiveSchema(); const backup = schemaService.deleteAllSchemaContents(active2.id); downloadBlob(`schema-backup-${active2.id}-${Date.now()}.json`, backup, 'application/json'); store.pushToast('success', 'Schema contents deleted. A backup was downloaded automatically.'); wipeResult.innerHTML = ''; renderDangerTab(panel); });
    });
  }

  draw();
}
