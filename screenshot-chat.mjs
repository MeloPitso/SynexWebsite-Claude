import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, 'temporary screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

// Force the bubble to show immediately (bypass the 3-second timer)
await page.evaluate(() => {
  const bubble = document.getElementById('synex-chat-bubble');
  const tooltip = document.getElementById('synex-chat-tooltip');
  if (bubble) bubble.classList.add('visible');
  if (tooltip) tooltip.classList.add('visible');
});

await new Promise(r => setTimeout(r, 600));

const closedPath = path.join(screenshotDir, 'chat-widget-closed.png');
await page.screenshot({ path: closedPath, fullPage: false });
console.log('Saved:', closedPath);

// Now open the chat window
await page.click('#synex-chat-bubble');
await new Promise(r => setTimeout(r, 500));

const openPath = path.join(screenshotDir, 'chat-widget-open.png');
await page.screenshot({ path: openPath, fullPage: false });
console.log('Saved:', openPath);

await browser.close();
