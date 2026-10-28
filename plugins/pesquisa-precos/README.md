# Pesquisa de Preços

Marketplace de plugins do Claude Code do Grupo Esteves & Esteves (https://jaderesteves.com.br).

## Plugin `pesquisa-precos` (versão 1.2.0)

Pesquisa de preços de contratações públicas (IN SEGES/ME nº 65/2021, art. 5º, II) com os dados abertos do Compras.gov.br e relatório pronto para os autos: até 100 itens, links do PNCP, planilha com memória de cálculo e leitura de TR.

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

No Claude (app ou navegador), sem o Claude Code: envie o .zip da Skill em Configurações → Capacidades → Skills.

## Atualizar

- **Automático (recomendado):** `/plugin` → **Marketplaces** → `grupo-esteves` → **Enable auto-update**.
- **Manual:** `claude plugin update pesquisa-precos@grupo-esteves`.

## Usar

Peça ao Claude, por exemplo: "faça a pesquisa de preços do CATMAT 470419, 1.000 metros, últimos 12 meses, na Bahia".

O relatório é apoio técnico gerado a partir de dados abertos: deve ser revisado, complementado e assinado pelo agente responsável pela pesquisa.

## Licença

Uso livre por pessoas e órgãos públicos, inclusive com modificações; proibida a revenda ou a oferta como serviço pago por terceiros; sem garantia. Ver `LICENCA.md`.

Quer isso implantado na sua organização, com as regras e o modelo de relatório do seu órgão? Fale com o Grupo Esteves & Esteves: jaderesteves.com.br
