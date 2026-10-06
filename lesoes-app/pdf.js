// Relatórios em PDF (pdfkit): avaliação individual e histórico completo do paciente.
import PDFDocument from 'pdfkit';

const COR = '#0e7490', CLARO = '#e0f2fe', CINZA = '#68797f';
const W = 595.28, H = 841.89, M = 50, CW = W - 2 * M;
const TZ = 'America/Sao_Paulo';
const ESTAGIO = { 1: 'Estágio 1', 2: 'Estágio 2', 3: 'Estágio 3', 4: 'Estágio 4', nao_classificavel: 'Não classificável', tissular_profunda: 'Lesão tissular profunda' };

const dh = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ }) : '—');
const dt = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ }) : '—');
const idade = (nasc) => (nasc ? `${Math.floor((Date.now() - new Date(nasc)) / 31557600000)} anos` : '');

function novoDoc(titulo) {
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: titulo, Author: 'Lesões por Pressão' } });
  doc.rect(0, 0, W, 72).fill(COR);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text(titulo, M, 24, { width: CW });
  doc.fillColor('#000');
  doc.y = 96;
  return doc;
}

const espaco = (doc, h) => { if (doc.y + h > H - 70) { doc.addPage(); doc.y = M; } };

function secao(doc, texto) {
  espaco(doc, 40);
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).fillColor(COR).text(texto.toUpperCase(), M, doc.y);
  const y = doc.y + 2;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor(COR).lineWidth(0.7).stroke();
  doc.y = y + 6; doc.fillColor('#000');
}

function campo(doc, rotulo, valor) {
  espaco(doc, 16);
  doc.font('Helvetica-Bold').fontSize(10).text(`${rotulo}: `, M, doc.y, { continued: true, width: CW })
    .font('Helvetica').text(valor || '—');
}

function caixa(doc, titulo, texto) {
  doc.font('Helvetica').fontSize(10);
  const h = doc.heightOfString(texto, { width: CW - 22 }) + 16;
  espaco(doc, h + 20);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COR).text(titulo, M, doc.y); doc.fillColor('#000');
  const y = doc.y + 3;
  doc.rect(M, y, CW, h).fill(CLARO); doc.rect(M, y, 3, h).fill(COR);
  doc.fillColor('#000').font('Helvetica').fontSize(10).text(texto, M + 12, y + 8, { width: CW - 22 });
  doc.y = y + h + 8;
}

function dadosPaciente(doc, p) {
  secao(doc, 'Paciente');
  campo(doc, 'Nome', p.nome);
  campo(doc, 'Atendimento', p.prontuario);
  campo(doc, 'Setor', p.setor);
  campo(doc, 'Leito', p.leito);
  const extra = [idade(p.data_nascimento), p.sexo, p.braden ? `Braden ${p.braden}` : ''].filter(Boolean).join(' · ');
  if (p.data_nascimento) campo(doc, 'Nascimento', `${dt(p.data_nascimento + 'T12:00:00Z')}${extra ? ' (' + extra + ')' : ''}`);
  else if (extra) campo(doc, 'Dados clínicos', extra);
  if (p.comorbidades) campo(doc, 'Comorbidades / observações', p.comorbidades);
}

function foto(doc, buf) {
  if (!buf) return;
  try {
    const img = doc.openImage(buf);
    const k = Math.min(300 / img.width, 230 / img.height, 1);
    const w = img.width * k, h = img.height * k;
    espaco(doc, h + 10);
    const y = doc.y;
    doc.image(img, M, y, { width: w });
    doc.rect(M, y, w, h).strokeColor('#d5dde0').lineWidth(0.5).stroke();
    doc.y = y + h + 8;
  } catch { // ex.: WebP não é suportado pelo gerador de PDF
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(CINZA).text('(foto em formato não suportado no PDF; disponível no aplicativo)', M, doc.y).fillColor('#000');
    doc.moveDown(0.4);
  }
}

