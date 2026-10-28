// ============================================================================
// pncp.js — link do edital no Portal Nacional de Contratações Públicas (PNCP)
// para cada compra da série. O idCompra (de materiais, derivado de
// idCompraItem) é consultado no módulo de contratações da API de Dados
// Abertos, que devolve orgaoEntidadeCnpj, anoCompraPncp e sequencialCompraPncp:
//   https://pncp.gov.br/app/editais/{cnpj}/{ano}/{sequencial}
// Só há resultado para compras da Lei 14.133 publicadas no PNCP; as demais
// ficam com o link da consulta na API. Copiado para o nó "Obter links do PNCP".
//
// O módulo de contratações limita a ~100 requisições por minuto (HTTP 429 com
// Retry-After). Por isso: pausa global respeitando o Retry-After, cache dos
// links entre os itens da mesma execução e um teto de tempo por item.
//
// O teto é rígido: a instância n8n encerra qualquer nó Code que passe de 60 s
// (task runner) e, quando isso acontecia, o item inteiro virava ERRO. Nenhuma
// pausa ou espera passa do teto e, com o timeout de cada requisição (10 s no
// nó), o passo termina em no máximo teto + 10 s.
//
// Antes da API, o fluxo consulta a base local (tabela contratacoes_pncp do
// Supabase, sincronizada toda semana; função links_pncp) numa só requisição,
// no nó "Consultar base de contratações". Só o que não está na base (compras
// antigas ou publicadas depois da última sincronização) vai para a API. Se a
// base falhar, tudo vai para a API, como antes.
// ============================================================================

const PNCP_CONSULTA = 'https://dadosabertos.compras.gov.br/modulo-contratacoes/1.1_consultarContratacoes_PNCP_14133_Id';
const PNCP_EDITAIS = 'https://pncp.gov.br/app/editais';
const OPCOES_PNCP_PADRAO = {
  concorrencia: 4,
  tentativas: 3,              // por compra, em 5xx ou falha de rede (429 não conta)
  esperaBaseMs: 2000,
  esperaMaxLimiteS: 65,       // teto da pausa pedida no Retry-After (limitada também pelo orçamento)
  orcamentoMs: 40 * 1000,     // teto de tempo por item (runner do n8n: 60 s); o que sobrar fica com o link da API
  validadeNaoEncontradoDias: 30,
  maxCache: 30000
};

/** Link do edital no PNCP a partir do registro do módulo de contratações (ou null). */
function linkPncp(x) {
  const cnpj = String((x && x.orgaoEntidadeCnpj) || '').replace(/\D/g, '');
  const ano = Number(x && x.anoCompraPncp);
  const seq = Number(x && x.sequencialCompraPncp);
  if (cnpj.length !== 14 || !(ano > 0) || !(seq > 0)) return null;
  return `${PNCP_EDITAIS}/${cnpj}/${ano}/${seq}`;
}

/**
 * Resposta da base local (POST /rest/v1/rpc/links_pncp, HTTP Request com
 * resposta completa) → { mapa, linhas, erro }. mapa[idCompra] = { url, numeroControlePNCP }.
 * Aceita também a saída de erro do nó ({ error }): mapa vazio e o motivo em `erro`.
 */
function mapaDaBase(resp) {
  const falha = (erro) => ({ mapa: {}, linhas: 0, erro: String(erro).split('\n')[0].slice(0, 200) });
  if (!resp) return falha('sem resposta');
  if (resp.error) return falha(typeof resp.error === 'object' ? resp.error.message || JSON.stringify(resp.error) : resp.error);
  if (resp.statusCode && (resp.statusCode < 200 || resp.statusCode >= 300)) {
    const b = resp.body && typeof resp.body === 'object' ? resp.body.message || resp.body.hint || '' : String(resp.body || '');
    return falha(`HTTP ${resp.statusCode}${b ? `: ${b}` : ''}`);
  }
  if (!Array.isArray(resp.body)) return falha('resposta sem lista');
  const mapa = {};
  for (const x of resp.body) {
    const url = linkPncp({ orgaoEntidadeCnpj: x.orgao_cnpj, anoCompraPncp: x.ano_compra_pncp, sequencialCompraPncp: x.sequencial_compra_pncp });
    if (url && x.id_compra) mapa[String(x.id_compra)] = { url, numeroControlePNCP: x.numero_controle_pncp || null };
  }
  return { mapa, linhas: resp.body.length, erro: null };
}

