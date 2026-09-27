import { icon } from '../components/icons';
import { store } from '../state/store';
import { schemaService } from '../services/schemaService';
import { changePassword, resetPasswordToDefault, verifyPassword } from '../services/passwordService';
import { secretVaultService } from '../services/secretVaultService';
import { syncService } from '../services/syncService';
import { handleVaultUnlocked } from '../services/autoSyncService';
import { renderSchemaManagementSection } from './schemaPage';
import { renderSchemaEditorSection } from './schemaEditorSection';
import { renderConflictBanner } from '../components/conflictBanner';
import { renderSyncLogPanel } from '../components/syncLogPanel';
import { renderTabs } from '../components/tabs';
import { downloadBlob, formatBytes } from '../utils/dom';
import { estimateStringBytes } from '../utils/validation';
export function renderSettingsPage(container: HTMLElement): void {
  function draw(): void { if (!store.settingsUnlocked) { renderLockScreen(); return; } renderUnlockedSettings(); }
  function renderLockScreen(): void {
    container.innerHTML = `<div class="page-settings-lock" data-tour="settings-lock-screen"><div class="settings-lock-card"><div class="settings-lock-icon">${icon('lock', 32)}</div>
      <h2>Settings</h2>
      <p class="hint">Settings — including Schema Management, the Secret Vault, and cross-device synchronization — are protected.</p>
      <label class="block-label">Enter Admin Password<input type="password" id="settingsPwInput"/></label>
      <div class="issue-box mini" id="settingsPwError" hidden>Incorrect password.</div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="settingsCancelBtn">Cancel</button><button type="button" class="btn btn-primary" id="settingsUnlockBtn">${icon('unlock', 15)} Unlock</button></div>
    </div></div>`;
    const input = container.querySelector<HTMLInputElement>('#settingsPwInput')!; const errBox = container.querySelector<HTMLElement>('#settingsPwError')!;
    async function tryUnlock(): Promise<void> {
      const candidate = input.value; const ok = await verifyPassword(candidate); if (!ok) { errBox.removeAttribute('hidden'); return; }
      store.unlockSettings();
      const bootstrapResult = await secretVaultService.tryAutoUnlock(candidate);
      if (bootstrapResult.ok) { store.pushToast('success', 'Secret Vault unlocked.'); handleVaultUnlocked().catch(() => {}); }
      draw();
    }
    container.querySelector('#settingsUnlockBtn')?.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
    container.querySelector('#settingsCancelBtn')?.addEventListener('click', () => { window.location.hash = 'quickstart'; });
  }
  function renderUnlockedSettings(): void {
    container.innerHTML = `<div class="page">
      <div class="settings-header-row"><h2 class="page-title">${icon('settings')} Settings Unlocked</h2><button type="button" class="btn btn-outline btn-sm" id="lockSettingsBtn">${icon('lock', 14)} Lock Settings</button></div>
      <div class="settings-tabs-scroll" id="settingsTabsMount"></div>
    </div>`;
    container.querySelector('#lockSettingsBtn')?.addEventListener('click', () => { store.lockSettings(); secretVaultService.lock(); draw(); });
    const tabsMount = container.querySelector<HTMLElement>('#settingsTabsMount')!;
    renderTabs(tabsMount, [
      { id: 'security', label: 'Security', render: renderSecurityTab },
      { id: 'schema-editor', label: 'Manual Schema Update', render: renderSchemaEditorSection },
      { id: 'schema-mgmt', label: 'Schema Management', render: (panel) => renderSchemaManagementSection(panel, { allowAddImport: true }, draw) },
      { id: 'sync', label: 'Synchronization', render: renderSyncTab },
      { id: 'danger', label: 'Danger Zone', render: renderDangerTab }
    ], 'security');
  }
  function renderSecurityTab(panel: HTMLElement): void {
    panel.innerHTML = `<div class="mt"><h4>Change Admin Password</h4><div class="form-row-2"><label class="block-label">Current password<input type="password" id="oldPwInput"/></label><label class="block-label">New password<input type="password" id="newPwInput"/></label></div><button type="button" class="btn btn-primary btn-sm" id="changePwBtn">${icon('key', 14)} Change Password</button><div id="changePwResult"></div></div>`;
    panel.querySelector('#changePwBtn')?.addEventListener('click', async () => {
      const oldPw = panel.querySelector<HTMLInputElement>('#oldPwInput')?.value || ''; const newPw = panel.querySelector<HTMLInputElement>('#newPwInput')?.value || '';
      const resultMount = panel.querySelector<HTMLElement>('#changePwResult'); const result = await changePassword(oldPw, newPw); if (!resultMount) return;
      resultMount.innerHTML = result.ok ? `<div class="issue-box ok mini">${icon('check', 14)} Changed.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`;
    });
  }
  function renderSyncTab(panel: HTMLElement): void {
    panel.innerHTML = `<div class="mt"><h4>${icon('github', 15)} GitHub Sync</h4><button type="button" class="btn btn-outline btn-sm" id="simpleSyncBtn2">${icon('github', 14)} Sync with GitHub Now</button><div id="syncResult2"></div><div id="conflictBannerMountSync"></div><h4 class="mt">${icon('history', 15)} Sync Log</h4><div id="syncLogMount"></div></div>`;
    panel.querySelector('#simpleSyncBtn2')?.addEventListener('click', async () => { const result = await syncService.syncWithGitHubSimple(); const mount = panel.querySelector<HTMLElement>('#syncResult2'); if (mount) mount.innerHTML = result.ok ? `<div class="issue-box ok mini">${icon('check', 14)} Synced.</div>` : `<div class="issue-box mini">${icon('alert-triangle', 14)} ${result.error}</div>`; });
    const conflictMount = panel.querySelector<HTMLElement>('#conflictBannerMountSync'); if (conflictMount) renderConflictBanner(conflictMount, () => renderSyncTab(panel));
    const logMount = panel.querySelector<HTMLElement>('#syncLogMount'); if (logMount) renderSyncLogPanel(logMount);
  }
  function renderDangerTab(panel: HTMLElement): void {
    const health = schemaService.getStorageHealth();
    const registrySize = estimateStringBytes(JSON.stringify(schemaService.getRegistry()));
    panel.innerHTML = `<div class="mt"><h4>${icon('hard-drive', 15)} Local Storage Health</h4><div class="row-actions wrap"><span class="chip ${health.lastPersistOk ? 'chip-active' : 'chip-inactive'}">${icon(health.lastPersistOk ? 'check' : 'alert-triangle', 14)} Last save: ${health.lastPersistOk ? 'OK' : 'FAILED'}</span><span class="chip">Size: ${formatBytes(registrySize)}</span></div><button type="button" class="btn btn-outline btn-sm mt" id="cleanupStorageBtn">${icon('broom', 14)} Clean Up Duplicate/Stale Schemas</button><div id="cleanupResult"></div></div>`;
    panel.querySelector('#cleanupStorageBtn')?.addEventListener('click', () => { const result = schemaService.pruneForSpace(); const mount = panel.querySelector<HTMLElement>('#cleanupResult'); if (mount) mount.innerHTML = `<div class="issue-box ok mini">${icon('check', 14)} Removed ${result.removedCount} schema(s).</div>`; renderDangerTab(panel); });
  }
  draw();
}
