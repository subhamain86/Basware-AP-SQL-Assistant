import { initTheme } from './components/theme';
import { mountAppShell } from './layouts/appShell';
import { handleCopilotAuthCallbackIfPresent } from './services/msalAuthService';
function boot(): void {
  // V16.0: if this page load is actually the M365 Copilot sign-in popup
  // returning from Microsoft identity platform, relay the result to the
  // opener and stop — do not mount the full app shell in the popup.
  if (handleCopilotAuthCallbackIfPresent()) return;
  initTheme();
  const appRoot = document.getElementById('app');
  if (!appRoot) { throw new Error('AP-SQL Assistant: #app root element not found in index.html'); }
  mountAppShell(appRoot);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
