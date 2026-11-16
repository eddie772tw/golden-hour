def create_account(page, name):
    page.locator('[data-act="online"]:visible').first.click(timeout=180000)
    page.locator("#account-open").click()
    page.locator("#account-name").fill(name)
    page.locator("#account-pass").fill("test portable passphrase")
    page.locator("#account-create").click()
    page.locator("#account-dialog").wait_for(state="hidden",timeout=30000)
