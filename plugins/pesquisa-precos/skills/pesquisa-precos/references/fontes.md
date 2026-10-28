# Fontes de dados

API de Dados Abertos do Compras.gov.br (`https://dadosabertos.compras.gov.br`), pública e sem autenticação.

| Uso | Endpoint |
|---|---|
| Preços de materiais (CATMAT) | `/modulo-pesquisa-preco/1_consultarMaterial` |
| Preços de serviços (CATSER) | `/modulo-pesquisa-preco/3_consultarServico` |
| Catálogo de materiais | `/modulo-material/4_consultarItemMaterial` |
| Catálogo de serviços | `/modulo-servico/6_consultarItemServico` |
| Link do edital no PNCP | `/modulo-contratacoes/1.1_consultarContratacoes_PNCP_14133_Id` |

Particularidades que o motor já trata (não precisam de ação): `idCompra` de materiais com perda de precisão numérica (lido de `idCompraItem`); `idCompra` de serviços sem o zero à esquerda; um valor por filtro de UF e de esfera; catálogo sobrecarregado que responde HTTP 400 temporário; limite de cerca de 100 requisições por minuto em todo o domínio (o motor espera o tempo pedido no 429).

## Tempo

Cada item leva de 10 s a 1 min; itens com muitas compras ou muitas combinações UF × esfera (27 UFs × 3 esferas = 81 consultas) podem levar vários minutos. Os links do PNCP acrescentam até 3 min por item (`--sem-pncp` dispensa essa etapa).

## Acesso de rede

O script precisa alcançar `dadosabertos.compras.gov.br` por HTTPS. Teste com `node scripts/pesquisar.js --verificar`.

- **Claude Code ou terminal próprio**: costuma funcionar sem configuração.
- **Claude no navegador ou app (execução de código)**: o acesso à internet do ambiente de código é restrito. O administrador da conta (ou o próprio usuário, em plano individual) precisa liberar o domínio `dadosabertos.compras.gov.br` nas configurações de execução de código e acesso à rede. Sem isso, o script responde `SEM_ACESSO_API`.
- **Rede corporativa** com proxy ou firewall: o domínio precisa estar liberado.

Quando o acesso falhar, explique isso ao usuário em linguagem simples e não tente outro caminho para obter os preços: valores inventados ou buscados em outras páginas não servem para os autos.
