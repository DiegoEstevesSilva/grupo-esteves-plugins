// ============================================================================
// relatorio.js — monta a saída JSON e o relatório único do edital/processo
// (art. 3º da IN SEGES/ME nº 65/2021), a partir dos estados de todos os itens:
//   Parte I   — informações gerais (uma vez): processo, parâmetros comuns,
//               metodologia, justificativas e quadro-resumo dos itens;
//   Parte II  — uma ficha por item: parâmetros específicos, série, tratamento,
//               memória de cálculo, método, valor e alertas do item;
//   Parte III — consolidação (lotes e total global), alertas gerais e responsável.
// Copiado para o nó "Montar relatório" pelo build.
// ============================================================================

const ENDPOINTS_PESQUISA = {
  material: '/modulo-pesquisa-preco/1_consultarMaterial',
  servico: '/modulo-pesquisa-preco/3_consultarServico'
};
// Acima deste número de registros, a ficha mostra a série em versão enxuta
const LIMITE_SERIE_COMPLETA = 15;

const ALERTAS_GERAIS_FIXOS = [
  'Verifique se as condições comerciais das contratações utilizadas (quantidades, local de entrega, prazos, forma de ' +
    'pagamento, garantia etc.) são compatíveis com as do objeto a ser contratado (art. 4º da IN SEGES/ME nº 65/2021).',
  'Este relatório é um apoio técnico gerado automaticamente a partir de dados abertos e deve ser revisado, ' +
    'complementado e assinado pelo agente responsável pela pesquisa de preços.'
];

