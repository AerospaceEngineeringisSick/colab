// Bundles BlockCraft into one self-contained, offline-capable index.html:
// game code + three.js + worker + textures + sounds + font, all inlined.
//
//   npm run build          one-off build
//   npm run watch          rebuild on change
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'src');
const ASSETS = path.join(ROOT, 'assets');
const OUT = path.join(ROOT, 'index.html');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function collectAssets() {
  const textures = {};
  for (const f of walk(path.join(ASSETS, 'textures'))) {
    if (!f.endsWith('.png')) continue;
    const key = path.relative(path.join(ASSETS, 'textures'), f).replace(/\\/g, '/').replace(/\.png$/, '');
    textures[key] = fs.readFileSync(f).toString('base64');
  }
  const sounds = {};
  for (const f of walk(path.join(ASSETS, 'sounds'))) {
    if (!f.endsWith('.mp3')) continue;
    sounds[path.basename(f, '.mp3')] = fs.readFileSync(f).toString('base64');
  }
  return { textures, sounds };
}

async function build() {
  const t0 = Date.now();
  const common = { bundle: true, format: 'iife', target: ['es2020'], minify: !dev, legalComments: 'none', logLevel: 'warning', write: false };
  const worker = await esbuild.build({ ...common, entryPoints: [path.join(SRC, 'worker/worker.js')] });
  const workerCode = worker.outputFiles[0].text;
  const main = await esbuild.build({
    ...common,
    entryPoints: [path.join(SRC, 'main.js')],
    define: { __WORKER_SRC__: JSON.stringify(workerCode), __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  });
  const mainCode = main.outputFiles[0].text;

  const assets = collectAssets();
  const font = fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource/pixelify-sans/files/pixelify-sans-latin-500-normal.woff2')).toString('base64');
  let css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
  css = `@font-face{font-family:"Pixel";src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:400 700;font-display:block}\n` + css;
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
  html = html
    .replace('/*__CSS__*/', () => css)
    .replace('/*__ASSETS__*/', () => 'window.ASSETS=' + safe(JSON.stringify(assets)) + ';')
    .replace('/*__MAIN__*/', () => safe(mainCode));
  fs.writeFileSync(OUT, html);
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`built index.html ${kb(html.length)} (code ${kb(mainCode.length)}, worker ${kb(workerCode.length)}, assets ${kb(JSON.stringify(assets).length)}) in ${Date.now() - t0} ms`);
}

await build();
if (watch) {
  let timer = null;
  const again = () => { clearTimeout(timer); timer = setTimeout(() => build().catch((e) => console.error(e.message)), 80); };
  fs.watch(SRC, { recursive: true }, again);
  fs.watch(ASSETS, { recursive: true }, again);
  console.log('watching for changes...');
}
