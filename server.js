/**
 * 每周作业小管家 —— 零依赖后端（Node.js 原生 http）
 *
 * 功能：
 *   1. 静态托管前端页面（index.html / styles.css / app.js）
 *   2. 提供 /api/state 接口，按「家庭码」存取作业数据（JSON 文件落盘）
 *
 * 启动： node server.js        默认端口 3000
 *        PORT=8080 node server.js
 *
 * 部署到公网后，在网页「设置」里把家庭码填好、云端地址留空（同源）即可跨设备同步。
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const MAX_BODY = 4 * 1024 * 1024; // 4MB

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function safeCode(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim();
  if (!c || c.length > 64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(c)) return null; // 只允许字母数字下划线短横线
  return c;
}

function fileOf(code) {
  return path.join(DATA_DIR, code + '.json');
}

function readState(code) {
  const f = fileOf(code);
  if (!fs.existsSync(f)) return { items: [] };
  try {
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { items: Array.isArray(p.items) ? p.items : [] };
  } catch (e) {
    return { items: [] };
  }
}

function writeState(code, items) {
  const tmp = fileOf(code) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ code, items, updatedAt: new Date().toISOString() }));
  fs.renameSync(tmp, fileOf(code));
}

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT)) return send(res, 403, '{"error":"forbidden"}');
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      // SPA 回退
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, buf) => {
        if (e2) return send(res, 404, '{"error":"not found"}');
        send(res, 200, buf, MIME['.html']);
      });
    }
    const ext = path.extname(full).toLowerCase();
    fs.readFile(full, (e3, buf) => {
      if (e3) return send(res, 500, '{"error":"read error"}');
      send(res, 200, buf, MIME[ext] || 'application/octet-stream');
    });
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // 健康检查
  if (pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, time: new Date().toISOString() }));
  }

  // 数据接口
  if (pathname === '/api/state') {
    if (req.method === 'GET') {
      const code = safeCode(parsed.query.code);
      if (!code) return send(res, 400, JSON.stringify({ error: 'invalid code' }));
      return send(res, 200, JSON.stringify(readState(code)));
    }

    if (req.method === 'POST') {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const code = safeCode(body.code);
          if (!code) return send(res, 400, JSON.stringify({ error: 'invalid code' }));
          if (!Array.isArray(body.items)) return send(res, 400, JSON.stringify({ error: 'items must be array' }));
          const items = body.items.slice(0, 5000).map((it) => ({
            id: String(it.id || '').slice(0, 64),
            subject: String(it.subject || '').slice(0, 16),
            type: String(it.type || '').slice(0, 16),
            content: String(it.content || '').slice(0, 1000),
            date: String(it.date || '').slice(0, 10),
            due: String(it.due || '').slice(0, 10),
            done: !!it.done,
            doneAt: it.doneAt ? String(it.doneAt).slice(0, 24) : null,
            createdAt: it.createdAt || null,
            updatedAt: it.updatedAt || new Date().toISOString(),
            deleted: !!it.deleted
          })).filter((it) => it.id);
          writeState(code, items);
          return send(res, 200, JSON.stringify({ ok: true, count: items.length }));
        } catch (e) {
          return send(res, 400, JSON.stringify({ error: 'bad json' }));
        }
      });
      return;
    }

    return send(res, 405, JSON.stringify({ error: 'method not allowed' }));
  }

  return serveStatic(req, res, pathname);
});

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach((name) => {
    (ifaces[name] || []).forEach((i) => {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    });
  });
  return out;
}

server.listen(PORT, () => {
  const lans = lanAddresses();
  console.log('');
  console.log('  每周作业小管家已启动');
  console.log('  ------------------------------------------');
  console.log('  这台电脑打开：      http://localhost:' + PORT);
  if (lans.length) {
    console.log('  手机 / 平板打开（连同一个 Wi-Fi）：');
    lans.forEach((ip) => console.log('      http://' + ip + ':' + PORT));
  } else {
    console.log('  未检测到局域网地址，请确认已连接 Wi-Fi 或网线。');
  }
  console.log('  ------------------------------------------');
  console.log('  手机和电脑填同一个「家庭码」，即可看到同一份作业。');
  console.log('  数据目录： ' + DATA_DIR);
  console.log('  停止服务：按 Ctrl + C');
  console.log('');
});
