// Renders scene.html frame-by-frame in Chromium (GPU by default) and muxes the soundtrack.
// Layout is authored at 1920x1080 (or 1080x1920) and captured at a device scale of 4/3 -> 2560x1440 / 1440x2560.
// Frames with fast motion are rendered as several sub-frames and averaged (true motion blur, 180° shutter).
//
//   npm run gpu-check                                  -> confirms Chromium is using your GPU
//   node render.mjs --edit landscape                   -> LRWeb-promo-landscape.mp4
//   node render.mjs --edit vertical                    -> LRWeb-promo-vertical.mp4
//   node render.mjs --edit landscape --preview         -> quick 1080p/30fps check, no motion blur
//   node render.mjs --edit vertical --stills 1,12.5    -> PNG stills in stills/
// Options: --workers N (parallel browsers), --cpu (software rendering), --headed (visible windows, a GPU fallback),
//          --angle d3d11|metal|gl|vulkan, --from/--to (seconds), --crf 19, --no-blur, --keep-dir <dir> (resumable)
import { createRequire } from 'node:module';
import { spawn, execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const require = createRequire(import.meta.url);
const SELF = fileURLToPath(import.meta.url);
const here = path.dirname(SELF);
const root = path.resolve(here, '..');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  try { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); } catch { console.error('Playwright not found. Run: npm install && npx playwright install chromium'); process.exit(1); }
}
let sharp = null; try { sharp = require('sharp'); } catch { /* falls back to the python merge */ }
const TL = require('./timeline.js');

const argv = process.argv;
const has = (k) => argv.includes('--' + k);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : d; };
const EDIT = arg('edit', 'landscape'), E = TL.EDITS[EDIT];
if (!E) { console.error(`Unknown edit "${EDIT}" (landscape | vertical)`); process.exit(1); }
const PREVIEW = has('preview');
const FPS = +arg('fps', PREVIEW ? 30 : TL.FPS);
const SCALE = +arg('scale', PREVIEW ? 1 : 4 / 3);
const CPU = has('cpu'), HEADED = has('headed');
const SKY = +arg('sky', CPU ? .66 : 1); // WebGL sky resolution factor (softer + faster on CPU)
const OUT = path.resolve(here, arg('out', `LRWeb-promo-${EDIT}${PREVIEW ? '-preview' : ''}.mp4`));
const FROM = +arg('from', 0), TO = +arg('to', E.end);
const STILLS = arg('stills', '');
const MB = !has('no-blur') && !PREVIEW;
const WORKERS = +arg('workers', Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))));
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const FFMPEG = process.env.FFMPEG || (() => {
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch { /* not installed */ }
  try { return execSync(`${PY} -c "import imageio_ffmpeg as i;print(i.get_ffmpeg_exe())"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not installed */ }
  return 'ffmpeg';
})();
const AUDIO = path.join(here, `soundtrack-${EDIT}.wav`);

// ------------------------------------------------------------------ static server (the scene, brand fonts, example sites)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.json': 'application/json', '.webp': 'image/webp' };
function serve() {
  const server = http.createServer((req, res) => {
    let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(0);
  return server;
}

// The example sites load Google Fonts. Normally Chromium fetches them directly; behind a proxy that only
// tunnels HTTPS (like a cloud sandbox) they are fetched with curl into captures/.fontcache instead.
const cacheDir = path.join(here, 'captures', '.fontcache');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const viaCurl = !!(process.env.HTTPS_PROXY || process.env.https_proxy);
function cached(url) {
  const f = path.join(cacheDir, Buffer.from(url).toString('base64url').slice(0, 200));
  if (!fs.existsSync(f) && viaCurl) { fs.mkdirSync(cacheDir, { recursive: true }); execFileSync('curl', ['-sSL', '-m', '30', '-A', UA, '-o', f, url]); }
  return fs.existsSync(f) ? fs.readFileSync(f) : null;
}

const ANGLE = arg('angle', process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : '');
function launch() {
  const args = ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--ignore-gpu-blocklist', '--hide-scrollbars'];
  if (CPU) args.push('--enable-unsafe-swiftshader');
  else { args.push('--enable-gpu', '--enable-gpu-rasterization', '--enable-zero-copy'); if (ANGLE) args.push(`--use-angle=${ANGLE}`); }
  // channel 'chromium' = full Chromium in the new headless mode, which can use the GPU
  return chromium.launch({ headless: !HEADED, channel: CPU ? undefined : 'chromium', args });
}
async function open(browser, port) {
  const ctx = await browser.newContext({ viewport: { width: E.W, height: E.H }, deviceScaleFactor: SCALE });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
    const url = route.request().url();
    let body = null; try { body = cached(url); } catch { /* offline */ }
    if (body) route.fulfill({ status: 200, body, headers: { 'Content-Type': url.includes('googleapis') ? 'text/css' : 'font/woff2', 'Access-Control-Allow-Origin': '*' } });
    else route.fallback();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.error('PAGE ERROR', err.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|net::/.test(m.text())) console.error('console:', m.text()); });
  await page.goto(`http://localhost:${port}/lrweb-promo/scene.html?edit=${EDIT}&sky=${SKY}`);
  await page.evaluate(() => window.ready);
  return page;
}
const shutter = (k) => Array.from({ length: k }, (_, i) => ((i + .5) / k - .5) * (0.5 / FPS));

// ------------------------------------------------------------------ gpu check
if (has('gpu-check')) {
  const b = await launch(); const p = await b.newPage();
  const r = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'no WebGL2'; const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
  console.log('WebGL renderer:', r);
  console.log(/swiftshader|llvmpipe|software/i.test(r) ? 'Software rendering: your GPU is NOT being used. Try: --headed, or --angle gl / --angle vulkan (Linux), --angle d3d11 (Windows).' : 'GPU rendering is active.');
  await b.close(); process.exit(0);
}

// ------------------------------------------------------------------ stills
if (STILLS) {
  const server = serve(); const b = await launch(); const page = await open(b, server.address().port);
  fs.mkdirSync(path.join(here, 'stills'), { recursive: true });
  for (const t of STILLS.split(',').map(Number)) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(here, 'stills', `${EDIT[0]}${t.toFixed(2)}.png`) });
  }
  console.log('stills saved to', path.join(here, 'stills')); await b.close(); server.close(); process.exit(0);
}

