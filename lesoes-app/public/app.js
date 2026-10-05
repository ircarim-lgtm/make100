const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const ESTAGIO = { 1: 'Estágio 1', 2: 'Estágio 2', 3: 'Estágio 3', 4: 'Estágio 4', nao_classificavel: 'Não classificável', tissular_profunda: 'Lesão tissular profunda' };
const STATUS = { rascunho: 'Rascunho', enviado: 'Aguardando estomaterapeuta', avaliado: 'Avaliado' };
const PERFIL = { admin: 'Administrador', examinador: 'Examinador', estomaterapeuta: 'Estomaterapeuta' };
const badge = (s) => `<span class="badge b-${s}">${STATUS[s]}</span>`;

let token = sessionStorage.getItem('token'), user = null, pollTimer = null, lastCount = 0;
let state = { view: 'home', tab: null, id: null };

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  let body = opts.body;
  if (body && !(body instanceof Blob)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers, body });
  if (r.status === 401 && token && path !== '/login') { logout(); throw new Error('Sessão expirada'); }
  if (opts.raw && r.ok) return r;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erro || 'Erro ' + r.status);
  return data;
}
function logout() { token = null; user = null; clearInterval(pollTimer); sessionStorage.removeItem('token'); render(); }
function go(view, extra = {}) { state = { ...state, view, ...extra }; render(); window.scrollTo(0, 0); }

// Reduz a foto no aparelho (celulares geram fotos de vários MB)
function reduzirImagem(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao processar imagem'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = url;
  });
}
async function carregarFoto(imgEl, regId) {
  try { const r = await api(`/registros/${regId}/foto`, { raw: true }); imgEl.src = URL.createObjectURL(await r.blob()); } catch { /* sem foto */ }
}

// ---------- Avisos ----------
async function checarAvisos() {
  if (!token || !user || user.perfil === 'admin') return;
  try {
    const { total, tipo } = await api('/notificacoes');
    const b = $('#badge');
    if (b) { b.hidden = !total; b.textContent = `${total} ${tipo === 'casos' ? 'aguardando' : 'nova(s)'}`; }
    if (total > lastCount && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(tipo === 'casos' ? 'Novo caso para avaliação' : 'Nova devolutiva da estomaterapeuta', { icon: '/icon.svg' });
    }
    lastCount = total;
  } catch { /* ignora falha de rede */ }
}
function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(checarAvisos, 30000); }

function shell(inner) {
  return `<header><h1>Lesões por Pressão<small>${esc(user.nome)} · ${PERFIL[user.perfil]}</small></h1>
    <span id="badge" hidden></span><button id="home">Início</button><button id="conta">Conta</button><button id="out">Sair</button></header><main>${inner}</main>`;
}
function bindShell() {
  $('#home').onclick = () => go('home', { tab: null });
  $('#badge').onclick = () => go('home', { tab: null });
  $('#conta').onclick = () => go('conta');
  $('#out').onclick = async () => { try { await api('/logout', { method: 'POST' }); } catch { /* já expirou */ } logout(); };
  checarAvisos();
}
const bindRegs = () => $$('[data-reg]').forEach((c) => (c.onclick = () => go('registro', { id: c.dataset.reg })));
const bindPacs = () => $$('[data-pac]').forEach((c) => (c.onclick = () => go('paciente', { id: c.dataset.pac })));

