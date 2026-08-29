'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.TCIM_LOCAL_WEB_PORT || 5173);
const ROOT = path.resolve(__dirname, 'web', 'dist');
const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
});

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  throw new Error('本机发布文件不存在，请先运行“发布本机版.cmd”。');
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': status === 200 ? 'no-cache' : 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (requestUrl.pathname === '/healthz') {
    send(res, 200, JSON.stringify({ ok: true, service: 'tcim-local-web-release' }), 'application/json; charset=utf-8');
    return;
  }
  let relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
  if (!relative) relative = 'index.html';
  let candidate = path.resolve(ROOT, relative);
  if (!candidate.startsWith(ROOT + path.sep) && candidate !== ROOT) {
    send(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
    candidate = path.join(ROOT, 'index.html');
  }
  fs.readFile(candidate, (error, content) => {
    if (error) {
      send(res, 500, 'Local release read failed');
      return;
    }
    send(res, 200, content, MIME[path.extname(candidate).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`TCIM local release: http://${HOST}:${PORT}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

