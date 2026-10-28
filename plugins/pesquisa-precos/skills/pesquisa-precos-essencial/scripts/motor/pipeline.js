// ============================================================================
// pipeline.js — etapas do fluxo, uma por nó Code do n8n. A pesquisa percorre os
// itens do edital um a um (nó "Itens do edital (loop)"); cada etapa recebe e
// devolve o `estado` de UM item (serializável em JSON). Os estados de todos os
// itens são reunidos no fim pelo relatório único (relatorio.js).
// Depende de tratamento.js, estatistica.js e relatorio.js (no n8n, o build
// concatena os trechos necessários; aqui, usa require).
// ============================================================================
const { normalizarRegistro, deduplicar, removerInconsistentes, homogeneizarUnidade } = require('./tratamento.js'); // @exports
const { aplicarIQR, calcularEstimativa, arred2 } = require('./estatistica.js'); // @exports
const { montarSaida } = require('./relatorio.js'); // @exports

// Parcela da série (após a etapa de inconsistentes) descartada por unidade a partir da qual há alerta
const LIMIAR_DESCARTE_UNIDADE = 0.3;
// Abaixo deste n (com status OK) a amostra é considerada pequena
const AMOSTRA_PEQUENA = 5;

/**
 * Um item por elemento do edital, para o loop. Cada item leva o contexto comum
 * (processo, parâmetros da Parte I, data/hora e alertas gerais).
 * @param {object} v saída do nó "Validar entradas"
 */
function separarItens(v) {
  const contexto = {
    processo: v.params.processo,
    comum: v.params.comum,
    dataHoraPesquisa: v.dataHoraPesquisa,
    alertasGerais: v.alertas,
    totalItens: v.params.itens.length
  };
  return v.params.itens.map((item) => ({ item, contexto }));
}

/** Estado inicial de um item (após a identificação no catálogo). */
function criarEstado(entrada, identificacao) {
  const it = entrada.item;
  const tipo = identificacao.tipoItem;
  return {
    contexto: entrada.contexto,
    itemEdital: {
      indice: it.indice, numeroItem: it.numeroItem, quantidade: it.quantidade, lote: it.lote,
      descricaoInformada: it.descricaoInformada, desvios: it.desvios, justificativaDesvio: it.justificativaDesvio
    },
    params: Object.assign({}, it.params, { tipoItem: tipo }),
    item: {
      tipo, codigo: it.params.codigo,
      sistema: tipo === 'material' ? 'CATMAT' : tipo === 'servico' ? 'CATSER' : 'CATMAT/CATSER',
      descricao: identificacao.descricao || it.descricaoInformada || null
    },
    consultasCatalogo: identificacao.consultas || [],
    dataHoraAcesso: null,
    endpoint: null,
    coleta: { requisicoes: [], falhas: [] },
    totalBruto: 0, duplicadosRemovidos: 0,
    serieColetada: [], descartados: [], serieSaneada: [], validos: [],
    unidade: null, iqr: null, estimativa: null, status: null, valorTotal: null,
    observacoes: [],
    alertas: [].concat(it.alertas || [], identificacao.alertas || [])
  };
}

/**
 * Estado de um item que não chegou ao fim do tratamento: código não
 * identificado no catálogo (NAO_IDENTIFICADO) ou falha de execução (ERRO).
 */
function estadoSemColeta(entrada, status, mensagem, identificacao) {
  const e = criarEstado(entrada, identificacao || { tipoItem: entrada.item.params.tipoItem, descricao: null, alertas: [] });
  delete e.validos;
  e.status = status;
  e.alertas.push(status === 'NAO_IDENTIFICADO'
    ? `Item não pesquisado: ${mensagem}`
    : `Falha ao processar o item: ${mensagem}. Refaça a pesquisa deste item.`);
  e.alertas.push('Complemente a pesquisa deste item com os demais parâmetros do art. 5º da IN SEGES/ME nº 65/2021 ' +
    '(incisos I, III, IV e V) ou corrija os dados informados e pesquise novamente.');
  return e;
}

