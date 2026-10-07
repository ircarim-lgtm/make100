'use strict';
const $ = (s) => document.querySelector(s);
const view = $('#view'), title = $('#title'), backBtn = $('#back');
let state = { sectors: [], pumps: [] };
let stream = null, scanTimer = null;

// ---------- utilidades ----------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) e.append(c instanceof Node ? c : document.createTextNode(c ?? ''));
  return e;
}
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 2800);
}
async function api(path, method = 'GET', body) {
  const code = localStorage.getItem('accessCode') || '';
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'x-access-code': code }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    const c = prompt('Código de acesso:');
    if (c) { localStorage.setItem('accessCode', c); return api(path, method, body); }
  }
  if (!r.ok) throw new Error(data.error || 'Erro ' + r.status);
  return data;
}
async function refresh() { state = await api('/state'); }
const fmtDate = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const fmtDay = (d) => (d ? d.split('-').reverse().join('/') : '—');
const expired = (d) => d && d < new Date().toISOString().slice(0, 10);

// O QR da etiqueta traz o patrimônio (ex.: HMMKB-234-0285). Se vier URL/texto extra, extrai o padrão.
function normalizeCode(text) {
  const t = String(text).trim();
  const m = t.match(/[A-Z]{2,}-\d+(?:-\d+)+/i);
  return (m ? m[0] : t).toUpperCase();
}

function setHeader(t, back) {
  title.textContent = t;
  backBtn.hidden = !back;
  backBtn.onclick = back || null;
}
function setTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
}
function stopScan() {
  clearInterval(scanTimer); scanTimer = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}
function sectorBadge(p) { return h('span', { class: 'badge' + (p.sector ? '' : ' none') }, p.sector || 'Sem setor'); }

// ---------- telas ----------
async function scanView() {
  stopScan(); setTab('scan'); setHeader('Escanear QR Code');
  const video = h('video', { playsinline: true, muted: true });
  const manual = h('input', { placeholder: 'Ex.: HMMKB-234-0285', autocapitalize: 'characters' });
  const status = h('p', { class: 'mute' }, 'Aponte a câmera para o QR Code da bomba.');
  view.replaceChildren(
    h('div', { class: 'scanbox' }, video), status,
    h('div', { class: 'card' },
      h('h2', {}, 'Digitar código'),
      manual,
      h('button', { class: 'btn', onclick: () => manual.value.trim() && openCode(normalizeCode(manual.value)) }, 'Buscar')),
  );
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = stream; await video.play();
  } catch {
    status.textContent = 'Não foi possível abrir a câmera (precisa de HTTPS e permissão). Digite o código abaixo.';
    return;
  }
  const detector = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  let busy = false;
  scanTimer = setInterval(async () => {
    if (busy || video.readyState < 2) return;
    busy = true;
    try {
      let text = '';
      if (detector) { const r = await detector.detect(video); text = r[0]?.rawValue || ''; }
      else {
        const w = (canvas.width = Math.min(video.videoWidth, 640)), hh = (canvas.height = Math.round(w * video.videoHeight / video.videoWidth));
        ctx.drawImage(video, 0, 0, w, hh);
        text = jsQR(ctx.getImageData(0, 0, w, hh).data, w, hh)?.data || '';
      }
      if (text) { navigator.vibrate?.(60); openCode(normalizeCode(text)); }
    } catch { /* quadro sem QR */ }
    busy = false;
  }, 250);
}

async function openCode(code) {
  stopScan();
  try { pumpView(await api('/pumps/' + encodeURIComponent(code))); }
  catch (e) { if (/não encontrada/i.test(e.message)) newPumpView(code); else toast(e.message, true) }
}