function blocoLesao(doc, r, fotoBuf, comFoto = true) {
  campo(doc, 'Localização', r.local);
  campo(doc, 'Registrado por', `${r.criado_por_nome} em ${dh(r.criado_em)}`);
  if (r.enviado_em) campo(doc, 'Enviado para avaliação', dh(r.enviado_em));
  if (r.observacoes) campo(doc, 'Observações do examinador', r.observacoes);
  doc.moveDown(0.4);
  if (comFoto && r.foto_arquivo) foto(doc, fotoBuf);
  const av = r.avaliacao ? JSON.parse(r.avaliacao) : null;
  if (!av) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(CINZA).text('Aguardando avaliação da estomaterapeuta.', M, doc.y).fillColor('#000');
    doc.moveDown(0.5);
    return;
  }
  doc.font('Helvetica-Bold').fontSize(10).text('Avaliação da estomaterapeuta', M, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor(CINZA).text(`${av.avaliadoPorNome} · ${dh(av.avaliadoEm)}`, M, doc.y).fillColor('#000');
  doc.moveDown(0.3);
  if (av.estagio) campo(doc, 'Classificação', ESTAGIO[av.estagio]);
  doc.moveDown(0.3);
  caixa(doc, 'Tratamento indicado', av.tratamento);
  caixa(doc, 'Orientações', av.orientacoes);
  if (av.retornoDias != null) {
    const prev = new Date(new Date(av.avaliadoEm).getTime() + av.retornoDias * 86400000).toISOString();
    campo(doc, 'Reavaliação', `em ${av.retornoDias} dia(s) — previsão ${dt(prev)}`);
  }
}

function rodape(doc, geradoPor) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // permite escrever na área do rodapé sem criar página nova
    const y = H - 48;
    doc.moveTo(M, y - 6).lineTo(W - M, y - 6).strokeColor('#d5dde0').lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(CINZA)
      .text(`Documento confidencial — contém dados pessoais sensíveis de saúde (LGPD). Gerado por ${geradoPor} em ${dh(new Date().toISOString())}.`, M, y, { width: CW - 60, lineBreak: true })
      .text(`Página ${i + 1} de ${count}`, W - M - 60, y, { width: 60, align: 'right' });
  }
}

/** Relatório de uma avaliação (um registro já avaliado). */
export function relatorioRegistro({ paciente, registro, fotoBuf, geradoPor }) {
  const doc = novoDoc('Relatório de avaliação de lesão por pressão');
  dadosPaciente(doc, paciente);
  secao(doc, 'Lesão e avaliação');
  blocoLesao(doc, registro, fotoBuf);
  rodape(doc, geradoPor);
  return doc;
}

/** Histórico completo: resumo da evolução + cada lesão (mais antiga primeiro). */
export function relatorioHistorico({ paciente, registros, fotos, geradoPor }) {
  const doc = novoDoc('Histórico de lesões por pressão');
  dadosPaciente(doc, paciente);
  secao(doc, `Resumo da evolução (${registros.length} registro${registros.length === 1 ? '' : 's'})`);
  const COLS = [[M, 80], [M + 80, 190], [M + 270, 130], [M + 400, 95]];
  const linha = (vals, bold) => {
    espaco(doc, 16);
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    vals.forEach((v, i) => doc.text(v, COLS[i][0], y, { width: COLS[i][1] - 6, lineBreak: false, ellipsis: true }));
    doc.y = y + 14;
  };
  linha(['Data', 'Localização', 'Classificação', 'Situação'], true);
  for (const r of registros) {
    const av = r.avaliacao ? JSON.parse(r.avaliacao) : null;
    linha([dt(r.criado_em), r.local || '—', av?.estagio ? ESTAGIO[av.estagio] : '—', av ? 'Avaliado' : 'Aguardando']);
  }
  registros.forEach((r, i) => {
    doc.addPage(); doc.y = M;
    secao(doc, `Registro ${i + 1} de ${registros.length} — ${r.local || 'localização não informada'}`);
    blocoLesao(doc, r, fotos.get(r.id));
  });
  rodape(doc, geradoPor);
  return doc;
}
