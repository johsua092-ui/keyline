/**
 * Preview server. Node only, no dependencies.
 *
 * Serves ./public as static files and hands every /api/* request to the very
 * same worker module that runs on Cloudflare, so the preview and the deployed
 * worker cannot drift apart.
 *
 *   node server.mjs            # http://127.0.0.1:4173
 *   PORT=8080 node server.mjs
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './worker/index.js';

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PUB = fileURLToPath(new URL('./public/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function serveStatic(pathname, res) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const full = join(PUB, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUB)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(full);
    if (info.isDirectory()) return serveStatic(join(rel, 'index.html'), res);
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request(url.href, {
    method: req.method,
    headers: { 'content-type': req.headers['content-type'] || 'application/json' },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });

  try {
    const out = await worker.fetch(request, {});
    const buf = Buffer.from(await out.arrayBuffer());
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(buf);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ ok: false, error: 'Preview server error: ' + String(err && err.message ? err.message : err) }),
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log('KEYLINE preview on http://' + HOST + ':' + PORT);
});
