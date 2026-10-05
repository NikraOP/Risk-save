// Локальный сервер редактора: раздаёт сайт и сам читает/пишет профили RoR2.
// Нужен потому, что браузер не даёт сайту открывать файлы из Program Files.
// Запуск: start.bat  (или node tools/server.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

const PORT = 8765;
const ROOT = path.join(__dirname, '..');
const BACKUP = path.join(ROOT, 'backup');
const STEAM_DIRS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam', 'D:\\Program Files (x86)\\Steam',
];

function findProfiles() {
  const out = [];
  for (const steam of STEAM_DIRS) {
    const ud = path.join(steam, 'userdata');
    if (!fs.existsSync(ud)) continue;
    for (const id of fs.readdirSync(ud)) {
      const dir = path.join(ud, id, '632360', 'remote', 'UserProfiles');
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.toLowerCase().endsWith('.xml')) continue;
        const p = path.join(dir, f);
        const text = fs.readFileSync(p, 'utf8');
        const name = (text.match(/<name>([^<]*)<\/name>/) || [])[1] || f;
        out.push({ path: p, file: f, name, steamId: id, mtime: fs.statSync(p).mtimeMs });
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function gameRunning() {
  try { return execSync('tasklist /FI "IMAGENAME eq Risk of Rain 2.exe" /NH', { encoding: 'utf8' }).includes('Risk of Rain 2.exe'); }
  catch (e) { return false; }
}

const allowed = p => findProfiles().some(x => x.path === p);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.xml': 'application/xml' };

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/profiles') return send(res, 200, { profiles: findProfiles(), gameRunning: gameRunning() });

    if (url.pathname === '/api/profile') {
      const p = url.searchParams.get('path');
      if (!p || !allowed(p)) return send(res, 400, { error: 'Такого профиля нет' });
      if (req.method === 'GET') return send(res, 200, fs.readFileSync(p, 'utf8'), 'application/xml; charset=utf-8');
      if (req.method === 'POST') {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', c => (body += c));
        req.on('end', () => {
          if (gameRunning()) return send(res, 409, { error: 'Игра запущена. Закрой её, иначе она перезапишет файл при выходе.' });
          if (!body.startsWith('<?xml') || !body.includes('<UserProfile>')) return send(res, 400, { error: 'Это не профиль' });
          fs.mkdirSync(BACKUP, { recursive: true });
          const backup = path.join(BACKUP, path.basename(p, '.xml') + '-' + stamp() + '.xml');
          fs.copyFileSync(p, backup);
          fs.writeFileSync(p, body, 'utf8');
          send(res, 200, { ok: true, backup: path.relative(ROOT, backup) });
        });
        return;
      }
    }

    // статика
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) return send(res, 403, 'нет', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return send(res, 404, 'не найдено', 'text/plain');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  const url = 'http://localhost:' + PORT;
  console.log('Редактор запущен: ' + url + '\nНе закрывай это окно, пока работаешь с редактором.');
  if (process.argv.includes('--open')) exec('start "" "' + url + '"');
});
