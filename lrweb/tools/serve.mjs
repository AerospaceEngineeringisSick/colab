// Static preview server for the LRWeb site (the folder above this one).
// Mirrors how a static host behaves: /services serves services.html, unknown paths get 404.html.
// Usage: npm run serve          (then open http://localhost:8000)
//        PORT=8080 npm run serve
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

function resolve(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const full = path.join(ROOT, p);
  if (!full.startsWith(ROOT)) return null;                       // no escaping the site folder
  if (full.includes(`${path.sep}tools${path.sep}`) || full.includes(`${path.sep}_src${path.sep}`)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  if (!path.extname(full) && fs.existsSync(full + '.html')) return full + '.html';   // clean URLs
  if (fs.existsSync(path.join(full, 'index.html'))) return path.join(full, 'index.html');
  return null;
}

export function startServer(port = 8000) {
  const server = http.createServer((req, res) => {
    const file = resolve(req.url);
    if (!file) {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      return res.end(fs.readFileSync(path.join(ROOT, '404.html')));
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +(process.env.PORT || 8000);
  await startServer(port);
  console.log(`LRWeb preview: http://localhost:${port}  (Ctrl+C to stop)`);
}
