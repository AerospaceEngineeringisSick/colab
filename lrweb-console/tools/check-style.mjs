#!/usr/bin/env node
// House style check (from the LRWeb site's CLAUDE.md): no em dashes anywhere in code, copy, docs or comments.
// Usage: node tools/check-style.mjs     Exits 1 and lists every offending line.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'data', '.git']);
const EXT = new Set(['.js', '.mjs', '.css', '.html', '.md', '.json', '.svg', '.txt']);
const EM_DASH = String.fromCharCode(0x2014); // built from the code point so this file stays clean too
const hits = [];

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.has(extname(p))) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (line.includes(EM_DASH)) hits.push(`${relative(root, p)}:${i + 1}: ${line.trim().slice(0, 110)}`);
      });
    }
  }
})(root);

if (hits.length) {
  console.error(`Em dashes found (${hits.length}). Use a comma, colon, full stop or brackets instead:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log('Style check passed: no em dashes.');
