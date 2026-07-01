import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        errors = []
        page.on('pageerror', lambda err: errors.append(f'PAGE ERROR: {err}'))
        page.on('console', lambda msg: errors.append(f'CONSOLE ERROR: {msg.text}') if msg.type == 'error' else None)
        
        print('Going to Vercel login...')
        await page.goto('https://logicore-app.vercel.app/login')
        await page.fill('input[type="text"]', 'client')
        await page.fill('input[type="password"]', 'client123')
        
        async with page.expect_navigation():
            await page.click('button')
            
        print('Landed on', page.url)
        await asyncio.sleep(8)
        
        if errors:
            print("FOUND ERRORS:")
            for e in errors:
                print(e)
        else:
            print("NO ERRORS DETECTED.")
        
        await browser.close()

asyncio.run(main())
