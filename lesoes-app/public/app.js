const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const ESTAGIO = { 1: 'Estágio 1', 2: 'Estágio 2', 3: 'Estágio 3', 4: 'Estágio 4', nao_classificavel: 'Não classificável', tissular_profunda: 'Lesão tissular profunda' };
const STATUS = { rascunho: 'Rascunho', enviado: 'Aguardando estomaterapeuta', avaliado: 'Avaliado' };
const PERFIL = { admin: 'Administrador', examinador: 'Examinador', estomaterapeuta: 'Estomaterapeuta' };
const badge = (s) => `<span class="badge b-${s}">${STATUS[s]}</span>`;
const COMORB = [['HAS', 'Hipertensão arterial sistêmica'], ['DM', 'Diabetes mellitus'], ['DAOP', 'Doença arterial obstrutiva periférica'], ['DAC', 'Doença arterial coronariana']];
const SITUACAO = { alta: 'Alta', obito: 'Óbito' };
const REAVAL_DIAS = [3, 4, 5, 6, 7];
const fmtDia = (d) => (d ? d.split('-').reverse().join('/') : '—'); // AAAA-MM-DD → DD/MM/AAAA
const diasEntre = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

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
const ua = () => navigator.userAgent;
const SO = () => (/iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1) ? 'ios' : /Android/.test(ua()) ? 'android' : 'pc');
const NAV = () => (/CriOS/.test(ua()) ? 'chrome-ios' : /FxiOS|Firefox/.test(ua()) ? 'firefox' : /EdgA|EdgiOS|Edg\//.test(ua()) ? 'edge' : /Chrome\//.test(ua()) ? 'chrome' : /Safari\//.test(ua()) ? 'safari' : 'outro');
// Passo a passo para liberar a câmera, conforme o navegador/aparelho
function ajudaPermissao() {
  const so = SO(), nav = NAV();
  if (nav === 'chrome-ios') return 'No iPhone: abra Ajustes › Chrome › e ative “Câmera”. Depois volte aqui e toque em “Tentar de novo”.';
  if (so === 'ios' && nav === 'firefox') return 'No iPhone: abra Ajustes › Firefox › e ative “Câmera”. Depois volte aqui e toque em “Tentar de novo”.';
  if (so === 'ios') return 'No iPhone: toque em “aA” na barra do endereço › Ajustes do Site › Câmera › Permitir. (Ou: Ajustes › Safari › Câmera › Perguntar.) Depois toque em “Tentar de novo”.';
  if (nav === 'firefox') return 'No Firefox: toque no ícone de cadeado ao lado do endereço › Permissões › Câmera › Permitir (apague o bloqueio, se houver). Depois recarregue a página.';
  if (so === 'android') return 'No Chrome do Android: toque no cadeado ao lado do endereço › Permissões › Câmera › Permitir. Se continuar bloqueado: Configurações do Android › Apps › Chrome › Permissões › Câmera › Permitir. Depois recarregue a página.';
  return 'No computador: clique no ícone de cadeado ao lado do endereço › Configurações do site › Câmera › Permitir. Depois recarregue a página.';
}
function motivoCamera(e, perm) {
  const usar = 'Abra este endereço direto no Safari (iPhone) ou no Chrome (Android), fora de outros aplicativos.';
  if (!window.isSecureContext) return { texto: 'A câmera só funciona em conexão segura (https).', copiar: true };
  if (!navigator.mediaDevices?.getUserMedia) return { texto: `${emAppEmbutido() ? 'Este navegador embutido em outro aplicativo não permite usar a câmera.' : 'Este navegador não permite usar a câmera.'} ${usar}`, copiar: true };
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return emAppEmbutido() ? { texto: `Este navegador embutido em outro aplicativo bloqueou a câmera. ${usar}`, copiar: true }
        : { texto: `A câmera está bloqueada para este site${perm === 'denied' ? '' : ' (o pedido de permissão foi negado ou não apareceu)'}. ${ajudaPermissao()}`, recarregar: true };
    case 'NotFoundError': case 'OverconstrainedError': return { texto: SO() === 'pc' ? 'Nenhuma câmera foi encontrada neste computador. Use o celular para tirar a foto, ou conecte uma webcam.' : 'Nenhuma câmera foi encontrada neste aparelho.' };
    case 'NotReadableError': case 'AbortError': return { texto: 'Não foi possível acessar a câmera. Feche outros aplicativos ou abas que a estejam usando e tente de novo.', recarregar: true };
    default: return { texto: 'Não foi possível abrir a câmera. Toque em “Tentar de novo” ou recarregue a página.', recarregar: true };
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
      <div class="cam-msg" hidden><p></p><small></small><div class="cam-acoes"><button type="button" class="cam-retry">Tentar de novo</button><button type="button" class="cam-reload" hidden>Recarregar página</button><button type="button" class="cam-copy" hidden>Copiar endereço</button></div><a class="cam-diag" href="/camera-teste.html" target="_blank" rel="noopener">Testar a câmera do navegador</a></div>
      <div class="cam-bar"><button type="button" class="cam-x">Cancelar</button><button type="button" class="cam-shot" aria-label="Capturar foto"></button><span></span></div>
      <div class="cam-bar" hidden><button type="button" class="cam-redo">Refazer</button><span></span><button type="button" class="cam-ok primary">Usar foto</button></div>`;
    document.body.appendChild(m);
    const v = $('video', m), c = $('canvas', m), msg = $('.cam-msg', m), [barra1, barra2] = $$('.cam-bar', m);
    let stream;
    const fechar = (blob) => { stream?.getTracks().forEach((t) => t.stop()); m.remove(); resolve(blob || null); };
    const iniciar = async () => {
      msg.hidden = true;
      let perm = '';
      try { perm = (await navigator.permissions.query({ name: 'camera' })).state; } catch { /* nem todo navegador informa */ }
      const demora = setTimeout(() => { // o pedido de permissão pode estar pendente ou escondido
        if (stream) return;
        $('p', msg).textContent = `Aguardando a permissão da câmera… Se nenhum aviso apareceu, ${ajudaPermissao().replace(/^No [^:]+: /, '')}`;
        $('small', msg).textContent = ''; $('.cam-copy', msg).hidden = true; $('.cam-reload', msg).hidden = false; msg.hidden = false;
      }, 8000);
      try {
        if (perm === 'denied') { const e = new Error('permissão negada'); e.name = 'NotAllowedError'; throw e; }
        stream = await obterCamera(); clearTimeout(demora); msg.hidden = true; v.srcObject = stream;
        try { await v.play(); } catch { /* a reprodução automática pode ser adiada pelo navegador; o quadro aparece em seguida */ }
      } catch (e) {
        clearTimeout(demora);
        const r = motivoCamera(e, perm); $('p', msg).textContent = r.texto; $('small', msg).textContent = `Detalhe técnico: ${e?.name || 'erro'} · ${NAV()}/${SO()}${perm ? ' · permissão: ' + perm : ''}`;
        $('.cam-copy', msg).hidden = !r.copiar; $('.cam-reload', msg).hidden = !r.recarregar; msg.hidden = false;
      }
    };
    $('.cam-x', m).onclick = () => fechar(null);
    $('.cam-retry', m).onclick = iniciar;
    $('.cam-reload', m).onclick = () => location.reload();
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
// ---------- Ditado por voz ----------
// Reconhecimento de fala do navegador (pt-BR). Cada campo marcado com data-voz ganha um microfone dentro do campo.
// Modos: (vazio/texto) texto livre · nome · codigo (atendimento, leito) · digitos (CPF/RG) · num · data · opcao (lista) · busca.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const N_UN = { zero: 0, um: 1, uma: 1, primeiro: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
const N_DZ = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const N_CT = { cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900 };
const ehNumero = (w) => w in N_UN || w in N_DZ || w in N_CT || w === 'mil';
// "doze" → "12", "mil novecentos e quarenta" → "1940" (só troca sequências de números por extenso)
function numerosPorExtenso(txt, digitoADigito = false) {
  const tk = String(txt).split(/\s+/).filter(Boolean), out = []; let i = 0;
  while (i < tk.length) {
    const w = semAcento(tk[i]).replace(/[.,;!?]/g, '');
    if (!ehNumero(w)) { out.push(tk[i]); i++; continue; }
    let total = 0, atual = 0; const inicio = i, digitos = [];
    while (i < tk.length) {
      const x = semAcento(tk[i]).replace(/[.,;!?]/g, '');
      if (x === 'e' && i + 1 < tk.length && ehNumero(semAcento(tk[i + 1]).replace(/[.,;!?]/g, ''))) { i++; continue; }
      if (!ehNumero(x)) break;
      if (x === 'mil') { total += (atual || 1) * 1000; atual = 0; } else atual += N_UN[x] ?? N_DZ[x] ?? N_CT[x];
      if (x in N_UN && N_UN[x] <= 9) digitos.push(N_UN[x]); else digitos.push(null);
      i++;
    }
    // em códigos (atendimento, CPF), “um dois três” são dígitos soltos: 123, e não a soma
    out.push(digitoADigito && digitos.length > 1 && digitos.every((d) => d !== null) ? digitos.join('') : String(total + atual));
  }
  return out.join(' ');
}
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function dataFalada(txt) { // → aaaa-mm-dd ou ''
  const t = semAcento(numerosPorExtenso(txt)).replace(/[.,]/g, ' ');
  let d, m, y, r;
  if ((r = t.match(/(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{4})/))) [, d, m, y] = r;
  else if ((r = t.match(/(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/)) && MESES.includes(r[2])) { d = r[1]; m = MESES.indexOf(r[2]) + 1; y = r[3]; }
  else if ((r = t.match(/(\d{1,2})\s+(?:de\s+)?(\d{1,2})\s+(?:de\s+)?(\d{4})/))) [, d, m, y] = r;
  if (!d || +d < 1 || +d > 31 || +m < 1 || +m > 12) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const radical = (w) => w.replace(/\(a\)/g, '').replace(/[aeo]s?$/, '');
function opcaoFalada(sel, txt) { // escolhe a opção da lista que mais combina com o que foi dito
  const dito = semAcento(numerosPorExtenso(txt)).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 || /\d/.test(w)).map(radical);
  let melhor = null, pontos = 0;
  for (const o of sel.options) {
    if (!o.value && !o.text.trim().replace('—', '')) continue;
    const palavras = semAcento(o.text).replace(/\(a\)/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(radical);
    const p = palavras.filter((w) => dito.includes(w)).length / palavras.length + (dito.join(' ') === palavras.join(' ') ? 1 : 0);
    if (p > pontos) { pontos = p; melhor = o; }
  }
  return pontos >= 0.5 ? melhor : null;
}
const titulo = (t) => t.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && /^(da|de|do|das|dos|e)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
// transforma o que foi falado no valor do campo, conforme o modo
function valorFalado(el, modo, fala) {
  let t = fala.trim().replace(/[.!?]+$/, '');
  if (modo === 'nome') return titulo(t);
  if (modo === 'codigo') return numerosPorExtenso(t, true).replace(/[^\w\/\-.]/g, '').toUpperCase();
  if (modo === 'digitos') return numerosPorExtenso(t, true).replace(/\D/g, '');
  if (modo === 'num') { const r = numerosPorExtenso(t).match(/\d+/); return r ? r[0] : ''; }
  if (modo === 'busca') return t;
  return t;
}
let vozAtiva = null;
const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
function habilitarVoz() {
  if (!SR) return;
  $$('[data-voz]').forEach((el) => {
    if (el.dataset.vozOk) return; el.dataset.vozOk = '1';
    const modo = el.dataset.voz || 'texto', longo = el.tagName === 'TEXTAREA';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mic'; b.innerHTML = MIC;
    b.setAttribute('aria-label', 'Preencher por voz'); b.title = 'Preencher por voz. O áudio é processado pelo serviço de voz do navegador (Google/Apple), não pelo app.';
    const ancora = el.closest('.search') ? el : el;
    const w = document.createElement('span'); w.className = 'vz'; ancora.replaceWith(w); w.append(el, b);
    const aviso = (msg) => { let a = w.nextElementSibling; if (!a?.classList.contains('vz-msg')) { a = document.createElement('small'); a.className = 'vz-msg'; w.after(a); } a.textContent = msg; clearTimeout(a._t); a._t = setTimeout(() => a.remove(), 5000); };
    let rec = null;
    const parar = () => { rec = null; if (vozAtiva === parar) vozAtiva = null; b.classList.remove('rec'); b.setAttribute('aria-pressed', 'false'); b.title = 'Preencher por voz'; };
    const aplicar = (fala) => {
      if (modo === 'data') { const v = dataFalada(fala); if (!v) return aviso(`Não entendi a data (“${fala}”). Diga, por exemplo: 2 de março de 1940.`); el.value = v; }
      else if (modo === 'opcao') { const o = opcaoFalada(el, fala); if (!o) return aviso(`Não entendi (“${fala}”). Opções: ${[...el.options].map((x) => x.text).filter((x) => x && x !== '—' && !/^Selecione/.test(x)).join(', ')}.`); el.value = o.value || o.text; }
      else {
        const v = valorFalado(el, modo, fala);
        if (modo === 'num' && !v) return aviso(`Não entendi o número (“${fala}”).`);
        el.value = longo ? (el.value ? el.value.replace(/\s*$/, ' ') : '') + v : v;
      }
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    b.onclick = () => {
      if (rec) { rec.stop(); return; }
      vozAtiva?.();
      rec = new SR(); rec.lang = 'pt-BR'; rec.continuous = longo; rec.interimResults = false;
      rec.onresult = (ev) => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) aplicar(ev.results[i][0].transcript); };
      rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') aviso('Permita o uso do microfone no navegador para ditar.'); else if (e.error === 'no-speech') aviso('Não ouvi nada. Toque no microfone e fale.'); else if (e.error !== 'aborted') aviso('Não foi possível usar a voz: ' + e.error); };
      rec.onend = parar;
      const r = rec;
      try { r.start(); vozAtiva = () => { try { r.stop(); } catch { /* já parado */ } }; b.classList.add('rec'); b.setAttribute('aria-pressed', 'true'); b.title = 'Ouvindo… toque para parar'; } catch { parar(); }
    };
  });
}

// Janela simples para pedir um motivo ou uma escolha. `ler(janela)` devolve o valor ou { erro }. Resolve null se cancelar.
function janela(titulo, corpo, textoOk, ler) {
  return new Promise((resolve) => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"><h2>${titulo}</h2>${corpo}<div class="err" id="mErr"></div>
      <div class="row nofill"><button type="button" class="m-cancel">Cancelar</button><button type="button" class="primary m-ok">${textoOk}</button></div></div>`;
    document.body.appendChild(m); habilitarVoz();
    const fechar = (v) => { m.remove(); resolve(v); };
    $('.m-cancel', m).onclick = () => fechar(null);
    $('.m-ok', m).onclick = () => { const r = ler(m); if (r && r.erro) { $('#mErr', m).textContent = r.erro; return; } fechar(r); };
    const campo = $('textarea,input[type=text],input:not([type])', m); if (campo) campo.focus();
  });
}
const pedirMotivo = (titulo, dica, ok) => janela(titulo, `<p class="muted">${dica}</p><label>Motivo *</label><textarea name="motivo" data-voz placeholder="Explique o que estava errado"></textarea>`, ok,
  (m) => { const v = $('[name=motivo]', m).value.trim(); return v.length < 5 ? { erro: 'Informe o motivo (mínimo 5 caracteres).' } : v; });

