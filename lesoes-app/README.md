# Acompanhamento de Lesões por Pressão

**Examinador** cadastra o paciente (com consentimento) → registra a lesão e anexa a foto → clica **Enviar para Estomaterapeuta** →
a **Estomaterapeuta** avalia (classificação, tratamento, orientações, prazo de reavaliação) e a devolutiva aparece no app.

## Recursos
- Três perfis: examinador, estomaterapeuta e administrador (gestão de usuários, auditoria, exclusão de paciente).
- Consentimento (LGPD) obrigatório no cadastro; guarda quem consentiu e quando.
- Avisos: contador no topo (atualiza a cada 30 s), aviso do navegador (opcional, app aberto) e webhook opcional (Slack/Teams/Discord) sem dados do paciente.
- Comparação de fotos antes/depois por paciente.
- **Relatórios em PDF** com foto: um por avaliação (botão na devolutiva) e o histórico completo do paciente, com todas as lesões em ordem cronológica.
- **Ditado por voz** (🎤 Ditar) nos campos de texto do examinador e da estomaterapeuta, em português. Usa o reconhecimento de fala do próprio navegador (Chrome/Edge/Android e Safari/iOS), sem custo; o áudio é processado pelo serviço de voz do navegador (Google/Apple), não pelo app. Peça ao DPO para avaliar esse ponto.
- Trilha de auditoria (logins, acessos a paciente e a fotos, envios, avaliações).
- App instalável no celular (PWA); a foto é reduzida no aparelho antes do envio.
- Banco: SQLite embutido (`node:sqlite`) para uso local, ou Postgres quando há `DATABASE_URL`. Fotos: disco local ou Vercel Blob privado. Dependências: `pg`, `@vercel/blob`, `pdfkit`. Requer **Node 22.13+**.
- Nenhum serviço pago por uso é necessário: o app não chama APIs externas cobradas.

## Rodar localmente
    npm start        # http://localhost:3000   (PORT, DATA_DIR opcionais)
    npm test         # testes de ponta a ponta da API

Usuários de demonstração (só fora de produção): `admin`/`admin1234`, `examinador`/`exam1234`, `estomaterapeuta`/`estoma1234`.

## Publicar na Vercel
Variáveis do projeto: `ADMIN_PASSWORD` (primeiro acesso), `DATABASE_URL` (Postgres, ex.: Neon) e `BLOB_STORE_ID` (Blob privado, criado ao conectar o store ao projeto). O diretório raiz do projeto é `lesoes-app`.

## Publicar com Docker (HTTPS automático)
Num servidor com Docker e um domínio apontando para ele:

    cp .env.example .env     # preencha DOMINIO e ADMIN_PASSWORD
    docker compose up -d

Em produção (`NODE_ENV=production`) não há usuários de demonstração: o único usuário inicial é `admin`, com a senha de `ADMIN_PASSWORD`.
Entre, crie os usuários reais em **Administração → Usuários** e troque a senha em **Conta**.

Dados: banco `lesoes.db` e fotos ficam no volume `/data`. **Faça backup desse volume** (ex.: `docker run --rm -v lesoes-app_dados:/d -v $PWD:/b alpine tar czf /b/backup.tgz -C /d .`).

## Proteção contra captura de tela e PDF
- **PDF:** somente **estomaterapeuta** e **administrador** baixam (regra imposta no servidor; o examinador recebe 403 mesmo chamando a API direto). O PDF leva marca d'água "CONFIDENCIAL" com o nome de quem o gerou.
- **Telas:** marca d'água com nome, login e hora em toda a tela; cobertura de privacidade ao sair da janela ou ao pressionar PrintScreen; impressão, salvar, copiar, menu de contexto e arrastar imagens bloqueados; fotos sem cache do navegador. Tentativas de captura, impressão e cópia aparecem na **Auditoria** (linhas em vermelho).
- **Limite importante:** um site não consegue bloquear de fato o print do sistema (botão do celular, Win+Shift+S, foto da tela por outro aparelho). O que o app faz é dificultar e **identificar o autor** de qualquer vazamento. Para bloqueio real: política de dispositivo gerenciado do hospital (MDM/Intune; no Chrome, a política `DisableScreenshots`) ou um aplicativo nativo com `FLAG_SECURE` no Android.

## Segurança e LGPD
Senhas com scrypt, sessão de 12 h, bloqueio após 5 tentativas de login, CSP estrita, HSTS em produção, validação do tipo real da imagem.
O administrador não acessa dados clínicos. O app não substitui a avaliação do Encarregado de Dados (DPO) da instituição:
revise base legal, prazo de retenção, política de backup e contrato com o provedor de hospedagem.
