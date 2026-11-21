// 폰으로 찍어 보내기: 같은 와이파이 안에서만 쓰는 작은 웹 서버.
// 주소에 들어 있는 토큰을 아는 기기만 올릴 수 있다.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 30 * 1024 * 1024;
let server = null;
let state = null;

function lanAddress() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) found.push(ni.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : ip.startsWith('169.254.') ? 9 : 3);
  found.sort((a, b) => rank(a) - rank(b));
  return found[0] || null;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function handler(opts) {
  const mobileHtml = () => fs.readFileSync(path.join(__dirname, 'mobile', 'index.html'));
  const icon = () => fs.readFileSync(path.join(__dirname, 'assets', 'icon.png'));
  return (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== opts.token) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('주소가 올바르지 않습니다. PC의 QR을 다시 찍어 주세요.');
      return;
    }
    const sub = parts[1] || '';
    if (req.method === 'GET' && sub === '') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(mobileHtml());
    } else if (req.method === 'GET' && sub === 'info') {
      json(res, 200, opts.getInfo());
    } else if (req.method === 'GET' && sub === 'icon.png') {
      res.writeHead(200, { 'content-type': 'image/png' }).end(icon());
    } else if (req.method === 'GET' && sub === 'manifest.json') {
      json(res, 200, {
        name: '공감캡처',
        short_name: '공감캡처',
        start_url: `/${opts.token}/`,
        display: 'standalone',
        background_color: '#0f1f1d',
        theme_color: '#0f9b7c',
        icons: [{ src: `/${opts.token}/icon.png`, sizes: '512x512', type: 'image/png' }],
      });
    } else if (req.method === 'POST' && sub === 'upload') {
      const chunks = [];
      let size = 0;
      let aborted = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          aborted = true;
          json(res, 413, { ok: false, error: '사진이 너무 큽니다' });
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        try {
          const item = opts.onUpload(Buffer.concat(chunks), req.headers['content-type'] || '', url.searchParams.get('session') || '');
          json(res, 200, { ok: true, id: item.id });
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
    } else {
      res.writeHead(404).end();
    }
  };
}

function listen(srv, port) {
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, '0.0.0.0', () => {
      srv.removeListener('error', reject);
      resolve(srv.address().port);
    });
  });
}

// opts: { token, port, onUpload(buf, contentType, session) -> item, getInfo() }
async function ensure(opts) {
  if (!server) {
    const srv = http.createServer(handler(opts));
    let port;
    try {
      port = await listen(srv, opts.port);
    } catch {
      port = await listen(srv, 0); // 포트가 쓰이는 중이면 빈 포트로
    }
    server = srv;
    state = { port, token: opts.token };
  }
  const ip = lanAddress();
  return { ip, port: state.port, url: ip ? `http://${ip}:${state.port}/${state.token}/` : null };
}

function stop() {
  if (server) server.close();
  server = null;
  state = null;
}

module.exports = { ensure, stop, lanAddress };
