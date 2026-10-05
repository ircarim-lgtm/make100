# Acompanhamento de Lesões por Pressão

**Examinador** cadastra o paciente (com consentimento) → registra a lesão e anexa a foto → clica **Enviar para Estomaterapeuta** →
a **Estomaterapeuta** avalia (classificação, tratamento, orientações, prazo de reavaliação) e a devolutiva aparece no app.

## Recursos
- Três perfis: examinador, estomaterapeuta e administrador (gestão de usuários, auditoria, exclusão de paciente).
- Consentimento (LGPD) obrigatório no cadastro; guarda quem consentiu e quando.
- Avisos: contador no topo (atualiza a cada 30 s), aviso do navegador (opcional, app aberto) e webhook opcional (Slack/Teams/Discord) sem dados do paciente.
- Comparação de fotos antes/depois por paciente.
- Trilha de auditoria (logins, acessos a paciente e a fotos, envios, avaliações).
- App instalável no celular (PWA); a foto é reduzida no aparelho antes do envio.
- SQLite embutido (`node:sqlite`), sem dependências npm. Requer **Node 22.13+**.

## Rodar localmente
    npm start        # http://localhost:3000   (PORT, DATA_DIR opcionais)
    npm test         # testes de ponta a ponta da API

Usuários de demonstração (só fora de produção): `admin`/`admin1234`, `examinador`/`exam1234`, `estomaterapeuta`/`estoma1234`.

## Publicar (HTTPS automático)
Num servidor com Docker e um domínio apontando para ele:

    cp .env.example .env     # preencha DOMINIO e ADMIN_PASSWORD
    docker compose up -d

Em produção (`NODE_ENV=production`) não há usuários de demonstração: o único usuário inicial é `admin`, com a senha de `ADMIN_PASSWORD`.
Entre, crie os usuários reais em **Administração → Usuários** e troque a senha em **Conta**.

Dados: banco `lesoes.db` e fotos ficam no volume `/data`. **Faça backup desse volume** (ex.: `docker run --rm -v lesoes-app_dados:/d -v $PWD:/b alpine tar czf /b/backup.tgz -C /d .`).

## Segurança e LGPD
Senhas com scrypt, sessão de 12 h, bloqueio após 5 tentativas de login, CSP estrita, HSTS em produção, validação do tipo real da imagem.
O administrador não acessa dados clínicos. O app não substitui a avaliação do Encarregado de Dados (DPO) da instituição:
revise base legal, prazo de retenção, política de backup e contrato com o provedor de hospedagem.
