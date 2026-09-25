// Re-capture the showcase stills (captures/<site>-hero.jpg and -mhero.jpg) from the example sites in ../lrweb/work.
// Only needed if the sites change. Desktop: 1440x900 @2x, saved at 1440x900. Mobile: iPhone 13 (390x844 @3x), saved at 585x1266.
//   node tools/capture_sites.mjs [site ...]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path'; import fs from 'node:fs'; import http from 'node:http';
const require = createRequire(import.meta.url);
const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(here, '..');
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium, devices } = pw;
const sharp = require('sharp');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const srv = http.createServer((q, s) => { let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s); }).listen(0);
const port = srv.address().port;
const sites = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, 'lrweb/work'));
const out = path.join(here, 'captures'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();

// Behind a proxy (e.g. a sandbox) Google Fonts go through curl, cached on disk; otherwise the browser fetches them itself
const viaCurl = !!(process.env.HTTPS_PROXY || process.env.https_proxy);
const cacheDir = path.join(out, '.fontcache');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
function fetchCached(url) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const f = path.join(cacheDir, Buffer.from(url).toString('base64url').slice(0, 200));
  if (!fs.existsSync(f)) execSync(`curl -sSL -m 30 -A ${JSON.stringify(UA)} -o ${JSON.stringify(f)} ${JSON.stringify(url)}`);
  return fs.readFileSync(f);
}
async function routeFonts(page) {
  if (!viaCurl) return;
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
    const url = route.request().url();
    try { route.fulfill({ status: 200, body: fetchCached(url), headers: { 'Content-Type': url.includes('googleapis') ? 'text/css' : 'font/woff2', 'Access-Control-Allow-Origin': '*' } }); }
    catch { route.abort(); }
  });
}
async function shoot(site, name, ctxOpts, size) {
  const ctx = await b.newContext(ctxOpts); const p = await ctx.newPage(); await routeFonts(p);
  await p.goto(`http://localhost:${port}/lrweb/work/${site}/?shot`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500); // let the hero's entrance animations settle
  const png = await p.screenshot({ type: 'png' });
  await sharp(png).resize(...size).jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(out, `${site}-${name}.jpg`));
  console.log(site, name); await ctx.close();
}
for (const s of sites) {
  await shoot(s, 'hero', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, [1440, 900]);
  await shoot(s, 'mhero', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }, [585, 1266]);
}
await b.close(); srv.close();
