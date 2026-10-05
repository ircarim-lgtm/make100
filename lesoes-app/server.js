// Servidor sem dependências externas: HTTP + armazenamento em JSON + fotos em disco.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PHOTO = 10 * 1024 * 1024;
fs.mkdirSync(PHOTO_DIR, { recursive: true });

// ---------- Persistência ----------
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
const checkPw = (pw, stored) => {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(hash(pw, salt).split(':')[1], 'hex');
  return crypto.timingSafeEqual(a, Buffer.from(h, 'hex'));
};

let db;
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
else {
  db = {
    users: [
      { id: 'u1', nome: 'Enf. Examinador (demo)', login: 'examinador', senha: hash('exam123'), perfil: 'examinador' },
      { id: 'u2', nome: 'Estomaterapeuta (demo)', login: 'estomaterapeuta', senha: hash('estoma123'), perfil: 'estomaterapeuta' },
    ],
    pacientes: [],
    registros: [],
  };
}
const save = () => {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
};
save();

const sessions = new Map(); // token -> userId
const id = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();

// ---------- Utilidades HTTP ----------
const send = (res, status, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isBuf ? body : JSON.stringify(body));
};
const fail = (res, status, erro) => send(res, status, { erro });

const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Arquivo muito grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
const readJson = async (req) => {
  const buf = await readBody(req, 1024 * 1024);
  try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
};

const publicUser = (u) => ({ id: u.id, nome: u.nome, login: u.login, perfil: u.perfil });
const authUser = (req) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const uid = sessions.get(token);
  return db.users.find((u) => u.id === uid) || null;
};

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ESTAGIOS = ['1', '2', '3', '4', 'nao_classificavel', 'tissular_profunda'];
const SEGUIMENTOS = ['rascunho', 'enviado', 'avaliado'];

const withPaciente = (r) => {
  const p = db.pacientes.find((x) => x.id === r.pacienteId);
  return { ...r, paciente: p ? { id: p.id, nome: p.nome, prontuario: p.prontuario, leito: p.leito } : null };
};

