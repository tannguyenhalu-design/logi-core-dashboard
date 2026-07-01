const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({ executablePath: 'C:\\Users\\TanNguyen\\.cache\\puppeteer\\chrome\\win64-150.0.7871.24\\chrome-win64\\chrome.exe' });
    const page = await browser.newPage();
    page.on('pageerror', err => {
      console.log('PAGE ERROR:', err.message);
    });
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('CONSOLE ERROR:', msg.text());
      }
    });

    console.log('Going to login...');
    await page.goto('http://localhost:3000/login', {waitUntil: 'networkidle2'});
    await page.type('input[type="text"]', 'admin');
    await page.type('input[type="password"]', 'admin123');
    await Promise.all([
      page.click('button'),
      page.waitForNavigation({waitUntil: 'networkidle2'})
    ]);
    
    console.log('Landed on', page.url());
    await new Promise(r => setTimeout(r, 3000));
    await browser.close();
  } catch (e) {
    console.error('SCRIPT ERROR:', e);
  }
})();
