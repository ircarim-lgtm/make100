# Publicar no Instagram pelo Windows

Conta: **@orbita_labs_dev** (ID `17841431882100470`)

## 1. Instalar o necessario (uma vez so)

1. Instale o Python em https://www.python.org/downloads/ e marque **"Add python.exe to PATH"** na instalacao.
2. Abra o **Prompt de Comando** e rode:

```
pip install requests python-dotenv
```

## 2. Colocar os arquivos no computador

Copie a pasta `claude-instagram` para, por exemplo, `C:\Users\SEU_USUARIO\claude-instagram`.

## 3. Criar o arquivo .env

1. Dentro da pasta, copie `.env.example` e renomeie a copia para `.env`.
2. Abra o `.env` no Bloco de Notas e troque `COLE_O_TOKEN_AQUI` pelo seu token (comeca com `IG...`).
3. Salve.

## 4. Testar a conexao

```
cd C:\Users\SEU_USUARIO\claude-instagram\scripts
python publish_instagram.py --test
```

Se aparecer `Conexao OK!` com `@orbita_labs_dev`, esta tudo certo.

## 5. Publicar

Teste primeiro sem publicar:

```
python publish_instagram.py --images slide1.png slide2.png --caption "Minha legenda" --dry-run
```

Para publicar de verdade, rode o mesmo comando sem `--dry-run`. Aceita de 1 a 10 imagens (1 = foto, 2 ou mais = carrossel).

## Observacoes

- O token do painel da Meta expira em cerca de 60 dias. Quando expirar, gere outro em **Casos de uso > Personalizar > Configuracao da API com login do Instagram > Gerar token** e troque no `.env`.
- As imagens sao hospedadas temporariamente em catbox.moe (a API do Instagram exige uma URL publica). Nao use imagens privadas.
- O arquivo `.env` esta no `.gitignore` e nao deve ser enviado ao GitHub.
