# Acompanhamento de Lesões por Pressão

Fluxo: **Examinador** cadastra o paciente → registra a lesão e anexa a foto → clica **Enviar para Estomaterapeuta** →
a **Estomaterapeuta** avalia (classificação, tratamento, orientações, prazo de reavaliação) e a devolutiva aparece no app.

## Rodar
    npm start        # http://localhost:3000  (PORT para mudar a porta)
    npm test         # teste de ponta a ponta da API

Sem dependências (Node 18+). Dados em `data/` (db.json + fotos), ignorado pelo git; use `DATA_DIR` para mudar.

## Usuários de demonstração
| Perfil | Usuário | Senha |
|---|---|---|
| Examinador | examinador | exam123 |
| Estomaterapeuta | estomaterapeuta | estoma123 |

**Antes de uso real:** troque as senhas demo, sirva por HTTPS e substitua o armazenamento em JSON por um banco de dados.
São dados de saúde (LGPD): exigem controle de acesso, criptografia e consentimento adequados.