/** Após a coleta: normaliza, deduplica e numera (seq) os registros. */
function etapaNormalizar(estado, resultadoColeta, endpoint) {
  estado.endpoint = endpoint;
  estado.coleta = { requisicoes: resultadoColeta.requisicoes, falhas: resultadoColeta.falhas };
  estado.alertas.push(...resultadoColeta.alertas);
  estado.totalBruto = resultadoColeta.brutos.length;
  const normalizados = resultadoColeta.brutos.map((b) => normalizarRegistro(b.raw, estado.item.tipo, b.urlRequisicao, estado.params.codigo));
  const { unicos, removidos } = deduplicar(normalizados);
  unicos.forEach((r, i) => { r.seq = i + 1; });
  estado.serieColetada = unicos;
  estado.duplicadosRemovidos = removidos;
  if (!estado.item.descricao && unicos.length) estado.item.descricao = unicos[0].descricaoItem;
  const semPrecisao = unicos.filter((r) => !r.precisaoIdOk).length;
  if (semPrecisao) estado.alertas.push(`${semPrecisao} registro(s) sem idCompraItem: o idCompra exibido pode ter perdido precisão numérica na API.`);
  if (resultadoColeta.falhas.length) {
    estado.alertas.push(`Falha definitiva na coleta de ${resultadoColeta.falhas.length} combinação(ões) de filtros, após novas tentativas: ` +
      resultadoColeta.falhas.map((f) => `${f.combinacao} (${f.erro})`).join('; ') + '. A série pode estar incompleta.');
  }
  return estado;
}

/**
 * Após a normalização: grava em cada registro o link do edital no PNCP
 * (urlPncp e numeroControlePNCP), obtido por consultarPncp. Registros sem
 * PNCP mantêm só o link da consulta na API (urlRegistro).
 */
function etapaPncp(estado, r) {
  const mapa = (r && r.mapa) || {};
  let comLink = 0;
  for (const reg of estado.serieColetada) {
    const p = mapa[reg.idCompra];
    reg.urlPncp = p ? p.url : null;
    reg.numeroControlePNCP = p ? p.numeroControlePNCP : null;
    if (p) comLink++;
  }
  estado.pncp = {
    registrosComLink: comLink, registros: estado.serieColetada.length,
    comprasConsultadas: (r && r.consultados) || 0, comprasEncontradas: (r && r.encontrados) || 0,
    comprasForaDoPncp: (r && r.naoEncontrados) || 0, falhas: (r && r.falhas) || 0,
    naoConsultadas: (r && r.naoConsultados) || 0, daBase: (r && r.daBase) || 0, doCache: (r && r.doCache) || 0,
    pausasLimite: (r && r.pausas) || 0, erro: (r && r.erro) || null,
    // base local (Supabase): sem ela, tudo vai para a API; por isso a falha não gera alerta
    erroBase: (r && r.erroBase) || null
  };
  if (estado.pncp.erro || estado.pncp.falhas || estado.pncp.naoConsultadas) {
    const n = estado.pncp.falhas + estado.pncp.naoConsultadas;
    estado.alertas.push(estado.pncp.erro
      ? `Não foi possível consultar o PNCP (${estado.pncp.erro}); os registros mantêm o link da consulta na API.`
      : `Não foi possível obter o link do PNCP de ${n} compra(s); esses registros mantêm o link da consulta na API.`);
  }
  return estado;
}

function etapaInconsistentes(estado) {
  const { validos, descartados } = removerInconsistentes(estado.serieColetada, estado.params);
  estado.validos = validos;
  estado.descartados.push(...descartados);
  return estado;
}

function etapaUnidade(estado) {
  const r = homogeneizarUnidade(estado.validos, estado.params.unidadeFornecimento);
  const antes = estado.validos.length;
  estado.validos = r.validos;
  estado.descartados.push(...r.descartados);
  estado.unidade = { adotada: r.adotada, criterio: r.criterio, distribuicao: r.distribuicao };
  estado.alertas.push(...r.alertas);
  if (antes > 0 && r.descartados.length / antes >= LIMIAR_DESCARTE_UNIDADE) {
    estado.alertas.push(`${r.descartados.length} de ${antes} preços válidos (${String(Math.round((r.descartados.length / antes) * 100))}%) foram ` +
      'descartados por unidade de fornecimento diferente da adotada. Confira se a unidade adotada corresponde à do edital.');
  }
  return estado;
}

