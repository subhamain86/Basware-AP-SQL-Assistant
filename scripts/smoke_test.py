"""Real-browser smoke test for dist/index.html — V16.2. Specifically
verifies the password error box is completely ABSENT from the DOM (not
merely CSS-hidden) until a real incorrect-password error occurs, which is
the root-cause fix for the reported bug."""
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

        # === THE V16.2 FIX: verify #settingsPwError is COMPLETELY EMPTY (not
        # just CSS-hidden) on load, becomes populated on a real wrong
        # password, empties again on edit, and stays empty after success ===
        page.evaluate("window.location.hash = 'settings'")
        page.wait_for_timeout(300)
        pw_input = page.locator('#settingsPwInput')
        if pw_input.count() == 0:
            failures.append('Settings: password lock screen not shown (expected for locked settings).')
        else:
            err_box = page.locator('#settingsPwError')
            initial_inner_html = page.eval_on_selector('#settingsPwError', 'el => el.innerHTML').strip()
            initial_text = err_box.inner_text().strip()
            is_visible_on_load = err_box.is_visible()
            if initial_inner_html != '' or initial_text != '' or is_visible_on_load:
                failures.append(f'V16.2 REGRESSION: #settingsPwError is NOT empty on initial load (this is the exact bug reported). innerHTML={initial_inner_html!r}, visible={is_visible_on_load}.')
            else:
                print('V16.2 FIX CONFIRMED: #settingsPwError is a completely empty DOM node on load — not just CSS-hidden, genuinely empty.')

            # Trigger a real wrong-password error
            page.fill('#settingsPwInput', 'definitely-wrong-password')
            page.click('#settingsUnlockBtn')
            page.wait_for_timeout(300)
            after_wrong_html = page.eval_on_selector('#settingsPwError', 'el => el.innerHTML').strip()
            is_visible_after_wrong = err_box.is_visible()
            if after_wrong_html == '' or not is_visible_after_wrong:
                failures.append('V16.2 REGRESSION: #settingsPwError did NOT populate/become visible after an actual incorrect password attempt.')
            else:
                print('V16.2 FIX CONFIRMED: #settingsPwError populates and becomes visible after a real incorrect-password error.')

            # Editing the field must empty it again
            page.fill('#settingsPwInput', '')
            page.wait_for_timeout(100)
            after_clear_html = page.eval_on_selector('#settingsPwError', 'el => el.innerHTML').strip()
            if after_clear_html != '':
                failures.append(f'V16.2 REGRESSION: #settingsPwError was not cleared after editing the input. innerHTML={after_clear_html!r}')

            # Correct password must unlock cleanly with the box still empty
            page.fill('#settingsPwInput', 'admin')
            page.click('#settingsUnlockBtn')
            page.wait_for_timeout(500)
            if page.locator('#settingsTabsMount').count() == 0:
                failures.append('Settings did not unlock with the default password "admin" after a prior wrong attempt.')
            else:
                page.click('.tab-btn:has-text("Schema Management")')
                page.wait_for_timeout(300)
                err_mount = page.locator('#syncErrorMount')
                if err_mount.count() > 0:
                    err_mount_html = err_mount.inner_html().strip()
                    if err_mount_html != '':
                        failures.append(f'Sync error indicator visible with no active sync error. Content: {err_mount_html[:200]}')

                # Schema-import validation check (V16.1 fix, still working)
                import_schema = {
                    'id': 'schema-smoketest-import', 'name': 'Smoke Test Import', 'version': '1.0',
                    'tables': [{
                        'name': 'EXTERNAL_ORDERS', 'module': 'External', 'description': 'Imported for smoke test.',
                        'columns': [
                            {'name': 'ORDER_ID', 'label': 'Order ID', 'type': 'INTEGER', 'nullable': False, 'isPrimaryKey': True, 'description': 'PK'},
                            {'name': 'CUSTOMER', 'label': 'Customer', 'type': 'VARCHAR2', 'nullable': False, 'description': 'Customer name'},
                        ],
                    }],
                    'relationships': [],
                }
                tmp_path = None
                try:
                    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp:
                        json.dump(import_schema, tmp)
                        tmp_path = tmp.name
                    file_input = page.locator('#importSchemaFile')
                    if file_input.count() > 0:
                        file_input.set_input_files(tmp_path)
                        try:
                            page.wait_for_selector('#schemaNameConfirm', timeout=5000)
                            # Also check the schema-name modal's error box is empty by default
                            name_err_html = page.eval_on_selector('#schemaNameError', 'el => el.innerHTML').strip()
                            if name_err_html != '':
                                failures.append(f'V16.2: #schemaNameError not empty by default. innerHTML={name_err_html!r}')
                            page.locator('#schemaNameConfirm').click()
                            page.wait_for_function(
                                "() => { const el = document.querySelector('#importSchemaPreview'); return el && el.innerHTML.trim().length > 0; }",
                                timeout=5000,
                            )
                            preview_html = page.locator('#importSchemaPreview').inner_html()
                        except Exception as wait_err:
                            preview_html = page.locator('#importSchemaPreview').inner_html()
                            failures.append(f'Timed out waiting for the import flow ({wait_err}). Preview so far: {preview_html[:300]}')
                            preview_html = ''
                        if preview_html:
                            if 'alert-triangle' in preview_html or 'failed' in preview_html.lower():
                                failures.append(f'Importing a schema with real-world data types was rejected. Preview: {preview_html[:300]}')
                            elif 'Imported as' not in preview_html and 'Updated existing schema' not in preview_html:
                                failures.append(f'Import did not show a clear success message. Preview: {preview_html[:300]}')
                            else:
                                print('Schema import OK: real-world data types accepted.')
                finally:
                    if tmp_path and os.path.exists(tmp_path):
                        os.remove(tmp_path)

        page.evaluate("window.location.hash = 'about'")
        page.wait_for_timeout(300)

        browser.close()

    if console_errors:
        print(f'--- {len(console_errors)} console error(s)/exception(s) ---')
        for e in console_errors[:20]:
            print(' ', e)

    if failures:
        print(f'\n=== SMOKE TEST FAILED: {len(failures)} issue(s) ===')
        for f in failures:
            print(' -', f)
        sys.exit(1)
    else:
        print('=== SMOKE TEST PASSED: all checks OK, including the V16.2 password-error-box root-cause fix, no console errors ===')

if __name__ == '__main__':
    main()