const frames = Math.round((TO - FROM) * FPS);
const FRAMES_DIR = arg('frames-dir', '');

async function average(bufs, out) {
  const raws = await Promise.all(bufs.map((b) => sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const { width, height, channels } = raws[0].info, n = raws.length, acc = new Float32Array(raws[0].data.length);
  for (const r of raws) for (let i = 0; i < acc.length; i++) acc[i] += r.data[i];
  const o = Buffer.alloc(acc.length); for (let i = 0; i < acc.length; i++) o[i] = Math.min(255, Math.round(acc[i] / n));
  await sharp(o, { raw: { width, height, channels } }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(out);
}

// ------------------------------------------------------------------ worker: a slice of frames -> JPEGs
if (FRAMES_DIR) {
  const [a, b] = arg('range').split(':').map(Number);
  const server = serve(); const br = await launch(); const page = await open(br, server.address().port);
  for (let f = a; f < b; f++) {
    const t = FROM + f / FPS, name = String(f).padStart(5, '0');
    const k = await page.evaluate((t) => window.seek(t), t);
    if (!MB || k <= 1) { await page.screenshot({ type: 'jpeg', quality: 93, path: path.join(FRAMES_DIR, name + '.jpg') }); continue; }
    const offs = shutter(k), bufs = [];
    for (let i = 0; i < k; i++) {
      await page.evaluate((t) => window.seek(t), t + offs[i]);
      if (sharp) bufs.push(await page.screenshot({ type: 'png' }));
      else await page.screenshot({ type: 'jpeg', quality: 95, path: path.join(FRAMES_DIR, `${name}_${i}.jpg`) });
    }
    if (sharp) await average(bufs, path.join(FRAMES_DIR, name + '.jpg'));
  }
  await br.close(); server.close(); process.exit(0);
}

// ------------------------------------------------------------------ main: soundtrack, parallel workers, encode once
if (!fs.existsSync(AUDIO) || has('music')) {
  console.log('Soundtrack missing: building it (needs Python with numpy + scipy)…');
  if (!fs.existsSync(path.join(here, 'samples', 'kick_bigroom.wav'))) execFileSync(PY, [path.join(here, 'tools', 'fetch_samples.py')], { stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(here, 'timeline.js')], { stdio: 'inherit' });
  execFileSync(PY, [path.join(here, 'music.py'), EDIT], { stdio: 'inherit' });
}
const dir = arg('keep-dir', '') ? path.resolve(arg('keep-dir')) : fs.mkdtempSync(path.join(os.tmpdir(), `lrweb-${EDIT}-`));
fs.mkdirSync(dir, { recursive: true });
console.log(`Rendering ${EDIT}: ${frames} frames at ${Math.round(E.W * SCALE)}x${Math.round(E.H * SCALE)}, ${FPS} fps, ${WORKERS} worker(s), ${CPU ? 'CPU' : 'GPU'}${MB ? ', motion blur' : ''}`);
const t0 = Date.now();
if (!has('encode-only')) {
  const chunks = []; for (let a = 0; a < frames; a += 60) chunks.push([a, Math.min(frames, a + 60)]);
  const queues = Array.from({ length: WORKERS }, () => []); chunks.forEach((c, i) => queues[i % WORKERS].push(c));
  let done = 0;
  await Promise.all(queues.map((q, w) => (async () => {
    for (const [a, b] of q) {
      if (!has('force') && fs.existsSync(path.join(dir, String(b - 1).padStart(5, '0') + '.jpg'))) { done += b - a; continue; } // resumable
      await new Promise((res, rej) => {
        const c = spawn(process.execPath, [SELF, ...argv.slice(2).filter((x, i, arr) => !['--workers', '--keep-dir', '--out'].includes(x) && !['--workers', '--keep-dir', '--out'].includes(arr[i - 1])), '--frames-dir', dir, '--range', `${a}:${b}`], { stdio: ['ignore', 'inherit', 'inherit'] });
        c.on('close', (code) => (code === 0 ? res() : rej(new Error(`worker ${w} failed on frames ${a}-${b}`))));
      });
      if (!sharp && MB) execFileSync(PY, [path.join(here, 'tools', 'merge_frames.py'), dir, String(a), String(b)]);
      done += b - a;
      const el = (Date.now() - t0) / 60000;
      console.log(`[${EDIT}] ${done}/${frames} frames · ${el.toFixed(1)} min · ~${(el / done * (frames - done)).toFixed(1)} min left`);
    }
  })()));
}
console.log(`frames done in ${((Date.now() - t0) / 60000).toFixed(1)} min, encoding…`);
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'),
  '-ss', String(FROM), '-t', String(TO - FROM), '-i', AUDIO,
  '-vf', 'noise=c0s=6:c0f=t+u:c1s=2:c1f=t+u:c2s=2:c2f=t+u', // fine film grain (also prevents banding in the sky)
  '-c:v', 'libx264', '-preset', 'slow', '-crf', arg('crf', '19'), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', OUT], { stdio: 'inherit' });
if (!arg('keep-dir', '')) fs.rmSync(dir, { recursive: true, force: true }); else console.log('frames kept in', dir);
console.log('wrote', OUT);
