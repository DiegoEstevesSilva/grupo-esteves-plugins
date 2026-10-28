// ============================================================================
// tratamento.js — normalização, deduplicação e saneamento dos registros
// (seções 3, 4.1, 4.2 e 6). Copiado para os nós "Normalizar e deduplicar",
// "Remover inconsistentes" e "Homogeneizar unidade" pelo build.
// ============================================================================

// Tabela de modalidades do SIASG (campo `modalidade` e dígitos 7–8 do idCompra)
const MODALIDADES = {
  1: 'Convite', 2: 'Tomada de Preços', 3: 'Concorrência', 4: 'Concorrência Internacional',
  5: 'Pregão', 6: 'Dispensa de Licitação', 7: 'Inexigibilidade de Licitação', 20: 'Concurso',
  22: 'Tomada de Preços por Técnica e Preço', 33: 'Concorrência por Técnica e Preço',
  44: 'Concorrência Internacional por Técnica e Preço'
};
const FORMAS = { SISPP: 'SISPP (compra comum)', SISRP: 'SISRP (registro de preços)' };
const ESFERAS = { F: 'Federal', E: 'Estadual', M: 'Municipal' };
const PODERES = { E: 'Executivo', L: 'Legislativo', J: 'Judiciário' };

/**
 * Converte número em formato brasileiro ("1.234,56") ou internacional ("1234.56").
 * Retorna NaN se não for numérico.
 */