function etapaIQR(estado) {
  const r = aplicarIQR(estado.validos, estado.params.fatorIQR, (x) => x.precoUnitario);
  estado.validos = r.mantidos;
  estado.descartados.push(...r.descartados);
  estado.iqr = { quartis: r.quartis, aplicado: r.aplicado, justificativa: r.justificativa };
  return estado;
}

/** Define status, valor estimado (unitário e total), observações e alertas do item. */
function etapaEstimativa(estado) {
  const p = estado.params;
  estado.serieSaneada = estado.validos;
  delete estado.validos;
  const complementar = 'Considere ampliar a pesquisa (período, UFs, esferas) ou complementá-la com os demais parâmetros do art. 5º ' +
    '(incisos I, III, IV e V).';

  const todasFalharam = estado.coleta.requisicoes.length > 0 && estado.coleta.requisicoes.every((r) => r.status === 'falha');
  if (todasFalharam && estado.serieColetada.length === 0) {
    estado.status = 'ERRO';
    estado.alertas.push('Todas as consultas à API falharam para este item: não há série de preços. Refaça a pesquisa do item. ' + complementar);
  } else if (estado.serieColetada.length === 0) {
    estado.status = 'SEM_DADOS';
    estado.alertas.push('Nenhum registro foi encontrado para o código e os filtros informados. Recomenda-se ampliar o período, ' +
      'as UFs ou as esferas, ou utilizar os demais parâmetros do art. 5º da IN SEGES/ME nº 65/2021 (incisos I, III, IV e V).');
  } else {
    estado.estimativa = calcularEstimativa(estado.serieSaneada.map((r) => r.precoUnitario), p.limiarCV);
    estado.status = estado.estimativa.status;
    const est = estado.estimativa.estatisticas;
    if (estado.status === 'AMOSTRA_INSUFICIENTE') {
      estado.alertas.push(`A série saneada possui apenas ${est.n} preço(s). A estimativa com menos de três ` +
        'preços é excepcional e exige justificativa do gestor responsável e aprovação da autoridade competente (art. 6º, § 5º). ' + complementar);
    } else {
      if (est.n < AMOSTRA_PEQUENA) {
        estado.alertas.push(`Amostra pequena: a série saneada tem ${est.n} preços. Avalie a representatividade e, se necessário, ${complementar.charAt(0).toLowerCase() + complementar.slice(1)}`);
      }
      if (estado.estimativa.regraDecisao.resultado === 'mediana') {
        estado.alertas.push(`CV de ${String((est.cv * 100).toFixed(2)).replace('.', ',')}%, acima do limiar de ${String(p.limiarCV * 100).replace('.', ',')}%: ` +
          'a série é heterogênea e foi adotada a mediana. Faça a análise crítica dos preços (art. 6º, § 4º).');
      }
    }
  }

  // Valor total: unitário (já arredondado a 2 casas) × quantidade, arredondado a 2 casas
  const v = estado.estimativa ? estado.estimativa.valorEstimado : null;
  const q = estado.itemEdital.quantidade;
  estado.valorTotal = v !== null && v !== undefined && q ? arred2(v * q) : null;

  // Observações do item (a metodologia geral fica na Parte I do relatório)
  const O = estado.observacoes;
  if (estado.unidade && estado.unidade.adotada) {
    O.push(`Unidade adotada: "${estado.unidade.adotada.descricao}" — critério: ${estado.unidade.criterio}.`);
  }
  if (estado.iqr && (!estado.iqr.aplicado || estado.iqr.quartis.IQR === 0)) O.push(`IQR: ${estado.iqr.justificativa}`);
  if (estado.duplicadosRemovidos) {
    O.push(`${estado.duplicadosRemovidos} registro(s) duplicado(s) (mesmo idCompra, idItemCompra e fornecedor, retornados por mais de uma ` +
      'combinação de filtros) foram contados uma única vez.');
  }
  return estado;
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { separarItens, criarEstado, estadoSemColeta, etapaNormalizar, etapaPncp, etapaInconsistentes, etapaUnidade, etapaIQR, etapaEstimativa, montarSaida }; // @exports
} // @exports
