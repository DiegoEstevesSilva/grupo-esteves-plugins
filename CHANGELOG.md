# Histórico de versões

## 1.2.0 (28/10/2026)

A Skill passa a ter um único pacote, com todos os recursos, público e gratuito. Deixam de existir as edições Essencial e Completa.

- Até 100 itens por pesquisa, links dos editais no PNCP (com cache local), planilha .xlsx com memória de cálculo em fórmulas, respostas brutas da API com SHA-256 e leitura de itens de TR em PDF ou planilha, para todos.
- `limiarCV` e `fatorIQR` podem ser ajustados na entrada, com justificativa.
- O plugin continua com o nome `pesquisa-precos`, no marketplace `grupo-esteves`: quem já o instalou recebe tudo isso ao atualizar. O marketplace `grupo-esteves-pro` foi descontinuado.
- `resumo.json`, `resultado.json`, a saída curta e `--verificar` trazem o campo `versao` no lugar de `edicao`.
- Licença de uso (`LICENCA.md`): uso livre por pessoas e órgãos públicos, inclusive com modificações; proibida a revenda ou a oferta como serviço pago por terceiros; sem garantia.
- Nenhuma regra de cálculo mudou.

## 1.1.0 (28/10/2026)

Nenhuma regra de cálculo mudou: para as mesmas respostas da API, valores, métodos, preços válidos e status são os mesmos da versão anterior.

- **Planilha sem Python (Completa):** a planilha .xlsx é escrita pelo próprio script, em Node.js. Python e `openpyxl` deixam de ser requisitos.
- **Links do PNCP mais rápidos (Completa):** o link do edital é buscado só para os preços aproveitados, depois do IQR; os descartados têm o link da consulta na API. Os links já encontrados ficam num cache local entre pesquisas (`PESQUISA_PRECOS_CACHE` muda o arquivo; `--sem-cache` consulta tudo de novo).
- **Saída curta:** ao terminar, o script imprime só o essencial, uma linha por item; descrições e alertas ficam em `resumo.json`.
- **Limite de tempo por ambiente:** no Claude Code, cada rodada vai até 540 s (antes, 240 s), o que evita reiniciar o comando à toa.
- Testes automáticos de regressão contra pesquisas gravadas.

## 1.0.1 e anteriores

- Versões iniciais: edições Essencial (até 5 itens) e Completa (até 100 itens, links do PNCP, planilha, trilha das respostas e leitura de TR).
