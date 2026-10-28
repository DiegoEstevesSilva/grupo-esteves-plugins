# Formato da entrada (`entrada.json`)

Um arquivo cobre **um processo/edital com um ou mais itens**.

```json
{
  "processo": "23000.000123/2026-11",
  "orgao": "Prefeitura Municipal de Exemplo",
  "objeto": "Aquisição de material elétrico",
  "dataInicio": "2025-10-28",
  "dataFim": "2026-10-27",
  "ufs": ["BA"],
  "esferas": [],
  "itens": [
    { "numeroItem": "1", "codigo": "470419", "quantidade": 1000, "unidadeFornecimento": "METRO", "lote": "Lote 1" },
    { "numeroItem": "2", "codigo": "8729", "tipoItem": "servico", "quantidade": 12, "lote": "Lote 2" }
  ]
}
```

## Campos comuns

| Campo | Obrigatório | Regra |
|---|---|---|
| `dataInicio`, `dataFim` | sim | `AAAA-MM-DD`; `dataFim` não pode ser futura. Padrão sugerido: os 12 meses anteriores à data de hoje. |
| `itens` | sim | lista de itens (limite da edição no SKILL.md) |
| `processo`, `orgao`, `objeto` | não | identificação na Parte I do relatório; peça ao usuário |
| `ufs` | não | siglas (`["BA","SE"]`); vazio = todas |
| `esferas` | não | `F` (federal), `E` (estadual), `M` (municipal); vazio = todas |
| `tipoItem` | não | `material` ou `servico`, padrão para todos os itens |
| `limiarCV`, `fatorIQR` | não | **só na edição Completa**; fração entre 0 e 1 (padrão 0.25) e número > 0 (padrão 1.5) |

## Campos de cada item

| Campo | Obrigatório | Regra |
|---|---|---|
| `codigo` | sim | código CATMAT ou CATSER, só dígitos |
| `numeroItem` | não | número no edital (texto, único). Padrão: posição na lista. O mesmo código pode aparecer em dois itens (cota reservada e ampla). |
| `quantidade` | não | sem ela, o valor total não é calculado |
| `tipoItem` | não | **informe para serviços**: muitos códigos existem nos dois catálogos |
| `unidadeFornecimento` | não | força a unidade de comparação (sigla `M`, nome `METRO` ou chave `RO 100 M`) |
| `lote` | não | agrupa os totais na Parte III |
| `descricao` | não | descrição do edital; aparece na ficha se diferir da do catálogo |
| `dataInicio`, `dataFim`, `ufs`, `esferas` | não | desvio em relação aos comuns, só neste item |
| `justificativa` | quando houver desvio | motivo do desvio (art. 3º, III) |

## Erros comuns

- Código com pontos ou dígito verificador (`47041-9`): envie só os dígitos que o usuário confirmar.
- Quantidade em texto com milhar (`"2.500"`) é aceita; prefira número.
- Datas em `DD/MM/AAAA` são recusadas: converta para `AAAA-MM-DD`.
- O script responde `ENTRADA_INVALIDA` com a lista de erros, cada um com "Item N:". Corrija e rode de novo.
