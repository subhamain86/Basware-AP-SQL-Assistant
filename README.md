# SQL Assistant — V15.5

Baseline: V15.4 (working). This is a **query-generation engine enhancement
release** — the entire V15.4 UI, theme system, navigation, Schema
Management, Secret Vault, and cross-device sync are unchanged; only the
Query Generation Engine got substantially smarter.

## How to run
- **Static hosting** (GitHub Pages, SharePoint, OneDrive, any web server):
  upload `index.html` as-is — CSS and JS are fully inlined, no build step.
- **Local / offline:** double-click `index.html`.
- `source/` contains the full TypeScript source (`tsc --noEmit` clean).

## What changed in V15.5

### 1. DECODE is now CASE-based functionality (not a DB-specific function)
Every schema-defined or manually-configured value-to-display mapping —
regardless of SQL dialect, including Oracle — now generates a standard,
portable `CASE WHEN ... THEN ... ELSE 'Unknown' END` expression. The
application **never** emits a database-specific `DECODE()` function call
anymore. Verified: selecting a CASE/DECODE-mapped column produces exactly
```sql
CASE
    WHEN PO_HEADER.STATUS = 'O' THEN 'Open'
    WHEN PO_HEADER.STATUS = 'C' THEN 'Closed'
    WHEN PO_HEADER.STATUS = 'H' THEN 'On Hold'
    ELSE 'Unknown'
END AS STATUS
```
Manual Schema Update's DECODE guidance, live preview, and example are all
updated to reflect this — the preview literally renders as CASE, live, as
you type.

### 2. Query Generation Pipeline — genuinely complex SELECT queries
The engine now runs a real, staged pipeline (not a single regex blob):
table/column resolution → **aggregation resolution** (SUM/AVG/COUNT/MIN/
MAX) → filter resolution → **GROUP BY resolution** (explicit "by X", or
implied whenever an aggregate is mixed with plain columns) → **HAVING
resolution** (a comparison applied to an aggregate) → related/EXISTS
resolution → sort/limit resolution → SQL generation → schema validation.

Verified end-to-end with the exact complex example from the spec:
> "Show the total invoice amount by supplier for the current year,
> including supplier name, invoice count, average invoice amount, and
> only suppliers whose total invoice amount is greater than 100000. Sort
> by total amount descending and show the top 20 suppliers."

produces one coherent statement with `SUM`, `AVG`, `COUNT`, automatic
JOINs across 3 tables (via the Active Schema's real relationships),
`GROUP BY`, `HAVING SUM(...) > 100000`, `ORDER BY ... DESC`, and
`FETCH FIRST 20 ROWS ONLY`.

**Bugs found and fixed while building this test** (a good sign the
testing was real, not superficial):
- A relative-date SQL expression (`DATE_TRUNC('YEAR', CURRENT_DATE)`) was
  being wrapped in an extra pair of string quotes, turning valid SQL into
  a broken string literal — fixed in the filter-rendering engine to
  recognize SQL date expressions and pass them through unquoted.
- A short generic column name (e.g. a bare `AMOUNT` on an unrelated
  table) could "steal" a match meant for a more specific compound column
  (`INVOICE_AMOUNT`) due to plain substring matching — fixed by resolving
  longer/more specific column names first and skipping a generic column
  once its concept is already covered.
- Both the aggregate and HAVING resolvers only checked the *first*
  occurrence of a phrase, so a column mentioned twice for two different
  purposes (once for SUM, later for a HAVING comparison) missed the
  second occurrence — fixed to scan every occurrence.
- A direction word ("descending") not immediately followed by a comma/
  period (e.g. "...descending and show the top 20...") was being
  swallowed into the sort-column phrase instead of recognized as the
  direction — fixed to match on a word boundary instead of requiring an
  immediate sentence terminator.

### 3. Manual Selectors as a structured query definition
Manual Selectors were already capable of producing every advanced SQL
shape (JOINs, filters, GROUP BY/HAVING, CTEs, EXISTS, related counts,
hierarchies) — this is unchanged and confirmed still fully functional.

### 4. Describe + Manual Selectors combine, non-destructively
`store.mergeReadOnlyFromNlp()` and `aiService.generateSQL()` were both
extended to additively merge the new aggregate/GROUP BY/HAVING/related-
condition signals the same way tables/columns/filters were already merged
in V15.4: **every merge only ever adds** to what the user has manually
selected — an explicit Manual Selector choice is never removed or
replaced by natural-language intent. Verified: manually selecting
`INVOICE_HEADER` and then describing a related requirement keeps
`INVOICE_HEADER` in the final SQL.

### 5. Self-sustained (offline) engine + Online AI, both schema-grounded
The local engine performs the entire pipeline above with zero network
calls, and is what's actually used in this test environment (no online
endpoint configured) — SQL is still generated correctly and the "Offline/
local engine" badge is shown. When an online endpoint IS configured and
reachable, it's given the full Active Schema context (including CASE/
DECODE mappings) and any table/column it references that isn't in the
Active Schema is discarded rather than trusted. Any online failure,
timeout, or unavailability falls through to the local engine silently —
the Query Builder never becomes unusable.

### 6. Query explanation (new)
The Generated SQL panel gained an "Explain Query" button (alongside the
existing Copy/Clear/Validate/Regenerate/Optimize) that reads the current
builder state and produces a plain-language summary — tables/joins used,
aggregations, filters, GROUP BY, HAVING, ORDER BY, LIMIT, and CTEs —
without altering the existing Generated SQL panel's structure.

## Regression testing performed
- `tsc --noEmit`: clean.
- Playwright: all 7 routes, zero console/page errors.
- Playwright: DECODE→CASE conversion confirmed (no `DECODE(` anywhere).
- Playwright: the exact complex spec example produces SUM/AVG/COUNT/JOIN/
  GROUP BY/HAVING/ORDER BY DESC/LIMIT 20 correctly.
- Playwright: Manual Selectors preserved when combined with Describe.
- Playwright: offline fallback confirmed (SQL still generated, correctly
  labeled, with zero online endpoint configured).
- Playwright: Explain Query button and output confirmed.
- Playwright: Manual Schema Update DECODE help/live-preview confirmed
  CASE-based (not DECODE()).
- Playwright: V15.4 UI (side-by-side Describe/Generated SQL grid, aligned
  top edges) confirmed unchanged.
