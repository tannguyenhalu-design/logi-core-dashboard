import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        page.on('pageerror', lambda err: print(f'PAGE ERROR: {err}'))
        page.on('console', lambda msg: print(f'CONSOLE ERROR: {msg.text}') if msg.type == 'error' else None)
        
        print('Going to login...')
        await page.goto('http://localhost:3001/login')
        await page.fill('input[type="text"]', 'admin')
        await page.fill('input[type="password"]', 'admin123')
        
        async with page.expect_navigation():
            await page.click('button')
            
        print('Landed on', page.url)
        await asyncio.sleep(5)
        await browser.close()

asyncio.run(main())
