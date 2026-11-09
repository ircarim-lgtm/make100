// Notificações push (Web Push, gratuito): avisos de segurança para o administrador, mesmo com o app fechado.
// Precisa de VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY (gere com: npx web-push generate-vapid-keys). Sem elas, o recurso fica desligado.
import * as webpush from 'web-push';

const PUB = process.env.VAPID_PUBLIC_KEY, PRIV = process.env.VAPID_PRIVATE_KEY;
export const pushAtivo = () => !!(PUB && PRIV);
export const chavePublica = () => PUB || '';
if (pushAtivo()) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://localhost', PUB, PRIV); // subject: endereço do site, não e-mail pessoal

/** Envia uma notificação; lança erro com statusCode 404/410 quando a inscrição não vale mais. */
export async function enviar(sub, payload) {
  if (globalThis.__pushTeste) return globalThis.__pushTeste(sub, payload); // gancho dos testes automáticos
  return webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high', timeout: 5000 });
}
