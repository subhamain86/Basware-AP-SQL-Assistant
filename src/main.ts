import './styles/main.css';
import { initTheme } from './components/theme';
import { mountAppShell } from './layouts/appShell';
initTheme();
const appRoot = document.getElementById('app');
if (!appRoot) { throw new Error('SQL Assistant: #app root element not found in index.html'); }
mountAppShell(appRoot);
