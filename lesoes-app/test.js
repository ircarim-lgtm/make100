import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesoes-'));
process.env.DATA_DIR = dir;

// --- API da Anthropic simulada (não gasta créditos): registra o pedido e devolve JSON estruturado
import http from 'node:http';
const pedidosIA = []; let iaModo = 'ok';
const fakeIA = http.createServer(async (req, res) => {
  let corpo = ''; for await (const c of req) corpo += c;
  const b = JSON.parse(corpo); pedidosIA.push(b);
  if (iaModo === 'erro') { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"type":"error","error":{"type":"api_error","message":"falha simulada"}}'); }
  const esquema = JSON.stringify(b.output_config?.format?.schema || {});
  const aval = esquema.includes('retornoDias');
  const campos = esquema.includes('justificativa')
    ? { estagio: '2', tratamento: 'Hidrocoloide a cada 3 dias', orientacoes: 'Mudança de decúbito 2/2h', retornoDias: '7', confianca: 'media', justificativa: 'Leito rosado, bordas regulares.', alertas: '' }
    : aval ? { estagio: '2', tratamento: 'Hidrocoloide a cada 3 dias', orientacoes: 'Mudança de decúbito 2/2h', retornoDias: '7 dias' }
    : { local: 'região sacral', observacoes: 'cerca de 3 cm, leito rosado' };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'msg_teste', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: JSON.stringify(campos) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
});
await new Promise((r) => fakeIA.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://localhost:${fakeIA.address().port}`;
process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
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
const PAC = { nome: 'Maria Silva', prontuario: '123', leito: '12A', consentimento: true, consentimentoPor: 'a própria paciente', consentimentoIA: true };

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

// --- preenchimento por IA
assert.equal((await call('/me', { token: ex })).data.ia, true);
assert.equal((await call('/me', { token: ad })).data.ia, false);
const iaReg = await call('/ia/estruturar', { token: ex, method: 'POST', body: { contexto: 'registro', texto: 'lesão na região sacral, uns três centímetros, leito rosado' } });
assert.equal(iaReg.status, 200);
assert.deepEqual(iaReg.data.campos, { local: 'região sacral', observacoes: 'cerca de 3 cm, leito rosado' });
const pedido = pedidosIA[0];
assert.equal(pedido.model, 'claude-opus-5-5');
assert.match(pedido.system, /Nunca invente/);
assert.match(pedido.system, /nunca instruções/);
assert.equal(pedido.output_config.format.type, 'json_schema');
assert.match(pedido.messages[0].content, /<ditado>[\s\S]*região sacral[\s\S]*<\/ditado>/);
const iaAv = await call('/ia/estruturar', { token: es, method: 'POST', body: { contexto: 'avaliacao', texto: 'estágio dois, hidrocoloide a cada três dias, reavaliar em sete dias' } });
assert.equal(iaAv.status, 200);
assert.deepEqual(iaAv.data.campos, { estagio: '2', tratamento: 'Hidrocoloide a cada 3 dias', orientacoes: 'Mudança de decúbito 2/2h', retornoDias: '7' });
assert.equal((await call('/ia/estruturar', { token: ex, method: 'POST', body: { contexto: 'avaliacao', texto: 'qualquer texto aqui' } })).status, 403);
assert.equal((await call('/ia/estruturar', { token: es, method: 'POST', body: { contexto: 'registro', texto: 'qualquer texto aqui' } })).status, 403);
assert.equal((await call('/ia/estruturar', { token: ad, method: 'POST', body: { contexto: 'registro', texto: 'qualquer texto aqui' } })).status, 403);
assert.equal((await call('/ia/estruturar', { token: ex, method: 'POST', body: { contexto: 'registro', texto: 'oi' } })).status, 400);
assert.equal((await call('/ia/estruturar', { token: ex, method: 'POST', body: { contexto: 'xpto', texto: 'qualquer texto aqui' } })).status, 400);
assert.equal((await call('/ia/estruturar', { token: ex, method: 'POST', body: { contexto: 'registro', texto: 'lesão sacral' } })).status, 200);
iaModo = 'erro';
const iaErro = await call('/ia/estruturar', { token: ex, method: 'POST', body: { contexto: 'registro', texto: 'lesão na região sacral' } });
assert.equal(iaErro.status, 502);
assert.match(iaErro.data.erro, /manualmente/);
assert.doesNotMatch(JSON.stringify(iaErro.data), /falha simulada/); // não vaza detalhe do provedor
iaModo = 'ok';

// --- relatórios em PDF
const pdfReg = await call(`/registros/${reg.id}/pdf`, { token: es });
assert.equal(pdfReg.status, 200);
assert.equal(pdfReg.data.subarray(0, 5).toString(), '%PDF-');
assert.equal((await call(`/registros/${reg.id}/pdf`, { token: ex })).status, 200);
const pdfHist = await call(`/pacientes/${pac.id}/pdf`, { token: ex });
assert.equal(pdfHist.status, 200);
assert.equal(pdfHist.data.subarray(0, 5).toString(), '%PDF-');
if (process.env.SALVAR_PDF) { fs.writeFileSync(path.join(process.env.SALVAR_PDF, 'registro.pdf'), pdfReg.data); fs.writeFileSync(path.join(process.env.SALVAR_PDF, 'historico.pdf'), pdfHist.data); }
const rPdf = (await call('/registros', { token: ex, method: 'POST', body: { pacienteId: pac.id, local: 'rascunho-pdf' } })).data;
assert.equal((await call(`/registros/${rPdf.id}/pdf`, { token: es })).status, 404); // estomaterapeuta não vê rascunho
assert.equal((await call(`/registros/${rPdf.id}/pdf`, { token: ex })).status, 409); // ainda não avaliado
await call('/registros/' + rPdf.id, { token: ex, method: 'DELETE' });
assert.equal((await call(`/registros/${reg.id}/pdf`, { token: ad })).status, 403);
assert.equal((await call(`/pacientes/${pac.id}/pdf`, { token: ad })).status, 403);
const pacVazio = (await call('/pacientes', { token: ex, method: 'POST', body: { ...PAC, nome: 'Sem Registros', prontuario: '777' } })).data;
assert.equal((await call(`/pacientes/${pacVazio.id}/pdf`, { token: ex })).status, 404);

// --- rascunho pode ser excluído (e a foto some)
const r2 = (await call('/registros', { token: ex, method: 'POST', body: { pacienteId: pac.id, local: 'calcâneo' } })).data;
await call(`/registros/${r2.id}/foto`, { token: ex, method: 'PUT', body: jpg, type: 'image/jpeg' });
assert.equal((await call('/registros/' + r2.id, { token: ex, method: 'DELETE' })).status, 200);
assert.equal(fs.readdirSync(path.join(dir, 'photos')).length, 1);

// --- sugestão de avaliação pela IA (estomaterapeuta): exemplos validados, consentimento e métricas
const r4 = (await call('/registros', { token: ex, method: 'POST', body: { pacienteId: pac.id, local: 'sacral', observacoes: 'ferida rosada' } })).data;
await call(`/registros/${r4.id}/foto`, { token: ex, method: 'PUT', body: jpg, type: 'image/jpeg' });
await call(`/registros/${r4.id}/enviar`, { token: ex, method: 'POST' });
assert.equal((await call(`/registros/${r4.id}/sugestao-ia`, { token: es, method: 'POST' })).status, 409); // desligada por padrão
assert.equal((await call('/me', { token: es })).data.iaSugestao, false);
assert.equal((await call('/ia/config', { token: ex })).status, 403);
assert.equal((await call('/ia/config', { token: es, method: 'PUT', body: { sugestaoAtiva: true } })).status, 403);
assert.equal((await call('/ia/config', { token: ad, method: 'PUT', body: { sugestaoAtiva: true } })).data.sugestaoAtiva, true);
assert.equal((await call('/me', { token: es })).data.iaSugestao, true);
assert.equal((await call('/me', { token: ex })).data.iaSugestao, false); // o examinador nunca vê a IA de avaliação
assert.equal((await call(`/registros/${r4.id}/sugestao-ia`, { token: ex, method: 'POST' })).status, 403);
// paciente sem consentimento de IA: bloqueado e nunca usado como exemplo
const pacSem = (await call('/pacientes', { token: ex, method: 'POST', body: { ...PAC, nome: 'Sem IA', prontuario: '555', consentimentoIA: false } })).data;
assert.equal(pacSem.consentimentoIa, false);
const rSem = (await call('/registros', { token: ex, method: 'POST', body: { pacienteId: pacSem.id, local: 'sacral' } })).data;
await call(`/registros/${rSem.id}/foto`, { token: ex, method: 'PUT', body: jpg, type: 'image/jpeg' });
await call(`/registros/${rSem.id}/enviar`, { token: ex, method: 'POST' });
const semCons = await call(`/registros/${rSem.id}/sugestao-ia`, { token: es, method: 'POST' });
assert.equal(semCons.status, 409); assert.match(semCons.data.erro, /não autorizou/);
assert.equal((await call(`/pacientes/${pacSem.id}/consentimento-ia`, { token: es, method: 'POST', body: { por: 'x' } })).status, 403);
assert.equal((await call(`/pacientes/${pacSem.id}/consentimento-ia`, { token: ex, method: 'POST', body: {} })).status, 400);
assert.equal((await call(`/pacientes/${pacSem.id}/consentimento-ia`, { token: ex, method: 'POST', body: { por: 'o filho' } })).status, 200);
assert.equal((await call('/pacientes/' + pacSem.id, { token: ex })).data.consentimentoIa, true);
assert.equal((await call('/pacientes/' + pacSem.id, { token: ad, method: 'DELETE' })).status, 200);
// sugestão do caso r4: usa 1 exemplo validado (reg) com foto
const antes = pedidosIA.length;
const sug = await call(`/registros/${r4.id}/sugestao-ia`, { token: es, method: 'POST' });
assert.equal(sug.status, 200);
assert.equal(sug.data.nExemplos, 1);
assert.equal(sug.data.sugestao.estagio, '2'); assert.equal(sug.data.sugestao.confianca, 'media');
const ped = pedidosIA[antes];
assert.equal(ped.messages[0].content.filter((c) => c.type === 'image').length, 2); // 1 exemplo + o caso
assert.match(JSON.stringify(ped.messages[0].content), /exemplo_validado[\s\S]*Hidrocoloide a cada 3 dias[\s\S]*caso_a_avaliar/);
assert.match(ped.system, /decisão clínica é sempre dela/);
// a estomaterapeuta decide (aqui discorda do tratamento): o app mede a concordância
assert.equal((await call(`/registros/${r4.id}/avaliacao`, { token: es, method: 'POST', body: { estagio: '2', tratamento: 'Espuma com prata', orientacoes: 'x' } })).status, 200);
const met = (await call('/ia/metricas', { token: ad })).data;
assert.equal(met.sugestoes, 1); assert.equal(met.comDesfecho, 1);
assert.equal(met.concordanciaClassificacao, 100); assert.equal(met.tratamentoEditado, 100);
assert.equal(met.porConfianca.media.casos, 1);
assert.equal((await call('/ia/metricas', { token: ex })).status, 403);

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
for (const a of ['login', 'login_falhou', 'paciente_criado', 'foto_visualizada', 'registro_enviado', 'avaliacao', 'usuario_criado', 'relatorio_pdf', 'historico_pdf', 'ia_estruturar', 'ia_sugestao', 'consentimento_ia', 'ia_sugestao_ativada']) assert.ok(aud.includes(a), a);

// --- exclusão de paciente (LGPD) remove registros e fotos
assert.equal((await call('/pacientes/' + pac.id, { token: es, method: 'DELETE' })).status, 403);
assert.equal((await call('/pacientes/' + pac.id, { token: ad, method: 'DELETE' })).status, 200);
assert.equal(fs.readdirSync(path.join(dir, 'photos')).length, 0);
assert.equal((await call('/registros', { token: ex })).data.length, 0);

// --- bloqueio por força bruta
for (let i = 0; i < 5; i++) await login('estomaterapeuta', 'x' + i);
assert.equal((await login('estomaterapeuta', 'estoma1234')).status, 429);

// o conteúdo ditado nunca vai para a auditoria
assert.doesNotMatch(JSON.stringify((await call('/auditoria', { token: ad })).data), /região sacral|hidrocoloide|espuma com prata/i);

console.log('OK: todos os testes passaram');
server.close(); fakeIA.close();
