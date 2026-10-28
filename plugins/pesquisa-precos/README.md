# Pesquisa de Preços – Essencial

Marketplace de plugins do Claude Code do Grupo Esteves & Esteves (https://jaderesteves.com.br).

## Plugin `pesquisa-precos` (versão 1.1.0)

Pesquisa de preços de contratações públicas (IN SEGES/ME nº 65/2021, art. 5º, II) com os dados abertos do Compras.gov.br e relatório pronto para os autos. Edição Essencial: até 5 itens por pesquisa.

## Instalar

No Claude Code (versão 2.1.275 ou superior), em um passo:

```
/plugin install pesquisa-precos --marketplace DiegoEstevesSilva/grupo-esteves-plugins
```

Em versões anteriores, em dois passos:

```
/plugin marketplace add DiegoEstevesSilva/grupo-esteves-plugins
/plugin install pesquisa-precos@grupo-esteves
```

Ou no terminal: `claude plugin marketplace add DiegoEstevesSilva/grupo-esteves-plugins` e `claude plugin install pesquisa-precos@grupo-esteves`.

Requisitos: Node.js 18+ e acesso a `dadosabertos.compras.gov.br`.

## Atualizar

- **Automático (recomendado):** `/plugin` → **Marketplaces** → `grupo-esteves` → **Enable auto-update**.
- **Manual:** `claude plugin update pesquisa-precos@grupo-esteves`.

## Usar

Peça ao Claude, por exemplo: "faça a pesquisa de preços do CATMAT 470419, 1.000 metros, últimos 12 meses, na Bahia".

O relatório é apoio técnico gerado a partir de dados abertos: deve ser revisado, complementado e assinado pelo agente responsável pela pesquisa.