function newPumpView(code) {
  setTab('scan'); setHeader('Nova bomba', scanView);
  const f = {
    code: h('input', { value: code }), name: h('input', { placeholder: 'Ex.: Bomba B. Braun Infusomat' }), model: h('input', { placeholder: 'Modelo' }),
    serial: h('input', { placeholder: 'Ex.: C24377' }), cal: h('input', { type: 'date' }),
    sector: h('select', {}, h('option', { value: '' }, 'Selecione o setor'), state.sectors.map((s) => h('option', { value: s }, s))),
    who: h('input', { placeholder: 'Seu nome', value: localStorage.getItem('who') || '' }),
  };
  view.replaceChildren(h('div', { class: 'card' },
    h('p', {}, 'Esta bomba ainda não está cadastrada.'),
    h('label', {}, 'Código (patrimônio)'), f.code, h('label', {}, 'Nome / descrição'), f.name, h('label', {}, 'Modelo'), f.model,
    h('label', {}, 'Nº de série'), f.serial, h('label', {}, 'Calibração válida até'), f.cal,
    h('label', {}, 'Setor atual'), f.sector, h('label', {}, 'Responsável'), f.who,
    h('button', { class: 'btn alt', onclick: async () => {
      try {
        localStorage.setItem('who', f.who.value);
        const p = await api('/pumps', 'POST', { code: normalizeCode(f.code.value), name: f.name.value, model: f.model.value, serial: f.serial.value, calibrationDue: f.cal.value, sector: f.sector.value, who: f.who.value });
        await refresh(); toast('Bomba cadastrada'); pumpView(p);
      } catch (e) { toast(e.message, true); }
    } }, 'Cadastrar')));
}

function pumpView(p) {
  setTab('scan'); setHeader(p.name, scanView);
  let chosen = p.sector;
  const chips = h('div', { class: 'chips' });
  const drawChips = () => chips.replaceChildren(...state.sectors.map((s) => h('button', { class: 'chip' + (s === chosen ? ' on' : ''), onclick: () => { chosen = s; drawChips(); } }, s)));
  drawChips();
  const who = h('input', { placeholder: 'Seu nome', value: localStorage.getItem('who') || '' });
  const note = h('input', { placeholder: 'Observação (opcional)' });
  const expiredCal = expired(p.calibrationDue);
  view.replaceChildren(
    h('div', { class: 'card' },
      h('p', { class: 'mute' }, 'Patrimônio: ', h('b', {}, p.code)),
      p.model && h('p', { class: 'mute' }, 'Modelo: ' + p.model),
      p.serial && h('p', { class: 'mute' }, 'Série: ' + p.serial),
      h('p', { class: 'mute' }, 'Calibração até: ', h('b', {}, fmtDay(p.calibrationDue)), expiredCal ? h('span', { class: 'badge none' }, ' VENCIDA') : ''),
      h('p', {}, 'Setor atual: ', sectorBadge(p))),
    h('div', { class: 'card' },
      h('h2', {}, 'Registrar novo setor'), chips,
      h('label', {}, 'Responsável'), who, h('label', {}, 'Observação'), note,
      h('button', { class: 'btn alt', onclick: async () => {
        if (!chosen) return toast('Escolha o setor', true);
        try {
          localStorage.setItem('who', who.value);
          const u = await api(`/pumps/${encodeURIComponent(p.code)}/move`, 'POST', { sector: chosen, who: who.value, note: note.value });
          await refresh(); toast('Setor registrado'); pumpView(u);
        } catch (e) { toast(e.message, true); }
      } }, 'Salvar setor')),
    h('div', { class: 'card' }, h('h2', {}, 'Histórico'),
      p.history.map((x) => h('div', { class: 'hist' }, h('b', {}, x.sector || '—'), ' · ' + fmtDate(x.at), x.who ? ' · ' + x.who : '', x.note ? h('div', { class: 'mute' }, x.note) : ''))),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => labelView(p) }, 'Etiqueta QR'),
      h('button', { class: 'btn small', onclick: () => editView(p) }, 'Editar dados')),
  );
}

