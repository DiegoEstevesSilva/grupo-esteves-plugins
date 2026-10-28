# Regras aplicadas pelo motor

Base normativa: IN SEGES/ME nº 65/2021, art. 5º, II (contratações similares da Administração Pública, parâmetro prioritário pelo § 1º), e Lei nº 14.133/2021, art. 23. Todas as regras abaixo estão em `scripts/motor/` e rodam do mesmo jeito em toda pesquisa. Use este arquivo para **explicar** o resultado ao usuário; nunca para recalcular.

## Etapas, por item, nesta ordem

1. **Identificação** no catálogo (CATMAT para materiais, CATSER para serviços). Sem `tipoItem`, o tipo é detectado pelo catálogo que contém o código. Se o código existir nos dois, o item fica `NAO_IDENTIFICADO` e é preciso informar `tipoItem`.
2. **Coleta**: uma consulta por combinação UF × esfera (a API aceita um valor por filtro), lendo todas as páginas. Em 429, 5xx ou falha de rede, novas tentativas com espera. Combinação que falhar de vez vira alerta e as demais seguem.
3. **Normalização e deduplicação** por `idCompra + idItemCompra + fornecedor`. CPF de fornecedor pessoa física sai mascarado (LGPD).
4. **Inconsistentes**: descarta preço nulo, zero, negativo ou não numérico; quantidade nula ou zero; código divergente; sem data ou fora do período.
5. **Unidade de fornecimento**: usa a unidade informada no item (`unidadeFornecimento`) ou, na falta, a predominante. As outras são descartadas, sem conversão. Empate: a primeira em ordem alfabética, com alerta.
6. **IQR**, uma única vez: Q1 e Q3 por interpolação linear (= `QUARTIL.INC`). Abaixo de Q1 − 1,5·IQR → inexequível; acima de Q3 + 1,5·IQR → excessivamente elevado (art. 6º, § 3º). Com menos de 4 preços não se aplica; com IQR = 0 ficam só os preços iguais à mediana.
7. **Estimativa**: com menos de 3 preços válidos, `AMOSTRA_INSUFICIENTE` e nenhum valor automático (art. 6º, § 5º). Senão, CV (desvio padrão amostral / média) ≤ 25% → **média**; CV > 25% → **mediana** (art. 6º, § 4º). O valor unitário é arredondado a 2 casas e só então multiplicado pela quantidade.

Na edição Completa, o limiar do CV (`limiarCV`) e o fator do IQR (`fatorIQR`) podem ser alterados na entrada; o relatório registra os valores usados.

## Status de cada item

| Status | Significado | O que propor ao usuário |
|---|---|---|
| `OK` | valor estimado calculado | conferir os alertas do item |
| `AMOSTRA_INSUFICIENTE` | menos de 3 preços válidos | ampliar período (até 1 ano), UFs ou esferas **com justificativa**, ou complementar com os outros incisos do art. 5º |
| `SEM_DADOS` | a API não devolveu registros | conferir código e período; ampliar filtros; outros incisos do art. 5º |
| `NAO_IDENTIFICADO` | código não achado ou presente nos dois catálogos | conferir o código; informar `tipoItem` |
| `ERRO` | falha de coleta ou execução | rodar a pesquisa de novo em outra pasta |

Status geral: o dos itens quando todos iguais; senão `PARCIAL`.

## Desvios e justificativas (art. 3º, III e VI)

Um item pode ter período, UFs ou esferas diferentes dos comuns (ex.: ampliação por falta de amostra). Todo desvio precisa de `justificativa` no item; sem ela, o relatório traz alerta. Ao sugerir uma ampliação, peça ao usuário o motivo e coloque-o em `justificativa`. Período que começa mais de 1 ano antes da pesquisa gera alerta (art. 5º, § 3º), mas não é bloqueado.

## Limites do que o motor faz

- Não avalia condições comerciais (quantidade, local, prazo, garantia; art. 4º): o relatório alerta o responsável.
- Não consulta os incisos I, III, IV e V do art. 5º (Painel de Preços, mídia especializada, sítios eletrônicos, fornecedores).
- Unidades de serviços parecidas (POSTO × POSTO/D) não são unificadas: use `unidadeFornecimento`.
- O relatório é apoio técnico: precisa ser revisado, complementado e assinado pelo agente responsável (art. 3º, II).
