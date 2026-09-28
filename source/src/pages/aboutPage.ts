import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `<div class="page" data-tour="about-panel">
    <h2 class="page-title">${icon('info')} About SQL Assistant</h2>
    <p class="page-subtitle">SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing deep, memorized knowledge of the underlying database schema.</p>
    <div class="explanation-box">
      <p>Version 15.3 is a UI organization, theme consistency, and stability release — the application name is now consistently "SQL Assistant" throughout, the Admin Password page no longer shows a false error before any attempt, the Read Only and CR Query Builders have a cleaner card layout with deliberate spacing between "Describe What You Need" and "Generated SQL", the Error Rectifier displays original and rectified SQL side by side on larger screens, and every input control now correctly follows the selected theme.</p>
      <h4 class="mt">Cross-device Active Schema</h4>
      <p>The Active Schema selection is shared application state, not a per-device setting — when an administrator changes it on one machine, every other authorized device automatically adopts the same schema the next time it synchronizes, with no manual re-selection and no page refresh.</p>
      <h4 class="mt">Advanced Options</h4>
      <p>ORDER BY (multi-column), LIMIT/TOP/FETCH, friendly query names (CTE-wrapped), EXISTS/NOT EXISTS related-table filters, related counts, GROUP BY/HAVING, and recursive hierarchy ("org chart") queries are all schema-aware and update the generated SQL immediately.</p>
      <p class="hint mt">Current AI provider: ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
      <p class="hint">Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations, the last requiring the Admin Password; the GitHub access token lives only as encrypted ciphertext, always shown masked in the UI.</p>
    </div>
    <p class="navbar-signature mt">${icon('user', 14)} Crafted by Subham Ain · Senior Support Consultant</p>
  </div>`;
}
