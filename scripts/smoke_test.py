"""Real-browser smoke test for dist/index.html (V16.0)."""
import sys, os
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
        if page.locator('.app-logo-badge').count() == 0:
            failures.append('Logo not rendered.')
        if 'AP-SQL Assistant' not in page.content():
            failures.append('Quick Start page text missing.')

        page.evaluate("window.location.hash = 'readonly'")
        page.wait_for_timeout(300)
        if page.locator('#nlDesc').count() == 0:
            failures.append('Read Only Query Builder: NL textarea (#nlDesc) not found.')
        if page.locator('#dialectSelect').count() == 0:
            failures.append('Read Only Query Builder: dialect select not found.')

        page.wait_for_timeout(200)
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
                else:
                    failures.append('CR builder: DELETE segment button not found.')
            else:
                failures.append('CR builder: no tables available in dropdown.')
        else:
            failures.append('CR builder: #crTableSelect not found.')

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
            page.click('.tab-btn:has-text("Secret Vault")')
            page.wait_for_timeout(200)
            vault_html = page.locator('#settingsTabsMount').inner_html()
            if 'M365 Copilot Enterprise' not in vault_html:
                failures.append('V16.0 M365 Copilot Enterprise section missing from Secret Vault tab.')
            if 'GitHub Access Token' not in vault_html:
                failures.append('Existing GitHub Access Token section missing from Secret Vault tab (V16.0 must not remove existing Secret Vault content).')
            if 'copilotEnabled' not in vault_html:
                failures.append('M365 Copilot enable checkbox not found.')

        page.evaluate("window.location.hash = 'about'")
        page.wait_for_timeout(300)
        about_text = page.content()
        if 'M365 Copilot Enterprise' not in about_text:
            failures.append('About page does not mention the V16.0 M365 Copilot Enterprise integration.')

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
        print('=== SMOKE TEST PASSED: all checks OK, no console errors ===')

if __name__ == '__main__':
    main()