/** Número no padrão brasileiro com `casas` decimais. */
function fmtNum(x, casas) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const d = casas === undefined ? 2 : casas;
  const neg = x < 0;
  const [int, dec] = Math.abs(x).toFixed(d).split('.');
  const milhar = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${milhar}${dec ? ',' + dec : ''}`;
}
const fmtR$ = (x) => (x === null || x === undefined ? '—' : `R$ ${fmtNum(x, 2)}`);
const fmtPct = (x) => (x === null || x === undefined ? '—' : `${fmtNum(x * 100, 2)}%`);
const fmtFator = (x) => String(x).replace('.', ',');
const fmtData = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
/** Quantidade: sem casas quando inteira. */
const fmtQtd = (x) => (x === null || x === undefined ? '—' : fmtNum(x, Number.isInteger(x) ? 0 : 2));
const listaOuTodas = (l) => (l && l.length ? l.join(', ') : 'todas (filtro não aplicado)');

/** Célula de tabela Markdown segura. */
function cel(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function resumir(s, max) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** Situação do item para o quadro-resumo. */
function situacaoItem(status) {
  if (status === 'OK') return 'OK';
  if (status === 'AMOSTRA_INSUFICIENTE') return 'Amostra insuficiente';
  return 'Requer complementação';
}

/** Registro no formato de saída (identificação completa da fonte — seção 6). */
function fonte(r) {
  return {
    seq: r.seq,
    idCompra: r.idCompra, idItemCompra: r.idItemCompra, numeroItemCompra: r.numeroItemCompra,
    numeroCompra: r.numeroCompra, numeroCompraExtraido: r.numeroCompraExtraido,
    modalidade: r.modalidade, forma: r.forma, criterioJulgamento: r.criterioJulgamento,
    codigoUasg: r.codigoUasg, nomeUasg: r.nomeUasg, codigoOrgao: r.codigoOrgao, nomeOrgao: r.nomeOrgao,
    municipio: r.municipio, uf: r.uf, esfera: r.esfera, poder: r.poder,
    niFornecedor: r.niFornecedor, nomeFornecedor: r.nomeFornecedor, marca: r.marca,
    dataCompra: r.dataCompra, quantidade: Number.isFinite(r.quantidade) ? r.quantidade : null,
    unidadeFornecimento: r.unidade,
    preco: Number.isFinite(r.precoUnitario) ? r.precoUnitario : null,
    urlRequisicao: r.urlRequisicao, urlRegistro: r.urlRegistro,
    numeroControlePNCP: r.numeroControlePNCP || null, urlPncp: r.urlPncp || null
  };
}

/** Link do registro: edital no PNCP quando houver; senão, a consulta do registro na API. */
const linkDe = (r) => (r.urlPncp ? `[PNCP](${r.urlPncp})` : r.urlRegistro ? `[API](${r.urlRegistro})` : '—');
const precoDe = (r) => fmtR$(Number.isFinite(r.precoUnitario) ? r.precoUnitario : null);
const compraDe = (r) => (r.numeroCompraExtraido ? `${r.numeroCompra}` : `${r.idCompra} (número não extraído)`);
// Nº do item na contratação de origem: é o número do item no edital do PNCP
// (conferido em 29/09/2026: mesmo preço e fornecedor do resultado homologado)
const itemDe = (r) => cel(r.numeroItemCompra);

function linhaFonte(r, situacao) {
  return `| ${r.seq} | ${cel(r.idCompra)} / ${cel(r.idItemCompra)} | ${cel(compraDe(r))} | ${itemDe(r)} | ` +
    `${cel(r.modalidade)}; ${cel(r.forma)}; crit. ${cel(r.criterioJulgamento)} | ${cel(r.codigoUasg)} – ${cel(r.nomeUasg)} | ` +
    `${cel(r.nomeOrgao)} | ${cel(r.municipio)}/${cel(r.uf)} | ${cel(r.esfera)} / ${cel(r.poder)} | ` +
    `${cel(r.niFornecedor)} – ${cel(r.nomeFornecedor)} | ${cel(r.marca)} | ${fmtData(r.dataCompra)} | ` +
    `${fmtNum(r.quantidade, 2)} | ${cel(r.unidade)} | ${precoDe(r)} | ${cel(situacao)} | ${linkDe(r)} |`;
}
const CAB_FONTES = '| # | idCompra / idItemCompra | Nº compra/ano | Item na compra | Modalidade; forma; critério | UASG | Órgão | Município/UF | Esfera / Poder | Fornecedor | Marca | Data compra | Qtd. | Unidade | Preço unit. | Situação | Link |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

function linhaFonteEnxuta(r, situacao) {
  return `| ${r.seq} | ${cel(r.codigoUasg)} – ${cel(r.nomeUasg)} | ${cel(compraDe(r))} | ${itemDe(r)} | ${fmtData(r.dataCompra)} | ${cel(r.unidade)} | ` +
    `${precoDe(r)} | ${cel(situacao)} | ${linkDe(r)} |`;
}
const CAB_FONTES_ENXUTA = '| # | UASG | Nº compra/ano | Item na compra | Data compra | Unidade | Preço unit. | Situação | Link |\n|---|---|---|---|---|---|---|---|---|';

/** Saída JSON de um item (ficha). */
function saidaItem(e) {
  const est = e.estimativa ? e.estimativa.estatisticas : null;
  const q = e.iqr ? e.iqr.quartis : null;
  const unidadeAdotada = e.unidade && e.unidade.adotada ? e.unidade.adotada.descricao : null;
  return {
    numeroItem: e.itemEdital.numeroItem,
    lote: e.itemEdital.lote,
    quantidade: e.itemEdital.quantidade,
    status: e.status,
    situacao: situacaoItem(e.status),
    item: e.item,
    descricaoInformada: e.itemEdital.descricaoInformada,
    parametrosPesquisa: {
      dataInicio: e.params.dataInicio, dataFim: e.params.dataFim,
      esferas: e.params.esferas, ufs: e.params.ufs,
      unidadeFornecimento: e.params.unidadeFornecimento,
      dataHoraAcesso: e.dataHoraAcesso,
      endpoint: e.endpoint,
      desvios: e.itemEdital.desvios || [],
      justificativaDesvio: e.itemEdital.justificativaDesvio,
      requisicoes: e.coleta.requisicoes, falhasColeta: e.coleta.falhas,
      consultasCatalogo: e.consultasCatalogo || [],
      pncp: e.pncp || null
    },
    serieColetada: e.serieColetada.map(fonte),
    descartados: e.descartados.map((d) => Object.assign(fonte(d.registro), { etapa: d.etapa, motivo: d.motivo })),
    serieSaneada: e.serieSaneada.map(fonte),
    memoriaCalculo: {
      totalRegistrosRecebidos: e.totalBruto,
      duplicadosRemovidos: e.duplicadosRemovidos,
      unidadeAdotada,
      criterioUnidade: e.unidade ? e.unidade.criterio : null,
      distribuicaoUnidades: e.unidade ? e.unidade.distribuicao : [],
      quartis: q ? { metodo: q.metodo, Q1: q.Q1, Q3: q.Q3, IQR: q.IQR, fator: q.fator, limiteInferior: q.limiteInferior, limiteSuperior: q.limiteSuperior, aplicado: e.iqr.aplicado } : null,
      estatisticas: est,
      regraDecisao: e.estimativa ? e.estimativa.regraDecisao : { limiarCV: e.params.limiarCV, resultado: null }
    },
    metodoAplicado: e.estimativa ? e.estimativa.metodoAplicado : null,
    valorEstimado: e.estimativa ? e.estimativa.valorEstimado : null,
    valorTotal: e.valorTotal,
    observacoes: e.observacoes || [],
    alertas: e.alertas
  };
}

/** Status geral: o dos itens, quando todos iguais; senão PARCIAL. */
function statusGeral(itens) {
  const s = [...new Set(itens.map((i) => i.status))];
  return s.length === 1 ? s[0] : 'PARCIAL';
}

function consolidar(itens) {
  const somar = (lista) => {
    const comValor = lista.filter((i) => i.valorTotal !== null && i.valorTotal !== undefined);
    // soma em centavos para evitar erro de ponto flutuante
    const centavos = comValor.reduce((a, i) => a + Math.round(i.valorTotal * 100), 0);
    return { valorTotal: comValor.length ? centavos / 100 : null, itens: lista.map((i) => i.numeroItem), itensSemValor: lista.filter((i) => !comValor.includes(i)).map((i) => i.numeroItem) };
  };
  const lotes = [];
  if (itens.some((i) => i.lote)) {
    const ordem = [];
    const grupos = {};
    for (const i of itens) {
      const k = i.lote || '(sem lote)';
      if (!grupos[k]) { grupos[k] = []; ordem.push(k); }
      grupos[k].push(i);
    }
    for (const k of ordem) lotes.push(Object.assign({ lote: k }, somar(grupos[k])));
  }
  const g = somar(itens);
  return { lotes, valorTotalGlobal: g.valorTotal, itensComValor: itens.length - g.itensSemValor.length, itensSemValor: g.itensSemValor };
}

function justificativasGerais(comum) {
  return [
    'Parâmetro adotado: art. 5º, II (contratações similares da Administração Pública, em execução ou concluídas), prioritário junto ao ' +
      'inciso I (art. 5º, § 1º), com dados obtidos da API oficial de Dados Abertos do Compras.gov.br, o que garante rastreabilidade de cada preço.',
    'Valores inconsistentes (preço ou quantidade nulos, zero ou negativos, código de catálogo divergente, registros sem data ou fora do ' +
      'período) foram excluídos por não representarem preço válido do objeto.',
    'Unidade de fornecimento: adota-se a unidade informada para o item ou, na falta dela, a predominante na série (maior número de ' +
      'registros). Preços cotados em unidades diferentes não são comparáveis e foram descartados; não houve conversão automática de unidades.',
    `Preços inexequíveis e excessivamente elevados foram identificados pelo método do intervalo interquartil (IQR, fator ${fmtFator(comum.fatorIQR)}), ` +
      'critério estatístico objetivo, reproduzível em planilha e fundamentado, conforme exige o art. 6º, § 3º.',
    `Escolha entre média e mediana pelo coeficiente de variação (CV = desvio padrão / média), com limiar de ${fmtFator(comum.limiarCV * 100)}%: ` +
      'CV até o limiar indica série homogênea (média); acima dele, série heterogênea (mediana, menos sensível a extremos). O critério atende à ' +
      'análise crítica exigida diante de grande variação entre os valores (art. 6º, § 4º) e segue a orientação consolidada na jurisprudência e ' +
      'nos manuais do TCU sobre pesquisa de preços.',
    'Arredondamento: os cálculos usam precisão total; o valor unitário estimado é arredondado a 2 casas decimais e só então multiplicado ' +
      'pela quantidade a contratar, com o valor total também arredondado a 2 casas.',
    'Registros duplicados (mesmo idCompra, idItemCompra e fornecedor, retornados por mais de uma combinação de filtros) são contados uma única vez.'
  ];
}

/**
 * @param {object[]} estados estados finais de todos os itens (nó "Concluir item"), cada um com `contexto`
 * @returns {object} saída final com `itens[]`, consolidação e `relatorioMarkdown`
 */
function montarSaida(estados) {
  const ordenados = estados.slice().sort((a, b) => a.itemEdital.indice - b.itemEdital.indice);
  const ctx = ordenados[0].contexto;
  const c = ctx.comum;
  const itens = ordenados.map(saidaItem);
  const tipos = [...new Set(itens.map((i) => i.item.tipo).filter((t) => ENDPOINTS_PESQUISA[t]))];

  const saida = {
    status: statusGeral(itens),
    processo: ctx.processo,
    dataHoraPesquisa: ctx.dataHoraPesquisa,
    baseNormativa: 'IN SEGES/ME nº 65/2021',
    parametrosComuns: {
      dataInicio: c.dataInicio, dataFim: c.dataFim, esferas: c.esferas, ufs: c.ufs,
      limiarCV: c.limiarCV, fatorIQR: c.fatorIQR,
      fonte: 'API Dados Abertos Compras.gov.br',
      parametroNormativo: 'IN SEGES/ME nº 65/2021, art. 5º, II (contratações similares da Administração Pública)',
      endpoints: tipos.map((t) => ENDPOINTS_PESQUISA[t])
    },
    quadroResumo: itens.map((i) => ({
      numeroItem: i.numeroItem, lote: i.lote, sistema: i.item.sistema, codigo: i.item.codigo,
      descricao: resumir(i.item.descricao, 80), unidade: i.memoriaCalculo.unidadeAdotada || i.parametrosPesquisa.unidadeFornecimento,
      quantidade: i.quantidade, precosValidos: i.serieSaneada.length, metodo: i.metodoAplicado,
      cv: i.memoriaCalculo.estatisticas ? i.memoriaCalculo.estatisticas.cv : null,
      valorUnitario: i.valorEstimado, valorTotal: i.valorTotal, status: i.status, situacao: i.situacao
    })),
    consolidacao: consolidar(itens),
    totalItens: itens.length,
    totalRegistrosColetados: itens.reduce((a, i) => a + i.serieColetada.length, 0),
    itens,
    justificativas: justificativasGerais(c),
    alertas: [].concat(ctx.alertasGerais || [], ALERTAS_GERAIS_FIXOS)
  };
  if (itens.every((i) => i.status === 'NAO_IDENTIFICADO')) {
    saida.erros = itens.map((i) => `Item ${i.numeroItem}: ${i.alertas.find((a) => /^Item não pesquisado/.test(a)) || 'não identificado'}`);
  }
  saida.relatorioMarkdown = montarMarkdown(ordenados, saida);
  return saida;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function parteI(L, s) {
  const p = s.processo || {};
  const c = s.parametrosComuns;
  L.push('# Parte I — Informações gerais');
  L.push('');
  L.push('## 1. Identificação do processo e do objeto (art. 3º, I)');
  L.push('');
  L.push(`- **Nº do processo:** ${cel(p.numero || 'não informado')}`);
  L.push(`- **Órgão:** ${cel(p.orgao || 'não informado')}`);
  L.push(`- **Objeto:** ${cel(p.objeto || 'não informado')}`);
  L.push(`- **Itens pesquisados:** ${s.totalItens}`);
  L.push(`- **Data/hora da geração:** ${s.dataHoraPesquisa}`);
  L.push('- **Base normativa:** Instrução Normativa SEGES/ME nº 65, de 7 de julho de 2021');
  L.push('');

  L.push('## 2. Parâmetros e fontes comuns (art. 3º, III)');
  L.push('');
  L.push('- **Parâmetro utilizado:** art. 5º, II — contratações similares feitas pela Administração Pública, em execução ou concluídas (parâmetro prioritário, art. 5º, § 1º).');
  L.push('- **Fonte:** API de Dados Abertos do Compras.gov.br (https://dadosabertos.compras.gov.br), módulo Pesquisa de Preço.');
  const rotuloEndpoint = (x) => `\`${x}\` (${x === ENDPOINTS_PESQUISA.material ? 'materiais' : 'serviços'})`;
  L.push(`- **Endpoints:** ${c.endpoints.length ? c.endpoints.map(rotuloEndpoint).join('; ') : '—'}`);
  L.push(`- **Período padrão (data da compra):** ${fmtData(c.dataInicio)} a ${fmtData(c.dataFim)}`);
  L.push(`- **Esferas:** ${listaOuTodas(c.esferas)} · **UFs:** ${listaOuTodas(c.ufs)}`);
  L.push('- **Links das fontes:** cada preço traz o link que reproduz a consulta do registro na API de Dados Abertos (filtro por idCompra). A coluna "Item na compra" traz o número do item na contratação de origem, o mesmo da lista de itens do edital no PNCP, onde estão o preço e o fornecedor homologados.');
  L.push('- **Paginação:** todas as páginas de cada combinação UF × esfera (a API aceita um valor por filtro), com novas tentativas em caso de falha.');
  L.push('');
  L.push('Parâmetros que variam por item (período, UFs, esferas, unidade) e a data/hora de acesso constam da ficha de cada item (Parte II, seção 2).');
  L.push('');

  L.push('## 3. Metodologia de tratamento e critério estatístico');
  L.push('');
  L.push('Aplicada a todos os itens, na ordem abaixo. As fichas da Parte II registram apenas os números e as exceções de cada item.');
  L.push('');
  L.push('- **4.1 Valores inconsistentes:** exclusão de registros com preço nulo, zero, negativo ou não numérico; quantidade nula ou zero; código de catálogo diferente do pesquisado; sem data da compra ou fora do período.');
  L.push('- **4.2 Unidade de fornecimento:** adoção da unidade informada para o item ou, na falta, da predominante; registros em outras unidades são descartados, sem conversão.');
  L.push(`- **4.3 Inexequíveis e excessivamente elevados (IQR):** Q1 e Q3 por interpolação linear (QUARTIL.INC); exclusão, uma única vez, dos preços abaixo de Q1 − ${fmtFator(c.fatorIQR)} × IQR (inexequíveis) ou acima de Q3 + ${fmtFator(c.fatorIQR)} × IQR (excessivamente elevados), com IQR = Q3 − Q1. Com menos de 4 preços o IQR não é aplicado; com IQR = 0, mantêm-se só os preços iguais à mediana.`);
  L.push(`- **Média ou mediana:** coeficiente de variação da série saneada (CV = desvio padrão amostral / média). CV ≤ ${fmtFator(c.limiarCV * 100)}% ⇒ média; CV > ${fmtFator(c.limiarCV * 100)}% ⇒ mediana.`);
  L.push('- **Amostra mínima:** com menos de 3 preços válidos o valor não é calculado automaticamente (art. 6º, caput e § 5º).');
  L.push('');

  L.push('## 4. Justificativas da metodologia (art. 3º, VI)');
  L.push('');
  for (const j of s.justificativas) L.push(`- ${j}`);
  L.push('');

  L.push('## 5. Quadro-resumo dos itens');
  L.push('');
  const comLote = s.quadroResumo.some((r) => r.lote);
  L.push(`| Item |${comLote ? ' Lote |' : ''} Código | Descrição | Unidade | Qtd. | Preços válidos | Método | CV | Valor unit. | Valor total | Status |`);
  L.push(`|---|${comLote ? '---|' : ''}---|---|---|---|---|---|---|---|---|---|`);
  for (const r of s.quadroResumo) {
    L.push(`| ${cel(r.numeroItem)} |${comLote ? ` ${cel(r.lote)} |` : ''} ${r.sistema} ${cel(r.codigo)} | ${cel(r.descricao)} | ${cel(r.unidade)} | ${fmtQtd(r.quantidade)} | ` +
      `${r.precosValidos} | ${cel(r.metodo)} | ${fmtPct(r.cv)} | ${fmtR$(r.valorUnitario)} | ${fmtR$(r.valorTotal)} | ${r.situacao} |`);
  }
  L.push(`| **Total** |${comLote ? ' |' : ''} | | | | | | | | **${fmtR$(s.consolidacao.valorTotalGlobal)}** | |`);
  L.push('');
}

