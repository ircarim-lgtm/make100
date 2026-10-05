// Servidor sem dependências externas: HTTP + SQLite (node:sqlite) + fotos em disco.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { openStorage } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || !!process.env.VERCEL;
const MAX_PHOTO = 4 * 1024 * 1024; // limite de corpo das funções da Vercel é 4,5 MB
const SESSION_MS = 12 * 60 * 60 * 1000;
if (process.env.VERCEL) {
  const falta = [(!process.env.DATABASE_URL && !process.env.POSTGRES_URL) && 'banco Postgres (DATABASE_URL)', !process.env.BLOB_READ_WRITE_TOKEN && 'Vercel Blob (BLOB_READ_WRITE_TOKEN)'].filter(Boolean);
  if (falta.length) throw new Error(`Configuração incompleta na Vercel: conecte ao projeto o(s) recurso(s): ${falta.join(', ')}.`);
}
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = await openDb(path.join(DATA_DIR, 'lesoes.db'));
const storage = await openStorage(PHOTO_DIR);

// ---------- Utilidades ----------
const id = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
const checkPw = (pw, stored) => {
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash(pw, salt).split(':')[1], 'hex'), Buffer.from(h, 'hex'));
};
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const senhaValida = (s) => typeof s === 'string' && s.length >= 8 && s.length <= 200;
const PERFIS = ['admin', 'examinador', 'estomaterapeuta'];
const ESTAGIOS = ['1', '2', '3', '4', 'nao_classificavel', 'tissular_profunda'];
const STATUS = ['rascunho', 'enviado', 'avaliado'];

const audit = async (user, acao, alvo = null) =>
  await db.run('INSERT INTO auditoria (em, user_id, user_nome, acao, alvo) VALUES (?,?,?,?,?)', now(), user?.id ?? null, user?.nome ?? null, acao, alvo);

// Aviso opcional por webhook (Slack/Teams/Discord...). Nunca envia dados do paciente.
const notify = async (text) => {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(3000) }); } catch { /* aviso é opcional */ }
};

// ---------- Usuários iniciais ----------
async function seed() {
  if (await db.get('SELECT 1 x FROM users LIMIT 1')) return;
  const add = async (nome, login, senha, perfil) =>
    await db.run('INSERT INTO users (id,nome,login,senha,perfil,criado_em) VALUES (?,?,?,?,?,?) ON CONFLICT (login) DO NOTHING', id(), nome, login, hash(senha), perfil, now());
  if (PROD) {
    const pw = process.env.ADMIN_PASSWORD;
    if (!senhaValida(pw) || pw.length < 10) { console.error('Defina ADMIN_PASSWORD (mín. 10 caracteres) para o primeiro acesso em produção.'); process.exit(1); }
    await add('Administrador', 'admin', pw, 'admin');
  } else {
    await add('Administrador (demo)', 'admin', 'admin1234', 'admin');
    await add('Enf. Examinador (demo)', 'examinador', 'exam1234', 'examinador');
    await add('Estomaterapeuta (demo)', 'estomaterapeuta', 'estoma1234', 'estomaterapeuta');
  }
}
await seed();

// ---------- HTTP ----------
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
  ...(PROD ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};
