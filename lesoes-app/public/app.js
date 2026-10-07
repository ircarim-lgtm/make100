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

// Câmera dentro do app: usa a câmera ao vivo do navegador (getUserMedia). A foto nunca passa pelo
// aplicativo de câmera do sistema, então não é gravada na galeria do aparelho; só existe na memória até o envio.
const emAppEmbutido = () => /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|Snapchat|Telegram|; wv\)|Claude/i.test(navigator.userAgent) || (/iPhone|iPad|iPod/.test(navigator.userAgent) && !/Safari\//.test(navigator.userAgent));
function motivoCamera(e) {
  const usar = 'Abra este endereço direto no Safari (iPhone) ou no Chrome (Android), fora de outros aplicativos.';
  if (!window.isSecureContext) return { texto: 'A câmera só funciona em conexão segura (https).', copiar: true };
  if (!navigator.mediaDevices?.getUserMedia) return { texto: `${emAppEmbutido() ? 'Este navegador embutido em outro aplicativo não permite usar a câmera.' : 'Este navegador não permite usar a câmera.'} ${usar}`, copiar: true };
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return emAppEmbutido() ? { texto: `Este navegador embutido em outro aplicativo bloqueou a câmera. ${usar}`, copiar: true }
        : { texto: 'A câmera está bloqueada para este site. Libere em: cadeado ao lado do endereço (Chrome), ou Ajustes › Safari › Câmera (iPhone). Depois toque em “Tentar de novo”.' };
    case 'NotFoundError': case 'OverconstrainedError': return { texto: 'Nenhuma câmera foi encontrada neste aparelho.' };
    case 'NotReadableError': case 'AbortError': return { texto: 'Não foi possível acessar a câmera. Feche outros aplicativos que a estejam usando e tente de novo.' };
    default: return { texto: 'Não foi possível abrir a câmera.' };
  }
}
async function obterCamera() { // tenta do melhor para o mais simples; para ao ser negada
  const tentativas = [{ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false }, { video: { facingMode: 'environment' }, audio: false }, { video: true, audio: false }];
  let ultimo;
  for (const t of tentativas) { try { return await navigator.mediaDevices.getUserMedia(t); } catch (e) { ultimo = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break; } }
  throw ultimo;
}
function abrirCamera() {
  return new Promise((resolve) => {
    const m = document.createElement('div'); m.className = 'cam';
    m.innerHTML = `<div class="cam-dica">🔒 Esta foto não é salva na galeria do aparelho</div><video playsinline muted autoplay></video><canvas hidden></canvas>
      <div class="cam-msg" hidden><p></p><small></small><div class="cam-acoes"><button type="button" class="cam-retry">Tentar de novo</button><button type="button" class="cam-copy" hidden>Copiar endereço</button></div><a class="cam-diag" href="/camera-teste.html" target="_blank" rel="noopener">Testar a câmera do navegador</a></div>
      <div class="cam-bar"><button type="button" class="cam-x">Cancelar</button><button type="button" class="cam-shot" aria-label="Capturar foto"></button><span></span></div>
      <div class="cam-bar" hidden><button type="button" class="cam-redo">Refazer</button><span></span><button type="button" class="cam-ok primary">Usar foto</button></div>`;
    document.body.appendChild(m);
    const v = $('video', m), c = $('canvas', m), msg = $('.cam-msg', m), [barra1, barra2] = $$('.cam-bar', m);
    let stream;
    const fechar = (blob) => { stream?.getTracks().forEach((t) => t.stop()); m.remove(); resolve(blob || null); };
    const iniciar = async () => {
      msg.hidden = true;
      try {
        stream = await obterCamera(); v.srcObject = stream;
        try { await v.play(); } catch { /* a reprodução automática pode ser adiada pelo navegador; o quadro aparece em seguida */ }
      } catch (e) {
        const r = motivoCamera(e); $('p', msg).textContent = r.texto; $('small', msg).textContent = e?.name ? `Detalhe técnico: ${e.name}` : '';
        $('.cam-copy', msg).hidden = !r.copiar; msg.hidden = false;
      }
    };
    $('.cam-x', m).onclick = () => fechar(null);
    $('.cam-retry', m).onclick = iniciar;
    $('.cam-copy', m).onclick = async (ev) => { try { await navigator.clipboard.writeText(location.origin); ev.target.textContent = 'Endereço copiado'; } catch { ev.target.textContent = location.origin; } };
    $('.cam-shot', m).onclick = () => {
      if (!v.videoWidth) return;
      const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight)); // reduz o tamanho para o envio
      c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      v.hidden = true; c.hidden = false; barra1.hidden = true; barra2.hidden = false;
    };
    $('.cam-redo', m).onclick = () => { c.hidden = true; v.hidden = false; barra2.hidden = true; barra1.hidden = false; };
    $('.cam-ok', m).onclick = () => c.toBlob((b) => fechar(b), 'image/jpeg', 0.85);
    iniciar();
  });
}
async function carregarFoto(imgEl, regId) {
  try { const r = await api(`/registros/${regId}/foto`, { raw: true }); imgEl.src = URL.createObjectURL(await r.blob()); } catch { /* sem foto */ }
}

