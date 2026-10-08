# inbox-agent

Agente que triagem e automatiza as caixas de e-mail (Outlook do trabalho + Gmail pessoal).

## Estado atual
- Gmail pessoal (ircarim@gmail.com): conectado via conector Gmail do Claude.
- Outlook do Hospital Marieta: atendido pelo Copilot (ver `COPILOT_PROMPT.md`). Não está conectado ao Claude.
- Modo: `shadow` (só lê e propõe).

## Arquivos
- `AGENT_PROMPT.md`: prompt do agente.
- `config/rules.json`: VIPs, tom, regras de lixo, alertas, modo.
- `logs/`: propostas por lote (ignorado pelo git, contém dados reais).

## Varredura do atraso (lotes de 100)
Ordem: IMPORTANT + não lidas primeiro (`is:unread label:important`), do mais novo ao mais antigo; depois o resto.
Cada lote gera `logs/AAAA-MM-DD-lote-N.md` com categoria, ação proposta e rascunho de resposta quando couber.

## Conectar o Outlook
Opções: (a) conector Microsoft 365/Outlook no Claude, se a TI do hospital permitir; (b) Microsoft Graph via app registrado no Azure AD (precisa de aprovação da TI); (c) encaminhar automaticamente o trabalho para uma caixa Gmail dedicada. Copilot Studio é possível apenas dentro do tenant do hospital.

## Repositório
Recomenda-se mover esta pasta para um repositório privado próprio (`inbox-agent`), pois mistura dados pessoais e do trabalho.