const send = (res, status, body, headers = {}) => {
  const buf = Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': buf ? 'application/octet-stream' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...headers });
  res.end(buf ? body : JSON.stringify(body));
};
const fail = (res, status, erro) => send(res, status, { erro });
// Na Vercel o corpo pode já ter sido lido pelo runtime (req.body); nesse caso usamos esse valor.
const bodyPronto = (req, limit) => {
  const b = req.body;
  if (b == null || b === '') return Buffer.alloc(0);
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(typeof b === 'string' ? b : JSON.stringify(b));
  if (buf.length > limit) throw Object.assign(new Error('Arquivo muito grande'), { status: 413 });
  return buf;
};
const readBody = (req, limit) => new Promise((resolve, reject) => {
  if (req.readableEnded) { try { return resolve(bodyPronto(req, limit)); } catch (e) { return reject(e); } }
  const chunks = []; let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) { reject(Object.assign(new Error('Arquivo muito grande'), { status: 413 })); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (!chunks.length) { try { return resolve(bodyPronto(req, limit)); } catch (e) { return reject(e); } }
    resolve(Buffer.concat(chunks));
  });
  req.on('error', reject);
});
const readJson = async (req) => {
  const buf = await readBody(req, 1024 * 1024);
  try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
};
const clientIp = (req) => (TRUST_PROXY && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;

// Bloqueio de força bruta no login: 5 falhas => 15 min
const MAX_TENT = 5, BLOQUEIO_MS = 15 * 60 * 1000;

// ---------- Mapeamento ----------
const pacOut = (p) => ({
  id: p.id, nome: p.nome, prontuario: p.prontuario, dataNascimento: p.data_nascimento, sexo: p.sexo, leito: p.leito,
  comorbidades: p.comorbidades, braden: p.braden, consentimentoPor: p.consentimento_por, consentimentoEm: p.consentimento_em,
  criadoEm: p.criado_em, totalRegistros: p.total,
});
const REG_SQL = 'SELECT r.*, p.nome p_nome, p.prontuario p_pront, p.leito p_leito FROM registros r JOIN pacientes p ON p.id = r.paciente_id';
const regOut = (r, user) => ({
  id: r.id, pacienteId: r.paciente_id, local: r.local, observacoes: r.observacoes, status: r.status,
  foto: r.foto_arquivo ? { tipo: r.foto_tipo, enviadaEm: r.foto_em } : null,
  criadoPor: r.criado_por, criadoPorNome: r.criado_por_nome, criadoEm: r.criado_em, enviadoEm: r.enviado_em,
  avaliacao: r.avaliacao ? JSON.parse(r.avaliacao) : null,
  novo: user.perfil === 'examinador' && r.status === 'avaliado' && !r.avaliacao_visto && r.criado_por === user.id,
  paciente: { id: r.paciente_id, nome: r.p_nome, prontuario: r.p_pront, leito: r.p_leito },
});
const userOut = (u) => ({ id: u.id, nome: u.nome, login: u.login, perfil: u.perfil, ativo: !!u.ativo, criadoEm: u.criado_em });

const sigOk = (b, t) => t === 'image/jpeg' ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  : t === 'image/png' ? b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';

const authUser = async (req) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return null;
  return await db.get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1', sha(token), Date.now()) || null;
};
const startSession = async (userId) => {
  await db.run('DELETE FROM sessions WHERE expira_em < ?', Date.now());
  const token = crypto.randomBytes(24).toString('hex');
  await db.run('INSERT INTO sessions VALUES (?,?,?)', sha(token), userId, Date.now() + SESSION_MS);
  return token;
};

