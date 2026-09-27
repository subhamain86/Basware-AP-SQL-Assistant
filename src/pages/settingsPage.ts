import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { changePassword, resetPasswordToDefault, verifyPassword } from '../services/passwordService';
import { secretVaultService, maskToken, DEFAULT_BOOTSTRAP_CONFIG } from '../services/secretVaultService';
import { syncService } from '../services/syncService';
import { getConfiguredEndpoint, setConfiguredEndpoint } from '../services/onlineNlpService';
import { renderSchemaManagementSection } from './schemaPage';
import { renderSchemaEditorSection } from './schemaEditorSection';
import { renderTabs } from '../components/tabs';
import { downloadBlob } from '../utils/dom';
import type { SyncTimeOption } from '../types';

// ============================================================================
// settingsPage — V14.2 (spec sections 24-30). The lock screen still reads
// "Enter Admin Password" (unchanged). The KEY change: on a successful
// unlock, the SAME password is immediately handed to
// secretVaultService.tryAutoUnlock() — creating the Secret Vault
// automatically (pre-filled with non-secret bootstrap defaults) the very
// first time, or unlocking it transparently thereafter. There is no
// separate "Vault Passphrase" prompt anywhere anymore.
// ============================================================================

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
          <p class="hint">Settings — including Schema Management, the Secret Vault, and cross-machine synchronization — are protected.</p>
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
      if (ok) {
        store.unlockSettings();
        // V14.2 — the same Admin Password automatically unlocks (or, on
        // first use, creates) the Secret Vault too. No second prompt.
        await secretVaultService.tryAutoUnlock(candidate);
        store.pushToast('success', 'Settings unlocked for this session.');
        draw();
      } else errBox.removeAttribute('hidden');
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
        <p class="page-subtitle">Everything previously available under "Admin" lives here — same Admin Password, encrypted at rest.</p>
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
        <p class="hint">This same password also protects the Secret Vault (GitHub configuration) — changing it will re-encrypt the vault automatically.</p>
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
        // V14.2 — re-encrypt the Secret Vault under the new password too,
        // so it doesn't silently become unreadable.
        const reenc = await secretVaultService.reencryptForNewPassword(oldPw, newPw);
        resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Password changed successfully.${!reenc.ok ? ` (Note: ${reenc.error})` : ' The Secret Vault was re-encrypted automatically.'}</div>`;
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
        <p class="hint">The Secret Vault securely stores the GitHub configuration needed for synchronization. It unlocks automatically with the same Admin Password used for Settings — no separate passphrase to remember.</p>
        ${unlocked ? `
          <h3 class="mt">GitHub Access Token <span class="req">*</span></h3>
          <p class="hint">This is the one piece of information each authorized user must supply individually — it's a personal credential and, for security, is never synchronized or auto-recovered.</p>
          <div class="masked-token-row">
            <span class="masked-token-display">${icon('key', 14)} ${maskToken(cfg?.githubToken || '')}</span>
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
          <h3 class="mt">Reset Secret Vault</h3>
          <p class="hint">Permanently discards the stored GitHub configuration and token. Not the same as recovering a lost password — that is not possible.</p>
          <button class="btn btn-danger btn-sm" id="resetVaultBtn">${icon('trash', 14)} Reset Secret Vault</button>
        ` : `
          <div class="issue-box mini warn">${icon('alert-triangle', 14)} The Secret Vault should already be unlocked automatically — if you're seeing this, try locking and re-unlocking Settings.</div>
        `}
      </div>`;

    panel.querySelector('#changeTokenBtn')?.addEventListener('click', () => { const row = panel.querySelector<HTMLElement>('#tokenEditRow'); if (row) row.hidden = !row.hidden; });
    panel.querySelector('#cancelTokenBtn')?.addEventListener('click', () => { const row = panel.querySelector<HTMLElement>('#tokenEditRow'); if (row) row.hidden = true; });
    panel.querySelector('#saveTokenBtn')?.addEventListener('click', async () => {
      const newToken = panel.querySelector<HTMLInputElement>('#newTokenInput')?.value || '';
      const password = await promptForCurrentAdminPasswordSilently();
      if (!password) return;
      const result = await secretVaultService.saveConfig({ githubToken: newToken }, password);
      const resultMount = panel.querySelector('#secretVaultResult');
      if (result.ok) { store.pushToast('success', 'GitHub token saved securely.'); renderSecretVaultTab(panel); } else if (resultMount) resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#saveRepoConfigBtn')?.addEventListener('click', async () => {
      const repo = panel.querySelector<HTMLInputElement>('#ghRepo')?.value || DEFAULT_BOOTSTRAP_CONFIG.githubRepo;
      const branch = panel.querySelector<HTMLInputElement>('#ghBranch')?.value || DEFAULT_BOOTSTRAP_CONFIG.githubBranch;
      const path = panel.querySelector<HTMLInputElement>('#ghPath')?.value || DEFAULT_BOOTSTRAP_CONFIG.githubSchemaPath;
      const password = await promptForCurrentAdminPasswordSilently();
      if (!password) return;
      const result = await secretVaultService.saveConfig({ githubRepo: repo, githubBranch: branch, githubSchemaPath: path }, password);
      const resultMount = panel.querySelector('#secretVaultResult');
      if (result.ok) { store.pushToast('success', 'Repository settings saved.'); if (resultMount) resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Saved.</div>`; } else if (resultMount) resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#resetVaultBtn')?.addEventListener('click', () => { if (confirm('This permanently discards the stored GitHub configuration and token. Continue?')) { secretVaultService.resetVault(); store.pushToast('info', 'Secret Vault reset.'); renderSecretVaultTab(panel); } });

    // Since the vault's encryption key IS the Admin Password (already
    // verified once to unlock Settings), we quietly re-derive it here by
    // asking the user to confirm it once more only for a WRITE — this
    // keeps the "never store the plaintext password anywhere in memory
    // longer than necessary" property while still avoiding a full
    // separate secret. In practice this resolves instantly for the vast
    // majority of users who just unlocked Settings moments ago.
    async function promptForCurrentAdminPasswordSilently(): Promise<string | null> {
      const p = prompt('Confirm your Admin Password to save this change:');
      if (!p) return null;
      const ok = await verifyPassword(p);
      if (!ok) { store.pushToast('error', 'Incorrect Admin Password — change not saved.'); return null; }
      return p;
    }
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
          <p class="hint">Repository configuration and access token now live in <strong>Settings → Secret Vault</strong> — no technical details needed here.</p>
          <button class="btn btn-primary btn-sm" id="simpleSyncBtn2">${icon('github', 14)} Sync with GitHub</button>
          <div id="syncResult2" class="mt"></div>
        </div>
        <div class="builder-panel">
          <h3>${icon('clock', 15)} Custom Sync Time</h3>
          ${cfg.time === 'custom' ? `<label class="block-label">Time of day<input type="time" id="customTimeInput" value="${cfg.customTime || '20:30'}" /></label><button class="btn btn-outline btn-sm" id="saveCustomTimeBtn">${icon('save', 14)} Save</button>` : '<p class="hint">Not applicable — current Sync Time (navbar) is not "Custom".</p>'}
          <h3 class="mt">${icon('shield-alert', 15)} Conflict Management</h3>
          <p class="hint">Reuses the existing schema versioning/checksum mechanism — if a pull finds a schema that changed both locally and remotely, you'll be shown exactly which columns changed and asked to choose <strong>Use Local</strong> or <strong>Use Remote</strong> per schema.</p>
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
  }

  function renderNlpTab(panel: HTMLElement): void {
    const current = getConfiguredEndpoint();
    panel.innerHTML = `
      <div class="builder-panel narrow">
        <h3>${icon('cloud', 15)} Online AI/NLP Endpoint</h3>
        <p class="hint">The Query Builder tries this endpoint first, then automatically falls back to the schema-aware local offline engine if it is unset, unreachable, or the browser is offline.</p>
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
