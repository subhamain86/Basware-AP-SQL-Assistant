# V16.2 — Root-Cause Fix: Password Error Box Visible With No Active Error

Baseline: V16.1.1. Scope: one issue, reported as still present after the V16.1.1 CSS fix —
"the password error is still shown even when no password entered."

## Why the V16.1.1 fix did not fully resolve this

V16.1.1 added `[hidden] { display: none !important; }` to `main.css`, to force the browser's
built-in `hidden`-attribute behaviour to win over `.issue-box { display: flex }`, which had been
silently overriding it. That CSS rule is correct and was verified working in an isolated headless
browser test at the time.

However, it is still fundamentally a **CSS-dependent** fix: it only works if that exact stylesheet
rule is the one actually in effect at the moment the page renders. That dependency is a real risk
in practice — for example, a cached copy of the file predating the fix, or any wrapping viewer /
frame / portal that reinjects its own CSS after the page's own stylesheet, could neutralize it
without changing a single line of this app's own code. Whatever the exact mechanism in your
environment, the underlying architecture (a permanently-present error `<div>`, toggled invisible
via a single CSS property) was inherently fragile, so the right fix is to remove that fragility
entirely rather than add another layer of CSS defending against it.

## The V16.2 fix — remove the CSS dependency altogether

Every transient error/status indicator in the app that used the "permanently present, toggle
`hidden`" pattern has been changed to an "absent by default, inserted only on a real error"
pattern:

- **`#settingsPwError`** (Settings password lock screen) — the exact box reported as still
  visible. **Before:** `<div id="settingsPwError" class="issue-box mini" hidden>Incorrect
  password.</div>`, with `errBox.hidden = true/false` toggled in JS. **After:**
  `<div id="settingsPwError"></div>` — completely empty on every render. The error markup
  (`<div class="issue-box mini">...</div>`) is only ever written into it via `innerHTML` at the
  exact moment `verifyPassword()` returns `false` for an actual submitted password, and is erased
  (`innerHTML = ''`) again the instant the user edits the field.
- **`#c3Error`** (Manual Schema Update's final delete-confirmation dialog) — same pattern applied.
- **`#schemaNameError`** (Add/Rename/Import schema name modal) — same pattern applied.
- The GitHub-sync error indicator already used this pattern since V16.1 and needed no further
  change.

An element that contains **nothing** cannot be made visible by any stylesheet, in any browser, in
any embedding or viewing context — there is no CSS rule, cascade order, specificity conflict, or
external stylesheet injection that can display content that was never inserted into the page. This
makes the fix independent of the exact deployment/viewing environment, which the CSS-only V16.1.1
fix was not.

The `[hidden] { display: none !important; }` rule from V16.1.1 is **kept** in `main.css` as
defense-in-depth (it remains correct and harmless for any other element that might use the plain
`hidden` attribute), but it is no longer the primary mechanism protecting these specific boxes.

## Verified

- Automated browser test loads Settings fresh and asserts `#settingsPwError.innerHTML === ''`
  **and** the element is not visible — not merely "hidden per computed style," but genuinely
  empty, which is the strongest possible check.
- Submits an actual incorrect password and confirms the box populates and becomes visible.
- Edits the password field afterward and confirms the box empties again.
- Submits the correct default password and confirms Settings unlocks cleanly with no stray error
  box anywhere (including the GitHub sync indicator).
- Confirms the schema-name modal's error box is empty by default during a real import flow.
- All prior fixes (V16.1 card sizing, V16.1 schema-import validation) re-verified as still working.
- 10/10 unit tests pass, including three new tests that assert the source code for these three
  files no longer contains the fragile `hidden`-attribute-plus-error-class pattern, so this exact
  bug class cannot silently regress again without a test failing first.

No other files, features, or behaviors were touched.
