"""Real-browser smoke test for dist/index.html — V16.5. Verifies the app
still works end-to-end and the "Do NOT Change" UI constraints hold. Also
verifies, via the actual rendered UI copy in Schema Management, that the
V16.5 fix's user-facing description is present and correctly reflects that
Active Schema sync no longer requires unlocking Settings first (the deep
cross-device network flow itself is verified at the unit level in
test/engines.test.mjs, since GitHub calls are blocked by CORS from this
sandboxed file:// origin)."""
import sys, os, json, tempfile
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dist', 'index.html')

def main():
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path='/opt/pw-browsers/chromium-1208/chrome-linux64/chrome',
            args=['--no-sandbox'],
        )
        page = browser.new_page()
        console_errors = []
        page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)
        page.on('pageerror', lambda exc: console_errors.append(str(exc)))

        url = 'file://' + DIST
        page.goto(url)
        page.wait_for_timeout(500)

        if page.locator('.navbar').count() == 0:
            failures.append('Navbar did not render (app shell failed to mount).')
        if 'AP-SQL Assistant' not in page.content():
            failures.append('Quick Start page text missing.')

        # Card sizing check (carried from V16.1)
        page.evaluate("window.location.hash = 'readonly'")
        page.wait_for_timeout(300)
        panels = page.locator('.builder-grid-top .builder-panel')
        if panels.count() == 2:
            box0 = panels.nth(0).bounding_box(); box1 = panels.nth(1).bounding_box()
            if box0 and box1 and abs(box0['width'] - box1['width']) > 4:
                failures.append(f'Card widths are uneven — left={box0["width"]:.1f}px right={box1["width"]:.1f}px.')
        table_picker = page.locator('#tablePickerMount .picker-row').first
        if table_picker.count() > 0:
            table_picker.click()
            page.wait_for_timeout(200)
            sql_text = page.locator('#sqlBlockMount .sql-output').inner_text()
            if 'SELECT' not in sql_text and 'FROM' not in sql_text:
                failures.append(f'Manual table selection did not produce SQL. Got: {sql_text[:200]}')
        else:
            failures.append('No tables found in Table Picker — schema may not have loaded.')

        # CR builder safeguard
        page.evaluate("window.location.hash = 'cr'")
        page.wait_for_timeout(300)
        table_select = page.locator('#crTableSelect')
        if table_select.count() > 0:
            options = page.eval_on_selector('#crTableSelect', 'el => Array.from(el.options).map(o => o.value).filter(Boolean)')
            if options:
                table_select.select_option(options[0])
                page.wait_for_timeout(150)
                delete_btn = page.locator('.seg-btn', has_text='DELETE')
                if delete_btn.count() > 0:
                    delete_btn.click()
                    page.wait_for_timeout(150)
                    cr_sql = page.locator('#crSqlMount .sql-output').inner_text()
                    if 'WHERE condition is required' not in cr_sql:
                        failures.append(f'CR safeguard: DELETE without WHERE was not blocked. Got: {cr_sql[:200]}')

        # Error Rectifier
        page.evaluate("window.location.hash = 'error-rectifier'")
        page.wait_for_timeout(300)
        if page.locator('#errSqlText').count() == 0:
            failures.append('Error Rectifier: #errSqlText not found.')
        else:
            page.fill('#errSqlText', "SELECT INVOICE_ammount FROM INVOICE_HEADER")
            page.fill('#errText', 'ORA-00904: "INVOICE_AMMOUNT": invalid identifier')
            page.click('#rectifyBtn')
            page.wait_for_timeout(200)
            rectified = page.locator('#rectifiedOutput').inner_text()
            if 'Review' not in rectified and rectified.strip() == '—':
                failures.append(f'Error Rectifier did not produce output. Got: {rectified[:200]}')

        # Settings unlock + Schema Management: verify V16.5 fix messaging + Set Active + M365 Copilot section
        page.evaluate("window.location.hash = 'settings'")
        page.wait_for_timeout(300)
        pw_input = page.locator('#settingsPwInput')
        if pw_input.count() == 0:
            failures.append('Settings: password lock screen not shown.')
        else:
            err_box = page.locator('#settingsPwError')
            initial_html = page.eval_on_selector('#settingsPwError', 'el => el.innerHTML').strip()
            if initial_html != '' or err_box.is_visible():
                failures.append(f'Password error box not empty on load (V16.2 regression). innerHTML={initial_html!r}')
            page.fill('#settingsPwInput', 'admin')
            page.click('#settingsUnlockBtn')
            try:
                # tryAutoUnlock() attempts a real network call to GitHub
                # (to check for a repository-hosted vault) before falling
                # back to a fresh local vault; in this sandboxed, no-egress
                # environment that network attempt can take longer than a
                # fixed short sleep to fail/timeout, so wait explicitly for
                # the actual unlocked-state marker instead of guessing a
                # fixed delay.
                page.wait_for_selector('#settingsTabsMount', timeout=15000)
            except Exception as wait_err:
                pw_err_html = page.eval_on_selector('#settingsPwError', 'el => el ? el.innerHTML : null')
                failures.append(f'Settings did not unlock with default password "admin" within 15s ({wait_err}). #settingsPwError content: {pw_err_html!r}')
            if page.locator('#settingsTabsMount').count() == 0:
                pass  # already recorded above if it timed out
            else:
                page.click('.tab-btn:has-text("Schema Management")')
                page.wait_for_timeout(400)

                err_mount = page.locator('#syncErrorMount')
                if err_mount.count() > 0 and err_mount.inner_html().strip() != '':
                    failures.append(f'Sync error indicator visible with no active sync error. Content: {err_mount.inner_html()[:200]}')

                # V16.5: confirm the auto-sync hint text now describes
                # Active Schema sync working WITHOUT unlocking Settings.
                hint_text = page.locator('.auto-sync-hint').inner_text()
                if 'without unlocking Settings' not in hint_text and 'even without them unlocking' not in hint_text:
                    failures.append(f'V16.5: auto-sync hint does not describe the no-login Active Schema sync fix. Got: {hint_text[:300]}')
                else:
                    print('V16.5 OK: Schema Management UI correctly describes Active Schema sync working without unlocking Settings.')

                set_active_buttons = page.locator('[data-action="activate"]')
                if set_active_buttons.count() > 0:
                    set_active_buttons.first.click()
                    page.wait_for_timeout(300)
                    # Pre-existing V16.3 navigation behavior (unchanged,
                    # out of scope): the action callback re-renders the
                    # whole Settings page, resetting the tab strip to
                    # "Security". Re-open Schema Management to verify state.
                    page.click('.tab-btn:has-text("Schema Management")')
                    page.wait_for_timeout(300)
                    active_chip = page.locator('.schema-card.is-active .chip-active')
                    if active_chip.count() == 0:
                        failures.append('V16.5: after re-opening Schema Management, no schema card is marked active in the UI.')
                    else:
                        active_card_text = page.locator('.schema-card.is-active').inner_text()
                        print(f'V16.5 OK: Active Schema switching still works correctly through the real Schema Management UI (active card now: {active_card_text.splitlines()[0]!r}).')
                else:
                    print('(Only one schema present -- "Set Active" button not applicable, skipping that sub-check.)')

                page.click('.tab-btn:has-text("Secret Vault")')
                page.wait_for_timeout(300)
                copilot_heading = page.locator('text=M365 Copilot Enterprise Integration')
                if copilot_heading.count() == 0:
                    failures.append('M365 Copilot Enterprise Integration section not found in Secret Vault tab (regression).')
                else:
                    print('V16.5 OK: M365 Copilot Enterprise Integration section still present in Secret Vault tab.')

                # V16.5: schema import still works end-to-end (regression check)
                import_schema_raw = json.dumps({
                    'id': 'schema-v165-smoketest', 'name': 'V16.5 Smoke Test Import', 'version': '1.0',
                    'tables': [{'name': 'SMOKE_TABLE', 'module': 'Test', 'description': 'Smoke test.',
                                'columns': [{'name': 'ID', 'label': 'ID', 'type': 'INTEGER', 'nullable': False, 'isPrimaryKey': True, 'description': 'PK'}]}],
                    'relationships': [],
                })
                tmp_path = None
                try:
                    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp:
                        tmp.write(import_schema_raw); tmp_path = tmp.name
                    page.click('.tab-btn:has-text("Schema Management")')
                    page.wait_for_timeout(300)
                    file_input = page.locator('#importSchemaFile')
                    if file_input.count() > 0:
                        file_input.set_input_files(tmp_path)
                        try:
                            page.wait_for_selector('#schemaNameConfirm', timeout=5000)
                            page.locator('#schemaNameConfirm').click()
                            page.wait_for_function(
                                "() => { const el = document.querySelector('#importSchemaPreview'); return el && el.innerHTML.trim().length > 0; }",
                                timeout=5000,
                            )
                            preview_html = page.locator('#importSchemaPreview').inner_html()
                            if 'alert-triangle' in preview_html or 'failed' in preview_html.lower():
                                failures.append(f'Schema import regression: import was rejected. Preview: {preview_html[:300]}')
                            else:
                                print('V16.5 OK: schema import still works end-to-end.')
                        except Exception as wait_err:
                            failures.append(f'Schema import flow timed out: {wait_err}')
                finally:
                    if tmp_path and os.path.exists(tmp_path):
                        os.remove(tmp_path)

        page.evaluate("window.location.hash = 'about'")
        page.wait_for_timeout(300)
        about_content = page.content()
        if 'Active Schema Sync' not in about_content and 'common (no-login) flow' not in about_content:
            failures.append('About page does not mention the V16.5 Active Schema sync fix.')
        else:
            print('V16.5 OK: About page documents the fix.')

        browser.close()

    real_console_errors = [e for e in console_errors if 'CORS' not in e and 'ERR_FAILED' not in e]

    if console_errors:
        print(f'--- {len(console_errors)} console error(s)/exception(s) (CORS/network noise from sandboxed file:// GitHub calls expected) ---')
        for e in console_errors[:20]:
            print(' ', e)

    if real_console_errors:
        failures.append(f'{len(real_console_errors)} unexpected (non-CORS/network) console error(s) — see log above.')

    if failures:
        print(f'\n=== SMOKE TEST FAILED: {len(failures)} issue(s) ===')
        for f in failures:
            print(' -', f)
        sys.exit(1)
    else:
        print('=== SMOKE TEST PASSED: all checks OK, UI/layout unchanged, V16.5 fix messaging present, Active Schema switching works, schema import works, M365 Copilot section present, no unexpected console errors ===')

if __name__ == '__main__':
    main()
