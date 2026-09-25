// Renders scene.html frame-by-frame in headless Chromium and muxes it with soundtrack.wav.
//   node render.mjs                      -> LRWeb-promo.mp4 (1920x1080, 60 fps)
//   node render.mjs --fps 30 --out x.mp4 -> quicker draft
//   node render.mjs --stills 1,8.3,12.8  -> PNG stills in ./stills for checking frames
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
const FPS = +arg('fps', TL.FPS);
const OUT = path.resolve(here, arg('out', 'LRWeb-promo.mp4'));
const FROM = +arg('from', 0), TO = +arg('to', TL.DUR);
const STILLS = arg('stills', '');
const FFMPEG = process.env.FFMPEG || (() => { try { return execSync('python3 -c "import imageio_ffmpeg as i;print(i.get_ffmpeg_exe())"').toString().trim(); } catch { return 'ffmpeg'; } })();

// tiny static server so fonts/images load with proper origins
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: TL.W, height: TL.H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(`http://localhost:${port}/lrweb-promo/scene.html`);
await page.evaluate(() => window.ready);

if (STILLS) {
  fs.mkdirSync(path.join(here, 'stills'), { recursive: true });
  for (const t of STILLS.split(',').map(Number)) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(here, 'stills', `t${t.toFixed(2)}.png`) });
    console.log('still', t);
  }
  await browser.close(); server.close(); process.exit(0);
}

const frames = Math.round((TO - FROM) * FPS);
const WORKERS = +arg('workers', 1);
const FRAMES_DIR = arg('frames-dir', '');

// worker mode: write a slice of frames as JPEGs, then exit
if (FRAMES_DIR) {
  const [a, b] = arg('range').split(':').map(Number);
  for (let f = a; f < b; f++) {
    await page.evaluate((t) => window.seek(t), FROM + f / FPS);
    await page.screenshot({ type: 'jpeg', quality: 95, path: path.join(FRAMES_DIR, String(f).padStart(5, '0') + '.jpg') });
    if ((f - a) % 120 === 0) console.log(`[${a}:${b}] frame ${f}`);
  }
  await browser.close(); server.close(); process.exit(0);
}

// parallel mode: split frames across worker processes, then encode the image sequence once
if (WORKERS > 1) {
  await browser.close(); server.close();
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'lrweb-frames-'));
  const per = Math.ceil(frames / WORKERS);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, (_, w) => new Promise((res, rej) => {
    const a = w * per, b = Math.min(frames, a + per);
    const c = spawn(process.execPath, [new URL(import.meta.url).pathname, '--fps', String(FPS), '--from', String(FROM), '--to', String(TO), '--frames-dir', dir, '--range', `${a}:${b}`], { stdio: 'inherit' });
    c.on('close', (code) => (code === 0 ? res() : rej(new Error('worker ' + w + ' failed'))));
  })));
  console.log(`frames done in ${((Date.now() - t0) / 1000).toFixed(0)}s, encoding…`);
  execSync([FFMPEG, '-y', '-loglevel', 'error', '-framerate', FPS, '-i', path.join(dir, '%05d.jpg'),
    '-ss', FROM, '-t', TO - FROM, '-i', path.join(here, 'soundtrack.wav'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'animation',
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', JSON.stringify(OUT)].join(' '), { stdio: 'inherit' });
  if (!process.argv.includes('--keep-frames')) fs.rmSync(dir, { recursive: true, force: true }); else console.log('frames kept in', dir);
  console.log('wrote', OUT);
  process.exit(0);
}
const ff = spawn(FFMPEG, [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-ss', String(FROM), '-t', String(TO - FROM), '-i', path.join(here, 'soundtrack.wav'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'animation',
  '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  const t = FROM + f / FPS;
  await page.evaluate((t) => window.seek(t), t);
  const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % (FPS * 2) === 0) console.log(`frame ${f}/${frames}  t=${t.toFixed(2)}s  ${((Date.now() - t0) / 1000).toFixed(0)}s elapsed`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close(); server.close();
console.log('wrote', OUT);
