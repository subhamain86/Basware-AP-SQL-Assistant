import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { changePassword, resetPasswordToDefault, verifyPassword, DEMO_DEFAULT_PASSWORD_HINT, isUsingDefaultPassword } from '../services/passwordService';
import { vaultService } from '../services/vaultService';
import { syncService } from '../services/syncService';
import { renderSchemaManagementSection } from './schemaPage';
import { renderSchemaEditorSection } from './schemaEditorSection';
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
          <p class="hint">Settings are protected. Enter the operational password to continue.</p>
          <label class="block-label">Password<input type="password" id="settingsPwInput" autocomplete="off" /></label>
          <div id="settingsPwError" class="issue-box mini" hidden>Incorrect password.</div>
          <div class="row-actions" style="justify-content:center">
            <button type="button" class="btn btn-ghost" id="settingsCancelBtn">Cancel</button>
            <button type="button" class="btn btn-primary" id="settingsUnlockBtn">${icon('unlock', 15)} Unlock</button>
          </div>
          <p class="hint mt">Demo password: <code>${DEMO_DEFAULT_PASSWORD_HINT}</code></p>
        </div>
      </section>`;
    const input = container.querySelector<HTMLInputElement>('#settingsPwInput')!;
    const errBox = container.querySelector<HTMLElement>('#settingsPwError')!;
    async function tryUnlock(): Promise<void> {
      const ok = await verifyPassword(input.value);
      if (ok) { store.unlockSettings(); store.pushToast('success', 'Settings unlocked for this session.'); draw(); }
      else errBox.removeAttribute('hidden');
    }
    container.querySelector('#settingsUnlockBtn')?.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
    container.querySelector('#settingsCancelBtn')?.addEventListener('click', () => { window.location.hash = 'quickstart'; });
  }

  function renderUnlockedSettings(): void {
    container.innerHTML = `
      <section class="page page-settings">
        <div class="settings-header-row">
          <h1 class="page-title">${icon('settings')} Settings <span class="chip chip-active">Unlocked</span></h1>
          <button class="btn btn-outline btn-sm" id="lockSettingsBtn">${icon('lock', 14)} Lock Settings</button>
        </div>
        <p class="page-subtitle">Everything previously available under "Admin" lives here — same operational password, now encrypted at rest.</p>
        <div id="settingsTabsMount" class="settings-tabs-scroll"></div>
      </section>`;

    container.querySelector('#lockSettingsBtn')?.addEventListener('click', () => { store.lockSettings(); store.pushToast('info', 'Settings locked.'); draw(); });

    const tabsMount = container.querySelector<HTMLElement>('#settingsTabsMount')!;
    renderTabs(tabsMount, [
      { id: 'security', label: 'Security', render: renderSecurityTab },
      { id: 'schema-editor', label: 'Manual Schema Update', render: (panel) => { panel.setAttribute('data-tour', 'schema-editor-panel'); renderSchemaEditorSection(panel); } },
      { id: 'schema-mgmt', label: 'Schema Management', render: (panel) => renderSchemaManagementSection(panel, draw) },
      { id: 'sync', label: 'Synchronization', render: renderSyncTab },
      { id: 'vault', label: 'Vault', render: renderVaultTab },
      { id: 'danger', label: 'Danger Zone', render: renderDangerTab }
    ], 'security', { security: 'settings-security', danger: 'settings-danger' });
  }

  function renderSecurityTab(panel: HTMLElement): void {
    panel.innerHTML = `
      <div class="builder-panel narrow">
        <p class="hint">${isUsingDefaultPassword() ? `Currently using the demo default password: <code>${DEMO_DEFAULT_PASSWORD_HINT}</code>` : 'A custom password has been set. It is stored encrypted at rest (PBKDF2 + AES-GCM) — never in plain text.'}</p>
        <h3>Change Password</h3>
        <label class="block-label">Current password<input type="password" id="oldPwInput" autocomplete="off" /></label>
        <label class="block-label">New password<input type="password" id="newPwInput" autocomplete="off" /></label>
        <div class="row-actions"><button class="btn btn-primary btn-sm" id="changePwBtn">${icon('key', 14)} Change Password</button></div>
        <div id="changePwResult"></div>
        <h3 class="mt">Forgot Password</h3>
        <p class="hint">Resets the operational password back to the documented demo default.</p>
        <button class="btn btn-outline btn-sm" id="resetPwBtn">${icon('refresh', 14)} Reset to Default</button>
        <h3 class="mt">Session Security</h3>
        <p class="hint">Settings automatically locks after 5 minutes of inactivity, or immediately when you select "Lock Settings".</p>
      </div>`;
    panel.querySelector('#changePwBtn')?.addEventListener('click', async () => {
      const oldPw = panel.querySelector<HTMLInputElement>('#oldPwInput')?.value || ''; const newPw = panel.querySelector<HTMLInputElement>('#newPwInput')?.value || '';
      const resultMount = panel.querySelector('#changePwResult'); const result = await changePassword(oldPw, newPw);
      if (!resultMount) return;
      if (result.ok) { resultMount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Password changed successfully.</div>`; store.pushToast('success', 'Operational password changed.'); (panel.querySelector<HTMLInputElement>('#oldPwInput')!).value = ''; (panel.querySelector<HTMLInputElement>('#newPwInput')!).value = ''; }
      else resultMount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#resetPwBtn')?.addEventListener('click', () => { resetPasswordToDefault(); store.pushToast('info', 'Password reset to the demo default.'); renderSecurityTab(panel); });
  }

  function renderSyncTab(panel: HTMLElement): void {
    const cfg = syncService.getConfig();
    const vaultUnlocked = vaultService.isUnlocked();
    const vCfg = vaultService.getConfig();
    panel.innerHTML = `
      <div class="builder-grid-top">
        <div class="builder-panel">
          <h3>${icon('folder', 15)} Shared Location</h3>
          <p class="hint">Status: ${syncService.hasConnectedLocation() ? '<span class="sync-ok">Connected</span>' : 'Not connected'}${syncService.isFileSystemAccessSupported() ? '' : ' — this browser does not support the File System Access API; use Import/Export instead.'}</p>
          <button class="btn btn-outline btn-sm" id="connectLocationBtn" ${syncService.isFileSystemAccessSupported() ? '' : 'disabled'}>${icon('folder', 14)} Connect Folder</button>
          <div id="locationResult"></div>
          <h3 class="mt">${icon('github', 15)} GitHub</h3>
          ${vaultUnlocked ? `
            <label class="block-label">Repository (owner/repo)<input type="text" id="ghRepo" value="${vCfg?.githubRepo || ''}" placeholder="e.g. basware/ap-sql-schemas" /></label>
            <label class="block-label">Branch<input type="text" id="ghBranch" value="${vCfg?.githubBranch || 'main'}" /></label>
            <label class="block-label">Schema file path<input type="text" id="ghPath" value="${vCfg?.githubSchemaPath || 'schema.json'}" /></label>
            <label class="block-label">Access Token <span class="hint">(stored only inside the encrypted Vault)</span><input type="password" id="ghToken" value="${vCfg?.githubToken || ''}" autocomplete="off" /></label>
            <button class="btn btn-outline btn-sm" id="saveGithubBtn">${icon('save', 14)} Save GitHub Configuration</button>
          ` : `<div class="issue-box mini warn">${icon('alert-triangle', 14)} Unlock the Vault (below) to configure GitHub credentials.</div>`}
          <h3 class="mt">Sync Now</h3>
          <p class="hint">Status: <span id="syncStatusLabel">${syncStatusLabel()}</span>${syncService.getLastSyncedAt() ? ` · Last sync: ${new Date(syncService.getLastSyncedAt()!).toLocaleString()}` : ''}</p>
          <button class="btn btn-primary btn-sm" id="syncNowBtn">${icon('folder-sync', 14)} Sync Now (${cfg.source === 'shared-location' ? 'Shared Location' : 'GitHub'})</button>
          <div id="syncResult"></div>
        </div>
        <div class="builder-panel">
          <h3>${icon('clock', 15)} Custom Sync Time</h3>
          <p class="hint">Only shown when Sync Time (in the navbar) is set to "Custom".</p>
          ${cfg.time === 'custom' ? `<label class="block-label">Time of day<input type="time" id="customTimeInput" value="${cfg.customTime || '20:30'}" /></label><button class="btn btn-outline btn-sm" id="saveCustomTimeBtn">${icon('save', 14)} Save</button>` : '<p class="hint">Not applicable — current Sync Time is not "Custom".</p>'}
          <h3 class="mt">${icon('shield-alert', 15)} Conflict Management</h3>
          <p class="hint">If a synchronized schema differs from your active schema, you'll be shown a comparison and asked to choose Use Local / Use Remote / Cancel before anything is overwritten.</p>
        </div>
      </div>`;

    panel.querySelector('#connectLocationBtn')?.addEventListener('click', async () => {
      const result = await syncService.connectSharedLocation();
      const mount = panel.querySelector('#locationResult');
      if (mount) mount.innerHTML = result.ok ? `<div class="issue-box mini ok">${icon('check', 14)} Connected: ${result.label}</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
      if (result.ok) renderSyncTab(panel);
    });

    panel.querySelector('#saveGithubBtn')?.addEventListener('click', async () => {
      if (!vaultService.isUnlocked()) return;
      const repo = panel.querySelector<HTMLInputElement>('#ghRepo')?.value || '';
      const branch = panel.querySelector<HTMLInputElement>('#ghBranch')?.value || 'main';
      const path = panel.querySelector<HTMLInputElement>('#ghPath')?.value || 'schema.json';
      const token = panel.querySelector<HTMLInputElement>('#ghToken')?.value || '';
      const pass = prompt('Re-enter your Vault Passphrase to save this configuration:');
      if (!pass) { store.pushToast('info', 'GitHub configuration not saved.'); return; }
      const result = await vaultService.saveConfig({ githubRepo: repo, githubBranch: branch, githubSchemaPath: path, githubToken: token }, pass);
      if (result.ok) { store.pushToast('success', 'GitHub configuration saved to the encrypted Vault.'); renderSyncTab(panel); }
      else store.pushToast('error', result.error || 'Could not save — incorrect passphrase.');
    });

    panel.querySelector('#syncNowBtn')?.addEventListener('click', async () => {
      const resultMount = panel.querySelector('#syncResult');
      const result = await syncService.syncNow();
      if (resultMount) resultMount.innerHTML = result.ok ? `<div class="issue-box mini ok">${icon('check', 14)} Synchronized successfully.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
      const statusLabel = panel.querySelector('#syncStatusLabel'); if (statusLabel) statusLabel.textContent = syncStatusLabel();
    });

    panel.querySelector('#saveCustomTimeBtn')?.addEventListener('click', () => {
      const t = panel.querySelector<HTMLInputElement>('#customTimeInput')?.value || '20:30';
      syncService.setTime('custom' as SyncTimeOption, t);
      store.pushToast('success', `Custom sync time saved: ${t}.`);
    });
  }

  function syncStatusLabel(): string {
    const s = syncService.getStatus();
    return s === 'synchronized' ? 'Synchronized' : s === 'pending' ? 'Changes Pending' : s === 'failed' ? 'Synchronization Failed' : s === 'syncing' ? 'Synchronizing' : 'Never synchronized';
  }

  function renderVaultTab(panel: HTMLElement): void {
    const exists = vaultService.exists();
    const unlocked = vaultService.isUnlocked();
    panel.innerHTML = `
      <div class="builder-panel narrow">
        <div class="editing-schema-banner">${icon(unlocked ? 'unlock' : 'lock', 14)} Vault ${unlocked ? 'Unlocked' : 'Locked'}</div>
        ${!exists ? `
          <h3>Create Vault</h3>
          <p class="hint">Protects GitHub credentials and other sync secrets with your own passphrase. No default passphrase is ever built in — you must create one.</p>
          <label class="block-label">Vault Passphrase<input type="password" id="vaultNewPass" autocomplete="off" /></label>
          <label class="block-label">Confirm Passphrase<input type="password" id="vaultConfirmPass" autocomplete="off" /></label>
          <button class="btn btn-primary btn-sm" id="createVaultBtn">${icon('safe', 14)} Create Vault</button>
          <div id="vaultCreateResult"></div>
        ` : unlocked ? `
          <p class="hint">Vault is unlocked for this session. Decrypted configuration is held only in memory.</p>
          <button class="btn btn-outline btn-sm" id="lockVaultBtn">${icon('lock', 14)} Lock Vault</button>
          <h3 class="mt">Change Passphrase</h3>
          <label class="block-label">Current passphrase<input type="password" id="vaultOldPass" autocomplete="off" /></label>
          <label class="block-label">New passphrase<input type="password" id="vaultChangeNewPass" autocomplete="off" /></label>
          <button class="btn btn-outline btn-sm" id="changeVaultPassBtn">${icon('key', 14)} Change Passphrase</button>
          <div id="vaultChangeResult"></div>
          <h3 class="mt">Reset Vault</h3>
          <p class="hint">Permanently destroys the vault. This is <strong>not</strong> the same as recovering a lost passphrase — a lost passphrase cannot be recovered, only reset (starting fresh, losing existing encrypted secrets).</p>
          <button class="btn btn-danger btn-sm" id="resetVaultBtn">${icon('trash', 14)} Reset Vault</button>
        ` : `
          <h3>Unlock Vault</h3>
          <label class="block-label">Vault Passphrase<input type="password" id="vaultUnlockPass" autocomplete="off" /></label>
          <div id="vaultUnlockResult"></div>
          <button class="btn btn-primary btn-sm" id="unlockVaultBtn">${icon('unlock', 14)} Unlock</button>
          <h3 class="mt">Lost your passphrase?</h3>
          <p class="hint">Encrypted vault data cannot be decrypted without the correct passphrase — there is no recovery mechanism. You may reset the vault, but this permanently discards the existing encrypted secrets.</p>
          <button class="btn btn-outline btn-sm" id="resetVaultBtnLocked">${icon('trash', 14)} Reset Vault (discard existing secrets)</button>
        `}
      </div>`;

    panel.querySelector('#createVaultBtn')?.addEventListener('click', async () => {
      const p1 = panel.querySelector<HTMLInputElement>('#vaultNewPass')?.value || ''; const p2 = panel.querySelector<HTMLInputElement>('#vaultConfirmPass')?.value || '';
      const result = await vaultService.createVault(p1, p2);
      const mount = panel.querySelector('#vaultCreateResult');
      if (result.ok) { store.pushToast('success', 'Vault created and unlocked.'); renderVaultTab(panel); }
      else if (mount) mount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#unlockVaultBtn')?.addEventListener('click', async () => {
      const p = panel.querySelector<HTMLInputElement>('#vaultUnlockPass')?.value || '';
      const result = await vaultService.unlock(p);
      const mount = panel.querySelector('#vaultUnlockResult');
      if (result.ok) { store.pushToast('success', 'Vault unlocked.'); renderVaultTab(panel); }
      else if (mount) mount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#lockVaultBtn')?.addEventListener('click', () => { vaultService.lock(); store.pushToast('info', 'Vault locked.'); renderVaultTab(panel); });
    panel.querySelector('#changeVaultPassBtn')?.addEventListener('click', async () => {
      const oldP = panel.querySelector<HTMLInputElement>('#vaultOldPass')?.value || ''; const newP = panel.querySelector<HTMLInputElement>('#vaultChangeNewPass')?.value || '';
      const result = await vaultService.changePassphrase(oldP, newP);
      const mount = panel.querySelector('#vaultChangeResult');
      if (result.ok) { store.pushToast('success', 'Vault passphrase changed.'); if (mount) mount.innerHTML = `<div class="issue-box mini ok">${icon('check', 14)} Passphrase changed.</div>`; }
      else if (mount) mount.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
    panel.querySelector('#resetVaultBtn')?.addEventListener('click', () => { if (confirm('This permanently discards all encrypted vault secrets. Continue?')) { vaultService.resetVault(); store.pushToast('info', 'Vault reset. Create a new one when ready.'); renderVaultTab(panel); } });
    panel.querySelector('#resetVaultBtnLocked')?.addEventListener('click', () => { if (confirm('This permanently discards all encrypted vault secrets (they cannot be recovered). Continue?')) { vaultService.resetVault(); store.pushToast('info', 'Vault reset.'); renderVaultTab(panel); } });
  }

  function renderDangerTab(panel: HTMLElement): void {
    const active = schemaService.getActiveSchema();
    panel.innerHTML = `
      <div class="builder-panel">
        <p class="hint">Permanently remove every table, column, and relationship from the active schema (<strong>${active.name}</strong>). A full backup is downloaded automatically before anything is deleted.</p>
        <button class="btn btn-danger btn-sm" id="wipeSchemaBtn">${icon('trash', 14)} Delete Schema Contents</button>
        <div id="wipeResult"></div>
      </div>`;
    panel.querySelector('#wipeSchemaBtn')?.addEventListener('click', () => {
      const wipeResult = panel.querySelector('#wipeResult'); if (!wipeResult) return;
      wipeResult.innerHTML = `<div class="issue-box mini"><div>${icon('alert-triangle', 14)} This will permanently remove ALL tables/columns from the active schema. Enter the operational password to confirm.</div><label class="block-label mt">Password<input type="password" id="wipePwInput" autocomplete="off" /></label><div class="row-actions"><button class="btn btn-ghost btn-sm" id="wipeCancelBtn">Cancel</button><button class="btn btn-danger btn-sm" id="wipeConfirmBtn">${icon('trash', 14)} Confirm Delete</button></div></div>`;
      panel.querySelector('#wipeCancelBtn')?.addEventListener('click', () => { wipeResult.innerHTML = ''; });
      panel.querySelector('#wipeConfirmBtn')?.addEventListener('click', async () => {
        const pw = panel.querySelector<HTMLInputElement>('#wipePwInput')?.value || ''; const ok = await verifyPassword(pw);
        if (!ok) { wipeResult.innerHTML = `<div class="issue-box mini">${icon('alert-triangle', 14)} Incorrect password.</div>`; return; }
        const active2 = schemaService.getActiveSchema(); const backup = schemaService.deleteAllSchemaContents(active2.id);
        downloadBlob(`schema-backup-${active2.id}-${Date.now()}.json`, backup, 'application/json');
        store.pushToast('success', 'Schema contents deleted. A backup was downloaded automatically.');
        wipeResult.innerHTML = ''; renderDangerTab(panel);
      });
    });
  }

  draw();
}