async function baixarPdf(path, nome) {
  const r = await api(path, { raw: true });
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Ditado por voz (reconhecimento de fala do navegador, pt-BR). Campos marcados com data-voz ganham um botão.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function habilitarVoz() {
  if (!SR) return;
  $$('[data-voz]').forEach((el) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mic small'; b.textContent = '🎤 Ditar';
    b.title = 'O áudio é processado pelo serviço de voz do navegador (Google/Apple), não pelo app.';
    el.insertAdjacentElement('afterend', b);
    let rec = null;
    const parar = () => { rec = null; b.textContent = '🎤 Ditar'; b.classList.remove('rec'); };
    b.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = false;
      rec.onresult = (ev) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (!ev.results[i].isFinal) continue;
          const t = ev.results[i][0].transcript.trim();
          el.value = (el.value ? el.value.replace(/\s*$/, ' ') : '') + t;
        }
      };
      rec.onerror = (e) => { if (e.error === 'not-allowed') alert('Permita o uso do microfone no navegador para ditar.'); else if (e.error !== 'no-speech' && e.error !== 'aborted') alert('Não foi possível usar o ditado: ' + e.error); };
      rec.onend = parar;
      try { rec.start(); b.textContent = '⏹ Parar'; b.classList.add('rec'); } catch { parar(); }
    };
  });
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

const podeRegistrar = () => user.perfil === 'examinador' || user.perfil === 'estomaterapeuta';
// A estomaterapeuta alterna entre os modos Estomaterapeuta (fila de avaliação) e Examinador (cadastro e fotos)
let modo = (() => { try { return sessionStorage.getItem('modo') === 'exam' ? 'exam' : 'estoma'; } catch { return 'estoma'; } })();
const modoSwitch = () => (user.perfil === 'estomaterapeuta' ? `<div class="tabs modo"><button data-modo="estoma" class="${modo === 'estoma' ? 'on' : ''}">${I('check')} Estomaterapeuta</button><button data-modo="exam" class="${modo === 'exam' ? 'on' : ''}">${I('camera')} Examinador</button></div>` : '');