// ---------- Rotas ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  let m;

  if (method === 'POST' && pathname === '/api/login') {
    const { login, senha } = await readJson(req);
    const u = db.users.find((x) => x.login === str(login, 60));
    if (!u || typeof senha !== 'string' || !checkPw(senha, u.senha)) return fail(res, 401, 'Usuário ou senha inválidos');
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, u.id);
    return send(res, 200, { token, usuario: publicUser(u) });
  }

  const user = authUser(req);
  if (!user) return fail(res, 401, 'Não autenticado');
  const isExam = user.perfil === 'examinador';
  const isEstoma = user.perfil === 'estomaterapeuta';

  if (method === 'GET' && pathname === '/api/me') return send(res, 200, publicUser(user));
  if (method === 'POST' && pathname === '/api/logout') {
    sessions.delete((req.headers.authorization || '').replace(/^Bearer /, ''));
    return send(res, 200, { ok: true });
  }

  // Pacientes
  if (pathname === '/api/pacientes' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const list = db.pacientes
      .filter((p) => !q || p.nome.toLowerCase().includes(q) || p.prontuario.toLowerCase().includes(q))
      .map((p) => ({ ...p, totalRegistros: db.registros.filter((r) => r.pacienteId === p.id).length }));
    return send(res, 200, list);
  }
  if (pathname === '/api/pacientes' && method === 'POST') {
    if (!isExam) return fail(res, 403, 'Apenas o examinador cadastra pacientes');
    const b = await readJson(req);
    const nome = str(b.nome, 120);
    const prontuario = str(b.prontuario, 40);
    if (!nome || !prontuario) return fail(res, 400, 'Nome e prontuário são obrigatórios');
    if (db.pacientes.some((p) => p.prontuario === prontuario)) return fail(res, 409, 'Prontuário já cadastrado');
    const nasc = str(b.dataNascimento, 10);
    if (nasc && !/^\d{4}-\d{2}-\d{2}$/.test(nasc)) return fail(res, 400, 'Data de nascimento inválida');
    const p = {
      id: id(), nome, prontuario, dataNascimento: nasc,
      sexo: str(b.sexo, 20), leito: str(b.leito, 40),
      comorbidades: str(b.comorbidades, 500), braden: str(b.braden, 5),
      criadoPor: user.id, criadoEm: now(),
    };
    db.pacientes.push(p); save();
    return send(res, 201, p);
  }
  if ((m = pathname.match(/^\/api\/pacientes\/([\w]+)$/)) && method === 'GET') {
    const p = db.pacientes.find((x) => x.id === m[1]);
    if (!p) return fail(res, 404, 'Paciente não encontrado');
    const registros = db.registros.filter((r) => r.pacienteId === p.id)
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).map(withPaciente);
    return send(res, 200, { ...p, registros });
  }

  // Registros de lesão
  if (pathname === '/api/registros' && method === 'GET') {
    const status = url.searchParams.get('status');
    let list = db.registros;
    if (status && SEGUIMENTOS.includes(status)) list = list.filter((r) => r.status === status);
    // estomaterapeuta nunca vê rascunhos
    if (isEstoma) list = list.filter((r) => r.status !== 'rascunho');
    list = list.slice().sort((a, b) => (b.enviadoEm || b.criadoEm).localeCompare(a.enviadoEm || a.criadoEm));
    return send(res, 200, list.map(withPaciente));
  }
  if (pathname === '/api/registros' && method === 'POST') {
    if (!isExam) return fail(res, 403, 'Apenas o examinador cria registros');
    const b = await readJson(req);
    if (!db.pacientes.some((p) => p.id === b.pacienteId)) return fail(res, 400, 'Paciente inválido');
    const r = {
      id: id(), pacienteId: b.pacienteId, local: str(b.local, 100),
      observacoes: str(b.observacoes, 1000), status: 'rascunho', foto: null,
      criadoPor: user.id, criadoPorNome: user.nome, criadoEm: now(),
      enviadoEm: null, avaliacao: null,
    };
    db.registros.push(r); save();
    return send(res, 201, withPaciente(r));
  }
  if ((m = pathname.match(/^\/api\/registros\/(\w+)$/)) && method === 'GET') {
    const r = db.registros.find((x) => x.id === m[1]);
    if (!r || (isEstoma && r.status === 'rascunho')) return fail(res, 404, 'Registro não encontrado');
    return send(res, 200, withPaciente(r));
  }
  if ((m = pathname.match(/^\/api\/registros\/(\w+)\/foto$/)) && method === 'PUT') {
    if (!isExam) return fail(res, 403, 'Apenas o examinador envia fotos');
    const r = db.registros.find((x) => x.id === m[1]);
    if (!r) return fail(res, 404, 'Registro não encontrado');
    if (r.status !== 'rascunho') return fail(res, 409, 'Registro já enviado; não é possível trocar a foto');
    const type = (req.headers['content-type'] || '').split(';')[0];
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
    if (!ext) return fail(res, 415, 'Use imagem JPEG, PNG ou WebP');
    const buf = await readBody(req, MAX_PHOTO);
    if (!buf.length) return fail(res, 400, 'Imagem vazia');
    if (r.foto) fs.rmSync(path.join(PHOTO_DIR, r.foto.arquivo), { force: true });
    const arquivo = `${r.id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(PHOTO_DIR, arquivo), buf);
    r.foto = { arquivo, tipo: type, enviadaEm: now() };
    save();
    return send(res, 200, withPaciente(r));
  }
  if ((m = pathname.match(/^\/api\/registros\/(\w+)\/foto$/)) && method === 'GET') {
    const r = db.registros.find((x) => x.id === m[1]);
    if (!r || !r.foto || (isEstoma && r.status === 'rascunho')) return fail(res, 404, 'Foto não encontrada');
    const buf = fs.readFileSync(path.join(PHOTO_DIR, r.foto.arquivo));
    return send(res, 200, buf, { 'Content-Type': r.foto.tipo, 'Cache-Control': 'private, max-age=3600' });
  }
  if ((m = pathname.match(/^\/api\/registros\/(\w+)\/enviar$/)) && method === 'POST') {
    if (!isExam) return fail(res, 403, 'Apenas o examinador envia para a estomaterapeuta');
    const r = db.registros.find((x) => x.id === m[1]);
    if (!r) return fail(res, 404, 'Registro não encontrado');
    if (r.status !== 'rascunho') return fail(res, 409, 'Registro já foi enviado');
    if (!r.foto) return fail(res, 400, 'Anexe a foto da lesão antes de enviar');
    r.status = 'enviado'; r.enviadoEm = now(); save();
    return send(res, 200, withPaciente(r));
  }
  if ((m = pathname.match(/^\/api\/registros\/(\w+)\/avaliacao$/)) && method === 'POST') {
    if (!isEstoma) return fail(res, 403, 'Apenas a estomaterapeuta avalia');
    const r = db.registros.find((x) => x.id === m[1]);
    if (!r || r.status === 'rascunho') return fail(res, 404, 'Registro não encontrado');
    const b = await readJson(req);
    const tratamento = str(b.tratamento, 2000);
    const orientacoes = str(b.orientacoes, 2000);
    if (!tratamento || !orientacoes) return fail(res, 400, 'Informe o tratamento e as orientações');
    const estagio = str(b.estagio, 30);
    if (estagio && !ESTAGIOS.includes(estagio)) return fail(res, 400, 'Estágio inválido');
    const retorno = b.retornoDias === '' || b.retornoDias == null ? null : Number(b.retornoDias);
    if (retorno !== null && (!Number.isInteger(retorno) || retorno < 0 || retorno > 365)) return fail(res, 400, 'Prazo de reavaliação inválido');
    r.avaliacao = {
      estagio, tratamento, orientacoes, retornoDias: retorno,
      avaliadoPor: user.id, avaliadoPorNome: user.nome,
      avaliadoEm: now(),
    };
    r.status = 'avaliado'; save();
    return send(res, 200, withPaciente(r));
  }

  return fail(res, 404, 'Rota não encontrada');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'Erro interno');
    if (!e.status) console.error(e);
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Lesões por pressão: http://localhost:${port}`));
}
