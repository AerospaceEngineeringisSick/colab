// Regenerates the example-site screenshots used on the LRWeb pages (carousel, work grid, laptop, slider).
// Run after changing an example site:  npm run previews             (all sites)
//                                      npm run previews -- tidewater (one site)
// Each preview = three 1440x900 frames of the site stacked into one tall image (scrolled in steps,
// so scroll-driven scenes look as they would to a visitor).
import path from 'node:path';
import fs from 'node:fs';
import { startServer, ROOT } from './serve.mjs';
import { launch, EXAMPLES } from './shared.mjs';

// scroll positions (px) of the three frames for each site; tweak to show different sections
const FRAMES = {
  'smith-and-sons': [0, 1000, 2100],
  'crumb-and-kiln': [0, 1001, 2139],
  'northside-barber': [0, 1179, 4690],
  'petal-and-stem': [0, 1061, 2711],
  'volt-strength': [0, 1253, 3061],
  'tidewater': [0, 1100, 2934],
  'form-and-field': [0, 2200, 6300],
};
const PORT = 8124, BASE = `http://127.0.0.1:${PORT}/`, OUT = path.join(ROOT, 'assets', 'work');
const pick = process.argv.slice(2).filter(a => !a.startsWith('-'));
const sites = pick.length ? pick : EXAMPLES;

const server = await startServer(PORT);
const browser = await launch();

// stitch frames into one JPEG by laying them out in a page and screenshotting it
async function stitch(frames, width, file, quality = 80) {
  const ctx = await browser.newContext({ viewport: { width, height: 100 } });
  const page = await ctx.newPage();
  await page.setContent(`<body style="margin:0;background:#000">${frames.map(b => `<img style="display:block;width:100%" src="data:image/png;base64,${b.toString('base64')}">`).join('')}</body>`);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality });
  await ctx.close();
}

for (const site of sites) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}work/${site}/index.html?shot`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(3000);
  const frames = [];
  for (const y of FRAMES[site]) {
    const from = await page.evaluate(() => scrollY);
    for (let k = 1; k <= 8; k++) { await page.evaluate(t => scrollTo(0, t), from + (y - from) * k / 8); await page.waitForTimeout(90); }
    await page.waitForTimeout(1800);
    frames.push(await page.screenshot());
  }
  await ctx.close();
  await stitch(frames, 1200, path.join(OUT, `${site}.jpg`));
  fs.mkdirSync(path.join(OUT, 'thumb'), { recursive: true });
  await stitch(frames, 800, path.join(OUT, 'thumb', `${site}.jpg`), 74);
  if (site === 'smith-and-sons') {
    await stitch([frames[0]], 1440, path.join(OUT, 'smith-and-sons-hero.jpg'), 82);     // laptop screen + slider (desktop)
    const m = await browser.newContext({ viewport: { width: 412, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    await mp.goto(`${BASE}work/${site}/index.html?shot`, { waitUntil: 'load' }); await mp.waitForTimeout(3500);
    const shot = await mp.screenshot({ clip: { x: 0, y: 0, width: 412, height: 515 } });  // 4:5 phone crop
    await m.close();
    await stitch([shot], 660, path.join(OUT, 'smith-and-sons-mobile.jpg'), 78);       // slider on phones
  }
  console.log('updated', site);
}
await browser.close(); server.close();