function renderLogin() {
  $('#app').innerHTML = `<form class="card login" id="f"><h2>Entrar</h2>
    <label>Usuário</label><input name="login" autocomplete="username" required>
    <label>Senha</label><input name="senha" type="password" autocomplete="current-password" required>
    <div class="err" id="e"></div><button class="primary" style="width:100%">Entrar</button></form>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault(); const f = new FormData(ev.target);
    try {
      const r = await api('/login', { method: 'POST', body: { login: f.get('login'), senha: f.get('senha') } });
      token = r.token; user = r.usuario; sessionStorage.setItem('token', token); state = { view: 'home', tab: null, id: null };
      lastCount = 0; startPolling(); render();
    } catch (e) { $('#e').textContent = e.message; }
  };
}

// ---------- Listas ----------
function cardRegistro(r) {
  return `<div class="card click ${r.novo ? 'novo' : ''}" data-reg="${r.id}"><div class="top"><div><b>${esc(r.paciente?.nome)}</b>
    <div class="muted">Pront. ${esc(r.paciente?.prontuario)} · ${esc(r.paciente?.leito) || 'sem leito'} · ${esc(r.local) || 'local não informado'}</div>
    <div class="muted">${r.status === 'rascunho' ? 'Criado' : 'Enviado'} em ${fmt(r.enviadoEm || r.criadoEm)}</div></div>
    <div>${r.novo ? '<span class="badge b-novo">Nova devolutiva</span> ' : ''}${badge(r.status)}</div></div></div>`;
}
async function homeEstoma() {
  const tab = state.tab || 'enviado';
  const list = await api('/registros?status=' + tab);
  $('#app').innerHTML = shell(`<h2>Casos para avaliação</h2>
    <div class="tabs"><button data-t="enviado" class="${tab === 'enviado' ? 'on' : ''}">Aguardando</button><button data-t="avaliado" class="${tab === 'avaliado' ? 'on' : ''}">Avaliados</button></div>
    ${list.map(cardRegistro).join('') || '<p class="muted">Nenhum caso nesta lista.</p>'}`);
  bindShell(); bindRegs();
  $$('[data-t]').forEach((b) => (b.onclick = () => go('home', { tab: b.dataset.t })));
}
async function homeExam() {
  const q = state.q || '';
  const [pacs, regs] = await Promise.all([api('/pacientes?q=' + encodeURIComponent(q)), api('/registros')]);
  regs.sort((a, b) => Number(b.novo) - Number(a.novo));
  $('#app').innerHTML = shell(`<div class="row nofill" style="justify-content:space-between"><h2>Pacientes</h2><button class="primary" id="novo">+ Novo paciente</button></div>
    <input id="q" placeholder="Buscar por nome ou prontuário" value="${esc(q)}"><div class="spacer"></div>
    ${pacs.map((p) => `<div class="card click" data-pac="${p.id}"><b>${esc(p.nome)}</b>
      <div class="muted">Pront. ${esc(p.prontuario)} · ${esc(p.leito) || 'sem leito'} · ${p.totalRegistros} registro(s)</div></div>`).join('') || '<p class="muted">Nenhum paciente encontrado.</p>'}
    <h2 style="margin-top:20px">Últimos registros</h2>${regs.slice(0, 10).map(cardRegistro).join('') || '<p class="muted">Sem registros.</p>'}`);
  bindShell(); bindRegs(); bindPacs();
  $('#novo').onclick = () => go('novoPaciente');
  $('#q').onchange = (e) => { state.q = e.target.value; render(); };
}

// ---------- Administrador ----------
async function homeAdmin() {
  const tab = state.tab || 'usuarios';
  const tabs = `<div class="tabs">${[['usuarios', 'Usuários'], ['pacientes', 'Pacientes (LGPD)'], ['auditoria', 'Auditoria']]
    .map(([k, v]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'usuarios') {
    const us = await api('/usuarios');
    body = `<form class="card" id="nu"><h3 style="margin-top:0">Novo usuário</h3>
      <div class="row"><div><label>Nome</label><input name="nome" required></div><div><label>Login</label><input name="login" required autocapitalize="none"></div></div>
      <div class="row"><div><label>Perfil</label><select name="perfil"><option value="examinador">Examinador</option><option value="estomaterapeuta">Estomaterapeuta</option><option value="admin">Administrador</option></select></div>
      <div><label>Senha inicial (mín. 8)</label><input name="senha" type="password" minlength="8" required autocomplete="new-password"></div></div>
      <div class="err" id="e"></div><button class="primary">Criar usuário</button></form>
      ${us.map((u) => `<div class="card"><div class="top"><div><b>${esc(u.nome)}</b> <span class="muted">(${esc(u.login)})</span>
        <div class="muted">${PERFIL[u.perfil]} · ${u.ativo ? 'ativo' : 'desativado'}</div></div>
        <div class="row nofill"><button class="small" data-reset="${u.id}">Nova senha</button>
        ${u.id !== user.id ? `<button class="small ${u.ativo ? 'danger' : ''}" data-ativo="${u.id}" data-v="${u.ativo ? 0 : 1}">${u.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}</div></div></div>`).join('')}`;
  } else if (tab === 'pacientes') {
    const ps = await api('/pacientes?q=' + encodeURIComponent(state.q || ''));
    body = `<input id="q" placeholder="Buscar paciente" value="${esc(state.q || '')}"><div class="spacer"></div>
      <p class="muted">Excluir remove o paciente, os registros e as fotos de forma definitiva (direito de eliminação).</p>
      ${ps.map((p) => `<div class="card top"><div><b>${esc(p.nome)}</b><div class="muted">Pront. ${esc(p.prontuario)}</div></div><button class="small danger" data-del="${p.id}" data-nome="${esc(p.nome)}">Excluir</button></div>`).join('') || '<p class="muted">Nenhum paciente.</p>'}`;
  } else {
    const log = await api('/auditoria');
    body = `<div class="card"><table><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th></tr>${log.map((l) =>
      `<tr><td>${fmt(l.em)}</td><td>${esc(l.user_nome || '—')}</td><td>${esc(l.acao)}</td><td>${esc(l.alvo || '')}</td></tr>`).join('')}</table></div>`;
  }
  $('#app').innerHTML = shell(`<h2>Administração</h2>${tabs}${body}`);
  bindShell();
  $$('[data-t]').forEach((b) => (b.onclick = () => go('home', { tab: b.dataset.t, q: '' })));
  const nu = $('#nu');
  if (nu) nu.onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('/usuarios', { method: 'POST', body: Object.fromEntries(new FormData(nu)) }); render(); } catch (e) { $('#e').textContent = e.message; }
  };
  $$('[data-ativo]').forEach((b) => (b.onclick = async () => { try { await api('/usuarios/' + b.dataset.ativo, { method: 'PATCH', body: { ativo: b.dataset.v === '1' } }); render(); } catch (e) { alert(e.message); } }));
  $$('[data-reset]').forEach((b) => (b.onclick = async () => {
    const senha = prompt('Nova senha (mín. 8 caracteres):'); if (!senha) return;
    try { await api('/usuarios/' + b.dataset.reset, { method: 'PATCH', body: { senha } }); alert('Senha alterada. O usuário foi desconectado.'); } catch (e) { alert(e.message); }
  }));
  if ($('#q')) $('#q').onchange = (e) => { state.q = e.target.value; render(); };
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm(`Excluir DEFINITIVAMENTE ${b.dataset.nome}, com todos os registros e fotos?`)) return;
    try { await api('/pacientes/' + b.dataset.del, { method: 'DELETE' }); render(); } catch (e) { alert(e.message); }
  }));
}

// ---------- Conta ----------
function renderConta() {
  const podeAviso = 'Notification' in window && user.perfil !== 'admin';
  $('#app').innerHTML = shell(`<form class="card" id="f"><h2>Minha conta</h2><div class="muted">${esc(user.nome)} · ${esc(user.login)} · ${PERFIL[user.perfil]}</div>
    <h3>Alterar senha</h3><label>Senha atual</label><input name="atual" type="password" autocomplete="current-password" required>
    <label>Nova senha (mín. 8 caracteres)</label><input name="nova" type="password" minlength="8" autocomplete="new-password" required>
    <div class="err" id="e"></div><button class="primary">Salvar nova senha</button></form>
    ${podeAviso ? `<div class="card"><h3 style="margin-top:0">Avisos no aparelho</h3>
      <p class="muted">Receba um aviso quando chegar um caso novo ou uma devolutiva, enquanto o app estiver aberto. Status: <b id="np">${Notification.permission === 'granted' ? 'ativados' : 'desativados'}</b></p>
      <button id="avisos">Ativar avisos</button></div>` : ''}`);
  bindShell();
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('/me/senha', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); ev.target.reset(); $('#e').innerHTML = '<span class="okmsg">Senha alterada.</span>'; }
    catch (e) { $('#e').textContent = e.message; }
  };
  if ($('#avisos')) $('#avisos').onclick = async () => { const p = await Notification.requestPermission(); $('#np').textContent = p === 'granted' ? 'ativados' : 'bloqueados'; };
}

// ---------- Paciente ----------
function renderNovoPaciente() {
  $('#app').innerHTML = shell(`<form class="card" id="f"><h2>Cadastrar paciente</h2>
    <label>Nome completo *</label><input name="nome" required>
    <div class="row"><div><label>Prontuário *</label><input name="prontuario" required></div><div><label>Leito / setor</label><input name="leito"></div></div>
    <div class="row"><div><label>Data de nascimento</label><input name="dataNascimento" type="date"></div>
      <div><label>Sexo</label><select name="sexo"><option value="">—</option><option>Feminino</option><option>Masculino</option><option>Outro</option></select></div>
      <div><label>Escala de Braden</label><input name="braden" type="number" min="6" max="23" placeholder="6 a 23"></div></div>
    <label>Comorbidades / observações clínicas</label><textarea name="comorbidades"></textarea>
    <h3>Consentimento (LGPD)</h3>
    <label class="check"><input type="checkbox" name="consentimento" required><span>O paciente ou responsável legal autorizou o registro fotográfico da lesão e o tratamento dos dados para acompanhamento clínico.</span></label>
    <label>Quem consentiu (nome e vínculo) *</label><input name="consentimentoPor" required placeholder="Ex.: a própria paciente / Maria (filha)">
    <div class="err" id="e"></div><div class="row nofill"><button type="button" id="cancel">Cancelar</button><button class="primary">Salvar paciente</button></div></form>`);
  bindShell(); $('#cancel').onclick = () => go('home');
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target)); body.consentimento = ev.target.consentimento.checked;
    try { const p = await api('/pacientes', { method: 'POST', body }); go('paciente', { id: p.id }); } catch (e) { $('#e').textContent = e.message; }
  };
}

// Comparação lado a lado da evolução da lesão
function comparar(regs) {
  const com = regs.filter((r) => r.foto).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  if (com.length < 2) return '<p class="muted">São necessárias ao menos duas fotos para comparar a evolução.</p>';
  const opt = (sel) => com.map((r, i) => `<option value="${r.id}" ${i === sel ? 'selected' : ''}>${esc(r.local) || 'sem local'} — ${fmt(r.criadoEm)}</option>`).join('');
  const ult = com[com.length - 1], ant = com.find((r) => r !== ult && r.local === ult.local) || com[com.length - 2];
  return `<div class="row"><div><label>Antes</label><select id="cmpA">${opt(com.indexOf(ant))}</select></div><div><label>Depois</label><select id="cmpB">${opt(com.length - 1)}</select></div></div>
    <div class="spacer"></div><div class="cmp"><div><img id="imgA" alt="Foto anterior"><div class="muted" id="capA"></div></div><div><img id="imgB" alt="Foto posterior"><div class="muted" id="capB"></div></div></div>`;
}
function bindComparar(regs) {
  if (!$('#cmpA')) return;
  const show = (sel, img, cap) => {
    const r = regs.find((x) => x.id === $(sel).value);
    $(img).removeAttribute('src'); carregarFoto($(img), r.id);
    $(cap).textContent = `${r.local || 'sem local'} · ${fmt(r.criadoEm)}${r.avaliacao?.estagio ? ' · ' + ESTAGIO[r.avaliacao.estagio] : ''}`;
  };
  const upd = () => { show('#cmpA', '#imgA', '#capA'); show('#cmpB', '#imgB', '#capB'); };
  $('#cmpA').onchange = $('#cmpB').onchange = upd; upd();
}

async function renderPaciente() {
  const p = await api('/pacientes/' + state.id);
  const idade = p.dataNascimento ? Math.floor((Date.now() - new Date(p.dataNascimento)) / 31557600000) + ' anos' : '';
  $('#app').innerHTML = shell(`<div class="card"><h2>${esc(p.nome)}</h2>
    <div class="muted">Pront. ${esc(p.prontuario)} · ${esc(p.leito) || 'sem leito'} ${idade ? '· ' + idade : ''} ${p.sexo ? '· ' + esc(p.sexo) : ''} ${p.braden ? '· Braden ' + esc(p.braden) : ''}</div>
    <div class="muted">Consentimento: ${esc(p.consentimentoPor)} em ${fmt(p.consentimentoEm)}</div>
    ${p.comorbidades ? `<p>${esc(p.comorbidades)}</p>` : ''}
    ${user.perfil === 'examinador' ? '<button class="primary" id="nova">+ Nova lesão / foto</button>' : ''}</div>
    <div class="card"><h2>Evolução (comparar fotos)</h2>${comparar(p.registros)}</div>
    <h2>Histórico de lesões</h2>${p.registros.map(cardRegistro).join('') || '<p class="muted">Nenhum registro ainda.</p>'}
    <button id="back">← Voltar</button>`);
  bindShell(); bindRegs(); bindComparar(p.registros);
  $('#back').onclick = () => go('home');
  if ($('#nova')) $('#nova').onclick = () => go('novoRegistro', { pacienteId: p.id });
}

// ---------- Registro ----------
function renderNovoRegistro() {
  $('#app').innerHTML = shell(`<form class="card" id="f"><h2>Nova lesão</h2>
    <label>Localização anatômica</label><input name="local" placeholder="Ex.: região sacral, calcâneo direito">
    <label>Observações (tamanho, secreção, dor, curativo atual...)</label><textarea name="observacoes"></textarea>
    <div class="err" id="e"></div><div class="row nofill"><button type="button" id="cancel">Cancelar</button><button class="primary">Continuar e anexar foto</button></div></form>`);
  bindShell(); $('#cancel').onclick = () => go('paciente', { id: state.pacienteId });
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try { const r = await api('/registros', { method: 'POST', body: { pacienteId: state.pacienteId, ...Object.fromEntries(new FormData(ev.target)) } }); go('registro', { id: r.id }); }
    catch (e) { $('#e').textContent = e.message; }
  };
}
async function renderRegistro() {
  const r = await api('/registros/' + state.id);
  const isEx = user.perfil === 'examinador', av = r.avaliacao, rascunho = r.status === 'rascunho';
  $('#app').innerHTML = shell(`<div class="card"><div class="top"><div><h2 style="margin:0">${esc(r.paciente?.nome)}</h2>
      <div class="muted">Pront. ${esc(r.paciente?.prontuario)} · ${esc(r.local) || 'local não informado'}</div>
      <div class="muted">Registrado por ${esc(r.criadoPorNome)} em ${fmt(r.criadoEm)}${r.enviadoEm ? ' · Enviado em ' + fmt(r.enviadoEm) : ''}</div></div>${badge(r.status)}</div>
    ${r.observacoes ? `<p>${esc(r.observacoes)}</p>` : ''}
    ${r.foto ? '<img class="foto" id="foto" alt="Foto da lesão">' : '<p class="muted">Nenhuma foto anexada.</p>'}
    ${isEx && rascunho ? `<label>${r.foto ? 'Trocar foto' : 'Foto da lesão'}</label><input type="file" id="file" accept="image/*" capture="environment">
      <div class="err" id="e"></div>
      <button class="send" id="enviar" style="width:100%;margin-top:8px" ${r.foto ? '' : 'disabled'}>Enviar para Estomaterapeuta</button>
      <button class="danger small" id="excluir" style="margin-top:8px">Excluir rascunho</button>` : '<div class="err" id="e"></div>'}
  </div>
  ${av ? `<div class="card"><h2>Devolutiva da estomaterapeuta</h2><div class="muted">${esc(av.avaliadoPorNome)} · ${fmt(av.avaliadoEm)}</div>
     ${av.estagio ? `<h3>Classificação</h3><p>${ESTAGIO[av.estagio]}</p>` : ''}
     <h3>Tratamento indicado</h3><div class="devolutiva">${esc(av.tratamento)}</div>
     <h3>Orientações</h3><div class="devolutiva">${esc(av.orientacoes)}</div>
     ${av.retornoDias != null ? `<p class="muted">Reavaliar em ${av.retornoDias} dia(s).</p>` : ''}</div>`
   : r.status === 'enviado' && isEx ? '<div class="card muted">Aguardando avaliação da estomaterapeuta.</div>' : ''}
  ${!isEx && r.status === 'enviado' ? `<form class="card" id="av"><h2>Sua avaliação</h2>
    <label>Classificação da lesão</label><select name="estagio"><option value="">—</option>${Object.entries(ESTAGIO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <label>Tratamento indicado *</label><textarea name="tratamento" required placeholder="Limpeza, cobertura, frequência de troca..."></textarea>
    <label>Orientações *</label><textarea name="orientacoes" required placeholder="Reposicionamento, superfície de suporte, nutrição, sinais de alerta..."></textarea>
    <label>Reavaliar em (dias)</label><input name="retornoDias" type="number" min="0" max="365">
    <div class="err" id="e2"></div><button class="primary" style="width:100%">Enviar devolutiva</button></form>` : ''}
  <div class="row nofill"><button id="back">← Voltar</button><button id="hist">Ver histórico do paciente</button></div>`);
  bindShell();
  $('#back').onclick = () => go('home');
  $('#hist').onclick = () => go('paciente', { id: r.pacienteId });
  if (r.foto) carregarFoto($('#foto'), r.id);
  if ($('#file')) $('#file').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return; $('#e').textContent = 'Enviando foto…';
    try { const blob = await reduzirImagem(f); await api(`/registros/${r.id}/foto`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } }); render(); }
    catch (e) { $('#e').textContent = e.message; }
  };
  if ($('#enviar')) $('#enviar').onclick = async () => {
    if (!confirm('Enviar este registro para a estomaterapeuta? Depois não será possível trocar a foto.')) return;
    try { await api(`/registros/${r.id}/enviar`, { method: 'POST' }); render(); } catch (e) { $('#e').textContent = e.message; }
  };
  if ($('#excluir')) $('#excluir').onclick = async () => {
    if (!confirm('Excluir este rascunho e a foto?')) return;
    try { await api('/registros/' + r.id, { method: 'DELETE' }); go('paciente', { id: r.pacienteId }); } catch (e) { $('#e').textContent = e.message; }
  };
  if ($('#av')) $('#av').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api(`/registros/${r.id}/avaliacao`, { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); render(); }
    catch (e) { $('#e2').textContent = e.message; }
  };
}

async function render() {
  if (!token) return renderLogin();
  try {
    if (!user) { user = await api('/me'); startPolling(); }
    const v = state.view;
    if (v === 'conta') return renderConta();
    if (v === 'home') return user.perfil === 'admin' ? await homeAdmin() : user.perfil === 'examinador' ? await homeExam() : await homeEstoma();
    if (user.perfil === 'admin') return await homeAdmin();
    if (v === 'novoPaciente') return renderNovoPaciente();
    if (v === 'paciente') return await renderPaciente();
    if (v === 'novoRegistro') return renderNovoRegistro();
    if (v === 'registro') return await renderRegistro();
  } catch (e) { if (token) { $('#app').innerHTML = shell(`<p class="err">${esc(e.message)}</p>`); bindShell(); } }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