// ---------- Proteção de tela ----------
// Um site não consegue impedir capturas feitas pelo sistema do aparelho (print do celular, Win+Shift+S, foto da tela).
// Aqui há dissuasão e rastreabilidade: marca d'água com o nome do usuário, cobertura ao sair da janela,
// bloqueio de impressão/cópia e registro das tentativas na auditoria.
let coverTimer;
const evento = (tipo, detalhe) => { if (token) api('/seguranca/evento', { method: 'POST', body: { tipo, detalhe } }).catch(() => {}); };
function atualizarMarca() {
  let w = $('#wm'); if (!w) { w = document.createElement('div'); w.id = 'wm'; document.body.appendChild(w); }
  if (!user || !token) { w.style.backgroundImage = 'none'; return; }
  const dt = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="270"><g transform="rotate(-25 220 135)" font-family="sans-serif" font-weight="600" fill="#7f8a99" fill-opacity="0.16" text-anchor="middle"><text x="220" y="125" font-size="17">${esc(user.nome)} · ${esc(user.login)}</text><text x="220" y="150" font-size="14">${dt} · CONFIDENCIAL</text></g></svg>`;
  w.style.backgroundImage = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}
function iniciarProtecao() {
  const cover = document.createElement('div'); cover.className = 'cover';
  cover.innerHTML = '<div><div style="font-size:42px">🔒</div><p>Conteúdo protegido</p><small>Toque ou volte para o aplicativo para continuar.</small></div>';
  document.body.appendChild(cover);
  const mostrar = () => { clearTimeout(coverTimer); cover.classList.remove('on'); };
  const ocultar = (forcar) => { if (token && (forcar || !$('.cam'))) cover.classList.add('on'); }; // sem câmera aberta: o aviso de permissão tira o foco da janela
  const cobrirPor = (ms) => { ocultar(true); clearTimeout(coverTimer); coverTimer = setTimeout(() => { if (!document.hidden) mostrar(); }, ms); };
  const celular = matchMedia('(pointer: coarse)').matches; // no celular, perda de foco não é confiável (pedidos de permissão, teclado) e não impede captura
  if (!celular) window.addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) ocultar(); }, 150));
  window.addEventListener('focus', mostrar); window.addEventListener('pageshow', mostrar);
  document.addEventListener('visibilitychange', () => (document.hidden ? ocultar() : mostrar()));
  cover.addEventListener('click', mostrar); cover.addEventListener('touchend', mostrar);
  document.addEventListener('keyup', (e) => { if (e.key === 'PrintScreen') { navigator.clipboard?.writeText('').catch(() => {}); cobrirPor(2500); evento('tentativa_captura', 'PrintScreen'); } });
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && (k === 'p' || k === 's')) { e.preventDefault(); evento('tentativa_impressao', k === 'p' ? 'imprimir' : 'salvar'); }
    else if (e.metaKey && e.shiftKey && ['Digit3', 'Digit4', 'Digit5'].includes(e.code)) { cobrirPor(2500); evento('tentativa_captura', 'atalho do Mac'); }
  });
  document.addEventListener('copy', (e) => { if (!/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); evento('tentativa_copia'); } });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => e.preventDefault());
  window.addEventListener('beforeprint', () => { cobrirPor(2500); evento('tentativa_impressao', 'menu'); });
  setInterval(atualizarMarca, 30000);
}

const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  out: '<path d="M9 21H5V3h4"/><path d="M16 17l5-5-5-5M21 12H9"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.4 3.2-5 6.5-5s5.8 1.6 6.5 5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.6.2 4.3 1.6 4.8 4.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>', tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  chev: '<path d="M9 6l6 6-6 6"/>', file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  inbox: '<path d="M4 13l2-8h12l2 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
};
const I = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
const hue = (t) => { let h = 0; for (const ch of String(t)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const limpo = (n) => String(n || '').replace(/\(.*?\)/g, '').replace(/^\s*(enf|dr|dra|sr|sra)\.?\s+/i, '').trim();
const iniciais = (n) => { const p = (limpo(n) || '?').split(/\s+/); return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };
const avatar = (nome, tam = '') => `<span class="avatar ${tam}" style="--h:${hue(nome)}">${esc(iniciais(nome))}</span>`;
const primeiroNome = (n) => limpo(n).split(/\s+/)[0];
const hoje = () => { const d = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }); return d[0].toUpperCase() + d.slice(1); };
const hero = (titulo, sub, acao = '') => `<section class="hero"><div><h1>${titulo}</h1><p>${sub}</p></div>${acao}</section>`;
const kpi = (icone, rotulo, valor, tom = '') => `<div class="kpi ${tom}"><span class="kpi-ic">${I(icone)}</span><div><div class="kpi-v">${valor}</div><div class="kpi-l">${rotulo}</div></div></div>`;
const vazio = (icone, titulo, dica = '') => `<div class="empty">${I(icone)}<p><b>${titulo}</b></p>${dica ? `<p>${dica}</p>` : ''}</div>`;
const SKELETON = '<div class="skel"><i></i><i></i><i></i></div>';

const btnNav = (id, nome, ativo) => `<button id="${id}" class="${ativo ? 'ativo' : ''}" title="${nome}" aria-label="${nome}">${I(id === 'conta' ? 'user' : id)}<span>${nome}</span></button>`;
function shell(inner) {
  return `<aside class="side"><div class="brand"><span class="logo">${LOGO}</span><div><b>Lesões por Pressão</b><small>Estomaterapia</small></div></div>
    <nav class="nav">${btnNav('home', 'Início', state.view === 'home')}${btnNav('conta', 'Conta', state.view === 'conta')}${btnNav('out', 'Sair')}</nav>
    <div class="usercard">${avatar(user.nome, 'sm')}<div><b>${esc(user.nome)}</b><small>${PERFIL[user.perfil]}</small></div></div></aside>
    <header class="appbar"><span class="logo">${LOGO}</span><h1>Lesões por Pressão<small>${esc(user.nome)} · ${PERFIL[user.perfil]}</small></h1></header>
    <span id="badge" hidden></span><main>${inner}</main>`;
}
function bindShell() {
  $('#home').onclick = () => go('home', { tab: null });
  $('#badge').onclick = () => go('home', { tab: null });
  $('#conta').onclick = () => go('conta');
  $('#out').onclick = async () => { try { await api('/logout', { method: 'POST' }); } catch { /* já expirou */ } logout(); };
  $$('[data-modo]').forEach((b) => (b.onclick = () => { modo = b.dataset.modo; try { sessionStorage.setItem('modo', modo); } catch { /* sem armazenamento */ } go('home', { tab: null }); }));
  checarAvisos(); lazyFotos();
}
// fotos em miniatura só carregam quando aparecem na tela
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); carregarFoto(e.target, e.target.dataset.foto); } }), { rootMargin: '200px' }) : null;
function lazyFotos() { $$('img[data-foto]').forEach((img) => (io ? io.observe(img) : carregarFoto(img, img.dataset.foto))); }
const bindRegs = () => $$('[data-reg]').forEach((c) => (c.onclick = () => go('registro', { id: c.dataset.reg })));
const bindPacs = () => $$('[data-pac]').forEach((c) => (c.onclick = () => go('paciente', { id: c.dataset.pac })));

function renderLogin() {
  $('#app').innerHTML = `<div class="login-wrap"><section class="login-hero"><div class="logo">${LOGO}</div>
    <h1>Cada lesão, acompanhada de perto.</h1><p>Registre a foto, envie para a estomaterapeuta e receba a devolutiva dentro do app.</p>
    <ul><li>${I('camera')} Foto da lesão em segundos</li><li>${I('spark')} Devolutiva da estomaterapeuta no app</li><li>${I('file')} Histórico e relatório em PDF</li></ul></section>
    <form class="login" id="f"><div class="marca"><div class="logo">${LOGO}</div><h2>Lesões por Pressão</h2><p>Acompanhamento com apoio da estomaterapia</p></div>
    <label>Usuário</label><input name="login" autocomplete="username" required>
    <label>Senha</label><input name="senha" type="password" autocomplete="current-password" required>
    <div class="err" id="e"></div><button class="primary" style="width:100%">Entrar</button></form></div>`;
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
  return `<div class="card click reg ${r.novo ? 'novo' : ''}" data-reg="${r.id}">
    <div class="thumb">${r.foto ? `<img data-foto="${r.id}" alt="" />` : I('image')}</div>
    <div class="reg-main"><b>${esc(r.paciente?.nome)}</b>
      <div class="muted">${esc(r.local) || 'local não informado'} · Atend. ${esc(r.paciente?.prontuario)}</div>
      <div class="muted">${r.status === 'rascunho' ? 'Criado' : 'Enviado'} em ${fmt(r.enviadoEm || r.criadoEm)}</div></div>
    <div class="reg-st">${r.novo ? '<span class="badge b-novo">Nova devolutiva</span>' : ''}${badge(r.status)}</div></div>`;
}
function cardPaciente(p) {
  return `<div class="card click pac" data-pac="${p.id}">${avatar(p.nome)}<div class="pac-main"><b>${esc(p.nome)}</b>
    <div class="chips"><span class="chip">Atend. ${esc(p.prontuario)}</span>${p.setor ? `<span class="chip">${esc(p.setor)}</span>` : ''}${p.leito ? `<span class="chip">Leito ${esc(p.leito)}</span>` : ''}<span class="chip">${p.totalRegistros} registro(s)</span></div></div>${I('chev')}</div>`;
}
async function homeEstoma() {
  const tab = state.tab || 'enviado';
  const [ag, av] = await Promise.all([api('/registros?status=enviado'), api('/registros?status=avaliado')]);
  const list = tab === 'enviado' ? ag : av;
  $('#app').innerHTML = shell(`${hero(`Olá, ${esc(primeiroNome(user.nome))} 👋`, hoje())}
    ${modoSwitch()}
    <div class="kpis">${kpi('clock', 'Aguardando avaliação', ag.length, 'warn')}${kpi('check', 'Avaliados', av.length, 'ok')}</div>
    <div class="tabs"><button data-t="enviado" class="${tab === 'enviado' ? 'on' : ''}">Aguardando</button><button data-t="avaliado" class="${tab === 'avaliado' ? 'on' : ''}">Avaliados</button></div>
    ${list.map(cardRegistro).join('') || vazio('inbox', tab === 'enviado' ? 'Nenhum caso aguardando' : 'Nenhum caso avaliado ainda', tab === 'enviado' ? 'Quando o examinador enviar um caso, ele aparece aqui.' : '')}`);
  bindShell(); bindRegs();
  $$('[data-t]').forEach((b) => (b.onclick = () => go('home', { tab: b.dataset.t })));
}
async function homeExam() {
  const q = state.q || '';
  const [pacs, regs] = await Promise.all([api('/pacientes?q=' + encodeURIComponent(q)), api('/registros')]);
  regs.sort((a, b) => Number(b.novo) - Number(a.novo));
  const aguardando = regs.filter((r) => r.status === 'enviado').length, novas = regs.filter((r) => r.novo).length;
  $('#app').innerHTML = shell(`${hero(`Olá, ${esc(primeiroNome(user.nome))} 👋`, hoje(), `<button id="novo">${I('plus')} Novo paciente</button>`)}
    ${modoSwitch()}
    <div class="kpis">${kpi('users', 'Pacientes', pacs.length)}${kpi('clock', 'Aguardando avaliação', aguardando, 'warn')}${user.perfil === 'examinador' ? kpi('check', 'Novas devolutivas', novas, 'ok') : ''}</div>
    <div class="grid2"><section><div class="sec-h"><h2>Pacientes</h2></div>
      <div class="search">${I('search')}<input id="q" placeholder="Buscar por nome, atendimento ou setor" value="${esc(q)}"></div>
      ${pacs.map(cardPaciente).join('') || vazio('users', 'Nenhum paciente encontrado', 'Cadastre o primeiro em “Novo paciente”.')}</section>
    <section><div class="sec-h"><h2>Últimos registros</h2></div>${regs.slice(0, 10).map(cardRegistro).join('') || vazio('camera', 'Sem registros ainda', 'Abra um paciente e registre a primeira lesão.')}</section></div>`);
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
      ${ps.map((p) => `<div class="card top"><div><b>${esc(p.nome)}</b><div class="muted">Atend. ${esc(p.prontuario)}</div></div><div class="row nofill"><button class="small" data-pdf="${p.id}" data-at="${esc(p.prontuario)}">PDF</button><button class="small danger" data-del="${p.id}" data-nome="${esc(p.nome)}">Excluir</button></div></div>`).join('') || '<p class="muted">Nenhum paciente.</p>'}`;
  } else {
    const log = await api('/auditoria');
    body = `<div class="card"><table><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th></tr>${log.map((l) =>
      `<tr class="${String(l.acao).startsWith('seguranca_') ? 'alerta' : ''}"><td>${fmt(l.em)}</td><td>${esc(l.user_nome || '—')}</td><td>${esc(l.acao)}</td><td>${esc(l.alvo || '')}</td></tr>`).join('')}</table></div>`;
  }
  $('#app').innerHTML = shell(`${hero('Administração', 'Usuários, privacidade e auditoria')}${tabs}${body}`);
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
  $$('[data-pdf]').forEach((b) => (b.onclick = async () => { try { await baixarPdf(`/pacientes/${b.dataset.pdf}/pdf`, `historico-lesoes-${b.dataset.at}.pdf`); } catch (e) { alert(e.message); } }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm(`Excluir DEFINITIVAMENTE ${b.dataset.nome}, com todos os registros e fotos?`)) return;
    try { await api('/pacientes/' + b.dataset.del, { method: 'DELETE' }); render(); } catch (e) { alert(e.message); }
  }));
}

