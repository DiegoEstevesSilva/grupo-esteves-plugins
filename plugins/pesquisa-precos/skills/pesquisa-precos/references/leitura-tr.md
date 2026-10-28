# Leitura de itens de termo de referência (PDF) ou planilha

Objetivo: transformar a tabela de itens do documento em `itens[]` da entrada, sem inventar nada.

## Extração

1. Localize a tabela de itens (geralmente "Especificação dos itens", "Quadro de itens" ou anexo do TR). Ignore cabeçalhos e rodapés repetidos.
2. Para cada linha, extraia: `numeroItem` (como está no documento, ex.: `1`, `1-A`), `codigo` (CATMAT/CATSER, só dígitos), `quantidade`, `lote` (grupo/lote, se houver), `descricao` (resumida, até 200 caracteres) e `tipoItem` (`servico` quando o documento indicar CATSER ou serviço).
3. A unidade do TR **não** vai para `unidadeFornecimento`: ela costuma diferir da chave do catálogo. Mostre-a ao usuário e só preencha `unidadeFornecimento` se ele pedir.
4. Valores unitários estimados do TR, se houver, ficam fora da entrada: a pesquisa existe justamente para estimá-los.
5. Em planilhas (.xlsx, .csv), procure a linha de cabeçalho nas primeiras 20 linhas de cada aba e reconheça colunas como código/CATMAT/CATSER, item, descrição, quantidade, unidade, lote e tipo. Linhas sem código ficam de fora: diga quantas foram.

## Revisão humana

Mostre uma tabela com nº, código, descrição, quantidade, unidade do TR, lote e tipo, marcando:

- itens **sem código** ou com código ilegível (o usuário informa ou o item sai);
- números duplicados em `numeroItem`;
- quantidades que parecem lidas errado (separador de milhar, unidade misturada).

Siga para a pesquisa só com a tabela aprovada pelo usuário. Se ele corrigir algo, registre a correção na entrada; o relatório traz os itens exatamente como aprovados.

PDF digitalizado (imagem, sem texto): avise que a leitura pode ter erros e peça mais atenção na revisão, ou peça a planilha de itens.
