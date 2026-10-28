// ============================================================================
// coleta.js — consulta à API de Dados Abertos do Compras.gov.br (seção 3).
// Copiado para os nós "Identificar item no catálogo", "Consultar API – Materiais"
// e "Consultar API – Serviços" pelo scripts/build-workflow.js.
//
// As funções recebem `http(url)` e `dormir(ms)` por injeção, para que possam ser
// testadas sem rede. No n8n, `http` usa this.helpers.httpRequest.
// ============================================================================

const API_BASE = 'https://dadosabertos.compras.gov.br';
const ENDPOINTS = {
  material: '/modulo-pesquisa-preco/1_consultarMaterial',
  servico: '/modulo-pesquisa-preco/3_consultarServico',
  catalogoMaterial: '/modulo-material/4_consultarItemMaterial',
  catalogoServico: '/modulo-servico/6_consultarItemServico'
};
const TAMANHO_PAGINA = 500; // máximo aceito pela API (intervalo 10–500)

const OPCOES_COLETA_PADRAO = {
  tentativas: 3,          // tentativas por página em 429/5xx/erro de rede
  esperaBaseMs: 2000,     // backoff exponencial: 2 s, 4 s, ...
  // Em 429 espera o que a API pede (Retry-After ou "Try again in N seconds"),
  // até este teto: o nó Code inteiro precisa caber nos 60 s do task runner. O
  // limite é do domínio todo (inclui o módulo de contratações usado pelo PNCP).
  esperaMax429Ms: 15000,
  intervaloPaginasMs: 250,
  maxPaginas: 100         // trava de segurança por combinação (100 × 500 = 50 mil registros)
};