/**
 * Consulta o PNCP para cada idCompra distinto.
 * @param {(url) => Promise<{statusCode, body, headers?}>} http
 * @param {(ms) => Promise} dormir
 * @param {string[]} ids
 * @param {object} opcoes  ver OPCOES_PNCP_PADRAO; `base` (mapa de mapaDaBase), `cache` (objeto persistente) e `relogio` opcionais
 * @returns {{ mapa, consultados, encontrados, naoEncontrados, falhas, naoConsultados, daBase, doCache, pausas }}
 *   mapa[idCompra]: { url, numeroControlePNCP } | false (não está no PNCP) | null (falha)
 */
async function consultarPncp(http, dormir, ids, opcoes) {
  const o = Object.assign({}, OPCOES_PNCP_PADRAO, opcoes || {});
  const agora = () => (o.relogio ? o.relogio() : Date.now());
  const inicio = agora();
  const cache = o.cache || {};
  const validadeNao = o.validadeNaoEncontradoDias * 86400000;
  const unicos = [...new Set(ids.filter((id) => /^\d{17}$/.test(String(id || ''))).map(String))];
  const mapa = {};
  const base = o.base || {};
  const cont = { consultados: 0, encontrados: 0, naoEncontrados: 0, falhas: 0, naoConsultados: 0, daBase: 0, doCache: 0, pausas: 0 };

  // 1) base local; depois o cache: links encontrados valem sempre; "não encontrado" vale por alguns dias
  const pendentes = [];
  for (const id of unicos) {
    const c = cache[id];
    if (base[id]) { mapa[id] = base[id]; cont.daBase++; cont.encontrados++; }
    else if (c && c.u) { mapa[id] = { url: c.u, numeroControlePNCP: c.c || null }; cont.doCache++; cont.encontrados++; }
    else if (c && c.n && inicio - c.t < validadeNao) { mapa[id] = false; cont.doCache++; cont.naoEncontrados++; }
    else pendentes.push(id);
  }

  // 2) consultas, com pausa global no 429 (Retry-After) e teto de tempo
  let pausaAte = 0;
  let proximo = 0;
  const fim = inicio + o.orcamentoMs;
  // nenhuma espera passa do fim do orçamento
  const dormirAteNoMaximoOFim = async (ms) => { const d = Math.min(ms, fim - agora()); if (d > 0) await dormir(d); };
  const esperarPausa = () => dormirAteNoMaximoOFim(pausaAte - agora());
  const consultar = async (id) => {
    const url = `${PNCP_CONSULTA}?tipo=idCompra&codigo=${id}`;
    let t = 1;
    while (t <= o.tentativas) {
      await esperarPausa();
      if (agora() >= fim) return undefined;
      let resp = null;
      try { resp = await http(url); } catch (e) { resp = null; }
      if (resp && resp.statusCode === 429) {
        const h = resp.headers || {};
        const s = Math.min(Number(h['retry-after'] || h['Retry-After']) || 30, o.esperaMaxLimiteS);
        pausaAte = Math.max(pausaAte, agora() + s * 1000 + 500);
        cont.pausas++;
        continue; // 429 não consome tentativa
      }
      if (resp && resp.statusCode >= 200 && resp.statusCode < 300) {
        const lista = resp.body && Array.isArray(resp.body.resultado) ? resp.body.resultado : [];
        const x = lista.find((y) => String(y.idCompra) === id) || lista[0];
        const link = linkPncp(x);
        return link ? { url: link, numeroControlePNCP: x.numeroControlePNCP || null } : false;
      }
      if (resp && resp.statusCode < 500) return null; // 4xx definitivo
      if (t < o.tentativas) await dormirAteNoMaximoOFim(o.esperaBaseMs * Math.pow(2, t - 1));
      t++;
    }
    return null;
  };
  const trabalhador = async () => {
    while (proximo < pendentes.length) {
      const id = pendentes[proximo++];
      const r = await consultar(id);
      if (r === undefined) { cont.naoConsultados++; continue; }
      cont.consultados++;
      mapa[id] = r;
      if (r) { cont.encontrados++; cache[id] = { u: r.url, c: r.numeroControlePNCP, t: agora() }; }
      else if (r === false) { cont.naoEncontrados++; cache[id] = { n: 1, t: agora() }; }
      else cont.falhas++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concorrencia, pendentes.length) }, trabalhador));

  // 3) limita o tamanho do cache (remove as entradas mais antigas)
  const chaves = Object.keys(cache);
  if (chaves.length > o.maxCache) {
    chaves.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0)).slice(0, chaves.length - o.maxCache).forEach((k) => delete cache[k]);
  }
  return Object.assign({ mapa }, cont);
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { linkPncp, mapaDaBase, consultarPncp, PNCP_CONSULTA, PNCP_EDITAIS, OPCOES_PNCP_PADRAO }; // @exports
} // @exports