// ---------- Conta ----------
function renderConta() {
  const podeAviso = 'Notification' in window && user.perfil !== 'admin';
  $('#app').innerHTML = shell(`<form class="card pagina-form" id="f"><h2>Minha conta</h2><div class="muted">${esc(user.nome)} · ${esc(user.login)} · ${PERFIL[user.perfil]}</div>
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
  $('#app').innerHTML = shell(`<form class="card pagina-form" id="f"><h2>Cadastrar paciente</h2>
    <label>Nome completo *</label><input name="nome" required>
    <div class="row tres"><div><label>Atendimento *</label><input name="prontuario" required></div><div><label>Setor *</label><input name="setor" required placeholder="Ex.: UTI, Clínica Médica"></div><div><label>Leito</label><input name="leito" placeholder="Ex.: 12A"></div></div>
    <div class="row"><div><label>Data de nascimento</label><input name="dataNascimento" type="date"></div>
      <div><label>Sexo</label><select name="sexo"><option value="">—</option><option>Feminino</option><option>Masculino</option><option>Outro</option></select></div>
      <div><label>Escala de Braden</label><input name="braden" type="number" min="6" max="23" placeholder="6 a 23"></div></div>
    <label>Comorbidades / observações clínicas</label><textarea name="comorbidades" data-voz></textarea>
    <h3>Consentimento (LGPD)</h3>
    <label class="check"><input type="checkbox" name="consentimento" required><span>O paciente ou responsável legal autorizou o registro fotográfico da lesão e o tratamento dos dados para acompanhamento clínico.</span></label>
    <label>Quem consentiu (nome e vínculo) *</label><input name="consentimentoPor" required placeholder="Ex.: a própria paciente / Maria (filha)">
    <div class="err" id="e"></div><div class="row nofill"><button type="button" id="cancel">Cancelar</button><button class="primary">Salvar paciente</button></div></form>`);
  bindShell(); habilitarVoz(); $('#cancel').onclick = () => go('home');
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
  $('#app').innerHTML = shell(`<div class="card"><div class="pac-head">${avatar(p.nome, 'lg')}<div style="min-width:0"><h2>${esc(p.nome)}</h2>
      <div class="chips"><span class="chip">Atend. ${esc(p.prontuario)}</span>${p.setor ? `<span class="chip">${esc(p.setor)}</span>` : ''}${p.leito ? `<span class="chip">Leito ${esc(p.leito)}</span>` : ''}${idade ? `<span class="chip">${idade}</span>` : ''}${p.sexo ? `<span class="chip">${esc(p.sexo)}</span>` : ''}${p.braden ? `<span class="chip">Braden ${esc(p.braden)}</span>` : ''}</div></div></div>
    ${p.comorbidades ? `<p style="margin:14px 0 4px">${esc(p.comorbidades)}</p>` : ''}
    <div class="muted" style="margin-top:10px">Consentimento: ${esc(p.consentimentoPor)} em ${fmt(p.consentimentoEm)}</div>
    <div class="acoes">${podeRegistrar() ? `<button class="primary" id="nova">${I('plus')} Nova lesão / foto</button>` : ''}
    ${user.perfil !== 'examinador' && p.registros.some((r) => r.status !== 'rascunho') ? `<button id="pdfhist">${I('file')} Baixar histórico completo (PDF)</button>` : ''}</div><div class="err" id="e"></div></div>
    <div class="card"><div class="sec-h" style="margin-top:0"><h2>Evolução</h2></div>${comparar(p.registros)}</div>
    <div class="sec-h"><h2>Histórico de lesões</h2></div>
    ${p.registros.length ? `<div class="timeline">${p.registros.map((r) => `<div class="tl-item"><span class="tl-dot ${r.status}"></span>${cardRegistro(r)}</div>`).join('')}</div>` : vazio('camera', 'Nenhum registro ainda', 'Use “Nova lesão / foto” para começar o acompanhamento.')}
    <div class="acoes"><button id="back">← Voltar</button></div>`);
  bindShell(); bindRegs(); bindComparar(p.registros);
  $('#back').onclick = () => go('home');
  if ($('#pdfhist')) $('#pdfhist').onclick = async () => { try { await baixarPdf(`/pacientes/${p.id}/pdf`, `historico-lesoes-${p.prontuario}.pdf`); } catch (e) { $('#e').textContent = e.message; } };
  if ($('#nova')) $('#nova').onclick = () => go('novoRegistro', { pacienteId: p.id });
}

// ---------- Registro ----------
function renderNovoRegistro() {
  $('#app').innerHTML = shell(`<form class="card pagina-form" id="f"><h2>Nova lesão</h2>
    <label>Localização anatômica</label><input name="local" data-voz placeholder="Ex.: região sacral, calcâneo direito">
    <label>Observações (tamanho, secreção, dor, curativo atual...)</label><textarea name="observacoes" data-voz></textarea>
    <div class="err" id="e"></div><div class="row nofill"><button type="button" id="cancel">Cancelar</button><button class="primary">Continuar e anexar foto</button></div></form>`);
  bindShell(); habilitarVoz(); $('#cancel').onclick = () => go('paciente', { id: state.pacienteId });
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try { const r = await api('/registros', { method: 'POST', body: { pacienteId: state.pacienteId, ...Object.fromEntries(new FormData(ev.target)) } }); go('registro', { id: r.id }); }
    catch (e) { $('#e').textContent = e.message; }
  };
}
async function renderRegistro() {
  const r = await api('/registros/' + state.id);
  const isEx = user.perfil === 'examinador', av = r.avaliacao, rascunho = r.status === 'rascunho';
  const agora = rascunho ? 0 : r.status === 'enviado' ? 1 : 3;
  const passos = ['Registrado', 'Enviado', 'Avaliado'].map((t, i) => `<li class="${i < agora ? 'done' : i === agora ? 'now' : ''}"><span>${i < agora ? I('tick') : i + 1}</span>${t}</li>`).join('');
  $('#app').innerHTML = shell(`<ol class="stepper">${passos}</ol>
  <div class="cols"><div class="col-foto"><div class="card">
    ${r.foto ? '<img class="foto" id="foto" alt="Foto da lesão">' : vazio('image', 'Nenhuma foto anexada')}
    ${podeRegistrar() && rascunho ? `<button class="primary" id="camera" style="width:100%;margin-top:10px">${I('camera')} ${r.foto ? 'Tirar outra foto' : 'Tirar foto'}</button>
      <div class="muted" style="margin-top:6px">A foto é tirada dentro do app e não fica salva na galeria do aparelho.</div>
      <button class="send" id="enviar" style="width:100%;margin-top:10px" ${r.foto ? '' : 'disabled'}>Enviar para Estomaterapeuta</button>
      <button class="danger small" id="excluir" style="margin-top:8px">Excluir rascunho</button>` : ''}
    <div class="err" id="e"></div></div></div>
  <div class="col-main"><div class="card"><div class="info-h">${avatar(r.paciente?.nome || '?')}<div><h2>${esc(r.paciente?.nome)}</h2>
      <div class="chips"><span class="chip">Atend. ${esc(r.paciente?.prontuario)}</span>${r.paciente?.setor ? `<span class="chip">${esc(r.paciente.setor)}</span>` : ''}<span class="chip">${esc(r.local) || 'local não informado'}</span></div></div>${badge(r.status)}</div>
    <div class="muted">Registrado por ${esc(r.criadoPorNome)} em ${fmt(r.criadoEm)}${r.enviadoEm ? ' · Enviado em ' + fmt(r.enviadoEm) : ''}</div>
    ${r.observacoes ? `<p style="margin:10px 0 0">${esc(r.observacoes)}</p>` : ''}</div>
  ${av ? `<div class="card"><h2>Devolutiva da estomaterapeuta</h2><div class="muted">${esc(av.avaliadoPorNome)} · ${fmt(av.avaliadoEm)}</div>
     ${av.estagio ? `<h3>Classificação</h3><p style="margin:0">${ESTAGIO[av.estagio]}</p>` : ''}
     <h3>Tratamento indicado</h3><div class="devolutiva">${esc(av.tratamento)}</div>
     <h3>Orientações</h3><div class="devolutiva">${esc(av.orientacoes)}</div>
     ${av.retornoDias != null ? `<p class="muted">Reavaliar em ${av.retornoDias} dia(s).</p>` : ''}
     ${user.perfil !== 'examinador' ? `<button class="primary" id="pdf">${I('file')} Baixar relatório (PDF)</button>` : ''}</div>`
   : r.status === 'enviado' && isEx ? `<div class="card">${vazio('clock', 'Aguardando avaliação da estomaterapeuta', 'Você será avisado quando a devolutiva chegar.')}</div>` : ''}
  ${user.perfil === 'estomaterapeuta' && r.status === 'enviado' ? `<form class="card" id="av"><h2>Sua avaliação</h2>
    <label>Classificação da lesão</label><select name="estagio"><option value="">—</option>${Object.entries(ESTAGIO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <label>Tratamento indicado *</label><textarea name="tratamento" required data-voz placeholder="Limpeza, cobertura, frequência de troca..."></textarea>
    <label>Orientações *</label><textarea name="orientacoes" required data-voz placeholder="Reposicionamento, superfície de suporte, nutrição, sinais de alerta..."></textarea>
    <label>Reavaliar em (dias)</label><input name="retornoDias" type="number" min="0" max="365">
    <div class="err" id="e2"></div><button class="primary" style="width:100%">Enviar devolutiva</button></form>` : ''}
  <div class="acoes"><button id="back">← Voltar</button><button id="hist">Ver histórico do paciente</button></div></div></div>`);
  bindShell(); habilitarVoz();
  $('#back').onclick = () => go('home');
  $('#hist').onclick = () => go('paciente', { id: r.pacienteId });
  if (r.foto) carregarFoto($('#foto'), r.id);
  if ($('#camera')) $('#camera').onclick = async () => {
    const blob = await abrirCamera(); if (!blob) return; $('#e').textContent = 'Enviando foto…';
    try { await api(`/registros/${r.id}/foto`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } }); render(); }
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
  if ($('#pdf')) $('#pdf').onclick = async () => { try { await baixarPdf(`/registros/${r.id}/pdf`, `relatorio-lesao-${r.paciente?.prontuario || r.id}.pdf`); } catch (e) { $('#e').textContent = e.message; } };
  if ($('#av')) $('#av').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api(`/registros/${r.id}/avaliacao`, { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); render(); }
    catch (e) { $('#e2').textContent = e.message; }
  };
}

async function render() {
  atualizarMarca();
  if (!token) return renderLogin();
  const m = $('main'); if (m) m.innerHTML = SKELETON;
  try {
    if (!user) { user = await api('/me'); startPolling(); }
    const v = state.view;
    if (v === 'conta') return renderConta();
    if (v === 'home') return user.perfil === 'admin' ? await homeAdmin() : user.perfil === 'examinador' || (user.perfil === 'estomaterapeuta' && modo === 'exam') ? await homeExam() : await homeEstoma();
    if (user.perfil === 'admin') return await homeAdmin();
    if (v === 'novoPaciente') return renderNovoPaciente();
    if (v === 'paciente') return await renderPaciente();
    if (v === 'novoRegistro') return renderNovoRegistro();
    if (v === 'registro') return await renderRegistro();
  } catch (e) { if (token) { $('#app').innerHTML = shell(`<p class="err">${esc(e.message)}</p>`); bindShell(); } }
}
iniciarProtecao();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
