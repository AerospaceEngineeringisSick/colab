#!/usr/bin/env node
// Builds mockup/lrweb-console-mockup.html: ONE self-contained practice file that opens from disk with no server,
// no install and no network. It inlines the real console CSS (brand, tokens, glass, layout, components), the Latin
// font subsets as data URIs, the logos and favicon, the real shared library (web/js/lib/lb-algorithms.js) and the
// real LRChat crypto (web/js/chat/crypto.js) as script-scoped namespaces, then the practice UI in mockup/src/.
// Deterministic: the same inputs always give the same bytes. Usage: npm run mockup   (or node tools/build-mockup.mjs)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = (p) => join(root, p);
const text = (p) => readFileSync(at(p), 'utf8');
const dataUri = (mime, p) => `data:${mime};base64,${readFileSync(at(p)).toString('base64')}`;

const OUT = 'mockup/lrweb-console-mockup.html';
const LIMIT_BYTES = 600 * 1024;
const EM_DASH = String.fromCharCode(0x2014); // built from the code point so this file stays clean too

/* ---------- fonts: Latin subsets only, each woff2 embedded once ---------- */

// The console uses these four Latin subsets. Bricolage Grotesque and Instrument Sans are variable fonts, so one face
// covers their whole weight range (the real fonts.css lists the same file once per weight, which would embed it 4 times).
const LATIN_FILES = new Set(['font-03', 'font-15', 'font-08', 'font-13']);

function latinFontFaces() {
  const faces = text('web/css/fonts.css').match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const groups = new Map();
  for (const face of faces) {
    const file = /assets\/fonts\/(font-\d+)\.woff2/.exec(face)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(face)?.[1] ?? '';
    if (!LATIN_FILES.has(file) || !/U\+0000-00FF/.test(range)) continue;
    const family = /font-family:\s*'([^']+)'/.exec(face)[1];
    const weight = Number(/font-weight:\s*(\d+)/.exec(face)[1]);
    const key = `${family}|${file}`;
    const group = groups.get(key) ?? { family, file, range, weights: [] };
    group.weights.push(weight);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => {
    const lo = Math.min(...g.weights);
    const hi = Math.max(...g.weights);
    return [
      '@font-face {',
      `  font-family: '${g.family}';`,
      '  font-style: normal;',
      `  font-weight: ${lo === hi ? lo : `${lo} ${hi}`};`,
      '  font-stretch: 100%;',
      '  font-display: swap;',
      `  src: url(${dataUri('font/woff2', `web/assets/fonts/${g.file}.woff2`)}) format('woff2');`,
      `  unicode-range: ${g.range};`,
      '}',
    ].join('\n');
  }).join('\n');
}

/* ---------- JS: turn an import-free ES module into a script-scoped namespace ---------- */

function asNamespace(name, file) {
  const src = text(file);
  if (/^\s*import\s/m.test(src) || /^\s*export\s+default\b/m.test(src)) {
    throw new Error(`${file} must have no imports and no default export to be inlined.`);
  }
  const exported = new Map(); // exported name -> local name
  // export { a, b as c };
  let body = src.replace(/^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (_, list) => {
    for (const item of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [local, alias = local] = item.split(/\s+as\s+/);
      exported.set(alias, local);
    }
    return '';
  });
  // export const|let|var|function|async function|class NAME
  for (const m of body.matchAll(/^export\s+(?:async\s+function\*?|function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    exported.set(m[1], m[1]);
  }
  body = body.replace(/^export\s+(?=(?:async\s+function\b|function\b|const\b|let\b|var\b|class\b))/gm, '');
  if (/^export\s/m.test(body)) throw new Error(`${file} has an export form this builder does not handle.`);
  const members = [...exported].map(([out, local]) => (out === local ? out : `${out}: ${local}`)).join(', ');
  return [
    `const ${name} = (() => {`,
    "'use strict';",
    body.trimEnd(),
    `return { ${members} };`,
    '})();',
  ].join('\n');
}

/* ---------- assemble ---------- */

const CSS_FILES = ['web/css/brand.css', 'web/css/tokens.css', 'web/css/glass.css', 'web/css/layout.css', 'web/css/components.css'];
const css = [latinFontFaces(), ...CSS_FILES.map(text), text('mockup/src/mockup.css')].join('\n');

const parts = {
  '@@CSS@@': css,
  '@@FAVICON@@': dataUri('image/svg+xml', 'web/assets/favicon.svg'),
  '@@LOGO_LIGHT@@': dataUri('image/png', 'web/assets/brand/logo-light.png'),
  '@@LOGO_DARK@@': dataUri('image/png', 'web/assets/brand/logo-dark.png'),
  '@@LB@@': asNamespace('LB', 'web/js/lib/lb-algorithms.js'),
  '@@CRYPTO@@': asNamespace('LRCrypto', 'web/js/chat/crypto.js'),
  '@@APP@@': text('mockup/src/mockup.js'),
};

for (const code of [parts['@@LB@@'], parts['@@CRYPTO@@'], parts['@@APP@@']]) {
  if (/<\/script/i.test(code) || code.includes('<!--')) throw new Error('Inlined script would end the <script> element early.');
}
if (/<\/style/i.test(css)) throw new Error('Inlined CSS would end the <style> element early.');

let html = text('mockup/src/template.html');
for (const [token, value] of Object.entries(parts)) {
  const count = html.split(token).length - 1;
  if (count !== 1) throw new Error(`mockup/src/template.html must contain ${token} exactly once (found ${count}).`);
  html = html.split(token).join(value);
}
if (/@@[A-Z_]+@@/.test(html)) throw new Error('An unreplaced template token is left in the output.');

// Offline guarantees: nothing may point at the network, and every CSS url() must be a data URI or an in-page fragment.
if (/\b(?:src|href)\s*=\s*["']?\s*https?:/i.test(html) || /@import/.test(css)) throw new Error('The mockup must not reference any network address.');
for (const [, target] of html.matchAll(/url\(\s*["']?([^"')\s]+)/g)) {
  if (!target.startsWith('data:') && !target.startsWith('#')) throw new Error(`Unexpected url() reference in the mockup: ${target.slice(0, 60)}`);
}
if (html.includes(EM_DASH)) throw new Error('An em dash slipped into the mockup. Replace it with a comma, colon or full stop.');

const bytes = Buffer.byteLength(html, 'utf8');
if (bytes > LIMIT_BYTES) throw new Error(`Mockup is ${(bytes / 1024).toFixed(1)} KB, over the ${LIMIT_BYTES / 1024} KB limit.`);

mkdirSync(dirname(at(OUT)), { recursive: true });
writeFileSync(at(OUT), html);
console.log(`Wrote ${OUT}: ${(bytes / 1024).toFixed(1)} KB (limit ${LIMIT_BYTES / 1024} KB).`);
