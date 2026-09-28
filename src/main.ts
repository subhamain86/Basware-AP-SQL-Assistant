import { initTheme } from './components/theme';
import { mountAppShell } from './layouts/appShell';
import { handleCopilotAuthCallbackIfPresent } from './services/msalAuthService';
function boot(): void {
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