// ---------- Rotas ----------
async function handleApi(req, res, url) {
  const { pathname } = url, method = req.method;
  let m;

  if (method === 'POST' && pathname === '/api/login') {
    const { login, senha } = await readJson(req);
    const key = sha(`${clientIp(req)}|${str(login, 60).toLowerCase()}`);
    const t = await db.get('SELECT n, ate FROM tentativas WHERE chave = ?', key);
    const ativa = t && Number(t.ate) > Date.now();
    if (ativa && t.n >= MAX_TENT) return fail(res, 429, 'Muitas tentativas. Aguarde 15 minutos.');
    const u = await db.get('SELECT * FROM users WHERE login = ? AND ativo = 1', str(login, 60));
    if (!u || typeof senha !== 'string' || !checkPw(senha, u.senha)) {
      await db.run('INSERT INTO tentativas (chave, n, ate) VALUES (?,?,?) ON CONFLICT (chave) DO UPDATE SET n = excluded.n, ate = excluded.ate', key, (ativa ? t.n : 0) + 1, Date.now() + BLOQUEIO_MS);
      await audit(null, 'login_falhou', str(login, 60));
      return fail(res, 401, 'Usuário ou senha inválidos');
    }
    await db.run('DELETE FROM tentativas WHERE chave = ?', key);
    await audit(u, 'login');
    return send(res, 200, { token: await startSession(u.id), usuario: userOut(u) });
  }

  const user = await authUser(req);
  if (!user) return fail(res, 401, 'Não autenticado');
  const perfil = user.perfil;
  const isAdmin = perfil === 'admin', isExam = perfil === 'examinador', isEstoma = perfil === 'estomaterapeuta';
  const clinico = isExam || isEstoma;
  const deny = (msg, ok) => (ok ? false : (fail(res, 403, msg), true));

  if (method === 'GET' && pathname === '/api/me') return send(res, 200, userOut(user));
  if (method === 'POST' && pathname === '/api/logout') {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', sha((req.headers.authorization || '').replace(/^Bearer /, '')));
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && pathname === '/api/me/senha') {
    const { atual, nova } = await readJson(req);
    if (typeof atual !== 'string' || !checkPw(atual, user.senha)) return fail(res, 400, 'Senha atual incorreta');
    if (!senhaValida(nova)) return fail(res, 400, 'A nova senha deve ter ao menos 8 caracteres');
    await db.run('UPDATE users SET senha = ? WHERE id = ?', hash(nova), user.id);
    const cur = sha((req.headers.authorization || '').replace(/^Bearer /, ''));
    await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', user.id, cur);
    await audit(user, 'senha_alterada');
    return send(res, 200, { ok: true });
  }

  // Avisos (contadores consultados periodicamente pelo app)
  if (method === 'GET' && pathname === '/api/notificacoes') {
    if (isEstoma) return send(res, 200, { total: Number((await db.get("SELECT COUNT(*) n FROM registros WHERE status = 'enviado'")).n), tipo: 'casos' });
    if (isExam) return send(res, 200, { total: Number((await db.get("SELECT COUNT(*) n FROM registros WHERE status = 'avaliado' AND avaliacao_visto = 0 AND criado_por = ?", user.id)).n), tipo: 'devolutivas' });
    return send(res, 200, { total: 0, tipo: '' });
  }

  // ----- Administração -----
  if (pathname.startsWith('/api/usuarios') || pathname === '/api/auditoria') {
    if (deny('Apenas o administrador', isAdmin)) return;
    if (method === 'GET' && pathname === '/api/usuarios') return send(res, 200, (await db.all('SELECT * FROM users ORDER BY nome')).map(userOut));
    if (method === 'GET' && pathname === '/api/auditoria') return send(res, 200, await db.all('SELECT * FROM auditoria ORDER BY id DESC LIMIT 200'));
    if (method === 'POST' && pathname === '/api/usuarios') {
      const b = await readJson(req);
      const nome = str(b.nome, 120), login = str(b.login, 60).toLowerCase();
      if (!nome || !/^[a-z0-9._-]{3,60}$/.test(login)) return fail(res, 400, 'Informe nome e login (3+ letras minúsculas, números, . _ -)');
      if (!PERFIS.includes(b.perfil)) return fail(res, 400, 'Perfil inválido');
      if (!senhaValida(b.senha)) return fail(res, 400, 'A senha deve ter ao menos 8 caracteres');
      if (await db.get('SELECT 1 x FROM users WHERE login = ?', login)) return fail(res, 409, 'Login já existe');
      const uid = id();
      await db.run('INSERT INTO users (id,nome,login,senha,perfil,criado_em) VALUES (?,?,?,?,?,?)', uid, nome, login, hash(b.senha), b.perfil, now());
      await audit(user, 'usuario_criado', `${login} (${b.perfil})`);
      return send(res, 201, userOut(await db.get('SELECT * FROM users WHERE id = ?', uid)));
    }
    if ((m = pathname.match(/^\/api\/usuarios\/(\w+)$/)) && method === 'PATCH') {
      const u = await db.get('SELECT * FROM users WHERE id = ?', m[1]);
      if (!u) return fail(res, 404, 'Usuário não encontrado');
      const b = await readJson(req);
      if (u.id === user.id && (b.ativo === false || (b.perfil && b.perfil !== u.perfil))) return fail(res, 400, 'Você não pode desativar nem rebaixar a si mesmo');
      if (b.perfil !== undefined && !PERFIS.includes(b.perfil)) return fail(res, 400, 'Perfil inválido');
      if (b.senha !== undefined && !senhaValida(b.senha)) return fail(res, 400, 'A senha deve ter ao menos 8 caracteres');
      const nome = b.nome !== undefined ? str(b.nome, 120) : u.nome;
      if (!nome) return fail(res, 400, 'Nome inválido');
      await db.run('UPDATE users SET nome=?, perfil=?, ativo=?, senha=? WHERE id=?', nome, b.perfil ?? u.perfil,
        b.ativo === undefined ? u.ativo : (b.ativo ? 1 : 0), b.senha ? hash(b.senha) : u.senha, u.id);
      if (b.ativo === false || b.senha) await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
      await audit(user, 'usuario_alterado', u.login);
      return send(res, 200, userOut(await db.get('SELECT * FROM users WHERE id = ?', u.id)));
    }
  }

  // ----- Pacientes -----
  if (pathname === '/api/pacientes' && method === 'GET') {
    const q = `%${(url.searchParams.get('q') || '').toLowerCase()}%`;
    if (isAdmin) return send(res, 200, await db.all('SELECT id, nome, prontuario FROM pacientes WHERE lower(nome) LIKE ? OR lower(prontuario) LIKE ? ORDER BY nome LIMIT 200', q, q));
    const filtro = isEstoma ? "AND r.status != 'rascunho'" : '';
    const rows = await db.all(`SELECT p.*, CAST((SELECT COUNT(*) FROM registros r WHERE r.paciente_id = p.id ${filtro}) AS INTEGER) total
      FROM pacientes p WHERE lower(p.nome) LIKE ? OR lower(p.prontuario) LIKE ? ORDER BY p.nome LIMIT 200`, q, q);
    return send(res, 200, rows.map(pacOut));
  }
  if (pathname === '/api/pacientes' && method === 'POST') {
    if (deny('Apenas o examinador cadastra pacientes', isExam)) return;
    const b = await readJson(req);
    const nome = str(b.nome, 120), prontuario = str(b.prontuario, 40), consPor = str(b.consentimentoPor, 120);
    if (!nome || !prontuario) return fail(res, 400, 'Nome e prontuário são obrigatórios');
    if (b.consentimento !== true || !consPor) return fail(res, 400, 'É necessário registrar o consentimento (paciente ou responsável legal)');
    if (await db.get('SELECT 1 x FROM pacientes WHERE prontuario = ?', prontuario)) return fail(res, 409, 'Prontuário já cadastrado');
    const nasc = str(b.dataNascimento, 10);
    if (nasc && !/^\d{4}-\d{2}-\d{2}$/.test(nasc)) return fail(res, 400, 'Data de nascimento inválida');
    const pid = id();
    await db.run('INSERT INTO pacientes VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', pid, nome, prontuario, nasc, str(b.sexo, 20), str(b.leito, 40),
      str(b.comorbidades, 500), str(b.braden, 5), consPor, now(), user.id, now());
    await audit(user, 'paciente_criado', prontuario);
    return send(res, 201, pacOut(await db.get('SELECT p.*, 0 total FROM pacientes p WHERE id = ?', pid)));
  }
  if ((m = pathname.match(/^\/api\/pacientes\/(\w+)$/))) {
    const p = await db.get('SELECT p.*, 0 total FROM pacientes p WHERE id = ?', m[1]);
    if (!p) return fail(res, 404, 'Paciente não encontrado');
    if (method === 'GET') {
      if (deny('Sem acesso', clinico)) return;
      const filtro = isEstoma ? "AND r.status != 'rascunho'" : '';
      const regs = (await db.all(`${REG_SQL} WHERE r.paciente_id = ? ${filtro} ORDER BY r.criado_em DESC`, p.id)).map((r) => regOut(r, user));
      await audit(user, 'paciente_visualizado', p.prontuario);
      return send(res, 200, { ...pacOut(p), registros: regs });
    }
    if (method === 'DELETE') { // direito de eliminação (LGPD)
      if (deny('Apenas o administrador exclui pacientes', isAdmin)) return;
      for (const r of await db.all('SELECT foto_arquivo f FROM registros WHERE paciente_id = ? AND foto_arquivo IS NOT NULL', p.id)) await storage.del(r.f);
      await db.run('DELETE FROM pacientes WHERE id = ?', p.id);
      await audit(user, 'paciente_excluido', p.prontuario);
      return send(res, 200, { ok: true });
    }
  }

  // ----- Registros de lesão -----
  if (pathname.startsWith('/api/registros')) {
    if (deny('Sem acesso', clinico)) return;
    const visivel = (r) => r && !(isEstoma && r.status === 'rascunho');
    if (pathname === '/api/registros' && method === 'GET') {
      const status = url.searchParams.get('status');
      const where = [], params = [];
      if (STATUS.includes(status)) { where.push('r.status = ?'); params.push(status); }
      if (isEstoma) where.push("r.status != 'rascunho'");
      const rows = await db.all(`${REG_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(r.enviado_em, r.criado_em) DESC LIMIT 300`, ...params);
      return send(res, 200, rows.map((r) => regOut(r, user)));
    }
    if (pathname === '/api/registros' && method === 'POST') {
      if (deny('Apenas o examinador cria registros', isExam)) return;
      const b = await readJson(req);
      if (!await db.get('SELECT 1 x FROM pacientes WHERE id = ?', b.pacienteId)) return fail(res, 400, 'Paciente inválido');
      const rid = id();
      await db.run("INSERT INTO registros (id,paciente_id,local,observacoes,status,criado_por,criado_por_nome,criado_em) VALUES (?,?,?,?, 'rascunho',?,?,?)",
        rid, b.pacienteId, str(b.local, 100), str(b.observacoes, 1000), user.id, user.nome, now());
      await audit(user, 'registro_criado', rid);
      return send(res, 201, regOut(await db.get(`${REG_SQL} WHERE r.id = ?`, rid), user));
    }
    if ((m = pathname.match(/^\/api\/registros\/(\w+)(?:\/(foto|enviar|avaliacao))?$/))) {
      const r = await db.get(`${REG_SQL} WHERE r.id = ?`, m[1]);
      const sub = m[2];
      if (!visivel(r)) return fail(res, 404, 'Registro não encontrado');
      const reload = async () => regOut(await db.get(`${REG_SQL} WHERE r.id = ?`, r.id), user);

      if (!sub && method === 'GET') {
        if (isExam && r.status === 'avaliado' && !r.avaliacao_visto && r.criado_por === user.id) {
          await db.run('UPDATE registros SET avaliacao_visto = 1 WHERE id = ?', r.id);
        }
        return send(res, 200, regOut(r, user)); // 'novo' reflete o estado antes de marcar como visto
      }
      if (!sub && method === 'DELETE') {
        if (deny('Apenas o examinador exclui rascunhos', isExam)) return;
        if (r.status !== 'rascunho') return fail(res, 409, 'Só é possível excluir rascunhos');
        if (r.foto_arquivo) await storage.del(r.foto_arquivo);
        await db.run('DELETE FROM registros WHERE id = ?', r.id);
        await audit(user, 'rascunho_excluido', r.id);
        return send(res, 200, { ok: true });
      }
      if (sub === 'foto' && method === 'PUT') {
        if (deny('Apenas o examinador envia fotos', isExam)) return;
        if (r.status !== 'rascunho') return fail(res, 409, 'Registro já enviado; não é possível trocar a foto');
        const type = (req.headers['content-type'] || '').split(';')[0];
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
        if (!ext) return fail(res, 415, 'Use imagem JPEG, PNG ou WebP');
        const buf = await readBody(req, MAX_PHOTO);
        if (!buf.length || !sigOk(buf, type)) return fail(res, 400, 'Arquivo de imagem inválido');
        const arquivo = await storage.put(`${r.id}-${Date.now()}.${ext}`, buf, type);
        if (r.foto_arquivo) await storage.del(r.foto_arquivo);
        await db.run('UPDATE registros SET foto_arquivo=?, foto_tipo=?, foto_em=? WHERE id=?', arquivo, type, now(), r.id);
        await audit(user, 'foto_anexada', r.id);
        return send(res, 200, await reload());
      }
      if (sub === 'foto' && method === 'GET') {
        if (!r.foto_arquivo) return fail(res, 404, 'Foto não encontrada');
        await audit(user, 'foto_visualizada', r.id);
        return send(res, 200, await storage.get(r.foto_arquivo), { 'Content-Type': r.foto_tipo, 'Cache-Control': 'private, max-age=300' });
      }
      if (sub === 'enviar' && method === 'POST') {
        if (deny('Apenas o examinador envia para a estomaterapeuta', isExam)) return;
        if (r.status !== 'rascunho') return fail(res, 409, 'Registro já foi enviado');
        if (!r.foto_arquivo) return fail(res, 400, 'Anexe a foto da lesão antes de enviar');
        await db.run("UPDATE registros SET status='enviado', enviado_em=? WHERE id=?", now(), r.id);
        await audit(user, 'registro_enviado', r.id);
        await notify('Novo caso de lesão por pressão aguardando avaliação da estomaterapeuta.');
        return send(res, 200, await reload());
      }
      if (sub === 'avaliacao' && method === 'POST') {
        if (deny('Apenas a estomaterapeuta avalia', isEstoma)) return;
        if (r.status !== 'enviado') return fail(res, 409, 'Este caso já foi avaliado');
        const b = await readJson(req);
        const tratamento = str(b.tratamento, 2000), orientacoes = str(b.orientacoes, 2000), estagio = str(b.estagio, 30);
        if (!tratamento || !orientacoes) return fail(res, 400, 'Informe o tratamento e as orientações');
        if (estagio && !ESTAGIOS.includes(estagio)) return fail(res, 400, 'Estágio inválido');
        const ret = b.retornoDias === '' || b.retornoDias == null ? null : Number(b.retornoDias);
        if (ret !== null && (!Number.isInteger(ret) || ret < 0 || ret > 365)) return fail(res, 400, 'Prazo de reavaliação inválido');
        const av = { estagio, tratamento, orientacoes, retornoDias: ret, avaliadoPor: user.id, avaliadoPorNome: user.nome, avaliadoEm: now() };
        await db.run("UPDATE registros SET status='avaliado', avaliacao=?, avaliacao_visto=0 WHERE id=?", JSON.stringify(av), r.id);
        await audit(user, 'avaliacao', r.id);
        await notify('Uma devolutiva da estomaterapeuta está disponível.');
        return send(res, 200, await reload());
      }
    }
  }

  return fail(res, 404, 'Rota não encontrada');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export const handler = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, SEC); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'Erro interno');
    if (!e.status) console.error(e);
  }
};
export const server = http.createServer(handler);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Lesões por pressão: http://localhost:${port}`));
}
