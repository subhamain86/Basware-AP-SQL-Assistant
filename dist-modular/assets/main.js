import { initTheme } from './components/theme.js';
import { mountAppShell } from './layouts/appShell.js';
initTheme();
const appRoot = document.getElementById('app');
if (!appRoot) {
    throw new Error('SQL Assistant: #app root element not found in index.html');
}
mountAppShell(appRoot);
