'use strict';
// Servidor sem dependências: API JSON + arquivos estáticos. Dados em DATA_DIR/bombas.json.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ACCESS_CODE = process.env.ACCESS_CODE || ''; // opcional: exige o código no cabeçalho x-access-code
const DB_FILE = path.join(DATA_DIR, 'bombas.json');
const PUBLIC = path.join(__dirname, 'public');
const MAX_HISTORY = 500;

const DEFAULT_SECTORS = ['Centro de Tratamento Intensivo - 3', 'UTI Adulto', 'UTI Neonatal', 'Centro Cirúrgico', 'Pronto-Socorro', 'Enfermaria', 'Pediatria', 'Hemodiálise', 'Almoxarifado', 'Manutenção'];

fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { sectors: DEFAULT_SECTORS, pumps: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { save(); }

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

const clean = (v, max = 120) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const fail = (res, status, error) => send(res, status, { error });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 20000) { reject(new Error('grande')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('json')); } });
  });
}

function summary(p) { const { history, ...rest } = p; return rest; }

async function api(req, res, url) {
  if (ACCESS_CODE && req.headers['x-access-code'] !== ACCESS_CODE) return fail(res, 401, 'Código de acesso inválido.');
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // tira "api"
  const [kind, id, action] = parts;
  const m = req.method;
  const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);

  if (kind === 'state' && m === 'GET') {
    return send(res, 200, { sectors: db.sectors, pumps: Object.values(db.pumps).map(summary) });
  }

  if (kind === 'pumps') {
    if (!id && m === 'POST') {
      const code = clean(body.code, 200);
      if (!code) return fail(res, 400, 'Código do QR é obrigatório.');
      if (db.pumps[code]) return fail(res, 409, 'Esta bomba já está cadastrada.');
      const sector = clean(body.sector);
      if (sector && !db.sectors.includes(sector)) return fail(res, 400, 'Setor inexistente.');
      const now = new Date().toISOString();
      db.pumps[code] = {
        code, name: clean(body.name) || code, model: clean(body.model), serial: clean(body.serial), calibrationDue: clean(body.calibrationDue, 10), sector, updatedAt: now,
        history: [{ at: now, sector, who: clean(body.who), note: 'Cadastro' }],
      };
      save();
      return send(res, 201, db.pumps[code]);
    }
    const pump = db.pumps[id];
    if (!pump) return fail(res, 404, 'Bomba não encontrada.');
    if (m === 'GET' && !action) return send(res, 200, pump);
    if (m === 'PUT' && !action) {
      if ('name' in body) pump.name = clean(body.name) || pump.name;
      if ('model' in body) pump.model = clean(body.model);
      if ('serial' in body) pump.serial = clean(body.serial);
      if ('calibrationDue' in body) pump.calibrationDue = clean(body.calibrationDue, 10);
      save();
      return send(res, 200, pump);
    }
    if (m === 'POST' && action === 'move') {
      const sector = clean(body.sector);
      if (!db.sectors.includes(sector)) return fail(res, 400, 'Setor inexistente.');
      const now = new Date().toISOString();
      pump.sector = sector;
      pump.updatedAt = now;
      pump.history.unshift({ at: now, sector, who: clean(body.who), note: clean(body.note, 300) });
      pump.history.length = Math.min(pump.history.length, MAX_HISTORY);
      save();
      return send(res, 200, pump);
    }
    if (m === 'DELETE' && !action) { delete db.pumps[id]; save(); return send(res, 200, { ok: true }); }
  }

  if (kind === 'sectors') {
    if (!id && m === 'POST') {
      const name = clean(body.name, 60);
      if (!name) return fail(res, 400, 'Nome do setor é obrigatório.');
      if (db.sectors.some((s) => s.toLowerCase() === name.toLowerCase())) return fail(res, 409, 'Setor já existe.');
      db.sectors.push(name);
      save();
      return send(res, 201, { sectors: db.sectors });
    }
    if (id && m === 'DELETE') {
      if (!db.sectors.includes(id)) return fail(res, 404, 'Setor não encontrado.');
      if (Object.values(db.pumps).some((p) => p.sector === id)) return fail(res, 409, 'Há bombas neste setor. Mova-as antes de remover.');
      db.sectors = db.sectors.filter((s) => s !== id);
      save();
      return send(res, 200, { sectors: db.sectors });
    }
  }
  return fail(res, 404, 'Rota não encontrada.');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; media-src 'self'; connect-src 'self'");
  res.setHeader('Permissions-Policy', 'camera=(self)');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html'); // SPA
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    fail(res, e.message === 'json' || e.message === 'grande' ? 400 : 500, e.message === 'json' ? 'JSON inválido.' : e.message === 'grande' ? 'Requisição grande demais.' : 'Erro interno.');
  }
});

if (require.main === module) server.listen(PORT, () => console.log(`Bombas de infusão em http://localhost:${PORT}`));
module.exports = server;