// ---------- Avisos ----------
async function checarAvisos() {
  if (!token || !user || user.perfil === 'admin') return;
  try {
    const { total, tipo, reavaliacoes = 0 } = await api('/notificacoes');
    const n = total + reavaliacoes;
    const b = $('#badge');
    if (b) { b.hidden = !n; b.textContent = `${n} ${tipo === 'casos' ? 'pendente(s)' : 'nova(s)'}`; }
    if (n > lastCount && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(tipo === 'casos' ? (reavaliacoes ? 'Você tem reavaliações pendentes' : 'Novo caso para avaliação') : 'Nova devolutiva da estomaterapeuta', { icon: '/icon-192.png' });
    }
    lastCount = n;
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

const LOGO = '<img src="/logo.png" alt="" width="256" height="256">';
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  out: '<path d="M9 21H5V3h4"/><path d="M16 17l5-5-5-5M21 12H9"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.4 3.2-5 6.5-5s5.8 1.6 6.5 5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.6.2 4.3 1.6 4.8 4.5"/>',
  bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21a2 2 0 004 0"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>', tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  chev: '<path d="M9 6l6 6-6 6"/>', file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  inbox: '<path d="M4 13l2-8h12l2 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
};
const I = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
const hue = (t) => { let h = 0; for (const ch of String(t)) h = (h * 31 + ch.charCodeAt(0)) % 360; return [168, 182, 152, 14, 26, 196][h % 6]; };
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
  return `<aside class="side"><div class="brand"><span class="logo">${LOGO}</span><div><b>Evolu<i>IA</i></b><small>Acompanhamento de lesões</small></div></div>
    <nav class="nav">${btnNav('home', 'Início', state.view === 'home')}${btnNav('conta', 'Conta', state.view === 'conta')}${btnNav('out', 'Sair')}</nav>
    <div class="usercard">${avatar(user.nome, 'sm')}<div><b>${esc(user.nome)}</b><small>${PERFIL[user.perfil]}</small></div></div></aside>
    <header class="appbar"><span class="logo">${LOGO}</span><h1>Evolu<i>IA</i><small>${esc(user.nome)} · ${PERFIL[user.perfil]}</small></h1></header>
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
  $('#app').innerHTML = `<div class="login-wrap"><section class="login-hero">
      <div class="lockup"><div class="logo">${LOGO}</div><div><span class="nome">Evolu<i>IA</i></span><small>Acompanhamento de lesões</small></div></div>
      <p class="tag">Cada lesão, <em>acompanhada</em> de perto.</p>
      <p class="sub">Registre a foto, envie para a estomaterapeuta e receba a devolutiva dentro do app.</p>
      <ol class="jornada"><li style="--cor:#f2946f;--prox:#fbbf24"><b>Registro</b>Foto da lesão em segundos</li><li style="--cor:#fbbf24;--prox:#4fd1be"><b>Avaliação</b>Devolutiva da estomaterapeuta</li><li style="--cor:#4fd1be"><b>Evolução</b>Histórico e relatório em PDF</li></ol>
    </section>
    <form class="login" id="f"><h2>Entrar</h2><p class="intro">Acesse com seu usuário e senha.</p>
    <label>Usuário</label><input name="login" autocomplete="username" required>
    <label>Senha</label><input name="senha" type="password" autocomplete="current-password" required>
    <div class="err" id="e"></div><button class="primary" style="width:100%">Entrar</button>
    <p class="rodape">EvoluIA · seus dados são protegidos (LGPD)</p></form></div>`;
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
  return `<div class="card click reg ${r.novo ? 'novo' : ''} ${r.inativo ? 'inativo' : ''}" data-reg="${r.id}">
    <div class="thumb">${r.foto ? `<img data-foto="${r.id}" alt="" />` : I('image')}</div>
    <div class="reg-main"><b>${esc(r.paciente?.nome)}</b>
      <div class="muted">${esc(r.local) || 'local não informado'} · Atend. ${esc(r.paciente?.prontuario)}</div>
      <div class="muted">${r.status === 'rascunho' ? 'Criado' : 'Enviado'} em ${fmt(r.enviadoEm || r.criadoEm)}</div></div>
    <div class="reg-st">${r.novo ? '<span class="badge b-novo">Nova devolutiva</span>' : ''}${r.inativo ? '<span class="badge b-inativo">Inativado</span>' : badge(r.status)}</div></div>`;
}
function cardPaciente(p) {
  return `<div class="card click pac" data-pac="${p.id}">${avatar(p.nome)}<div class="pac-main"><b>${esc(p.nome)}</b>
    <div class="chips"><span class="chip">Atend. ${esc(p.prontuario)}</span>${p.setor ? `<span class="chip">${esc(p.setor)}</span>` : ''}${p.leito ? `<span class="chip">Leito ${esc(p.leito)}</span>` : ''}<span class="chip">${p.totalRegistros} registro(s)</span>${p.situacao && p.situacao !== 'ativo' ? `<span class="chip sit-${p.situacao}">${SITUACAO[p.situacao]}</span>` : ''}</div></div>${I('chev')}</div>`;
}
function cardReaval(r, hoje) { // lembrete de reavaliação marcado pela estomaterapeuta
  const d = diasEntre(r.reavaliarEm, hoje);
  const quando = d < 0 ? `<span class="badge b-atrasada">Atrasada há ${-d} dia(s)</span>` : d === 0 ? '<span class="badge b-hoje">Hoje</span>' : `<span class="badge b-enviado">Em ${d} dia(s)</span>`;
  return `<div class="card click pac" data-pac="${r.pacienteId}">${avatar(r.paciente?.nome)}<div class="pac-main"><b>${esc(r.paciente?.nome)}</b>
    <div class="chips"><span class="chip">Atend. ${esc(r.paciente?.prontuario)}</span><span class="chip">${esc(r.local) || 'local não informado'}</span><span class="chip">Reavaliar em ${fmtDia(r.reavaliarEm)}</span></div></div>${quando}</div>`;
}
async function homeEstoma() {
  const tab = state.tab || 'enviado';
  const [ag, av, rv] = await Promise.all([api('/registros?status=enviado'), api('/registros?status=avaliado'), api('/registros/reavaliacoes')]);
  const vencidas = rv.itens.filter((r) => r.reavaliarEm <= rv.hoje).length;
  const lista = tab === 'enviado' ? ag.map(cardRegistro).join('') : tab === 'reaval' ? rv.itens.map((r) => cardReaval(r, rv.hoje)).join('') : av.map(cardRegistro).join('');
  const vazioMsg = tab === 'enviado' ? vazio('inbox', 'Nenhum caso aguardando', 'Quando o examinador enviar um caso, ele aparece aqui.')
    : tab === 'reaval' ? vazio('bell', 'Nenhuma reavaliação marcada', 'Ao avaliar um caso, escolha reavaliar em 3 a 7 dias: você recebe um aviso no dia.') : vazio('inbox', 'Nenhum caso avaliado ainda');
  $('#app').innerHTML = shell(`${hero(`Olá, ${esc(primeiroNome(user.nome))} 👋`, hoje())}
    ${modoSwitch()}
    <div class="kpis">${kpi('clock', 'Aguardando avaliação', ag.length, 'warn')}${kpi('bell', 'Reavaliar hoje', vencidas, vencidas ? 'warn' : '')}${kpi('check', 'Avaliados', av.length, 'ok')}</div>
    <div class="tabs"><button data-t="enviado" class="${tab === 'enviado' ? 'on' : ''}">Aguardando</button><button data-t="reaval" class="${tab === 'reaval' ? 'on' : ''}">Reavaliações${rv.itens.length ? ` (${rv.itens.length})` : ''}</button><button data-t="avaliado" class="${tab === 'avaliado' ? 'on' : ''}">Avaliados</button></div>
    ${lista || vazioMsg}`);
  bindShell(); bindRegs(); bindPacs();
  $$('[data-t]').forEach((b) => (b.onclick = () => go('home', { tab: b.dataset.t })));
}
async function homeExam() {
  const q = state.q || '', sit = state.sit || 'ativos';
  const [pacs, regs] = await Promise.all([api('/pacientes?q=' + encodeURIComponent(q) + '&situacao=' + sit), api('/registros')]);
  regs.sort((a, b) => Number(b.novo) - Number(a.novo));
  const aguardando = regs.filter((r) => r.status === 'enviado').length, novas = regs.filter((r) => r.novo).length;
  $('#app').innerHTML = shell(`${hero(`Olá, ${esc(primeiroNome(user.nome))} 👋`, hoje(), `<button id="novo">${I('plus')} Novo paciente</button>`)}
    ${modoSwitch()}
    <div class="kpis">${kpi('users', 'Pacientes', pacs.length)}${kpi('clock', 'Aguardando avaliação', aguardando, 'warn')}${user.perfil === 'examinador' ? kpi('check', 'Novas devolutivas', novas, 'ok') : ''}</div>
    <div class="grid2"><section><div class="sec-h"><h2>Pacientes</h2></div>
      <div class="tabs">${[['ativos', 'Em atendimento'], ['finalizados', 'Finalizados'], ['todos', 'Todos']].map(([k, v]) => `<button data-sit="${k}" class="${sit === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="search">${I('search')}<input id="q" placeholder="Buscar por nome, atendimento ou setor" value="${esc(q)}" data-voz="busca"></div>
      ${pacs.map(cardPaciente).join('') || vazio('users', sit === 'finalizados' ? 'Nenhum atendimento finalizado' : 'Nenhum paciente encontrado', sit === 'finalizados' ? 'Altas e óbitos registrados pela estomaterapeuta aparecem aqui.' : 'Cadastre o primeiro em “Novo paciente”.')}</section>
    <section><div class="sec-h"><h2>Últimos registros</h2></div>${regs.slice(0, 10).map(cardRegistro).join('') || vazio('camera', 'Sem registros ainda', 'Abra um paciente e registre a primeira lesão.')}</section></div>`);
  bindShell(); bindRegs(); bindPacs(); habilitarVoz();
  $('#novo').onclick = () => go('novoPaciente');
  $$('[data-sit]').forEach((b) => (b.onclick = () => go('home', { sit: b.dataset.sit })));
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
      <div class="row"><div><label>Nome</label><input name="nome" required data-voz="nome"></div><div><label>Login</label><input name="login" required autocapitalize="none"></div></div>
      <div class="row"><div><label>Perfil</label><select name="perfil" data-voz="opcao"><option value="examinador">Examinador</option><option value="estomaterapeuta">Estomaterapeuta</option><option value="admin">Administrador</option></select></div>
      <div><label>Senha inicial (mín. 8)</label><input name="senha" type="password" minlength="8" required autocomplete="new-password"></div></div>
      <div class="err" id="e"></div><button class="primary">Criar usuário</button></form>
      ${us.map((u) => `<div class="card"><div class="top"><div><b>${esc(u.nome)}</b> <span class="muted">(${esc(u.login)})</span>
        <div class="muted">${PERFIL[u.perfil]} · ${u.ativo ? 'ativo' : 'desativado'}</div></div>
        <div class="row nofill"><button class="small" data-reset="${u.id}">Nova senha</button>
        ${u.id !== user.id ? `<button class="small ${u.ativo ? 'danger' : ''}" data-ativo="${u.id}" data-v="${u.ativo ? 0 : 1}">${u.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}</div></div></div>`).join('')}`;
  } else if (tab === 'pacientes') {
    const ps = await api('/pacientes?q=' + encodeURIComponent(state.q || ''));
    body = `<input id="q" placeholder="Buscar paciente" value="${esc(state.q || '')}" data-voz="busca"><div class="spacer"></div>
      <p class="muted">Excluir remove o paciente, os registros e as fotos de forma definitiva (direito de eliminação).</p>
      ${ps.map((p) => `<div class="card top"><div><b>${esc(p.nome)}</b><div class="muted">Atend. ${esc(p.prontuario)}</div></div><div class="row nofill"><button class="small" data-pdf="${p.id}" data-at="${esc(p.prontuario)}">PDF</button><button class="small danger" data-del="${p.id}" data-nome="${esc(p.nome)}">Excluir</button></div></div>`).join('') || '<p class="muted">Nenhum paciente.</p>'}`;
  } else {
    const log = await api('/auditoria');
    body = `<div class="card"><table><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th></tr>${log.map((l) =>
      `<tr class="${String(l.acao).startsWith('seguranca_') ? 'alerta' : ''}"><td>${fmt(l.em)}</td><td>${esc(l.user_nome || '—')}</td><td>${esc(l.acao)}</td><td>${esc(l.alvo || '')}</td></tr>`).join('')}</table></div>`;
  }
  $('#app').innerHTML = shell(`${hero('Administração', 'Usuários, privacidade e auditoria')}${tabs}${body}`);
  bindShell(); habilitarVoz();
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
// Alertas push do administrador (Web Push)
const chaveParaBytes = (b64) => Uint8Array.from(atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function iniciarPush() {
  const st = $('#pst'), btn = $('#pushbtn'), teste = $('#pushteste'), erro = $('#pe');
  const msg = (t) => { st.textContent = t; };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return msg(SO() === 'ios' ? 'indisponível aqui. No iPhone, adicione o app à Tela de Início (compartilhar › Adicionar à Tela de Início) e abra por lá.' : 'este navegador não suporta notificações push.');
  }
  let cfg; try { cfg = await api('/push/chave'); } catch (e) { return msg(e.message); }
  if (!cfg.ativo) return msg('não configurado no servidor.');
  const reg = await navigator.serviceWorker.ready;
  const atual = async () => reg.pushManager.getSubscription();
  const mostrar = async () => {
    const sub = await atual();
    if (Notification.permission === 'denied') { msg('bloqueado nas configurações do navegador (libere as notificações deste site).'); btn.hidden = true; teste.hidden = true; return; }
    msg(sub ? 'ativado' : 'desativado'); btn.hidden = false; btn.textContent = sub ? 'Desativar alertas neste aparelho' : 'Ativar alertas neste aparelho'; btn.className = sub ? '' : 'primary'; teste.hidden = !sub;
  };
  btn.onclick = async () => {
    erro.textContent = '';
    try {
      const sub = await atual();
      if (sub) { await api('/push/cancelar', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      else {
        if (await Notification.requestPermission() !== 'granted') throw new Error('Permissão de notificação não concedida.');
        const novo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(cfg.chave) });
        await api('/push/inscrever', { method: 'POST', body: novo.toJSON() });
      }
    } catch (e) { erro.textContent = e.message; }
    mostrar();
  };
  teste.onclick = async () => { erro.textContent = ''; try { const r = await api('/push/teste', { method: 'POST' }); erro.innerHTML = r.enviados ? '<span class="okmsg">Notificação enviada. Ela deve aparecer em instantes.</span>' : 'Nenhuma notificação foi enviada. Desative e ative de novo.'; } catch (e) { erro.textContent = e.message; } };
  mostrar();
}
function renderConta() {
  const podeAviso = 'Notification' in window && user.perfil !== 'admin';
  $('#app').innerHTML = shell(`<form class="card pagina-form" id="f"><h2>Minha conta</h2><div class="muted">${esc(user.nome)} · ${esc(user.login)} · ${PERFIL[user.perfil]}</div>
    <h3>Alterar senha</h3><label>Senha atual</label><input name="atual" type="password" autocomplete="current-password" required>
    <label>Nova senha (mín. 8 caracteres)</label><input name="nova" type="password" minlength="8" autocomplete="new-password" required>
    <div class="err" id="e"></div><button class="primary">Salvar nova senha</button></form>
    ${podeAviso ? `<div class="card"><h3 style="margin-top:0">Avisos no aparelho</h3>
      <p class="muted">Receba um aviso quando chegar um caso novo ou uma devolutiva, enquanto o app estiver aberto. Status: <b id="np">${Notification.permission === 'granted' ? 'ativados' : 'desativados'}</b></p>
      <button id="avisos">Ativar avisos</button></div>` : ''}
    ${user.perfil === 'admin' || user.perfil === 'estomaterapeuta' ? `<div class="card" id="pushcard"><h3 style="margin-top:0">${user.perfil === 'admin' ? 'Alertas de segurança' : 'Lembretes de reavaliação'}</h3>
      <p class="muted">${user.perfil === 'admin' ? 'Receba uma notificação neste aparelho quando alguém tentar capturar a tela, imprimir ou copiar conteúdo, mesmo com o app fechado.' : 'Receba uma notificação neste aparelho no dia de cada reavaliação que você marcar, mesmo com o app fechado.'} No iPhone, primeiro adicione o app à Tela de Início e abra por lá.</p>
      <p>Status neste aparelho: <b id="pst">verificando…</b></p>
      <div class="acoes"><button class="primary" id="pushbtn" hidden>Ativar alertas neste aparelho</button><button id="pushteste" hidden>Enviar notificação de teste</button></div><div class="err" id="pe"></div></div>` : ''}`);
  bindShell(); if (user.perfil === 'admin' || user.perfil === 'estomaterapeuta') iniciarPush();
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
    <label>Nome completo *</label><input name="nome" required data-voz="nome">
    <div class="row tres"><div><label>Atendimento *</label><input name="prontuario" required data-voz="codigo"></div><div><label>Setor *</label><input name="setor" required placeholder="Ex.: UTI, Clínica Médica" data-voz="nome"></div><div><label>Leito</label><input name="leito" placeholder="Ex.: 12A" data-voz="codigo"></div></div>
    <div class="row"><div><label>Data de nascimento</label><input name="dataNascimento" type="date" data-voz="data"></div>
      <div><label>Sexo</label><select name="sexo" data-voz="opcao"><option value="">—</option><option>Feminino</option><option>Masculino</option><option>Outro</option></select></div>
      <div><label>Escala de Braden</label><input name="braden" type="number" min="6" max="23" placeholder="6 a 23" data-voz="num"></div></div>
    <label>Comorbidades</label>
    <div class="opcoes">${COMORB.map(([c, nome]) => `<label class="opc" title="${nome}"><input type="checkbox" name="comorb" value="${c}"><span>${c}</span></label>`).join('')}<label class="opc"><input type="checkbox" id="comorbOutros"><span>Outros</span></label></div>
    <div id="outrosBox" hidden><input name="comorbidadesOutros" placeholder="Descreva as outras comorbidades" data-voz="texto"></div>
    <h3>Consentimento (LGPD)</h3>
    <label class="check"><input type="checkbox" name="consentimento" required><span>O paciente ou responsável legal autorizou o registro fotográfico da lesão e o tratamento dos dados para acompanhamento clínico.</span></label>
    <label>Quem consentiu (nome e vínculo) *</label><input name="consentimentoPor" required placeholder="Ex.: a própria paciente / Maria (filha)" data-voz="texto">
    <div class="err" id="e"></div><div class="row nofill"><button type="button" id="cancel">Cancelar</button><button class="primary">Salvar paciente</button></div></form>`);
  bindShell(); habilitarVoz(); $('#cancel').onclick = () => go('home');
  $('#comorbOutros').onchange = (e) => { $('#outrosBox').hidden = !e.target.checked; if (e.target.checked) $('[name=comorbidadesOutros]').focus(); };
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target)); body.consentimento = ev.target.consentimento.checked;
    body.comorbidades = $$('[name=comorb]:checked', ev.target).map((c) => c.value); delete body.comorb;
    if (!$('#comorbOutros').checked) body.comorbidadesOutros = '';
    else if (!String(body.comorbidadesOutros || '').trim()) { $('#e').textContent = 'Descreva as outras comorbidades ou desmarque “Outros”.'; return; }
    try { const p = await api('/pacientes', { method: 'POST', body }); go('paciente', { id: p.id }); } catch (e) { $('#e').textContent = e.message; }
  };
}

// ---------- Assinatura da família (autorização de uso de imagem) ----------
async function renderAssinatura() {
  const [termo, p] = await Promise.all([api('/autorizacao/termo'), api('/pacientes/' + state.pacienteId)]);
  $('#app').innerHTML = shell(`<form class="card pagina-form" id="f"><h2>Autorização de uso de imagem</h2>
    <div class="muted">Paciente: <b>${esc(p.nome)}</b> · Atend. ${esc(p.prontuario)}</div>
    <div class="termo"><h3>${esc(termo.titulo)}</h3>${termo.paragrafos.map((t) => `<p>${esc(t)}</p>`).join('')}<small>Termo versão ${esc(termo.versao)}</small></div>
    <label>Nome de quem está assinando *</label><input name="signatario" required autocomplete="off" data-voz="nome">
    <div class="row"><div><label>Grau de parentesco / vínculo *</label><select name="parentesco" required data-voz="opcao"><option value="">Selecione…</option>${termo.parentescos.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
      <div><label>CPF ou RG (opcional)</label><input name="documento" inputmode="numeric" autocomplete="off" data-voz="digitos"></div></div>
    <label>Assinatura * <span class="muted">(use o dedo na área abaixo)</span></label>
    <div class="sig"><canvas id="sig" aria-label="Área de assinatura"></canvas><span class="sig-dica" id="sigDica">Assine aqui</span></div>
    <div class="sig-acoes"><button type="button" id="limpar">Limpar assinatura</button></div>
    <label class="check"><input type="checkbox" name="aceite" required><span>Li e concordo com o termo acima.</span></label>
    <div class="err" id="e"></div>
    <div class="row nofill"><button type="button" id="cancel">Cancelar</button><button class="primary" id="ok">Confirmar assinatura</button></div></form>`);
  bindShell(); habilitarVoz();
  $('#cancel').onclick = () => go('paciente', { id: p.id });
  const cv = $('#sig'), ctx = cv.getContext('2d');
  let desenhando = false, ultimo = null, tracado = 0;
  const ajustar = () => { // tamanho em pixels reais (nítido em telas de alta densidade)
    const r = cv.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * k); cv.height = Math.round(r.height * k);
    ctx.setTransform(k, 0, 0, k, 0, 0); ctx.lineWidth = 2.6; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1b3a';
    tracado = 0; $('#sigDica').hidden = false;
  };
  ajustar();
  const ponto = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId); desenhando = true; ultimo = ponto(e); $('#sigDica').hidden = true;
    ctx.beginPath(); ctx.arc(ultimo[0], ultimo[1], 0.8, 0, 7); ctx.fill(); tracado += 6;
  });
  cv.addEventListener('pointermove', (e) => {
    if (!desenhando) return; e.preventDefault();
    const pt = ponto(e); ctx.beginPath(); ctx.moveTo(...ultimo); ctx.lineTo(...pt); ctx.stroke();
    tracado += Math.hypot(pt[0] - ultimo[0], pt[1] - ultimo[1]); ultimo = pt;
  });
  const fim = () => { desenhando = false; };
  cv.addEventListener('pointerup', fim); cv.addEventListener('pointercancel', fim); cv.addEventListener('pointerleave', fim);
  $('#limpar').onclick = ajustar;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault(); $('#e').textContent = '';
    if (tracado < 60) { $('#e').textContent = 'Peça para a pessoa assinar na área indicada antes de confirmar.'; return; }
    const out = document.createElement('canvas'); // exporta com fundo branco, em tamanho moderado
    const k = Math.min(1, 700 / cv.width); out.width = Math.round(cv.width * k); out.height = Math.round(cv.height * k);
    const oc = out.getContext('2d'); oc.fillStyle = '#fff'; oc.fillRect(0, 0, out.width, out.height); oc.drawImage(cv, 0, 0, out.width, out.height);
    const f = ev.target; $('#ok').disabled = true;
    try {
      await api(`/pacientes/${p.id}/autorizacao`, { method: 'POST', body: { signatario: f.signatario.value, parentesco: f.parentesco.value, documento: f.documento.value, aceite: f.aceite.checked, assinatura: out.toDataURL('image/png') } });
      go('paciente', { id: p.id });
    } catch (e) { $('#e').textContent = e.message; $('#ok').disabled = false; }
  };
}

// Comparação lado a lado da evolução da lesão
function comparar(regs) {
  const com = regs.filter((r) => r.foto && !r.inativo).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
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

const comorbBloco = (p) => {
  const d = p.comorbidadesDetalhe;
  if (!d) return p.comorbidades ? `<p style="margin:14px 0 4px">${esc(p.comorbidades)}</p>` : ''; // cadastros antigos: texto livre
  const itens = [...d.lista.map((c) => `<span class="chip com" title="${esc((COMORB.find((x) => x[0] === c) || [])[1] || c)}">${esc(c)}</span>`), d.outros ? `<span class="chip com">Outros: ${esc(d.outros)}</span>` : ''].join('');
  return itens ? `<div class="chips" style="margin:14px 0 4px"><span class="muted" style="align-self:center">Comorbidades:</span>${itens}</div>` : '';
};
async function renderPaciente() {
  const p = await api('/pacientes/' + state.id);
  const aut = p.autorizacao, finalizado = p.situacao && p.situacao !== 'ativo';
  const idade = p.dataNascimento ? Math.floor((Date.now() - new Date(p.dataNascimento)) / 31557600000) + ' anos' : '';
  $('#app').innerHTML = shell(`<div class="card"><div class="pac-head">${avatar(p.nome, 'lg')}<div style="min-width:0"><h2>${esc(p.nome)}</h2>
      <div class="chips"><span class="chip">Atend. ${esc(p.prontuario)}</span>${p.setor ? `<span class="chip">${esc(p.setor)}</span>` : ''}${p.leito ? `<span class="chip">Leito ${esc(p.leito)}</span>` : ''}${idade ? `<span class="chip">${idade}</span>` : ''}${p.sexo ? `<span class="chip">${esc(p.sexo)}</span>` : ''}${p.braden ? `<span class="chip">Braden ${esc(p.braden)}</span>` : ''}</div></div></div>
    ${comorbBloco(p)}
    ${finalizado ? `<div class="sit sit-${p.situacao}"><b>Atendimento finalizado: ${SITUACAO[p.situacao]}</b><span>em ${fmt(p.finalizadoEm)}${p.finalizadoPorNome ? ' · por ' + esc(p.finalizadoPorNome) : ''}${p.finalizadoObs ? ' · ' + esc(p.finalizadoObs) : ''}</span></div>` : ''}
    <div class="muted" style="margin-top:10px">Consentimento: ${esc(p.consentimentoPor)} em ${fmt(p.consentimentoEm)}</div>
    <div class="aut ${aut && !aut.revogadaEm ? 'ok' : 'falta'}" id="aut">
      <div class="aut-txt"><b>Autorização de uso de imagem</b>
        <span>${aut && !aut.revogadaEm ? `Assinada por ${esc(aut.signatario)} (${esc(aut.parentesco)}) em ${fmt(aut.criadoEm)}`
          : aut ? `Revogada em ${fmt(aut.revogadaEm)}. Colete uma nova assinatura para fotografar.` : 'Ainda não assinada pela família.'}</span></div>
      ${aut && !aut.revogadaEm ? '<img id="assImg" class="aut-img" alt="Assinatura da família">' : ''}
      ${podeRegistrar() ? `<div class="aut-acoes"><button class="${aut && !aut.revogadaEm ? '' : 'primary'}" id="assinar">${I('plus')} ${aut && !aut.revogadaEm ? 'Nova assinatura' : 'Coletar assinatura da família'}</button>
        ${aut && !aut.revogadaEm ? '<button id="revogar" class="perigo">Registrar revogação</button>' : ''}</div>` : ''}
    </div>
    <div class="acoes">${podeRegistrar() && !finalizado ? `<button class="primary" id="nova">${I('plus')} Nova lesão / foto</button>` : ''}
    ${user.perfil === 'estomaterapeuta' ? (finalizado ? `<button id="reabrir">Reabrir atendimento</button>` : `<button id="finalizar">${I('check')} Finalizar atendimento</button>`) : ''}
    ${user.perfil !== 'examinador' && p.registros.some((r) => r.status !== 'rascunho') ? `<button id="pdfhist">${I('file')} Baixar histórico completo (PDF)</button>` : ''}</div><div class="err" id="e"></div></div>
    <div class="sec-h"><h2>Histórico de lesões</h2></div>
    ${p.registros.length ? `<div class="timeline">${p.registros.map((r) => `<div class="tl-item"><span class="tl-dot ${r.inativo ? 'inativo' : r.status}"></span>${cardRegistro(r)}</div>`).join('')}</div>` : vazio('camera', 'Nenhum registro ainda', 'Use “Nova lesão / foto” para começar o acompanhamento.')}
    <div class="card"><div class="sec-h" style="margin-top:0"><h2>Evolução</h2></div>${comparar(p.registros)}</div>
    <div class="acoes"><button id="back">← Voltar</button></div>`);
  bindShell(); bindRegs(); bindComparar(p.registros);
  $('#back').onclick = () => go('home');
  if ($('#pdfhist')) $('#pdfhist').onclick = async () => { try { await baixarPdf(`/pacientes/${p.id}/pdf`, `historico-lesoes-${p.prontuario}.pdf`); } catch (e) { $('#e').textContent = e.message; } };
  if ($('#nova')) $('#nova').onclick = () => go('novoRegistro', { pacienteId: p.id });
  if ($('#finalizar')) $('#finalizar').onclick = async () => {
    const v = await janela('Finalizar atendimento', `<p class="muted">Escolha como o atendimento termina. Depois disso não é possível registrar novas lesões nem receber lembretes de reavaliação (você pode reabrir se precisar).</p>
      <label class="check"><input type="radio" name="sit" value="alta"><span><b>Alta</b></span></label><label class="check"><input type="radio" name="sit" value="obito"><span><b>Óbito</b></span></label>
      <label>Observação (opcional)</label><textarea name="obs" data-voz></textarea>`, 'Finalizar atendimento',
      (m) => { const o = $('[name=sit]:checked', m); return o ? { situacao: o.value, observacao: $('[name=obs]', m).value.trim() } : { erro: 'Escolha Alta ou Óbito.' }; });
    if (!v) return;
    try { await api(`/pacientes/${p.id}/finalizar`, { method: 'POST', body: v }); render(); } catch (e) { $('#e').textContent = e.message; }
  };
  if ($('#reabrir')) $('#reabrir').onclick = async () => {
    if (!confirm('Reabrir este atendimento? Ele volta para “Em atendimento” e novas lesões poderão ser registradas.')) return;
    try { await api(`/pacientes/${p.id}/reabrir`, { method: 'POST' }); render(); } catch (e) { $('#e').textContent = e.message; }
  };
  if ($('#assinar')) $('#assinar').onclick = () => go('assinatura', { pacienteId: p.id });
  if ($('#assImg')) api(`/pacientes/${p.id}/autorizacao/assinatura`, { raw: true }).then(async (r) => { $('#assImg').src = URL.createObjectURL(await r.blob()); }).catch(() => {});
  if ($('#revogar')) $('#revogar').onclick = async () => {
    if (!confirm('Registrar que a família revogou a autorização de uso de imagem? Novas fotos só poderão ser feitas após nova assinatura.')) return;
    try { await api(`/pacientes/${p.id}/autorizacao/revogar`, { method: 'POST' }); render(); } catch (e) { $('#e').textContent = e.message; }
  };
}

// ---------- Registro ----------
function renderNovoRegistro() {
  $('#app').innerHTML = shell(`<form class="card pagina-form" id="f"><h2>Nova lesão</h2>
    <label>Localização anatômica</label><input name="local" data-voz="texto" placeholder="Ex.: região sacral, calcâneo direito">
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
  const podeInativar = !rascunho && (user.perfil === 'estomaterapeuta' || (isEx && r.criadoPor === user.id));
  const finalizado = r.paciente?.situacao && r.paciente.situacao !== 'ativo';
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
  ${r.inativo ? `<div class="card aviso-inativo"><b>Registro inativado</b><span>por ${esc(r.inativo.porNome)} em ${fmt(r.inativo.em)} — motivo: ${esc(r.inativo.motivo)}</span>
    ${podeInativar ? '<button id="reativar">Reativar registro</button>' : ''}</div>` : ''}
  ${finalizado && rascunho ? `<div class="card aviso-aut"><b>Atendimento finalizado (${SITUACAO[r.paciente.situacao]})</b><span>Não é possível enviar este rascunho. A estomaterapeuta pode reabrir o atendimento.</span></div>` : ''}
  ${r.paciente?.autorizado === false && r.status === 'rascunho' && podeRegistrar() ? `<div class="card aviso-aut"><b>Falta a autorização de uso de imagem.</b><span>A família ainda não assinou o termo deste paciente. Colete a assinatura antes de fotografar a lesão.</span><button id="irAssinar">Coletar assinatura agora</button></div>` : ''}
  ${av ? `<div class="card"><h2>Devolutiva da estomaterapeuta</h2><div class="muted">${esc(av.avaliadoPorNome)} · ${fmt(av.avaliadoEm)}</div>
     ${av.estagio ? `<h3>Classificação</h3><p style="margin:0">${ESTAGIO[av.estagio]}</p>` : ''}
     <h3>Tratamento indicado</h3><div class="devolutiva">${esc(av.tratamento)}</div>
     <h3>Orientações</h3><div class="devolutiva">${esc(av.orientacoes)}</div>
     ${av.retornoDias != null ? `<p class="muted">Reavaliar em ${av.retornoDias} dia(s)${r.reavaliarEm ? ` — ${fmtDia(r.reavaliarEm)}` : ''}.</p>` : ''}
     <div class="acoes">${user.perfil !== 'examinador' && !r.inativo ? `<button class="primary" id="pdf">${I('file')} Baixar relatório (PDF)</button>` : ''}
     ${user.perfil === 'estomaterapeuta' && !r.inativo ? '<button id="refazer" class="perigo">Inativar minha avaliação (refazer)</button>' : ''}</div></div>`
   : r.status === 'enviado' && isEx ? `<div class="card">${vazio('clock', 'Aguardando avaliação da estomaterapeuta', 'Você será avisado quando a devolutiva chegar.')}</div>` : ''}
  ${user.perfil === 'estomaterapeuta' && r.status === 'enviado' ? `<form class="card" id="av"><h2>Sua avaliação</h2>
    <label>Classificação da lesão</label><select name="estagio" data-voz="opcao"><option value="">—</option>${Object.entries(ESTAGIO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <label>Tratamento indicado *</label><textarea name="tratamento" required data-voz placeholder="Limpeza, cobertura, frequência de troca..."></textarea>
    <label>Orientações *</label><textarea name="orientacoes" required data-voz placeholder="Reposicionamento, superfície de suporte, nutrição, sinais de alerta..."></textarea>
    <label>Reavaliar em</label>
    <div class="opcoes" id="reaval">${REAVAL_DIAS.map((n) => `<label class="opc"><input type="checkbox" name="rd" value="${n}"><span>${n} dias</span></label>`).join('')}</div>
    <div class="muted">Marque um prazo e você receberá uma notificação no dia da reavaliação.</div>
    <div class="err" id="e2"></div><button class="primary" style="width:100%">Enviar devolutiva</button></form>` : ''}
  ${r.avaliacaoHistorico?.length ? `<details class="card"><summary><b>Avaliações inativadas (${r.avaliacaoHistorico.length})</b></summary>${r.avaliacaoHistorico.map((h) => `<div class="hist-aval"><div class="muted">Avaliada por ${esc(h.avaliadoPorNome)} em ${fmt(h.avaliadoEm)} · inativada por ${esc(h.inativadaPorNome)} em ${fmt(h.inativadaEm)}</div>
    <div><b>Motivo:</b> ${esc(h.motivo)}</div><div class="muted">Tratamento que havia sido indicado: ${esc(h.tratamento)}</div></div>`).join('')}</details>` : ''}
  ${podeInativar && !r.inativo ? '<div class="acoes"><button id="inativar" class="perigo">Inativar este registro (lançado por engano)</button></div>' : ''}
  <div class="acoes"><button id="back">← Voltar</button><button id="hist">Ver histórico do paciente</button></div></div></div>`);
  bindShell(); habilitarVoz();
  $('#back').onclick = () => go('home');
  $('#hist').onclick = () => go('paciente', { id: r.pacienteId });
  if ($('#irAssinar')) $('#irAssinar').onclick = () => go('assinatura', { pacienteId: r.pacienteId });
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
  const corrigir = (acao, titulo, dica, ok) => async () => {
    const motivo = await pedirMotivo(titulo, dica, ok); if (!motivo) return;
    try { await api(`/registros/${r.id}/${acao}`, { method: 'POST', body: { motivo } }); render(); } catch (e) { $('#e').textContent = e.message || (alert(e.message), ''); }
  };
  if ($('#inativar')) $('#inativar').onclick = corrigir('inativar', 'Inativar este registro', 'O registro sai das filas e dos relatórios, mas continua no histórico com o motivo. Use quando foi lançado por engano (paciente ou foto errados, por exemplo).', 'Inativar registro');
  if ($('#refazer')) $('#refazer').onclick = corrigir('refazer-avaliacao', 'Inativar minha avaliação', 'Sua devolutiva fica guardada como inativada (com o motivo) e o caso volta para “Aguardando” para você avaliar de novo.', 'Inativar e refazer');
  if ($('#reativar')) $('#reativar').onclick = async () => { if (!confirm('Reativar este registro?')) return; try { await api(`/registros/${r.id}/reativar`, { method: 'POST' }); render(); } catch (e) { alert(e.message); } };
  if ($('#reaval')) $$('#reaval input').forEach((c) => (c.onchange = () => { if (c.checked) $$('#reaval input').forEach((o) => { if (o !== c) o.checked = false; }); })); // um prazo só
  if ($('#pdf')) $('#pdf').onclick = async () => { try { await baixarPdf(`/registros/${r.id}/pdf`, `relatorio-lesao-${r.paciente?.prontuario || r.id}.pdf`); } catch (e) { $('#e').textContent = e.message; } };
  if ($('#av')) $('#av').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target)); body.retornoDias = $('#reaval input:checked')?.value || ''; delete body.rd;
    try { await api(`/registros/${r.id}/avaliacao`, { method: 'POST', body }); render(); }
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
    if (v === 'assinatura') return await renderAssinatura();
    if (v === 'registro') return await renderRegistro();
  } catch (e) { if (token) { $('#app').innerHTML = shell(`<p class="err">${esc(e.message)}</p>`); bindShell(); } }
}
iniciarProtecao();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
