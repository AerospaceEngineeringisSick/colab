// Site checks before publishing. Run: npm run check   (or npm run check:full for every screen size)
//  - JavaScript errors and failed requests on every page
//  - broken internal links
//  - text, buttons or form fields running off the right edge on phones
//  - sideways scrolling
//  - blank screens while scrolling (catches broken pinned/scroll-driven scenes)
//  - em dashes in the source (house style: never use them)
// Exits with code 1 if anything is found.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { startServer, ROOT } from './serve.mjs';
import { launch, newContext, SITE_PAGES, EXAMPLE_PAGES } from './shared.mjs';

const FULL = process.argv.includes('--full');
const only = (process.argv.find(a => a.startsWith('--pages=')) || '').slice(8);
const PAGES = only ? only.split(',') : [...SITE_PAGES, ...EXAMPLE_PAGES];
const SIZES = FULL ? ['desktop', 'tablet', 'phone', 'small'] : ['desktop', 'phone'];
const BLANK_SIZES = FULL ? ['desktop', 'phone', 'small'] : ['phone'];
const PORT = 8123, BASE = `http://127.0.0.1:${PORT}/`;
const problems = [];
const report = (where, msg) => { problems.push(`${where}: ${msg}`); console.log(`  ✗ ${where}: ${msg}`); };

// 1. em dashes in anything a visitor can see
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(ROOT).filter(f => /\.(html|js|css|py|md)$/.test(f) && !f.includes(`${path.sep}tools${path.sep}`) && !f.includes(`${path.sep}legal${path.sep}`))) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => { if (l.includes('—')) report(path.relative(ROOT, f) + ':' + (i + 1), 'em dash'); });
}

const server = await startServer(PORT);
const browser = await launch();
const links = new Set();

const stddev = buf => {                       // luminance spread of a screenshot; near 0 = a blank screen
  const png = PNG.sync.read(buf); let n = 0, s = 0, s2 = 0;
  for (let y = 0; y < png.height; y += 8) for (let x = 0; x < png.width; x += 8) {
    const i = (y * png.width + x) * 4, v = .3 * png.data[i] + .59 * png.data[i + 1] + .11 * png.data[i + 2];
    n++; s += v; s2 += v * v;
  }
  return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
};

for (const size of SIZES) {
  console.log(`\n${size}`);
  const ctx = await newContext(browser, size);
  const page = await ctx.newPage();
  let errs = [];
  page.on('pageerror', e => errs.push('JS error: ' + e.message));
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/404.html') && !/404\.html$/.test(page.url())) errs.push(`${r.status()} ${r.url().replace(BASE, '/')}`); });
  for (const p of PAGES) {
    errs = [];
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    (await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href))).forEach(l => links.add(l));
    // sideways scroll
    const side = await page.evaluate(() => { scrollTo(400, scrollY); const x = scrollX; scrollTo(0, scrollY); return x; });
    if (side) errs.push(`page scrolls sideways by ${side}px`);
    // content cut off at the right edge (skips marquees, carousels and scrollable rows, which are meant to run off)
    if (size !== 'desktop') {
      const cut = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth, out = [];
        for (const el of document.querySelectorAll('input,button,select,textarea,h1,h2,h3,h4,p,label,a.btn,li,dd,dt')) {
          const r = el.getBoundingClientRect();
          if (!r.width || r.right <= vw + 1 || r.left >= vw) continue;
          const cs = getComputedStyle(el); if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
          let a = el.parentElement, skip = false;
          while (a && a !== document.body) {
            const s = getComputedStyle(a);
            if (/(auto|scroll)/.test(s.overflowX) || s.position === 'fixed' || s.transform !== 'none' && /ticker|slam|marq|who|track|ring|carousel|ribbon|cut|drawer|garden|row|quotes/.test(a.className)) { skip = true; break; }
            a = a.parentElement;
          }
          if (!skip) out.push(`"${(el.textContent || el.placeholder || el.tagName).trim().slice(0, 40)}" runs off the screen (${Math.round(r.right - vw)}px)`);
        }
        return out.slice(0, 5);
      });
      errs.push(...cut);
    }
    // blank screens while scrolling
    if (BLANK_SIZES.includes(size)) {
      const H = await page.evaluate(() => document.documentElement.scrollHeight), vh = page.viewportSize().height;
      for (let y = 0; y < H - 100; y += Math.round(vh * .6)) {
        await page.evaluate(t => scrollTo(0, t), y); await page.waitForTimeout(550);
        if (stddev(await page.screenshot()) < 5) errs.push(`blank screen at scroll position ${y}px`);
      }
    }
    for (const e of [...new Set(errs)]) report(`${size} ${p}`, e);
    process.stdout.write(errs.length ? '' : `  ✓ ${p}\n`);
  }
  await ctx.close();
}

// 2. broken internal links
const ctx = await newContext(browser, 'desktop');
for (const l of new Set([...links].filter(l => l.startsWith(BASE)).map(l => l.split('#')[0]))) {
  const r = await ctx.request.get(l);
  if (r.status() !== 200) report('link', `${l.replace(BASE, '/')} returns ${r.status()}`);
}
await browser.close(); server.close();
console.log(problems.length ? `\n${problems.length} problem(s) found.` : '\nAll checks passed.');
process.exit(problems.length ? 1 : 0);