function editView(p) {
  setHeader('Editar bomba', () => pumpView(p));
  const f = { name: h('input', { value: p.name }), model: h('input', { value: p.model }), serial: h('input', { value: p.serial }), cal: h('input', { type: 'date', value: p.calibrationDue || '' }) };
  view.replaceChildren(h('div', { class: 'card' },
    h('label', {}, 'Nome'), f.name, h('label', {}, 'Modelo'), f.model, h('label', {}, 'Nº de série'), f.serial, h('label', {}, 'Calibração válida até'), f.cal,
    h('button', { class: 'btn', onclick: async () => {
      try { const u = await api('/pumps/' + encodeURIComponent(p.code), 'PUT', { name: f.name.value, model: f.model.value, serial: f.serial.value, calibrationDue: f.cal.value }); await refresh(); pumpView(u); }
      catch (e) { toast(e.message, true); }
    } }, 'Salvar'),
    h('button', { class: 'btn danger', onclick: async () => {
      if (!confirm('Excluir esta bomba e todo o histórico?')) return;
      await api('/pumps/' + encodeURIComponent(p.code), 'DELETE'); await refresh(); listView();
    } }, 'Excluir bomba')));
}

function labelView(p) {
  setHeader('Etiqueta QR', () => pumpView(p));
  const qr = qrcode(0, 'M'); qr.addData(p.code); qr.make();
  const box = h('div', { class: 'qr', id: 'printarea' }, h('div', { class: 'label' }, (() => { const d = h('div'); d.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 }); return d; })(), h('b', {}, p.code), h('div', {}, p.name)));
  view.replaceChildren(h('div', { class: 'card' }, box, h('button', { class: 'btn', onclick: () => print() }, 'Imprimir')));
}

async function listView() {
  stopScan(); setTab('list'); setHeader('Bombas');
  await refresh();
  const q = h('input', { placeholder: 'Buscar por código, nome, série ou setor' });
  const list = h('div', { class: 'card' });
  const draw = () => {
    const t = q.value.toLowerCase();
    const rows = state.pumps.filter((p) => [p.code, p.name, p.serial, p.sector, p.model].join(' ').toLowerCase().includes(t)).sort((a, b) => a.code.localeCompare(b.code));
    list.replaceChildren(...(rows.length ? rows.map((p) => h('div', { class: 'item', onclick: () => openCode(p.code) }, h('div', {}, h('b', {}, p.code), h('br'), h('small', {}, p.name + (expired(p.calibrationDue) ? ' · calibração vencida' : ''))), sectorBadge(p))) : [h('p', { class: 'mute' }, 'Nenhuma bomba cadastrada. Escaneie um QR para começar.')]));
  };
  q.addEventListener('input', draw); draw();
  view.replaceChildren(q, h('p'), list);
}

async function sectorsView() {
  stopScan(); setTab('sectors'); setHeader('Setores');
  await refresh();
  const name = h('input', { placeholder: 'Novo setor' });
  const count = (s) => state.pumps.filter((p) => p.sector === s).length;
  view.replaceChildren(
    h('div', { class: 'card' }, state.sectors.map((s) => h('div', { class: 'item' },
      h('div', {}, h('b', {}, s), h('br'), h('small', {}, count(s) + ' bomba(s)')),
      h('button', { class: 'btn small danger', onclick: async () => { try { await api('/sectors/' + encodeURIComponent(s), 'DELETE'); sectorsView(); } catch (e) { toast(e.message, true); } } }, 'Remover')))),
    h('div', { class: 'card' }, name, h('button', { class: 'btn', onclick: async () => { try { await api('/sectors', 'POST', { name: name.value }); sectorsView(); } catch (e) { toast(e.message, true); } } }, 'Adicionar setor')));
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => ({ scan: scanView, list: listView, sectors: sectorsView })[b.dataset.go]()));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refresh().catch(() => {}).then(scanView);
