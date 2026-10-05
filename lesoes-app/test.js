import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesoes-'));
process.env.DATA_DIR = dir;
const { server } = await import('./server.js');
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const call = async (p, { token, method = 'GET', body, type } = {}) => {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  let payload = body;
  if (body && !Buffer.isBuffer(body)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (type) headers['Content-Type'] = type;
  const r = await fetch(base + '/api' + p, { method, headers, body: payload });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const login = (l, s) => call('/login', { method: 'POST', body: { login: l, senha: s } });
const tok = async (l, s) => (await login(l, s)).data.token;
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const PAC = { nome: 'Maria Silva', prontuario: '123', leito: '12A', consentimento: true, consentimentoPor: 'a própria paciente' };

// --- login e segurança básica
assert.equal((await login('examinador', 'errada')).status, 401);
const ex = await tok('examinador', 'exam1234'), es = await tok('estomaterapeuta', 'estoma1234'), ad = await tok('admin', 'admin1234');
assert.equal((await call('/pacientes')).status, 401);
const home = await fetch(base + '/');
assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
assert.equal((await fetch(base + '/manifest.webmanifest')).status, 200);
assert.equal((await fetch(base + '/..%2fserver.js')).status, 404);

// --- consentimento e cadastro
assert.equal((await call('/pacientes', { token: es, method: 'POST', body: PAC })).status, 403);
assert.equal((await call('/pacientes', { token: ex, method: 'POST', body: { nome: 'Maria' } })).status, 400);
assert.equal((await call('/pacientes', { token: ex, method: 'POST', body: { ...PAC, consentimento: false } })).status, 400);
const pac = (await call('/pacientes', { token: ex, method: 'POST', body: PAC })).data;
assert.equal(pac.consentimentoPor, 'a própria paciente');
assert.equal((await call('/pacientes', { token: ex, method: 'POST', body: { ...PAC, nome: 'Outra' } })).status, 409);

// --- rascunho invisível à estomaterapeuta (inclusive pelo paciente)
const reg = (await call('/registros', { token: ex, method: 'POST', body: { pacienteId: pac.id, local: 'sacral' } })).data;
assert.equal(reg.status, 'rascunho');
assert.equal((await call('/registros/' + reg.id, { token: es })).status, 404);
assert.equal((await call('/registros', { token: es })).data.length, 0);
assert.equal((await call('/pacientes/' + pac.id, { token: es })).data.registros.length, 0);
assert.equal((await call('/notificacoes', { token: es })).data.total, 0);

// --- foto
assert.equal((await call(`/registros/${reg.id}/enviar`, { token: ex, method: 'POST' })).status, 400);
assert.equal((await call(`/registros/${reg.id}/foto`, { token: ex, method: 'PUT', body: Buffer.from('abc'), type: 'text/html' })).status, 415);
assert.equal((await call(`/registros/${reg.id}/foto`, { token: ex, method: 'PUT', body: Buffer.from('não sou jpeg'), type: 'image/jpeg' })).status, 400);
assert.equal((await call(`/registros/${reg.id}/foto`, { token: ex, method: 'PUT', body: jpg, type: 'image/jpeg' })).status, 200);
assert.deepEqual((await call(`/registros/${reg.id}/foto`, { token: ex })).data, jpg);

// --- envio e aviso
assert.equal((await call(`/registros/${reg.id}/enviar`, { token: ex, method: 'POST' })).data.status, 'enviado');
assert.equal((await call(`/registros/${reg.id}/enviar`, { token: ex, method: 'POST' })).status, 409);
assert.equal((await call(`/registros/${reg.id}/foto`, { token: ex, method: 'PUT', body: jpg, type: 'image/jpeg' })).status, 409);
assert.equal((await call(`/registros/${reg.id}`, { token: ex, method: 'DELETE' })).status, 409);
assert.equal((await call('/notificacoes', { token: es })).data.total, 1);
assert.equal((await call('/registros?status=enviado', { token: es })).data.length, 1);

// --- devolutiva e aviso ao examinador
assert.equal((await call(`/registros/${reg.id}/avaliacao`, { token: ex, method: 'POST', body: { tratamento: 'a', orientacoes: 'b' } })).status, 403);
assert.equal((await call(`/registros/${reg.id}/avaliacao`, { token: es, method: 'POST', body: { tratamento: 'a' } })).status, 400);
const av = await call(`/registros/${reg.id}/avaliacao`, { token: es, method: 'POST', body: { estagio: '2', tratamento: 'Hidrocoloide a cada 3 dias', orientacoes: 'Mudança de decúbito 2/2h', retornoDias: 7 } });
assert.equal(av.data.status, 'avaliado');
assert.equal((await call(`/registros/${reg.id}/avaliacao`, { token: es, method: 'POST', body: { tratamento: 'x', orientacoes: 'y' } })).status, 409);
assert.equal((await call('/notificacoes', { token: ex })).data.total, 1);
const visto = (await call('/registros/' + reg.id, { token: ex })).data;
assert.equal(visto.avaliacao.tratamento, 'Hidrocoloide a cada 3 dias');
assert.equal(visto.novo, true);
assert.equal((await call('/notificacoes', { token: ex })).data.total, 0); // marcado como visto
assert.equal((await call('/registros/' + reg.id, { token: ex })).data.novo, false);

// --- rascunho pode ser excluído (e a foto some)
const r2 = (await call('/registros', { token: ex, method: 'POST', body: { pacienteId: pac.id, local: 'calcâneo' } })).data;
await call(`/registros/${r2.id}/foto`, { token: ex, method: 'PUT', body: jpg, type: 'image/jpeg' });
assert.equal((await call('/registros/' + r2.id, { token: ex, method: 'DELETE' })).status, 200);
assert.equal(fs.readdirSync(path.join(dir, 'photos')).length, 1);

// --- administrador: sem acesso clínico, gerencia usuários
assert.equal((await call('/registros', { token: ad })).status, 403);
assert.equal((await call('/pacientes/' + pac.id, { token: ad })).status, 403);
assert.equal((await call('/usuarios', { token: ex })).status, 403);
assert.equal((await call('/usuarios', { token: ad, method: 'POST', body: { nome: 'Nova', login: 'nova', perfil: 'examinador', senha: 'curta' } })).status, 400);
const nu = (await call('/usuarios', { token: ad, method: 'POST', body: { nome: 'Nova Enf.', login: 'nova', perfil: 'examinador', senha: 'senhaboa123' } })).data;
assert.equal((await call('/usuarios', { token: ad, method: 'POST', body: { nome: 'Dup', login: 'nova', perfil: 'examinador', senha: 'senhaboa123' } })).status, 409);
const tn = await tok('nova', 'senhaboa123');
assert.ok(tn);
assert.equal((await call('/usuarios/' + nu.id, { token: ad, method: 'PATCH', body: { ativo: false } })).status, 200);
assert.equal((await call('/me', { token: tn })).status, 401); // sessão derrubada
assert.equal((await login('nova', 'senhaboa123')).status, 401);
const meId = (await call('/me', { token: ad })).data.id;
assert.equal((await call('/usuarios/' + meId, { token: ad, method: 'PATCH', body: { ativo: false } })).status, 400);

// --- troca de senha própria
assert.equal((await call('/me/senha', { token: ex, method: 'POST', body: { atual: 'errada', nova: 'novasenha1' } })).status, 400);
assert.equal((await call('/me/senha', { token: ex, method: 'POST', body: { atual: 'exam1234', nova: 'novasenha1' } })).status, 200);
assert.equal((await login('examinador', 'exam1234')).status, 401);
assert.equal((await login('examinador', 'novasenha1')).status, 200);

// --- auditoria registra acessos
const aud = (await call('/auditoria', { token: ad })).data.map((a) => a.acao);
for (const a of ['login', 'login_falhou', 'paciente_criado', 'foto_visualizada', 'registro_enviado', 'avaliacao', 'usuario_criado']) assert.ok(aud.includes(a), a);

// --- exclusão de paciente (LGPD) remove registros e fotos
assert.equal((await call('/pacientes/' + pac.id, { token: es, method: 'DELETE' })).status, 403);
assert.equal((await call('/pacientes/' + pac.id, { token: ad, method: 'DELETE' })).status, 200);
assert.equal(fs.readdirSync(path.join(dir, 'photos')).length, 0);
assert.equal((await call('/registros', { token: ex })).data.length, 0);

// --- bloqueio por força bruta
for (let i = 0; i < 5; i++) await login('estomaterapeuta', 'x' + i);
assert.equal((await login('estomaterapeuta', 'estoma1234')).status, 429);

console.log('OK: todos os testes passaram');
server.close();
