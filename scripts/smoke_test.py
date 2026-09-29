"""Real-browser smoke test for dist/index.html — V16.3. Covers the general
regression suite plus specific checks that the app still behaves correctly
end-to-end (schema import, CR safeguard, error rectifier, password box,
sync error indicator). The core V16.3 root-cause fix (sanitize-before-
validate ordering + downgraded referential-integrity severity) is verified
directly against the source functions in test/engines.test.mjs, since a
live GitHub pull cannot be exercised in this sandboxed browser (GitHub API
calls are blocked by CORS from a file:// origin, as seen in console
warnings below — this is expected and does not indicate a bug)."""
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

        # Password error box must be genuinely empty on load (V16.2 fix, carried forward)
        page.evaluate("window.location.hash = 'settings'")
        page.wait_for_timeout(300)
        pw_input = page.locator('#settingsPwInput')
        if pw_input.count() == 0:
            failures.append('Settings: password lock screen not shown (expected for locked settings).')
        else:
            err_box = page.locator('#settingsPwError')
            initial_inner_html = page.eval_on_selector('#settingsPwError', 'el => el.innerHTML').strip()
            if initial_inner_html != '' or err_box.is_visible():
                failures.append(f'V16.2 REGRESSION: #settingsPwError is NOT empty on initial load. innerHTML={initial_inner_html!r}')
            else:
                print('V16.2 fix still holds: #settingsPwError is empty on load.')
            page.fill('#settingsPwInput', 'admin')
            page.click('#settingsUnlockBtn')
            page.wait_for_timeout(500)
            if page.locator('#settingsTabsMount').count() == 0:
                failures.append('Settings did not unlock with default password "admin".')
            else:
                page.click('.tab-btn:has-text("Schema Management")')
                page.wait_for_timeout(300)
                err_mount = page.locator('#syncErrorMount')
                if err_mount.count() > 0:
                    err_mount_html = err_mount.inner_html().strip()
                    if err_mount_html != '':
                        failures.append(f'Sync error indicator visible with no active sync error. Content: {err_mount_html[:200]}')

                # --- V16.3 end-to-end check: import a schema with a column
                # whose `type` key is genuinely ABSENT (not empty string) via
                # the real file-upload UI, and confirm it is accepted. This
                # exercises schemaService.importSchema()'s sanitize-then-
                # validate path with the exact malformed-input shape that
                # caused the recurring bug. ---
                import_schema_raw_text = json.dumps({
                    'id': 'schema-v163-smoketest', 'name': 'V16.3 Smoke Test Import', 'version': '1.0',
                    'tables': [{
                        'name': 'DRIFTED_ORDERS', 'module': 'Legacy', 'description': 'Simulates a column with a missing type key and a dangling FK.',
                        'columns': [
                            {'name': 'ORDER_ID', 'label': 'Order ID', 'type': 'INTEGER', 'nullable': False, 'isPrimaryKey': True, 'description': 'PK'},
                            {'name': 'CUSTOMER_ID', 'label': 'Customer', 'nullable': False, 'description': 'Customer id (type key intentionally omitted)', 'isForeignKey': True, 'references': {'table': 'CUSTOMER_RENAMED_AWAY', 'column': 'ID'}},
                        ],
                    }],
                    'relationships': [],
                })
                tmp_path = None
                try:
                    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp:
                        tmp.write(import_schema_raw_text)
                        tmp_path = tmp.name
                    file_input = page.locator('#importSchemaFile')
                    if file_input.count() == 0:
                        failures.append('V16.3: #importSchemaFile input not found in Schema Management tab.')
                    else:
                        file_input.set_input_files(tmp_path)
                        try:
                            page.wait_for_selector('#schemaNameConfirm', timeout=5000)
                            page.locator('#schemaNameConfirm').click()
                            page.wait_for_function(
                                "() => { const el = document.querySelector('#importSchemaPreview'); return el && el.innerHTML.trim().length > 0; }",
                                timeout=5000,
                            )
                            preview_html = page.locator('#importSchemaPreview').inner_html()
                        except Exception as wait_err:
                            preview_html = page.locator('#importSchemaPreview').inner_html()
                            failures.append(f'V16.3: timed out waiting for the import flow ({wait_err}). Preview so far: {preview_html[:300]}')
                            preview_html = ''
                        if preview_html:
                            if 'alert-triangle' in preview_html or 'failed' in preview_html.lower():
                                failures.append(f'V16.3 REGRESSION: importing a schema with a missing type key + dangling FK was REJECTED (this is exactly the recurring bug). Preview: {preview_html[:300]}')
                            elif 'Imported as' not in preview_html and 'Updated existing schema' not in preview_html:
                                failures.append(f'V16.3: import did not show a clear success message. Preview: {preview_html[:300]}')
                            else:
                                print('V16.3 FIX CONFIRMED: a schema with a missing data-type key and a dangling FK reference imports successfully (previously this pattern caused "Remote schema file failed validation").')
                finally:
                    if tmp_path and os.path.exists(tmp_path):
                        os.remove(tmp_path)

        page.evaluate("window.location.hash = 'about'")
        page.wait_for_timeout(300)

        browser.close()

    # CORS errors from the sandboxed file:// GitHub calls are expected and filtered out of the failure signal.
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
        print('=== SMOKE TEST PASSED: all checks OK, including the V16.3 schema-import regression check, no unexpected console errors ===')

if __name__ == '__main__':
    main()
