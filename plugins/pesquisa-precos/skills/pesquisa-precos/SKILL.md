---
name: pesquisa-precos
description: Pesquisa de preços de contratações públicas pela IN SEGES/ME nº 65/2021 (art. 5º, II), com preços de contratações similares dos dados abertos do Compras.gov.br, links dos editais no PNCP, planilha com memória de cálculo e relatório pronto para os autos. Use quando pedirem pesquisa de preços, preço estimado, valor de referência ou estimativa de itens CATMAT/CATSER para licitação, dispensa, ETP ou TR, inclusive a partir de um termo de referência em PDF ou de uma planilha de itens.
---

# Pesquisa de Preços

Você conduz a pesquisa; o script `scripts/pesquisar.js` faz a coleta e **todos os cálculos**. Seu papel é montar a entrada certa, rodar o script e explicar o resultado. Todo número que você mostrar ao usuário vem dos arquivos que o script gerou, exatamente como está neles.

Requisitos: Node.js 18 ou superior e acesso de rede a `dadosabertos.compras.gov.br` (ver `references/fontes.md`). Nos comandos, `<skill>` é o caminho desta pasta de skill. Grave `entrada.json` e a pasta de saída na pasta de trabalho, pois a pasta da skill pode ser somente leitura.

## Passos

### 1. Montar a entrada

Os itens podem vir de três jeitos:

- **Termo de referência em PDF ou planilha de itens**: extraia os itens seguindo `references/leitura-tr.md` e mostre a tabela extraída ao usuário. Siga só depois que ele aprovar ou corrigir a tabela.
- **Lista no chat**: código CATMAT ou CATSER, quantidade e, se houver, unidade, lote e tipo.
- **Só a descrição**: o código vem do Catálogo de Compras (catalogo.compras.gov.br); confirme cada código com o usuário em vez de supor um.

Complete com o usuário, perguntando só o que faltar: **período** da data da compra (sugira os 12 meses anteriores a hoje), **UFs e esferas** (vazio = todo o país, todas as esferas) e **identificação** (nº do processo, órgão, objeto). `limiarCV` e `fatorIQR` só mudam se o usuário pedir, e a justificativa dele vai junto.

Escreva `entrada.json` no formato de `references/entrada.md` (até 100 itens). Pronto quando cada item tem código confirmado e o período está definido.

### 2. Verificar o acesso

```bash
node <skill>/scripts/pesquisar.js --verificar
```

Com `SEM_ACESSO_API`, siga a seção "Acesso de rede" de `references/fontes.md`, explique ao usuário como liberar o domínio e pare aqui.

### 3. Rodar a pesquisa

```bash
node <skill>/scripts/pesquisar.js --entrada entrada.json --saida pesquisa-<processo-ou-data>
```

Cada rodada para de iniciar itens novos depois de 540 s no Claude Code (que define `CLAUDECODE=1`; dê ao comando o tempo limite de 10 min) e de 240 s nos demais ambientes; `--tempo-max S` muda esse limite.

O script imprime um JSON. Conforme o `status`:

- `ENTRADA_INVALIDA`: corrija a entrada pelos `erros` (ou pergunte ao usuário) e rode de novo.
- `INCOMPLETA`: rode **o mesmo comando** de novo, até sair o resumo final. Os itens prontos não são refeitos. Em editais grandes, avise o usuário do andamento a cada rodada.
- Qualquer outro: a pesquisa terminou. O JSON impresso é curto: status, versão, total global, pasta e uma linha por item (nº, código, status, método, valor unitário, valor total e quantidade de alertas). O detalhe está em `resumo.json`, na pasta.

`--sem-pncp` dispensa os links dos editais no PNCP e encurta a pesquisa em até 3 min por item; use quando o usuário quiser rapidez. Os links já encontrados ficam num cache local entre pesquisas (`PESQUISA_PRECOS_CACHE` muda o arquivo); `--sem-cache` consulta tudo de novo.

Pronto quando a pasta tem `relatorio.md`, `relatorio.html`, `resultado.json`, `resumo.json` e, se houve registros, `planilha.xlsx`.

A planilha é escrita pelo próprio script, sem Python nem outra dependência. Se `alertasGerais` disser que ela não foi gerada, rode **o mesmo comando** de novo, com a mesma `--saida`: os itens prontos são reaproveitados, sem nova consulta à API, e relatório, resumo e planilha saem coerentes entre si.

### 4. Apresentar o resultado

A partir da saída do script e do `resumo.json` da pasta:

1. Quadro com item, lote, código, preços válidos, método (média ou mediana), valor unitário, valor total e situação; depois, os totais por lote e o valor total global.
2. Para cada item fora de `OK`, a causa e o caminho, conforme a tabela de status de `references/regras.md`. Se o usuário aceitar ampliar período, UFs ou esferas de um item, registre o desvio **com a justificativa dele** no item e rode de novo em outra pasta.
3. Os alertas que pedem ação do usuário: os de cada item estão em `itens[].alertas` e os gerais em `alertasGerais`, ambos no `resumo.json` (a saída impressa só traz a quantidade).
4. O lembrete de que o relatório é apoio técnico: o agente responsável revisa, verifica as condições comerciais (art. 4º) e assina.

Para perguntas sobre metodologia ("por que mediana?", "por que este preço saiu?"), responda com `references/regras.md` e com os dados do item em `resultado.json` (série, descartes com motivo, quartis, CV). A aba "Memória de cálculo" da planilha refaz cada medida com fórmulas, e a coluna "Confere?" mostra "sim" quando bate com o relatório.

### 5. Entregar os arquivos

Entregue `relatorio.html` (abre no navegador e imprime em PDF), `relatorio.md`, `planilha.xlsx` e `resultado.json`. A subpasta `itens/` guarda as respostas brutas da API de cada item, com SHA-256, para auditoria: entregue-a quando o usuário quiser o pacote completo para os autos. Se o usuário pedir Word ou PDF, converta o relatório com as ferramentas do ambiente mantendo o texto e as tabelas como estão.
