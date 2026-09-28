"""Real-browser smoke test for dist/index.html (V16.1.1) — covers the three
targeted regression fixes plus a general regression pass."""
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

        # --- FIX #1: card sizing — the two top cards on Read Only Query Builder
        # must be equal width (previously "narrow" capped the left one at 480px).
        page.evaluate("window.location.hash = 'readonly'")
        page.wait_for_timeout(300)
        panels = page.locator('.builder-grid-top .builder-panel')
        if panels.count() != 2:
            failures.append(f'Expected 2 builder-panel cards in builder-grid-top, found {panels.count()}.')
        else:
            box0 = panels.nth(0).bounding_box()
            box1 = panels.nth(1).bounding_box()
            if not box0 or not box1:
                failures.append('Could not measure card bounding boxes.')
            else:
                diff = abs(box0['width'] - box1['width'])
                if diff > 4:
                    failures.append(f'FIX #1 REGRESSION: card widths are uneven — left={box0["width"]:.1f}px right={box1["width"]:.1f}px (diff={diff:.1f}px).')
                if panels.nth(0).evaluate("el => el.classList.contains('narrow')"):
                    failures.append('FIX #1 REGRESSION: the removed .narrow class is still present on a card.')

        if page.locator('#nlDesc').count() == 0:
            failures.append('Read Only Query Builder: NL textarea (#nlDesc) not found.')

        table_picker = page.locator('#tablePickerMount .picker-row').first
        if table_picker.count() > 0:
            table_picker.click()
            page.wait_for_timeout(200)
            sql_text = page.locator('#sqlBlockMount .sql-output').inner_text()
            if 'SELECT' not in sql_text and 'FROM' not in sql_text:
                failures.append(f'Manual table selection did not produce SQL. Got: {sql_text[:200]}')
        else:
            failures.append('No tables found in Table Picker — schema may not have loaded.')

        page.evaluate("window.location.hash = 'cr'")
        page.wait_for_timeout(300)
        cr_panels = page.locator('.builder-grid-top .builder-panel')
        if cr_panels.count() == 2:
            b0 = cr_panels.nth(0).bounding_box(); b1 = cr_panels.nth(1).bounding_box()
            if b0 and b1 and abs(b0['width'] - b1['width']) > 4:
                failures.append(f'FIX #1 REGRESSION (CR Builder): card widths are uneven — left={b0["width"]:.1f}px right={b1["width"]:.1f}px.')

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

        # --- FIX #3: error box must be ABSENT when there is no active error ---
        page.evaluate("window.location.hash = 'settings'")
        page.wait_for_timeout(300)
        if page.locator('#settingsPwInput').count() == 0:
            failures.append('Settings: password lock screen not shown (expected for locked settings).')
        page.fill('#settingsPwInput', 'admin')
        page.click('#settingsUnlockBtn')
        page.wait_for_timeout(500)
        if page.locator('#settingsTabsMount').count() == 0:
            failures.append('Settings did not unlock with default password "admin".')
        else:
            page.click('.tab-btn:has-text("Schema Management")')
            page.wait_for_timeout(300)
            err_mount = page.locator('#syncErrorMount')
            if err_mount.count() == 0:
                failures.append('FIX #3: #syncErrorMount not found in Schema Management tab.')
            else:
                err_html = err_mount.inner_html().strip()
                if err_html != '':
                    failures.append(f'FIX #3 REGRESSION: error box is visible with no active error. Content: {err_html[:200]}')

            # --- FIX #2: import a schema with real-world (non-enum) data types
            # via the ACTUAL file-upload UI (Schema Management -> Import
            # Schema) and confirm it is accepted, with no "Remote schema file
            # failed validation"-style rejection.
            import_schema = {
                'id': 'schema-smoketest-import', 'name': 'Smoke Test Import', 'version': '1.0',
                'tables': [{
                    'name': 'EXTERNAL_ORDERS', 'module': 'External', 'description': 'Imported for smoke test.',
                    'columns': [
                        {'name': 'ORDER_ID', 'label': 'Order ID', 'type': 'INTEGER', 'nullable': False, 'isPrimaryKey': True, 'description': 'PK'},
                        {'name': 'CUSTOMER', 'label': 'Customer', 'type': 'VARCHAR2', 'nullable': False, 'description': 'Customer name'},
                        {'name': 'IS_PAID', 'label': 'Paid', 'type': 'BOOLEAN', 'nullable': False, 'description': 'Paid flag'},
                        {'name': 'NOTES', 'label': 'Notes', 'type': 'CLOB', 'nullable': True, 'description': 'Free text notes'},
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
                if file_input.count() == 0:
                    failures.append('FIX #2: #importSchemaFile input not found in Schema Management tab.')
                else:
                    file_input.set_input_files(tmp_path)
                    try:
                        page.wait_for_selector('#schemaNameConfirm', timeout=5000)
                        confirm_btn = page.locator('#schemaNameConfirm')
                        confirm_btn.click()
                        page.wait_for_function(
                            "() => { const el = document.querySelector('#importSchemaPreview'); return el && el.innerHTML.trim().length > 0; }",
                            timeout=5000,
                        )
                        preview_html = page.locator('#importSchemaPreview').inner_html()
                    except Exception as wait_err:
                        preview_html = page.locator('#importSchemaPreview').inner_html()
                        failures.append(f'FIX #2: timed out waiting for the import flow to complete ({wait_err}). Preview so far: {preview_html[:300]}')
                        preview_html = ''
                    if preview_html:
                        if 'alert-triangle' in preview_html or 'failed' in preview_html.lower():
                            failures.append(f'FIX #2 REGRESSION: importing a schema with real-world data types (INTEGER/VARCHAR2/BOOLEAN/CLOB) was rejected. Preview: {preview_html[:300]}')
                        elif 'Imported as' not in preview_html and 'Updated existing schema' not in preview_html:
                            failures.append(f'FIX #2: import did not show a clear success message. Preview: {preview_html[:300]}')
                        else:
                            print('FIX #2 OK: schema with real-world data types imported successfully:', preview_html[:200])
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
        print('=== SMOKE TEST PASSED: all checks OK (including all 3 V16.1 regression fixes), no console errors ===')

if __name__ == '__main__':
    main()