function fichaItem(L, e, i, c) {
  const est = i.memoriaCalculo.estatisticas;
  const q = i.memoriaCalculo.quartis;
  const nDesc = (etapa) => e.descartados.filter((d) => d.etapa === etapa).length;
  const tipoNome = i.item.tipo === 'material' ? 'material' : i.item.tipo === 'servico' ? 'serviço' : 'tipo não identificado';

  L.push(`## Item ${cel(i.numeroItem)} — ${i.item.sistema} ${cel(i.item.codigo)}`);
  L.push('');

  L.push('### 1. Identificação do item (art. 3º, I)');
  L.push('');
  L.push(`- **Nº do item no edital:** ${cel(i.numeroItem)}${i.lote ? ` · **Lote/grupo:** ${cel(i.lote)}` : ''}`);
  L.push(`- **Descrição:** ${cel(i.item.descricao || 'descrição não localizada no catálogo')}`);
  if (i.descricaoInformada && i.descricaoInformada !== i.item.descricao) L.push(`- **Descrição informada no edital:** ${cel(i.descricaoInformada)}`);
  L.push(`- **Código ${i.item.sistema}:** ${cel(i.item.codigo)} (${tipoNome})`);
  L.push(`- **Unidade de fornecimento:** ${cel(i.memoriaCalculo.unidadeAdotada || i.parametrosPesquisa.unidadeFornecimento || 'não definida')}`);
  L.push(`- **Quantidade a contratar:** ${i.quantidade === null ? 'não informada' : fmtQtd(i.quantidade)}`);
  L.push(`- **Status:** ${i.situacao} (${i.status})`);
  L.push('');

  const pp = i.parametrosPesquisa;
  L.push('### 2. Parâmetros específicos (art. 3º, III)');
  L.push('');
  if (i.status === 'NAO_IDENTIFICADO' || (!pp.requisicoes.length && i.status === 'ERRO')) {
    L.push('A coleta não foi realizada para este item (ver alertas do item).');
    L.push('');
  } else {
    L.push(`- **Período (data da compra):** ${fmtData(pp.dataInicio)} a ${fmtData(pp.dataFim)}`);
    L.push(`- **Esferas:** ${listaOuTodas(pp.esferas)} · **UFs:** ${listaOuTodas(pp.ufs)}`);
    if (pp.unidadeFornecimento) L.push(`- **Unidade informada para o item:** ${cel(pp.unidadeFornecimento)}`);
    L.push(`- **Endpoint:** \`${pp.endpoint || '—'}\` · **Data/hora de acesso:** ${cel(pp.dataHoraAcesso || c.dataHoraPesquisa)}`);
    L.push('');
    if (pp.requisicoes.length) {
      L.push('| Combinação | Páginas lidas | Registros (API) | Registros obtidos | Situação | Requisição |');
      L.push('|---|---|---|---|---|---|');
      for (const r of pp.requisicoes) {
        L.push(`| ${cel(r.combinacao)} | ${r.paginasLidas}/${r.totalPaginas === null ? '—' : r.totalPaginas} | ${r.totalRegistros === null ? '—' : r.totalRegistros} | ${r.registrosObtidos} | ${cel(r.status === 'ok' ? 'concluída' : r.status + (r.erro ? ': ' + r.erro : ''))} | [link](${r.url}) |`);
      }
      L.push('');
    }
  }
  if (pp.desvios.length) {
    L.push('**Desvios em relação aos parâmetros comuns (Parte I, seção 2):**');
    L.push('');
    L.push('| Parâmetro | Comum | Adotado no item |');
    L.push('|---|---|---|');
    for (const d of pp.desvios) L.push(`| ${cel(d.campo)} | ${cel(d.comum)} | ${cel(d.item)} |`);
    L.push('');
    L.push(`**Justificativa:** ${cel(pp.justificativaDesvio || 'não informada — registre o motivo do desvio.')}`);
    L.push('');
  }

  L.push('### 3. Série de preços coletados (art. 3º, IV)');
  L.push('');
  if (!e.serieColetada.length) {
    L.push(i.status === 'SEM_DADOS' ? 'Nenhum registro foi retornado pela API para os parâmetros do item.' : 'Não há série de preços para este item.');
  } else {
    const situacao = {};
    for (const d of e.descartados) situacao[d.registro.seq] = `descartado (${d.etapa})`;
    const pn = e.pncp;
    L.push(`${e.serieColetada.length} registros distintos (${e.totalBruto} recebidos; ${e.duplicadosRemovidos} duplicados removidos). ` +
      (pn ? `${pn.registrosComLink} com link para o edital no PNCP; os demais (compras fora do PNCP) têm o link da consulta na API.` : 'Os links reproduzem a consulta do registro na API (filtro por idCompra).'));
    L.push('');
    if (e.serieColetada.length > LIMITE_SERIE_COMPLETA) {
      L.push(`Versão enxuta. A identificação completa de cada fonte (idCompra, modalidade, órgão, fornecedor, marca, quantidade etc.) está no arquivo resultado.json que acompanha este relatório.`);
      L.push('');
      L.push(CAB_FONTES_ENXUTA);
      e.serieColetada.forEach((r) => L.push(linhaFonteEnxuta(r, situacao[r.seq] || 'aproveitado')));
    } else {
      L.push(CAB_FONTES);
      e.serieColetada.forEach((r) => L.push(linhaFonte(r, situacao[r.seq] || 'aproveitado')));
    }
  }
  L.push('');

  L.push('### 4. Tratamento dos dados');
  L.push('');
  if (e.serieColetada.length) {
    const n0 = e.serieColetada.length;
    const n1 = n0 - nDesc('inconsistente');
    const n2 = n1 - nDesc('unidade');
    const n3 = n2 - nDesc('IQR_inferior') - nDesc('IQR_superior');
    L.push('| Etapa (Parte I, seção 3) | Excluídos | Restantes |');
    L.push('|---|---|---|');
    L.push(`| Série coletada | — | ${n0} |`);
    L.push(`| 4.1 Valores inconsistentes | ${nDesc('inconsistente')} | ${n1} |`);
    L.push(`| 4.2 Unidade de fornecimento | ${nDesc('unidade')} | ${n2} |`);
    L.push(`| 4.3 IQR — inexequíveis / excessivamente elevados | ${nDesc('IQR_inferior')} / ${nDesc('IQR_superior')} | ${n3} |`);
    L.push('');
    if (e.unidade && e.unidade.distribuicao.length) {
      L.push(`**Unidade adotada:** ${cel(i.memoriaCalculo.unidadeAdotada || '—')} — critério: ${cel(i.memoriaCalculo.criterioUnidade)}. Distribuição após 4.1:`);
      L.push('');
      L.push('| Unidade | Registros |');
      L.push('|---|---|');
      for (const g of e.unidade.distribuicao) L.push(`| ${cel(g.descricao)} (${cel(g.chave)}) | ${g.registros} |`);
      L.push('');
    }
    const obs = i.observacoes.filter((o) => !/^Unidade adotada/.test(o));
    for (const o of obs) L.push(`- ${o}`);
    if (obs.length) L.push('');
    if (e.descartados.length) {
      L.push('**Registros descartados** (# = número na série coletada):');
      L.push('');
      L.push('| # | UASG | Nº compra/ano | Item na compra | Data | Unidade | Preço unit. | Etapa | Motivo |');
      L.push('|---|---|---|---|---|---|---|---|---|');
      for (const d of e.descartados) {
        const r = d.registro;
        L.push(`| ${r.seq} | ${cel(r.codigoUasg)} – ${cel(r.nomeUasg)} | ${cel(r.numeroCompra)} | ${itemDe(r)} | ${fmtData(r.dataCompra)} | ${cel(r.unidade)} | ${precoDe(r)} | ${d.etapa} | ${cel(d.motivo)} |`);
      }
      L.push('');
    }
  } else {
    L.push('Não aplicável (sem registros).');
    L.push('');
  }

  L.push('### 5. Memória de cálculo (art. 3º, VII)');
  L.push('');
  const n2 = e.serieColetada.length - nDesc('inconsistente') - nDesc('unidade');
  if (q && q.aplicado) {
    L.push(`**Quartis** — série após a etapa 4.2 (n = ${n2}); valores com 4 casas decimais, cálculos com precisão total.`);
    L.push('');
    L.push(`- Q1 = QUARTIL.INC(série; 1) = **${fmtNum(q.Q1, 4)}**`);
    L.push(`- Q3 = QUARTIL.INC(série; 3) = **${fmtNum(q.Q3, 4)}**`);
    L.push(`- IQR = Q3 − Q1 = ${fmtNum(q.Q3, 4)} − ${fmtNum(q.Q1, 4)} = **${fmtNum(q.IQR, 4)}**`);
    L.push(`- Limite inferior = Q1 − ${fmtFator(q.fator)} × IQR = ${fmtNum(q.Q1, 4)} − ${fmtFator(q.fator)} × ${fmtNum(q.IQR, 4)} = **${fmtNum(q.limiteInferior, 4)}**`);
    L.push(`- Limite superior = Q3 + ${fmtFator(q.fator)} × IQR = ${fmtNum(q.Q3, 4)} + ${fmtFator(q.fator)} × ${fmtNum(q.IQR, 4)} = **${fmtNum(q.limiteSuperior, 4)}**`);
    L.push('');
  } else if (e.iqr) {
    L.push(`**Quartis:** não calculados (n = ${n2} após a etapa 4.2; ver seção 4).`);
    L.push('');
  }
  if (est && est.n > 0) {
    const soma = e.serieSaneada.reduce((a, r) => a + r.precoUnitario, 0);
    L.push(`**Série saneada** (n = ${est.n}):`);
    L.push('');
    L.push(`- Média = MÉDIA(série) = Σ preços / n = ${fmtNum(soma, 4)} / ${est.n} = **${fmtNum(est.media, 4)}**`);
    L.push(`- Mediana = MED(série) = **${fmtNum(est.mediana, 4)}**`);
    L.push(`- Menor valor = MÍNIMO(série) = **${fmtNum(est.menor, 4)}** · Maior valor = MÁXIMO(série) = **${fmtNum(est.maior, 4)}**`);
    if (est.desvioPadrao !== null) {
      L.push(`- Desvio padrão amostral = DESVPAD.A(série) = √[Σ(xᵢ − média)² / (n − 1)] = **${fmtNum(est.desvioPadrao, 4)}**`);
      L.push(`- Coeficiente de variação = desvio padrão / média = ${fmtNum(est.desvioPadrao, 4)} / ${fmtNum(est.media, 4)} = **${fmtPct(est.cv)}**`);
    } else {
      L.push('- Desvio padrão e CV: não calculáveis com menos de 2 preços.');
    }
    L.push('');
  } else {
    L.push('Não há preços válidos para cálculo.');
    L.push('');
  }

  L.push('### 6. Método estatístico aplicado (art. 3º, V)');
  L.push('');
  if (i.status === 'OK') {
    const rd = i.memoriaCalculo.regraDecisao;
    L.push(`**${i.metodoAplicado}.** CV de ${fmtPct(est.cv)}, ${rd.resultado === 'media' ? 'menor ou igual ao' : 'maior que o'} limiar de ${fmtPct(rd.limiarCV)}: ` +
      `série ${rd.resultado === 'media' ? 'homogênea, representada pela média' : 'heterogênea; adotada a mediana, menos sensível a valores extremos'}.`);
  } else if (i.status === 'AMOSTRA_INSUFICIENTE') {
    L.push(`Nenhum método foi aplicado automaticamente: a série saneada possui ${est ? est.n : 0} preço(s), abaixo do mínimo de 3 (art. 6º, caput).`);
  } else {
    L.push('Não aplicável.');
  }
  L.push('');

  L.push('### 7. Valor estimado do item');
  L.push('');
  if (i.status === 'OK') {
    const un = i.memoriaCalculo.unidadeAdotada || 'unidade';
    L.push(`> **Valor unitário: ${fmtR$(i.valorEstimado)} por ${un}** (${i.metodoAplicado.toLowerCase()} de ${est.n} preços)`);
    L.push(i.quantidade === null
      ? '> **Valor total:** não calculado (quantidade não informada)'
      : `> **Valor total: ${fmtR$(i.valorEstimado)} × ${fmtQtd(i.quantidade)} = ${fmtR$(i.valorTotal)}**`);
  } else if (i.status === 'AMOSTRA_INSUFICIENTE') {
    L.push('> **Valor não calculado automaticamente (amostra insuficiente).** A estimativa com menos de três preços é excepcional e exige justificativa do gestor responsável e aprovação da autoridade competente (art. 6º, § 5º).');
  } else {
    L.push('> **Valor não calculado: requer complementação da pesquisa** com os demais parâmetros do art. 5º (painel de preços, mídia especializada, sites eletrônicos, pesquisa direta com fornecedores, notas fiscais) ou nova consulta com parâmetros ampliados.');
  }
  L.push('');

  L.push('### 8. Alertas do item');
  L.push('');
  if (i.alertas.length) for (const a of i.alertas) L.push(`- ${a}`);
  else L.push('Nenhum alerta específico deste item.');
  L.push('');
}

