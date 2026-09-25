// Renders scene.html frame-by-frame in headless Chromium (WebGL via SwiftShader) and muxes the soundtrack.
//   node render.mjs --edit landscape --workers 3    -> LRWeb-promo-landscape.mp4 (1920x1080, 60 fps)
//   node render.mjs --edit vertical --workers 3     -> LRWeb-promo-vertical.mp4  (1080x1920, 60 fps)
//   node render.mjs --edit vertical --stills 1,5.2  -> PNG stills in stills/ for checking frames
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const TL = require('./timeline.js');

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const EDIT = arg('edit', 'landscape'), E = TL.EDITS[EDIT];
const FPS = +arg('fps', TL.FPS);
const OUT = path.resolve(here, arg('out', `LRWeb-promo-${EDIT}.mp4`));
const FROM = +arg('from', 0), TO = +arg('to', E.end);
const STILLS = arg('stills', '');
const FFMPEG = process.env.FFMPEG || (() => { try { return execSync('python3 -c "import imageio_ffmpeg as i;print(i.get_ffmpeg_exe())"').toString().trim(); } catch { return 'ffmpeg'; } })();
const AUDIO = path.join(here, `soundtrack-${EDIT}.wav`);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const launch = () => chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-lcd-text'] });

async function open(browser, edit, extra = '') {
  const e = TL.EDITS[edit];
  const page = await browser.newPage({ viewport: { width: e.W, height: e.H }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => console.error('PAGE ERROR', err.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(`http://localhost:${port}/lrweb-promo/scene.html?edit=${edit}${extra}`);
  await page.evaluate(() => window.ready);
  return page;
}

// 1) the datamosh starts from a still of the 2009 page: capture it once per edit (also used on the night laptop)
async function prep(force = false) {
  fs.mkdirSync(path.join(here, 'assets'), { recursive: true });
  const b = await launch();
  for (const edit of ['landscape', 'vertical']) {
    const out = path.join(here, 'assets', `old-${edit}.png`);
    if (fs.existsSync(out) && !force) continue;
    const e = TL.EDITS[edit], old = e.scenes.find((s) => s[0] === 'old');
    const page = await open(b, edit, '&prep=old');
    await page.evaluate((t) => window.seek(t), (old[1] + old[3].mosh) * TL.BAR - 1 / 60);
    await page.screenshot({ path: out });
    console.log('prep:', out);
    await page.close();
  }
  await b.close();
}
if (!process.argv.includes('--frames-dir')) await prep(process.argv.includes('--prep'));
if (process.argv.includes('--prep-only')) { server.close(); process.exit(0); }

// 2) stills
if (STILLS) {
  const b = await launch(); const page = await open(b, EDIT);
  fs.mkdirSync(path.join(here, 'stills'), { recursive: true });
  for (const t of STILLS.split(',').map(Number)) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(here, 'stills', `${EDIT[0]}${t.toFixed(2)}.png`) });
  }
  console.log('stills done'); await b.close(); server.close(); process.exit(0);
}

const frames = Math.round((TO - FROM) * FPS);
const WORKERS = +arg('workers', 1);
const FRAMES_DIR = arg('frames-dir', '');

// 3a) worker: write a slice of frames as JPEGs
if (FRAMES_DIR) {
  const [a, b] = arg('range').split(':').map(Number);
  const br = await launch(); const page = await open(br, EDIT);
  for (let f = a; f < b; f++) {
    await page.evaluate((t) => window.seek(t), FROM + f / FPS);
    await page.screenshot({ type: 'jpeg', quality: 94, path: path.join(FRAMES_DIR, String(f).padStart(5, '0') + '.jpg') });
    if ((f - a) % 120 === 0) console.log(`[${EDIT} ${a}:${b}] frame ${f}`);
  }
  await br.close(); server.close(); process.exit(0);
}

// 3b) main: soundtrack, split frames across workers, encode once
if (!fs.existsSync(AUDIO) || process.argv.includes('--music')) {
  if (!fs.existsSync(path.join(here, 'samples', 'kick_trap1.wav'))) execSync(`python3 ${JSON.stringify(path.join(here, 'tools', 'fetch_samples.py'))}`, { stdio: 'inherit' });
  execSync(`node ${JSON.stringify(path.join(here, 'timeline.js'))} && python3 ${JSON.stringify(path.join(here, 'music.py'))} ${EDIT}`, { stdio: 'inherit' });
}
server.close();
const dir = arg('keep-dir', '') || fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', `lrweb-${EDIT}-`));
fs.mkdirSync(dir, { recursive: true });
const per = Math.ceil(frames / WORKERS);
const t0 = Date.now();
await Promise.all(Array.from({ length: WORKERS }, (_, w) => new Promise((res, rej) => {
  const a = w * per, b = Math.min(frames, a + per);
  const c = spawn(process.execPath, [new URL(import.meta.url).pathname, '--edit', EDIT, '--fps', String(FPS), '--from', String(FROM), '--to', String(TO), '--frames-dir', dir, '--range', `${a}:${b}`], { stdio: 'inherit' });
  c.on('close', (code) => (code === 0 ? res() : rej(new Error('worker ' + w + ' failed'))));
})));
console.log(`frames done in ${((Date.now() - t0) / 1000).toFixed(0)}s, encoding…`);
execSync([FFMPEG, '-y', '-loglevel', 'error', '-framerate', FPS, '-i', JSON.stringify(path.join(dir, '%05d.jpg')),
  '-ss', FROM, '-t', TO - FROM, '-i', JSON.stringify(AUDIO),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', JSON.stringify(OUT)].join(' '), { stdio: 'inherit' });
if (!arg('keep-dir', '')) fs.rmSync(dir, { recursive: true, force: true }); else console.log('frames kept in', dir);
console.log('wrote', OUT);
