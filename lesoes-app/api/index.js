// Entrada única das funções da Vercel. O vercel.json reescreve /api/<qualquer/caminho> para cá
// com o caminho original em ?__p=..., que restauramos antes de chamar o handler.
import { handler } from '../server.js';

export default function (req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.searchParams.get('__p');
  if (p !== null) {
    u.searchParams.delete('__p');
    req.url = '/api/' + p + u.search;
  }
  return handler(req, res);
}
