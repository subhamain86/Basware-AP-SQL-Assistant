import { icon } from '../components/icons';
import { aiService } from '../services/aiService';
export function renderAboutPage(container: HTMLElement): void {
  container.innerHTML = `<div class="page" data-tour="about-panel">
    <h2 class="page-title">${icon('info')} About SQL Assistant</h2>
    <p class="page-subtitle">SQL Assistant is a self-contained tool that helps support teams construct accurate SQL without needing deep, memorized knowledge of the underlying database schema.</p>
    <div class="explanation-box">
      <p>Version 15.5 is a query-generation engine enhancement release. DECODE is now treated as CASE-based functionality throughout — schema-defined and manually-configured value-to-display mappings always generate a standard, portable <code>CASE WHEN ... THEN ... ELSE ... END</code> expression, never a database-specific <code>DECODE()</code> call.</p>
      <h4 class="mt">Query Generation Pipeline</h4>
      <p>The Query Generator now runs a structured pipeline: table &amp; column resolution → aggregation resolution → filter resolution → GROUP BY resolution → HAVING resolution → related/EXISTS resolution → sort/limit resolution → SQL generation → schema validation. This lets a single natural-language description — or Manual Selectors, or both combined — produce a complete, coherent complex SELECT statement with JOINs, aggregations, GROUP BY, HAVING, ORDER BY, LIMIT/TOP/FETCH, and CASE expressions, all grounded in the Active Schema.</p>
      <h4 class="mt">Self-sustained + Online AI</h4>
      <p>The local/offline engine always understands your Active Schema's tables, columns, relationships, and CASE/DECODE metadata, and can generate and validate complex SQL entirely without an internet connection. When an online AI/NLP endpoint is configured and reachable, it is used to improve natural-language understanding — but it always receives the Active Schema's context first, and any table/column it references that doesn't exist in the schema is discarded rather than invented. If the online engine is unavailable, unreachable, or errors, the Query Builder automatically and silently falls back to the local engine.</p>
      <h4 class="mt">Cross-device Active Schema</h4>
      <p>The Active Schema selection is shared application state, not a per-device setting — when an administrator changes it on one machine, every other authorized device automatically adopts the same schema the next time it synchronizes, with no manual re-selection and no page refresh.</p>
      <p class="hint mt">Current AI provider: ${aiService.providerName} (${aiService.isAvailable ? 'available' : 'unavailable'}).</p>
      <p class="hint">Strictly a SQL-text generator — never opens a database connection, never executes a query. Read Only blocks destructive SQL at the engine level; Manual Schema Update's delete requires three confirmations, the last requiring the Admin Password; the GitHub access token lives only as encrypted ciphertext, always shown masked in the UI.</p>
    </div>
    <p class="navbar-signature mt">${icon('user', 14)} Crafted by Subham Ain · Senior Support Consultant</p>
  </div>`;
}
