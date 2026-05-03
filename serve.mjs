import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = 3000;

/* ── Load .env into process.env ───────────────────────────── */
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

/* ── MIME map ─────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};

/* ── Minimal req/res shim for Vercel-style handlers ──────── */
function runApiHandler(handlerPath, req, res, body) {
  const headers = {};
  const statusHolder = { code: 200 };

  const fakeRes = {
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    status(code) { statusHolder.code = code; return fakeRes; },
    json(obj) {
      const payload = JSON.stringify(obj);
      res.writeHead(statusHolder.code, { 'Content-Type': 'application/json', ...headers });
      res.end(payload);
    },
    end() {
      res.writeHead(statusHolder.code, headers);
      res.end();
    },
  };

  const fakeReq = {
    method: req.method,
    headers: req.headers,
    body,
  };

  try {
    const handler = require(handlerPath);
    const fn = typeof handler === 'function' ? handler : handler.default;
    Promise.resolve(fn(fakeReq, fakeRes)).catch(err => {
      console.error('[serve] handler error', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
  } catch (err) {
    console.error('[serve] require error', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/* ── Server ───────────────────────────────────────────────── */
http.createServer((req, res) => {
  let url = req.url.split('?')[0];

  /* API routes — collect body then delegate to handler */
  if (url.startsWith('/api/')) {
    const handlerFile = path.join(__dirname, url + '.js');
    if (!fs.existsSync(handlerFile)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API route not found: ' + url }));
      return;
    }
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      runApiHandler(handlerFile, req, res, body);
    });
    return;
  }

  /* Static files */
  if (url === '/') url = '/index.html';
  const filePath = path.join(__dirname, url);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + url);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