function parteIII(L, s) {
  const cons = s.consolidacao;
  L.push('# Parte III — Consolidação e encerramento');
  L.push('');
  L.push('## 1. Valor estimado consolidado');
  L.push('');
  if (cons.lotes.length) {
    L.push('| Lote/grupo | Itens | Valor total | Itens sem valor estimado |');
    L.push('|---|---|---|---|');
    for (const l of cons.lotes) L.push(`| ${cel(l.lote)} | ${l.itens.join(', ')} | ${fmtR$(l.valorTotal)} | ${l.itensSemValor.length ? l.itensSemValor.join(', ') : '—'} |`);
    L.push('');
  }
  L.push(`> **Valor total global estimado: ${fmtR$(cons.valorTotalGlobal)}** — soma dos valores totais de ${cons.itensComValor} de ${s.totalItens} item(ns); confere com a linha "Total" do quadro-resumo (Parte I, seção 5).`);
  L.push('');
  if (cons.itensSemValor.length) {
    L.push(`Itens sem valor total calculado (não incluídos no total): ${cons.itensSemValor.join(', ')}. Complete a estimativa desses itens antes de fechar o valor da contratação.`);
    L.push('');
  }

  L.push('## 2. Alertas e ressalvas gerais');
  L.push('');
  for (const a of s.alertas) L.push(`- ${a}`);
  const pendentes = s.itens.filter((i) => i.status !== 'OK').map((i) => i.numeroItem);
  if (pendentes.length) L.push(`- Itens que exigem atenção (amostra insuficiente ou complementação): ${pendentes.join(', ')}. Ver os alertas de cada ficha (Parte II, seção 8).`);
  L.push('');

  L.push('## 3. Responsável pela pesquisa (art. 3º, II)');
  L.push('');
  L.push('- Nome: ______________________________________');
  L.push('- Cargo/matrícula: ____________________________');
  L.push('- Assinatura: _________________________________');
  L.push('');
}

function montarMarkdown(estados, s) {
  const L = [];
  const p = s.processo || {};
  L.push('# Relatório de Pesquisa de Preços');
  L.push('');
  L.push(`${p.numero ? `**Processo:** ${cel(p.numero)} · ` : ''}**Status:** ${s.status} · **Itens:** ${s.totalItens} · **Valor total global:** ${fmtR$(s.consolidacao.valorTotalGlobal)} · **Gerado em:** ${s.dataHoraPesquisa}`);
  L.push('');
  parteI(L, s);
  L.push('# Parte II — Fichas dos itens');
  L.push('');
  L.push('Metodologia e critérios: ver Parte I, seções 3 e 4. Cada ficha registra os dados, os resultados e as exceções do item.');
  L.push('');
  estados.forEach((e, k) => fichaItem(L, e, s.itens[k], s));
  parteIII(L, s);
  return L.join('\n');
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { montarSaida, montarMarkdown, saidaItem, consolidar, statusGeral, situacaoItem, fmtNum, fonte, ALERTAS_GERAIS_FIXOS }; // @exports
} // @exports