function parseNumero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim().replace(/\s|R\$/g, '');
  if (s === '') return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (!/^-?\d+(\.\d+)?$/.test(s)) {
    return NaN;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function texto(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Formata CNPJ; mascara CPF de fornecedor pessoa física (LGPD — minimização):
 * 12345678901 → ***.456.789-**
 */
function formatarNi(ni) {
  const s = String(ni || '').replace(/\D/g, '');
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  if (s.length === 11) return `***.${s.slice(3, 6)}.${s.slice(6, 9)}-**`;
  return texto(ni);
}

/**
 * Decompõe o idCompra: UASG (6) + modalidade (2) + número (5) + ano (4).
 * A hipótese foi validada contra o módulo de contratações (PNCP) — ver
 * docs/api-contract.md. Só é aceita se UASG e modalidade conferirem com os
 * campos do próprio registro e o ano for plausível.
 */
function decomporIdCompra(idCompra, codigoUasg, modalidade) {
  const s = String(idCompra || '');
  const res = { extraido: false, numero: null, ano: null, uasg: null, modalidade: null, numeroFormatado: 'número não extraído' };
  if (!/^\d{17}$/.test(s)) return res;
  const uasg = s.slice(0, 6);
  const mod = Number(s.slice(6, 8));
  const numero = s.slice(8, 13);
  const ano = Number(s.slice(13, 17));
  const uasgOk = codigoUasg === null || codigoUasg === undefined || String(codigoUasg).padStart(6, '0') === uasg;
  const modOk = modalidade === null || modalidade === undefined || Number(modalidade) === mod;
  const anoOk = ano >= 1990 && ano <= new Date().getFullYear() + 1;
  if (!(uasgOk && modOk && anoOk)) return res;
  return {
    extraido: true, numero, ano, uasg, modalidade: mod,
    numeroFormatado: `${String(Number(numero)).padStart(5, '0')}/${ano}`
  };
}

/**
 * Chave e descrição da unidade de fornecimento.
 * Material: sigla + capacidade + unidade de medida (ex.: "RO 100 M" = rolo de 100 m).
 * Serviço: unidade de medida (ex.: "UN").
 */
function unidadeDe(raw, tipoItem) {
  if (tipoItem === 'material') {
    const sigla = texto(raw.siglaUnidadeFornecimento);
    const nome = texto(raw.nomeUnidadeFornecimento);
    const cap = parseNumero(raw.capacidadeUnidadeFornecimento);
    const med = texto(raw.siglaUnidadeMedida);
    const nomeMed = texto(raw.nomeUnidadeMedida);
    if (!sigla && !nome) return { chave: null, descricao: 'NÃO INFORMADA', sigla: null, nome: null, capacidade: null, unidadeMedida: null };
    const temCap = Number.isFinite(cap) && cap > 0;
    const capTxt = temCap ? ` ${String(cap).replace('.', ',')}${med ? ' ' + med : ''}` : '';
    return {
      chave: `${(sigla || nome).toUpperCase()}${capTxt.toUpperCase()}`,
      descricao: `${nome || sigla}${temCap ? ` ${String(cap).replace('.', ',')} ${nomeMed || med || ''}`.trimEnd() : ''}`,
      sigla, nome, capacidade: temCap ? cap : null, unidadeMedida: med
    };
  }
  const sigla = texto(raw.siglaUnidadeMedida);
  const nome = texto(raw.nomeUnidadeMedida);
  if (!sigla && !nome) return { chave: null, descricao: 'NÃO INFORMADA', sigla: null, nome: null, capacidade: null, unidadeMedida: null };
  return { chave: (sigla || nome).toUpperCase(), descricao: nome || sigla, sigla, nome, capacidade: null, unidadeMedida: sigla };
}

/**
 * Normaliza um registro bruto da API para o formato do relatório.
 * ATENÇÃO: em 1_consultarMaterial o idCompra vem como número de 17 dígitos,
 * acima de Number.MAX_SAFE_INTEGER — o JSON.parse perde precisão e o zero à
 * esquerda. Por isso o idCompra de materiais é lido dos 17 primeiros dígitos
 * de `idCompraItem` (string). Em serviços, idCompra já vem como string.
 */
function normalizarRegistro(raw, tipoItem, urlRequisicao, codigoSolicitado) {
  let idCompra = null;
  const idCompraItem = texto(raw.idCompraItem);
  if (idCompraItem && /^\d{22}$/.test(idCompraItem)) idCompra = idCompraItem.slice(0, 17);
  else if (typeof raw.idCompra === 'string') idCompra = raw.idCompra.trim();
  else if (raw.idCompra !== null && raw.idCompra !== undefined) idCompra = String(raw.idCompra); // pode ter perdido precisão
  // Em 3_consultarServico o idCompra vem como string, mas sem o zero à esquerda
  // quando a UASG começa com 0 (16 dígitos). O formato canônico (confirmado no
  // PNCP) tem 17 dígitos; decomporIdCompra confere a UASG depois.
  if (idCompra && /^\d{16}$/.test(idCompra)) idCompra = '0' + idCompra;
  const precisaoIdOk = !(tipoItem === 'material' && !idCompraItem);

  const codigoUasg = texto(raw.codigoUasg);
  const compra = decomporIdCompra(idCompra, codigoUasg, raw.modalidade);
  const unidade = unidadeDe(raw, tipoItem);
  const caminho = tipoItem === 'material' ? '/modulo-pesquisa-preco/1_consultarMaterial' : '/modulo-pesquisa-preco/3_consultarServico';
  const qsRegistro = tipoItem === 'material'
    ? `tipo=codigoItemCatalogo&codigo=${codigoSolicitado}&idCompra=${idCompra}&pagina=1&tamanhoPagina=10`
    : `codigoItemCatalogo=${codigoSolicitado}&idCompra=${idCompra}&pagina=1&tamanhoPagina=10`;

  return {
    idCompra,
    idItemCompra: raw.idItemCompra === null || raw.idItemCompra === undefined ? null : String(raw.idItemCompra),
    numeroItemCompra: raw.numeroItemCompra === undefined ? null : raw.numeroItemCompra,
    idCompraItem,
    precisaoIdOk,
    numeroCompra: compra.numeroFormatado,
    numeroCompraExtraido: compra.extraido,
    anoCompra: compra.ano,
    modalidadeCodigo: raw.modalidade === undefined ? null : raw.modalidade,
    modalidade: raw.modalidade === null || raw.modalidade === undefined ? null
      : (MODALIDADES[Number(raw.modalidade)] || `código ${raw.modalidade}`),
    forma: raw.forma ? (FORMAS[raw.forma] || raw.forma) : null,
    criterioJulgamento: texto(raw.criterioJulgamento),
    codigoUasg,
    nomeUasg: texto(raw.nomeUasg),
    codigoOrgao: raw.codigoOrgao === undefined ? null : raw.codigoOrgao,
    nomeOrgao: texto(raw.nomeOrgao),
    municipio: texto(raw.municipio),
    uf: texto(raw.estado),
    esfera: raw.esfera ? (ESFERAS[raw.esfera] || raw.esfera) : null,
    poder: raw.poder ? (PODERES[raw.poder] || raw.poder) : null,
    niFornecedor: formatarNi(raw.niFornecedor),
    nomeFornecedor: texto(raw.nomeFornecedor),
    marca: texto(raw.marca),
    dataCompra: texto(raw.dataCompra),
    dataResultado: texto(raw.dataResultado),
    codigoItemCatalogo: raw.codigoItemCatalogo === undefined || raw.codigoItemCatalogo === null ? null : String(raw.codigoItemCatalogo),
    descricaoItem: texto(raw.descricaoItem),
    quantidade: parseNumero(raw.quantidade),
    precoUnitario: parseNumero(raw.precoUnitario),
    percentualMaiorDesconto: parseNumero(raw.percentualMaiorDesconto),
    unidade: unidade.descricao,
    unidadeChave: unidade.chave,
    unidadeDetalhe: unidade,
    urlRequisicao,
    urlRegistro: idCompra ? `https://dadosabertos.compras.gov.br${caminho}?${qsRegistro}` : null
  };
}

/**
 * Remove duplicados por idCompra + idItemCompra + fornecedor (as consultas por
 * UF/esfera podem se sobrepor). Mantém a primeira ocorrência.
 */
function deduplicar(registros) {
  const vistos = new Set();
  const unicos = [];
  let removidos = 0;
  for (const r of registros) {
    const chave = `${r.idCompra}|${r.idItemCompra}|${r.niFornecedor || ''}`;
    if (vistos.has(chave)) { removidos++; continue; }
    vistos.add(chave);
    unicos.push(r);
  }
  return { unicos, removidos };
}

/** Motivo de inconsistência (4.1) ou null se o registro é válido. */
function motivoInconsistencia(r, params) {
  if (!Number.isFinite(r.precoUnitario)) return 'Preço unitário nulo ou não numérico';
  if (r.precoUnitario <= 0) return `Preço unitário ${r.precoUnitario === 0 ? 'zero' : 'negativo'}`;
  if (!Number.isFinite(r.quantidade) || r.quantidade <= 0) return 'Quantidade nula, zero ou não numérica';
  if (r.codigoItemCatalogo !== String(params.codigo)) return `Código de catálogo divergente (${r.codigoItemCatalogo || 'vazio'} ≠ ${params.codigo})`;
  if (!r.dataCompra) return 'Registro sem data da compra';
  const d = String(r.dataCompra).slice(0, 10);
  if (d < params.dataInicio || d > params.dataFim) return `Data da compra ${d} fora do período ${params.dataInicio} a ${params.dataFim}`;
  return null;
}

function removerInconsistentes(registros, params) {
  const validos = [];
  const descartados = [];
  for (const r of registros) {
    const motivo = motivoInconsistencia(r, params);
    if (motivo) descartados.push({ registro: r, etapa: 'inconsistente', motivo });
    else validos.push(r);
  }
  return { validos, descartados };
}

function normalizarTextoUnidade(s) {
  return String(s || '').normalize('NFD').replace(/\p{Mn}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Homogeneidade da unidade de fornecimento (4.2).
 * - unidade forçada: mantém só os registros que casam (chave, sigla, nome ou descrição);
 * - senão: adota a unidade predominante (mais registros). Registros sem unidade
 *   nunca são adotados e são descartados.
 * Não converte unidades.
 */
function homogeneizarUnidade(registros, unidadeForcada) {
  const distribuicao = {};
  for (const r of registros) {
    const k = r.unidadeChave || 'NÃO INFORMADA';
    if (!distribuicao[k]) distribuicao[k] = { chave: k, descricao: r.unidade, registros: 0 };
    distribuicao[k].registros++;
  }
  const grupos = Object.values(distribuicao).sort((a, b) => b.registros - a.registros || a.chave.localeCompare(b.chave));
  const alertas = [];
  let adotada = null;
  let criterio;

  if (unidadeForcada) {
    const alvo = normalizarTextoUnidade(unidadeForcada);
    const casa = (r) => r.unidadeChave && [r.unidadeChave, r.unidadeDetalhe && r.unidadeDetalhe.sigla, r.unidadeDetalhe && r.unidadeDetalhe.nome, r.unidade]
      .some((x) => x && normalizarTextoUnidade(x) === alvo);
    const primeiro = registros.find(casa);
    adotada = primeiro ? { chave: primeiro.unidadeChave, descricao: primeiro.unidade } : { chave: null, descricao: unidadeForcada };
    criterio = 'informada pelo usuário';
    const validos = [];
    const descartados = [];
    for (const r of registros) {
      if (casa(r)) validos.push(r);
      else descartados.push({ registro: r, etapa: 'unidade', motivo: `Unidade de fornecimento divergente (${r.unidade}) da unidade informada (${unidadeForcada})` });
    }
    if (!validos.length) alertas.push(`Nenhum registro possui a unidade de fornecimento informada ("${unidadeForcada}"). Unidades encontradas: ${grupos.map((g) => g.chave).join(', ') || 'nenhuma'}.`);
    return { validos, descartados, adotada, criterio, distribuicao: grupos, alertas };
  }

  const candidatos = grupos.filter((g) => g.chave !== 'NÃO INFORMADA');
  if (candidatos.length) {
    adotada = { chave: candidatos[0].chave, descricao: candidatos[0].descricao };
    if (candidatos.length > 1 && candidatos[1].registros === candidatos[0].registros) {
      alertas.push(`Empate entre unidades predominantes (${candidatos.filter((g) => g.registros === candidatos[0].registros).map((g) => g.chave).join(', ')}); ` +
        `foi adotada "${adotada.chave}" pela ordem alfabética. Recomenda-se informar o parâmetro unidadeFornecimento.`);
    }
  }
  criterio = 'unidade predominante (maior número de registros)';
  const validos = [];
  const descartados = [];
  for (const r of registros) {
    if (adotada && r.unidadeChave === adotada.chave) validos.push(r);
    else if (!r.unidadeChave) descartados.push({ registro: r, etapa: 'unidade', motivo: 'Unidade de fornecimento não informada' });
    else descartados.push({ registro: r, etapa: 'unidade', motivo: `Unidade de fornecimento divergente (${r.unidade}) da unidade adotada (${adotada.descricao})` });
  }
  return { validos, descartados, adotada, criterio, distribuicao: grupos, alertas };
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { MODALIDADES, parseNumero, formatarNi, decomporIdCompra, unidadeDe, normalizarRegistro, deduplicar, motivoInconsistencia, removerInconsistentes, homogeneizarUnidade }; // @exports
} // @exports
