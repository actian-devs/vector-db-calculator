// Renders scripts/og/og.html to public/og-image.png at 1200x630.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const html = fileURLToPath(new URL('./og.html', import.meta.url));
const out = fileURLToPath(new URL('../../public/og-image.png', import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(html).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
