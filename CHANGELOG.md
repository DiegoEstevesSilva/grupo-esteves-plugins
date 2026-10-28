# Histórico de versões

## 1.1.0 (28/10/2026)

Nenhuma regra de cálculo mudou: para as mesmas respostas da API, valores, métodos, preços válidos e status são os mesmos da versão anterior.

- **Planilha sem Python (Completa):** a planilha .xlsx é escrita pelo próprio script, em Node.js. Python e `openpyxl` deixam de ser requisitos.
- **Links do PNCP mais rápidos (Completa):** o link do edital é buscado só para os preços aproveitados, depois do IQR; os descartados têm o link da consulta na API. Os links já encontrados ficam num cache local entre pesquisas (`PESQUISA_PRECOS_CACHE` muda o arquivo; `--sem-cache` consulta tudo de novo).
- **Saída curta:** ao terminar, o script imprime só o essencial, uma linha por item; descrições e alertas ficam em `resumo.json`.
- **Limite de tempo por ambiente:** no Claude Code, cada rodada vai até 540 s (antes, 240 s), o que evita reiniciar o comando à toa.
- Testes automáticos de regressão contra pesquisas gravadas.

## 1.0.1 e anteriores

- Versões iniciais: edições Essencial (até 5 itens) e Completa (até 100 itens, links do PNCP, planilha, trilha das respostas e leitura de TR).
