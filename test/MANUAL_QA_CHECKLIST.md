# AP-SQL Assistant V10.8 — Manual QA Checklist

Automated coverage lives in `smoke-test.js` (run with `node test/smoke-test.js`) and
verifies the core SQL/CR/Error-Rectifier/NL-query engine layer, plus the V10.7.1
GitHub vault-unlock fix, with no browser required. The items below need a real
browser and should be checked manually before distributing a build, since they
cover the redesigned Guided Walkthrough and the requirement that it always stays
within the screen.

## 1. Guided Walkthrough — redesign check, per page
For **each** page (Quick Start, Read Only Query Builder, Query Builder for CR,
Error Rectifier, Used Schema, Update Schema):
- [ ] Click **Guided Walkthrough** in the navbar (or "Restart Guided Walkthrough"
      in the menu) — the tour for *that specific page* starts, with content
      relevant to that page's own controls (not a generic, shared tour).
- [ ] Every step shows all four sections: *What it does*, *Why it helps*,
      *What to do*, *What happens next*.
- [ ] The highlighted (spotlighted) element is fully visible and is never
      covered by the walkthrough card itself.
- [ ] `Next` / `Previous` move correctly; `Previous` is disabled on step 1.
- [ ] `Skip` and the `×` close button both end the tour immediately.
- [ ] The last step's button reads **Finish** instead of **Next**.
- [ ] The step counter ("Step X of Y") and progress dots update every step.
- [ ] Pressing `Esc`, `→`, and `←` on the keyboard behave the same as clicking
      Close, Next, and Previous.
- [ ] Re-opening the same tour later (via the restart button) starts from
      step 1 again.

## 2. "Always within the screen" — responsive positioning of the walkthrough
- [ ] Resize the browser from full width down to ~360px — the tour card never
      overflows the viewport and its Next/Previous/Skip/Finish buttons stay
      reachable without needing to scroll the page.
- [ ] Below 576px width, the tour automatically switches to a full-width
      bottom-sheet layout docked to the bottom of the screen.
- [ ] Scroll the page while a tour step is open — the card and spotlight
      reposition smoothly and stay aligned to the target element.
- [ ] Test at 100%, 150%, and 200% browser zoom — the card stays fully
      on-screen and readable at every zoom level.
- [ ] Target an element near the very top, bottom, left, and right edges of
      the screen — the card automatically flips to whichever side has room
      and never overlaps the target it is describing.
- [ ] Open dev tools to shrink the viewport height (e.g. a short laptop
      screen) — the card's own internal scrollbar activates rather than the
      card extending past the bottom of the window.

## 3. General responsive UI/UX pass (all pages)
- [ ] No page produces horizontal scrolling at 360px, 768px, 1024px, or
      1440px widths.
- [ ] Action-button rows (Describe/Build/Reset, CR command buttons, tab
      action bars) wrap onto a new line instead of overflowing on narrow
      screens.
- [ ] The sticky "Generated SQL" result card does not overlap the sticky
      navbar at any scroll position, and drops its sticky behavior on
      narrower/tablet layouts.
- [ ] All modals (About, Confirm Password, Confirm Delete, Save
      Relationship) stay within the viewport and scroll internally if their
      content is tall.
- [ ] The offcanvas menu never overlaps the fixed navbar and closes cleanly
      after navigating.

## 4. Preserved functionality (regression pass vs. V10.7.1)
- [ ] Read Only Query Builder: Describe What You Need → Build Query produces
      valid SQL; manual Tables & Columns selection still works; Advanced
      Options (joins, sort, limit, named view, EXISTS, scalar counts,
      having, hierarchy) all still apply.
- [ ] Query Builder for CR: INSERT/UPDATE/DELETE all generate correctly;
      UPDATE/DELETE without a WHERE clause (and without the override
      checkbox) are correctly rejected.
- [ ] Error Rectifier: pasting a NULL-comparison, CASE/ELSE datatype
      mismatch, or invalid-column error still produces a corrected query and
      explanation.
- [ ] Used Schema: search filters the tree; the stored-schema list can
      switch the active schema.
- [ ] Update Schema: password gate, schema import + preview + apply, GitHub
      sync connect/sync, operational password change, and the **Secure
      GitHub Connection Vault** all still work — specifically, unlocking the
      vault on a second machine with an **empty** Token field must succeed
      (the V10.7.1 fix), not fail with a 401 as it did before that fix.