/** Monta a URL com parâmetros em ordem estável, omitindo vazios. */
function montarUrl(caminho, qs) {
  const partes = Object.keys(qs)
    .filter((k) => qs[k] !== undefined && qs[k] !== null && qs[k] !== '')
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(qs[k])}`);
  return `${API_BASE}${caminho}${partes.length ? '?' + partes.join('&') : ''}`;
}

/**
 * Uma requisição por combinação UF × esfera selecionadas (a API aceita um único
 * valor por parâmetro). Filtro não selecionado ⇒ parâmetro omitido.
 */
function montarCombinacoes(params) {
  const ufs = params.ufs && params.ufs.length ? params.ufs : [null];
  const esferas = params.esferas && params.esferas.length ? params.esferas : [null];
  const combos = [];
  for (const estado of ufs) for (const esfera of esferas) combos.push({ estado, esfera });
  return combos;
}

/** Parâmetros de consulta confirmados no Swagger (docs/api-contract.md). */
function montarQuery(tipoItem, params, combo, pagina) {
  const base = tipoItem === 'material'
    ? { tipo: 'codigoItemCatalogo', codigo: params.codigo }
    : { codigoItemCatalogo: params.codigo };
  return Object.assign(base, {
    dataCompraInicio: params.dataInicio,
    dataCompraFim: params.dataFim,
    estado: combo.estado,
    esfera: combo.esfera,
    pagina,
    tamanhoPagina: TAMANHO_PAGINA
  });
}

function descreverCombinacao(combo) {
  return `UF=${combo.estado || 'todas'}, esfera=${combo.esfera || 'todas'}`;
}

/** Mensagem de erro sem detalhes internos (sem stack trace). */
function resumirErro(e) {
  const msg = (e && (e.message || e.description)) ? String(e.message || e.description) : String(e);
  return msg.split('\n')[0].slice(0, 300);
}

/** Segundos pedidos num HTTP 429 (cabeçalho Retry-After ou texto "Try again in N seconds"), ou null. */
function esperaPedida429(resp) {
  const h = resp.headers || {};
  const cab = Number(h['retry-after'] || h['Retry-After']);
  if (cab > 0) return cab;
  const corpo = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body || '');
  const m = /try again in (\d+(?:\.\d+)?) ?s/i.exec(corpo);
  return m ? Number(m[1]) : null;
}

/**
 * HTTP 400 que é, na verdade, sobrecarga do servidor: com muitas consultas
 * simultâneas, o catálogo devolve "Erro ao efetuar a consulta Could not open JPA
 * EntityManager for transaction" depois de ~10 s (conferido em 29/09/2026).
 */
function erroTransitorio400(corpo) {
  return /Could not open JPA EntityManager/i.test(String(corpo || ''));
}

/**
 * GET com retry e backoff exponencial em 429, 5xx, 400 de sobrecarga
 * (erroTransitorio400) e falhas de rede/timeout.
 * Em 429, espera o tempo pedido pela API (até esperaMax429Ms), se for maior.
 * Outros 4xx são definitivos (não adianta repetir).
 * @returns {{ ok: boolean, statusCode?: number, body?: any, erro?: string, tentativas: number }}
 */
async function getComRetry(http, dormir, url, opcoes) {
  const o = Object.assign({}, OPCOES_COLETA_PADRAO, opcoes || {});
  let ultimoErro = '';
  for (let t = 1; t <= o.tentativas; t++) {
    let resp = null;
    let esperaMs = o.esperaBaseMs * Math.pow(2, t - 1);
    try {
      resp = await http(url);
    } catch (e) {
      ultimoErro = `falha de rede/timeout: ${resumirErro(e)}`;
    }
    if (resp) {
      const sc = resp.statusCode;
      if (sc >= 200 && sc < 300) return { ok: true, statusCode: sc, body: resp.body, tentativas: t };
      const corpo = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body || '');
      ultimoErro = `HTTP ${sc}: ${String(corpo).slice(0, 200)}`;
      if (!(sc === 429 || sc >= 500 || (sc === 400 && erroTransitorio400(corpo)))) return { ok: false, statusCode: sc, erro: ultimoErro, tentativas: t };
      const pedida = sc === 429 ? esperaPedida429(resp) : null;
      if (pedida) esperaMs = Math.min(Math.max(esperaMs, pedida * 1000 + 500), o.esperaMax429Ms);
    }
    if (t < o.tentativas) await dormir(esperaMs);
  }
  return { ok: false, erro: ultimoErro, tentativas: o.tentativas };
}

/**
 * Coleta todas as páginas de todas as combinações. Uma combinação que falhe
 * definitivamente é registrada em `falhas` e as demais seguem.
 * @returns {{ brutos: Array<{raw, urlRequisicao, combinacao}>, requisicoes: object[], falhas: object[], alertas: string[] }}
 */
async function coletarPrecos(http, dormir, tipoItem, params, opcoes) {
  const o = Object.assign({}, OPCOES_COLETA_PADRAO, opcoes || {});
  const caminho = ENDPOINTS[tipoItem];
  const brutos = [];
  const requisicoes = [];
  const falhas = [];
  const alertas = [];

  for (const combo of montarCombinacoes(params)) {
    const reg = {
      combinacao: descreverCombinacao(combo),
      url: montarUrl(caminho, montarQuery(tipoItem, params, combo, 1)),
      paginasLidas: 0, totalPaginas: null, totalRegistros: null, registrosObtidos: 0, status: 'ok'
    };
    let pagina = 1;
    while (true) {
      const url = montarUrl(caminho, montarQuery(tipoItem, params, combo, pagina));
      const r = await getComRetry(http, dormir, url, o);
      if (!r.ok) {
        reg.status = 'falha';
        reg.erro = `página ${pagina}: ${r.erro}`;
        falhas.push({ combinacao: reg.combinacao, url, erro: r.erro, paginasLidasAntesDaFalha: reg.paginasLidas });
        break;
      }
      const body = r.body || {};
      const lista = Array.isArray(body.resultado) ? body.resultado : [];
      for (const raw of lista) brutos.push({ raw, urlRequisicao: url, combinacao: reg.combinacao });
      reg.paginasLidas = pagina;
      reg.registrosObtidos += lista.length;
      if (reg.totalPaginas === null) {
        reg.totalPaginas = Number(body.totalPaginas) || 0;
        reg.totalRegistros = Number(body.totalRegistros) || 0;
      }
      const restantes = Number(body.paginasRestantes);
      const acabou = lista.length === 0 || pagina >= reg.totalPaginas || (Number.isFinite(restantes) && restantes <= 0);
      if (acabou) break;
      if (pagina >= o.maxPaginas) {
        reg.status = 'truncado';
        alertas.push(`Combinação ${reg.combinacao}: coleta interrompida no limite de segurança de ${o.maxPaginas} páginas ` +
          `(${reg.registrosObtidos} de ${reg.totalRegistros} registros). Restrinja o período ou os filtros.`);
        break;
      }
      pagina++;
      await dormir(o.intervaloPaginasMs);
    }
    if (reg.status === 'ok' && reg.totalRegistros !== null && reg.registrosObtidos !== reg.totalRegistros) {
      alertas.push(`Combinação ${reg.combinacao}: a API informou ${reg.totalRegistros} registros, mas foram obtidos ${reg.registrosObtidos}.`);
    }
    requisicoes.push(reg);
  }
  return { brutos, requisicoes, falhas, alertas };
}

/**
 * Consulta o catálogo (material e/ou serviço) para obter a descrição do item e,
 * se `tipoItem` não foi informado, detectar o tipo pelo catálogo que retornar o código.
 * @returns {{ tipoItem: string|null, descricao: string|null, erro: string|null, alertas: string[], consultas: object[] }}
 */
async function identificarItem(http, dormir, codigo, tipoInformado, opcoes) {
  const alertas = [];
  const consultas = [];
  const buscar = async (tipo) => {
    const url = tipo === 'material'
      ? montarUrl(ENDPOINTS.catalogoMaterial, { codigoItem: codigo, pagina: 1, tamanhoPagina: 10 })
      : montarUrl(ENDPOINTS.catalogoServico, { codigoServico: codigo, pagina: 1, tamanhoPagina: 10 });
    const r = await getComRetry(http, dormir, url, opcoes);
    const lista = r.ok && r.body && Array.isArray(r.body.resultado) ? r.body.resultado : [];
    const item = lista.find((x) => String(tipo === 'material' ? x.codigoItem : x.codigoServico) === String(codigo)) || null;
    const descricao = item ? (tipo === 'material' ? item.descricaoItem : (item.nomeServico || item.descricaoServico)) : null;
    consultas.push({ catalogo: tipo, url, ok: r.ok, encontrado: !!item, erro: r.ok ? null : r.erro });
    return { ok: r.ok, encontrado: !!item, descricao, item };
  };

  if (tipoInformado) {
    const r = await buscar(tipoInformado);
    if (!r.ok) alertas.push(`Não foi possível consultar o catálogo de ${tipoInformado === 'material' ? 'materiais (CATMAT)' : 'serviços (CATSER)'}; a descrição do item será obtida dos registros de preços.`);
    else if (!r.encontrado) alertas.push(`O código ${codigo} não foi localizado no catálogo de ${tipoInformado === 'material' ? 'materiais (CATMAT)' : 'serviços (CATSER)'}. Confira se o tipo do item está correto.`);
    return { tipoItem: tipoInformado, descricao: r.descricao, erro: null, alertas, consultas };
  }

  const m = await buscar('material');
  const s = await buscar('servico');
  if (!m.ok || !s.ok) {
    return { tipoItem: null, descricao: null, alertas, consultas,
      erro: 'Não foi possível consultar o catálogo para detectar o tipo do item. Informe tipoItem ("material" ou "servico").' };
  }
  if (m.encontrado && !s.encontrado) return { tipoItem: 'material', descricao: m.descricao, erro: null, alertas, consultas };
  if (s.encontrado && !m.encontrado) return { tipoItem: 'servico', descricao: s.descricao, erro: null, alertas, consultas };
  return {
    tipoItem: null, descricao: null, alertas, consultas,
    erro: m.encontrado
      ? `O código ${codigo} existe nos catálogos de materiais e de serviços. Informe tipoItem ("material" ou "servico").`
      : `O código ${codigo} não foi encontrado nos catálogos de materiais nem de serviços. Informe tipoItem ("material" ou "servico") ou confira o código.`
  };
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { API_BASE, ENDPOINTS, TAMANHO_PAGINA, montarUrl, montarCombinacoes, montarQuery, erroTransitorio400, getComRetry, coletarPrecos, identificarItem }; // @exports
} // @exports
