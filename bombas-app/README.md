# Bombas de Infusão — QR Code e setor

Escaneie o QR Code da etiqueta de patrimônio da bomba (ex.: `HMMKB-234-0285`), veja qual bomba é e registre em qual setor ela está agora. Cada troca fica no histórico (setor, data/hora, responsável, observação).

- **Escanear**: câmera do celular (BarcodeDetector, com jsQR de reserva) ou digitar o código.
- Bomba desconhecida → formulário de cadastro (nome, modelo, série, validade da calibração, setor).
- Aviso de **calibração vencida**.
- **Etiqueta QR** imprimível para bombas sem etiqueta.
- Setores editáveis; lista de bombas com busca.
- PWA instalável. Sem dependências de runtime (jsQR e qrcode-generator estão em `public/vendor`).

## Rodar
    npm start      # http://localhost:3000  (PORT, DATA_DIR, ACCESS_CODE opcionais)
    npm test

Dados em `data/bombas.json` (faça backup). A câmera do navegador exige **HTTPS** (ou `localhost`); publique atrás de um proxy HTTPS (ex.: Caddy, como no `lesoes-app`).

`ACCESS_CODE`: se definido, o app pede esse código na primeira vez. É uma proteção simples, não um login por usuário.
