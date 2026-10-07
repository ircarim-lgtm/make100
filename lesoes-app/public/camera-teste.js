// Diagnóstico da câmera: mostra passo a passo o que o navegador permite.
const saida = document.getElementById('saida'), video = document.getElementById('video');
const linhas = [];
const log = (t) => { linhas.push(t); saida.textContent = linhas.join('\n'); };
let stream;

document.getElementById('iniciar').onclick = async () => {
  linhas.length = 0; stream?.getTracks().forEach((t) => t.stop());
  log(`Navegador: ${navigator.userAgent}`);
  log(`Conexão segura (https): ${window.isSecureContext ? 'sim' : 'NÃO'}`);
  log(`API de câmera disponível: ${navigator.mediaDevices?.getUserMedia ? 'sim' : 'NÃO'}`);
  log(`Dentro de outro site/app (iframe): ${window.top !== window ? 'sim' : 'não'}`);
  try { const p = await navigator.permissions.query({ name: 'camera' }); log(`Permissão atual da câmera: ${p.state}`); } catch { log('Permissão atual da câmera: (este navegador não informa)'); }
  if (!navigator.mediaDevices?.getUserMedia) { log('RESULTADO: este navegador não oferece câmera para sites. Use o Safari (iPhone) ou o Chrome (Android) abrindo o endereço direto.'); return; }
  try { const lista = await navigator.mediaDevices.enumerateDevices(); log(`Câmeras encontradas: ${lista.filter((d) => d.kind === 'videoinput').length}`); } catch (e) { log(`Listar câmeras falhou: ${e.name}`); }
  log('Pedindo acesso à câmera… (o navegador deve mostrar um aviso para permitir)');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = stream; video.style.display = 'block';
    try { await video.play(); } catch (e) { log(`Aviso ao iniciar o vídeo: ${e.name}`); }
    const t = stream.getVideoTracks()[0], cfg = t.getSettings ? t.getSettings() : {};
    log(`RESULTADO: FUNCIONOU. Câmera: ${t.label || '(sem nome)'} ${cfg.width || '?'}x${cfg.height || '?'}`);
  } catch (e) {
    log(`RESULTADO: FALHOU. Erro: ${e.name}${e.message ? ' - ' + e.message : ''}`);
    if (e.name === 'NotAllowedError') log('Dica: a câmera está bloqueada para este site. iPhone: Ajustes › Safari › Câmera (Perguntar/Permitir). Chrome: cadeado ao lado do endereço › Permissões.');
    if (e.name === 'NotFoundError') log('Dica: nenhuma câmera encontrada.');
    if (e.name === 'NotReadableError') log('Dica: outro aplicativo pode estar usando a câmera. Feche-os e tente de novo.');
  }
};
