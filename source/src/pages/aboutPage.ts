import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `<div class="page" data-tour="about-panel">
    <h2 class="page-title">${icon('info')} About SQL Assistant</h2>
    <p class="page-subtitle">SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing deep, memorized knowledge of the underlying database schema.</p>
    <div class="explanation-box">
      <p>Version 15.7 is a targeted synchronization bug-fix release: Manual Schema Update's Save action now explicitly synchronizes the updated schema to the central GitHub repository as an integral, awaited part of the save workflow — not a decoupled background process — with clear success/failure feedback tied directly to that save.</p>
      <h4 class="mt">Manual Schema Update save is now centrally synchronized</h4>
      <p>Editing and saving a schema row updates only that row locally (unchanged from V15.6), then immediately and explicitly pushes the updated schema registry to the configured GitHub repository. If the Secret Vault is locked or the push fails, the save is clearly reported as "saved locally but not yet synchronized centrally" — it is never silently reported as a full central save when it wasn't.</p>
      <h4 class="mt">DECODE is CASE-based functionality</h4>
      <p>Schema-defined and manually-configured value-to-display mappings always generate a standard, portable <code>CASE WHEN ... THEN ... ELSE ... END</code> expression, never a database-specific <code>DECODE()</code> call.</p>
      <h4 class="mt">Query Generation Pipeline</h4>
      <p>The Query Generator runs a structured pipeline: table &amp; column resolution → aggregation resolution → filter resolution → GROUP BY resolution → HAVING resolution → related/EXISTS resolution → sort/limit resolution → SQL generation → schema validation — producing complete, coherent complex SELECT statements from Describe What You Need, Manual Selectors, or both combined.</p>
      <h4 class="mt">Self-sustained + Online AI</h4>
      <p>The local/offline engine always understands your Active Schema's tables, columns, relationships, and CASE/DECODE metadata, and can generate and validate complex SQL entirely without an internet connection. An online AI/NLP endpoint, when configured and reachable, is always given the Active Schema context first; any failure silently falls back to the local engine.</p>
      <h4 class="mt">Cross-device Active Schema</h4>
      <p>The Active Schema selection is shared application state — when changed on one machine, every other authorized device automatically adopts it the next time it synchronizes, with no manual re-selection and no page refresh.</p>
      <p class="hint mt">Current AI provider: ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
      <p class="hint">Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations, the last requiring the Admin Password; the GitHub access token lives only as encrypted ciphertext, always shown masked in the UI.</p>
    </div>
    <p class="navbar-signature mt">${icon('user', 14)} Crafted by Subham Ain · Senior Support Consultant</p>
  </div>`;
}
