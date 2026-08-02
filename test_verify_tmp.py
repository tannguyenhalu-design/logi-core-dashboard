import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1400, "height": 1100})
        page.on('response', lambda res: print(res.status, res.url) if res.status >= 400 else None)

        await page.goto('http://localhost:3000/login')
        await page.fill('input[type="text"]', 'admin@ghn.vn')
        await page.fill('input[type="password"]', 'admin123')
        await page.click('button[type="submit"]')
        await page.wait_for_url('**/dashboard', timeout=8000)
        await page.wait_for_timeout(2000)
        print('Logged in OK')

        # dark mode donut screenshot
        await page.screenshot(path='verify_dark_donuts.png', full_page=False)

        # switch to light mode
        buttons = await page.query_selector_all('button')
        for b in buttons:
            t = await b.inner_text()
            if 'sáng' in t.lower() or 'giao diện' in t.lower():
                await b.click()
                break
        await page.wait_for_timeout(600)
        await page.screenshot(path='verify_light_donuts.png', full_page=False)
        print('Screenshots saved (dark+light)')

        await browser.close()

asyncio.run(main())
