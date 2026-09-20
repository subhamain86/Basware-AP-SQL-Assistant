# AP-SQL Assistant V10.8 — Manual QA Checklist

Automated coverage lives in `smoke-test.js` (run with `node test/smoke-test.js`) and
verifies the core SQL/CR/Error-Rectifier/NL-query engine layer with no browser
required. The items below need a real browser and should be checked manually
before distributing a build, since they cover the Guided Walkthrough redesign
and the responsive UI/UX pass — the focus of the V10.8 release.

## 1. Guided Walkthrough — per page
For **each** page (Home, Read Only Query Builder, Query Builder for CR, Error
Rectifier, Used Schema, Update Schema):
- [ ] Click **Guided Walkthrough** in the navbar (or the menu) — the tour for
      *that* page starts, not a generic/shared tour.
- [ ] Every step shows all four sections: *What it does*, *Why it helps*,
      *What to do*, *What happens next*.
- [ ] The highlighted element is fully visible and is never covered by the
      tour card.
- [ ] `Next` / `Previous` move correctly; `Previous` is disabled on step 1.
- [ ] `Skip` and the `×` close button both end the tour immediately.
- [ ] The last step's button reads **Finish** instead of **Next**.
- [ ] The step counter ("Step X of Y") and progress dots update every step.
- [ ] Pressing `Esc`, `→`, and `←` on the keyboard behaves the same as
      clicking Close, Next, and Previous.
- [ ] Re-opening the same tour later (via the restart button) starts from
      step 1 again.

## 2. Responsive positioning of the walkthrough
- [ ] Resize the browser from full width down to ~360px — the tour card
      never overflows the viewport and its buttons stay reachable without
      scrolling the page.
- [ ] Below 576px width, the tour switches to a full-width bottom sheet.
- [ ] Scroll the page while a tour step is open — the card and spotlight
      reposition smoothly and stay aligned to the target.
- [ ] Test at 100%, 150%, and 200% browser zoom — layout stays usable.
- [ ] Target an element near the very top, bottom, left, and right edges of
      the screen — the card automatically flips to the side with room and
      never overlaps the target.

## 3. General responsive UI/UX pass (all pages)
- [ ] No page produces horizontal scrolling at 360px, 768px, 1024px, or
      1440px widths.
- [ ] Buttons in action rows (Describe/Build/Reset, CR command buttons, tab
      action bars) wrap onto a new line instead of overflowing on narrow
      screens.
- [ ] The sticky "Generated SQL" result card does not overlap the sticky
      navbar at any scroll position.
- [ ] All modals (About, Confirm Password, Confirm Delete, Save
      Relationship) stay within the viewport and scroll internally if their
      content is tall.
- [ ] The offcanvas menu never overlaps the fixed navbar and closes cleanly
      after navigating.
- [ ] Long table/column names and descriptions wrap instead of overflowing
      their containers.

## 4. Preserved functionality (regression pass)
- [ ] Read Only Query Builder: Describe What You Need → Build Query produces
      valid SQL; manual Tables & Columns selection still works; Advanced
      Options (joins, sort, limit, named view, EXISTS, scalar counts,
      having, hierarchy) still all apply.
- [ ] Query Builder for CR: INSERT/UPDATE/DELETE all generate correctly;
      UPDATE/DELETE without a WHERE clause (and without the override
      checkbox) are correctly rejected.
- [ ] Error Rectifier: pasting a NULL-comparison or invalid-column error
      still produces a corrected query and explanation.
- [ ] Used Schema: search filters the tree; stored-schema list can switch
      the active schema.
- [ ] Update Schema: password gate, schema import + preview + apply, GitHub
      sync connect/sync, vault publish/unlock, and operational password
      change all still work end-to-end.
