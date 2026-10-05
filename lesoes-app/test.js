import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lesoes-'));
const { server } = await import('./server.js');
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/api`;

const call = async (p, { token, method = 'GET', body, type } = {}) => {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  let payload = body;
  if (body && !Buffer.isBuffer(body)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (type) headers['Content-Type'] = type;
  const r = await fetch(base + p, { method, headers, body: payload });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};

const login = async (l, s) => (await call('/login', { method: 'POST', body: { login: l, senha: s } }));
assert.equal((await login('examinador', 'errada')).status, 401);
const ex = (await login('examinador', 'exam123')).data.token;
const es = (await login('estomaterapeuta', 'estoma123')).data.token;
assert.equal((await call('/pacientes')).status, 401);

// cadastro de paciente
assert.equal((await call('/pacientes', { token: es, method: 'POST', body: { nome: 'x', prontuario: '1' } })).status, 403);
assert.equal((await call('/pacientes', { token: ex, method: 'POST', body: { nome: 'Maria' } })).status, 400);
const pac = (await call('/pacientes', { token: ex, method: 'POST', body: { nome: 'Maria Silva', prontuario: '123', leito: '12A' } })).data;
assert.equal((await call('/pacientes', { token: ex, method: 'POST', body: { nome: 'Outra', prontuario: '123' } })).status, 409);

// registro: rascunho invisível à estomaterapeuta
const reg = (await call('/registros', { token: ex, method: 'POST', body: { pacienteId: pac.id, local: 'sacral' } })).data;
assert.equal(reg.status, 'rascunho');
assert.equal((await call('/registros/' + reg.id, { token: es })).status, 404);
assert.equal((await call('/registros', { token: es })).data.length, 0);

// não envia sem foto
assert.equal((await call(`/registros/${reg.id}/enviar`, { token: ex, method: 'POST' })).status, 400);
assert.equal((await call(`/registros/${reg.id}/foto`, { token: ex, method: 'PUT', body: Buffer.from('abc'), type: 'text/html' })).status, 415);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
assert.equal((await call(`/registros/${reg.id}/foto`, { token: ex, method: 'PUT', body: jpg, type: 'image/jpeg' })).status, 200);
assert.deepEqual((await call(`/registros/${reg.id}/foto`, { token: ex })).data, jpg);

// enviar para estomaterapeuta
assert.equal((await call(`/registros/${reg.id}/enviar`, { token: ex, method: 'POST' })).data.status, 'enviado');
assert.equal((await call(`/registros/${reg.id}/enviar`, { token: ex, method: 'POST' })).status, 409);
assert.equal((await call(`/registros/${reg.id}/foto`, { token: ex, method: 'PUT', body: jpg, type: 'image/jpeg' })).status, 409);
assert.equal((await call('/registros?status=enviado', { token: es })).data.length, 1);

// devolutiva
assert.equal((await call(`/registros/${reg.id}/avaliacao`, { token: ex, method: 'POST', body: { tratamento: 'a', orientacoes: 'b' } })).status, 403);
assert.equal((await call(`/registros/${reg.id}/avaliacao`, { token: es, method: 'POST', body: { tratamento: 'a' } })).status, 400);
const av = await call(`/registros/${reg.id}/avaliacao`, { token: es, method: 'POST', body: { estagio: '2', tratamento: 'Hidrocoloide a cada 3 dias', orientacoes: 'Mudança de decúbito 2/2h', retornoDias: 7 } });
assert.equal(av.data.status, 'avaliado');
const visto = (await call('/registros/' + reg.id, { token: ex })).data;
assert.equal(visto.avaliacao.tratamento, 'Hidrocoloide a cada 3 dias');

// histórico do paciente
assert.equal((await call('/pacientes/' + pac.id, { token: ex })).data.registros.length, 1);
console.log('OK: todos os testes passaram');
server.close();
