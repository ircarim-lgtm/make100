// Termo de autorização de uso de imagem (assinado pela família/paciente na tela do celular).
// Alterou o texto? Aumente TERMO_VERSAO: cada assinatura guarda a versão e o hash do texto que foi lido.
import crypto from 'node:crypto';

export const TERMO_VERSAO = '1.0';
export const TERMO_TITULO = 'Autorização para registro e uso de imagem';
export const TERMO_PARAGRAFOS = [
  'Autorizo o registro fotográfico da lesão por pressão do paciente identificado neste atendimento, realizado pela equipe de saúde.',
  'As imagens serão usadas exclusivamente para acompanhamento clínico, avaliação pela estomaterapeuta, definição de tratamento e registro da evolução no prontuário.',
  'As fotos serão armazenadas de forma protegida, com acesso restrito aos profissionais envolvidos no cuidado, e serão tratadas conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).',
  'O rosto e outros elementos que identifiquem o paciente não serão fotografados, salvo necessidade clínica.',
  'Estou ciente de que posso revogar esta autorização a qualquer momento, sem prejuízo ao atendimento, solicitando à equipe.',
];
export const TERMO_HASH = crypto.createHash('sha256').update(TERMO_VERSAO + TERMO_TITULO + TERMO_PARAGRAFOS.join('\n')).digest('hex');
export const PARENTESCOS = ['O próprio paciente', 'Cônjuge / companheiro(a)', 'Filho(a)', 'Pai / Mãe', 'Irmão(ã)', 'Outro familiar', 'Responsável legal / curador'];
