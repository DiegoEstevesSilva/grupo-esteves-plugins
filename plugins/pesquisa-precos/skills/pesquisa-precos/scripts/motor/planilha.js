// ============================================================================
// planilha.js — monta a planilha única do edital no Google Sheets (abas
// Resumo, Série coletada, Descartados, Memória de cálculo e Requisições) e
// anexa o link ao resultado. A série fica em formato longo, com a coluna
// "Item do edital"; a memória de cálculo tem um bloco por item, com fórmulas
// que filtram a série coletada pelo item. Copiado para os nós "Preparar dados
// da planilha" e "Anexar link da planilha" pelo build.
//
// Os valores são gravados com valueInputOption=USER_ENTERED para que as
// fórmulas sejam calculadas pelo próprio Sheets. A planilha é criada com
// locale en_US: fórmulas com nomes em inglês e vírgula como separador.
// ============================================================================

const ABAS_PLANILHA = ['Resumo', 'Série coletada', 'Descartados', 'Memória de cálculo', 'Requisições'];

/**
 * Valor de célula seguro para USER_ENTERED: números seguem como número; textos
 * que o Sheets interpretaria (fórmula, número, data, código com zero à
 * esquerda, CNPJ) recebem apóstrofo para ficarem como texto literal.
 */
function celula(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  const s = String(v);
  if (/^[=+\-@']/.test(s) || /^[\d\s.,/:()-]+$/.test(s)) return `'${s}`;
  return s;
}

const intervalo = (aba, celulaInicial) => `'${aba.replace(/'/g, "''")}'!${celulaInicial}`;

/** Letra da coluna (1 → A, 27 → AA). */
function coluna(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Texto como literal de fórmula ("a""b"). */
const literal = (s) => `"${String(s).replace(/"/g, '""')}"`;

const CAB_REGISTRO = ['Item do edital', 'Código', 'seq', 'Situação', 'Etapa do descarte', 'Motivo do descarte', 'idCompra', 'idItemCompra', 'Item na compra',
  'Nº compra/ano', 'Modalidade', 'Forma', 'Critério julgamento', 'Código UASG', 'UASG', 'Órgão', 'Município', 'UF',
  'Esfera', 'Poder', 'Fornecedor (CNPJ/CPF)', 'Fornecedor', 'Marca', 'Data da compra', 'Quantidade',
  'Unidade de fornecimento', 'Preço unitário', 'Link do edital (PNCP)', 'Nº de controle PNCP', 'Link do registro (API)', 'Requisição (API)'];
// Colunas usadas pelas fórmulas da memória de cálculo
const COL = {
  item: coluna(CAB_REGISTRO.indexOf('Item do edital') + 1),
  situacao: coluna(CAB_REGISTRO.indexOf('Situação') + 1),
  etapa: coluna(CAB_REGISTRO.indexOf('Etapa do descarte') + 1),
  preco: coluna(CAB_REGISTRO.indexOf('Preço unitário') + 1)
};

function linhaRegistro(it, r, desc) {
  return [it.numeroItem, it.item.codigo, r.seq, desc ? 'descartado' : 'aproveitado', desc ? desc.etapa : '', desc ? desc.motivo : '',
    r.idCompra, r.idItemCompra, r.numeroItemCompra, r.numeroCompra, r.modalidade, r.forma, r.criterioJulgamento,
    r.codigoUasg, r.nomeUasg, r.nomeOrgao, r.municipio, r.uf, r.esfera, r.poder, r.niFornecedor, r.nomeFornecedor,
    r.marca, r.dataCompra, r.quantidade, r.unidadeFornecimento, r.preco, r.urlPncp, r.numeroControlePNCP, r.urlRegistro, r.urlRequisicao].map(celula);
}

/**
 * Bloco da memória de cálculo de um item, a partir da linha `ini` (1-based).
 * Colunas: A medida, B fórmula (Sheets), C valor do fluxo, D confere?
 */
function blocoMemoria(it, ini) {
  const mc = it.memoriaCalculo;
  const est = mc.estatisticas || {};
  const q = mc.quartis || {};
  const S = "'Série coletada'!";
  const doItem = `${S}$${COL.item}$2:$${COL.item}=${literal(it.numeroItem)}`;
  const precos = `${S}$${COL.preco}$2:$${COL.preco}`;
  const etapa = `${S}$${COL.etapa}$2:$${COL.etapa}`;
  // Entrada do IQR: registros não descartados ou descartados pelo próprio IQR
  const ENTRADA = `FILTER(${precos},${doItem},(${etapa}="")+(LEFT(${etapa},3)="IQR"))`;
  const SANEADA = `FILTER(${precos},${doItem},${S}$${COL.situacao}$2:$${COL.situacao}="aproveitado")`;
  const nEntrada = it.serieColetada.length - it.descartados.filter((d) => d.etapa === 'inconsistente' || d.etapa === 'unidade').length;
  const nSaneada = it.serieSaneada.length;
  const r = (k) => ini + 2 + k; // linha da medida k (0 = Q1)
  const B = (k) => `B${r(k)}`;

  const med = [
    ['Q1 — QUARTIL.INC', `=QUARTILE.INC(${ENTRADA},1)`, q.Q1],
    ['Q3 — QUARTIL.INC', `=QUARTILE.INC(${ENTRADA},3)`, q.Q3],
    ['IQR = Q3 − Q1', `=${B(1)}-${B(0)}`, q.IQR],
    ['Fator IQR', q.fator === undefined || q.fator === null ? '' : q.fator, q.fator],
    ['Limite inferior = Q1 − fator × IQR', `=${B(0)}-${B(3)}*${B(2)}`, q.limiteInferior],
    ['Limite superior = Q3 + fator × IQR', `=${B(1)}+${B(3)}*${B(2)}`, q.limiteSuperior],
    ['n (série saneada)', `=COUNT(${SANEADA})`, est.n],
    ['Média — MÉDIA', `=AVERAGE(${SANEADA})`, est.media],
    ['Mediana — MED', `=MEDIAN(${SANEADA})`, est.mediana],
    ['Desvio padrão amostral — DESVPAD.A', `=STDEV.S(${SANEADA})`, est.desvioPadrao],
    ['CV = desvio padrão / média', `=${B(9)}/${B(7)}`, est.cv],
    ['Limiar do CV', mc.regraDecisao.limiarCV, mc.regraDecisao.limiarCV],
    ['Método', `=IF(${B(10)}<=${B(11)},"Média","Mediana")`, it.metodoAplicado],
    ['Valor unitário estimado', `=ROUND(IF(${B(10)}<=${B(11)},${B(7)},${B(8)}),2)`, it.valorEstimado],
    ['Quantidade a contratar', it.quantidade === null ? '' : it.quantidade, it.quantidade],
    ['Valor total = unitário × quantidade', `=ROUND(${B(13)}*${B(14)},2)`, it.valorTotal]
  ];
  // Sem dados suficientes, a fórmula daria erro: deixa em branco
  if (!(nEntrada >= 4) || !q.aplicado) for (let k = 0; k <= 5; k++) med[k][1] = '';
  if (!nSaneada) for (const k of [6, 7, 8]) med[k][1] = '';
  if (!(nSaneada >= 2)) for (const k of [9, 10]) med[k][1] = '';
  if (!(nSaneada >= 3)) for (const k of [12, 13]) med[k][1] = '';
  if (!(nSaneada >= 3) || it.quantidade === null) med[15][1] = '';

  const linhas = [
    [celula(`Item ${it.numeroItem} — ${it.item.sistema} ${it.item.codigo} — ${it.item.descricao || ''}`.trim()), '', '', ''],
    ['Medida', 'Fórmula (calculada pelo Sheets)', 'Valor do fluxo', 'Confere?']
  ];
  med.forEach((m, k) => {
    const l = r(k);
    const confere = k === 12
      ? `=IF(C${l}="","",IF(B${l}=C${l},"sim","NÃO"))`
      : `=IF(OR(B${l}="",C${l}=""),"",IF(ABS(B${l}-C${l})<=1E-9*MAX(1,ABS(C${l})),"sim","NÃO"))`;
    linhas.push([celula(m[0]), m[1] === '' ? '' : m[1], celula(m[2]), confere]);
  });
  return linhas;
}

/**
 * @param {object} s saída final do fluxo (nó "Montar relatório")
 * @returns {{ titulo: string, abas: string[], dados: Array<{range: string, values: any[][]}> }}
 */
function montarPlanilha(s) {
  const pc = s.parametrosComuns;
  const p = s.processo || {};
  const dados = [];
  const lista = (l) => (l && l.length ? l.join(', ') : 'todas');

  // --- Resumo: processo, parâmetros comuns, quadro-resumo e consolidação ---
  const resumo = [
    ['Relatório de Pesquisa de Preços — IN SEGES/ME nº 65/2021, art. 5º, II'],
    ['Nº do processo', p.numero || 'não informado'],
    ['Órgão', p.orgao || 'não informado'],
    ['Objeto', p.objeto || 'não informado'],
    ['Status', s.status],
    ['Data/hora da pesquisa', s.dataHoraPesquisa],
    ['Período padrão (data da compra)', `${pc.dataInicio} a ${pc.dataFim}`],
    ['UFs', lista(pc.ufs)],
    ['Esferas', lista(pc.esferas)],
    ['Fator IQR / limiar do CV', `${pc.fatorIQR} / ${pc.limiarCV}`],
    ['Fonte', `${pc.fonte} — ${pc.endpoints.join(', ')}`],
    [''],
    ['Quadro-resumo dos itens']
  ].map((l) => l.map(celula));
  const cabQuadro = ['Item do edital', 'Lote', 'Código', 'Descrição', 'Unidade', 'Quantidade', 'Preços válidos', 'Método', 'CV', 'Valor unitário', 'Valor total', 'Status'];
  resumo.push(cabQuadro);
  const iniQuadro = resumo.length + 1;
  for (const r of s.quadroResumo) {
    resumo.push([r.numeroItem, r.lote, `${r.sistema} ${r.codigo}`, r.descricao, r.unidade, r.quantidade, r.precosValidos, r.metodo, r.cv, r.valorUnitario, r.valorTotal, r.situacao].map(celula));
  }
  const fimQuadro = resumo.length;
  const colTotal = coluna(cabQuadro.indexOf('Valor total') + 1);
  resumo.push(['Total global (fórmula)', '', '', '', '', '', '', '', '', '', `=SUM(${colTotal}${iniQuadro}:${colTotal}${Math.max(fimQuadro, iniQuadro)})`, '']);
  const linhaTotal = resumo.length;
  resumo.push(['Total global (fluxo)', '', '', '', '', '', '', '', '', '', celula(s.consolidacao.valorTotalGlobal), '']);
  resumo.push(['Confere?', '', '', '', '', '', '', '', '', '', `=IF(${colTotal}${linhaTotal + 1}="","",IF(ROUND(${colTotal}${linhaTotal}-${colTotal}${linhaTotal + 1},2)=0,"sim","NÃO"))`, '']);
  if (s.consolidacao.lotes.length) {
    resumo.push([''], ['Totais por lote/grupo'], ['Lote', 'Itens', 'Valor total', 'Itens sem valor']);
    for (const l of s.consolidacao.lotes) resumo.push([l.lote, l.itens.join(', '), l.valorTotal, l.itensSemValor.join(', ')].map(celula));
  }
  resumo.push([''], ['Justificativas da metodologia']);
  s.justificativas.forEach((j, i) => resumo.push([`${i + 1}.`, j].map(celula)));
  resumo.push([''], ['Alertas e ressalvas gerais']);
  s.alertas.forEach((a, i) => resumo.push([`${i + 1}.`, a].map(celula)));
  dados.push({ range: intervalo('Resumo', 'A1'), values: resumo });

  // --- Série coletada e Descartados (formato longo, todos os itens) ---
  const serie = [CAB_REGISTRO];
  const descartados = [CAB_REGISTRO];
  for (const it of s.itens) {
    const desc = {};
    for (const d of it.descartados) desc[d.seq] = d;
    for (const r of it.serieColetada) serie.push(linhaRegistro(it, r, desc[r.seq]));
    for (const d of it.descartados) descartados.push(linhaRegistro(it, d, d));
  }
  dados.push({ range: intervalo('Série coletada', 'A1'), values: serie });
  dados.push({ range: intervalo('Descartados', 'A1'), values: descartados });

  // --- Memória de cálculo: um bloco por item, com fórmulas filtradas pelo item ---
  const memoria = [
    ['Memória de cálculo por item. As fórmulas filtram a aba "Série coletada" pela coluna "Item do edital"; a coluna "Confere?" compara com o valor do fluxo (tolerância 1e-9).', '', '', ''],
    ['Quartis por interpolação linear (QUARTIL.INC). Cálculos com precisão total; o valor unitário é arredondado a 2 casas antes de multiplicar pela quantidade.', '', '', '']
  ];
  for (const it of s.itens) {
    memoria.push(['', '', '', '']);
    memoria.push(...blocoMemoria(it, memoria.length + 1));
  }
  dados.push({ range: intervalo('Memória de cálculo', 'A1'), values: memoria });

  // --- Requisições à API ---
  const req = [['Item do edital', 'Código', 'Combinação', 'Situação', 'Páginas lidas', 'Total de páginas', 'Registros (API)', 'Registros obtidos', 'Erro', 'URL da 1ª página']];
  for (const it of s.itens) {
    for (const r of it.parametrosPesquisa.requisicoes) {
      req.push([it.numeroItem, it.item.codigo, r.combinacao, r.status, r.paginasLidas, r.totalPaginas, r.totalRegistros, r.registrosObtidos, r.erro || '', r.url].map(celula));
    }
  }
  dados.push({ range: intervalo('Requisições', 'A1'), values: req });

  return { titulo: `Pesquisa de preços – ${identificacaoArquivo(s)}`, abas: ABAS_PLANILHA.slice(), dados, colunasRegistro: coluna(CAB_REGISTRO.length) };
}

/** Trecho do nome dos arquivos: processo (ou nº de itens) e data/hora. */
function identificacaoArquivo(s) {
  const p = s.processo || {};
  const quando = String(s.dataHoraPesquisa || '').replace(/ \(.*\)$/, '');
  const quem = p.numero ? `Processo ${p.numero}`
    : s.itens.length === 1 ? `${s.itens[0].item.sistema} ${s.itens[0].item.codigo}` : `${s.itens.length} itens`;
  return `${quem} – ${quando}`.trim();
}

/**
 * Anexa o resultado da geração da planilha à saída do fluxo.
 * @param {object} saida  saída do "Montar relatório"
 * @param {object} res    { gerada, url?, id?, movida?, erroPasta?, erro?, motivo? }
 */
function anexarPlanilha(saida, res) {
  saida.planilha = res;
  if (res.gerada) {
    saida.relatorioMarkdown += `\n# Anexo — planilha única do edital\n\n` +
      `[Abrir a planilha no Google Drive](${res.url}). Abas: ${ABAS_PLANILHA.join(', ')}. ` +
      'A série de todos os itens está em formato longo, com a coluna "Item do edital". A aba "Memória de cálculo" tem um bloco por item que ' +
      'refaz Q1, Q3, IQR, média, mediana, desvio padrão, CV, valor unitário e valor total com fórmulas da própria planilha.\n';
    if (res.erroPasta) {
      const a = `A planilha foi criada, mas não foi movida para a pasta configurada: ${res.erroPasta}`;
      saida.alertas.push(a);
      saida.relatorioMarkdown += `\n- ${a}\n`;
    }
  } else if (res.erro) {
    const a = `Não foi possível gerar a planilha no Google Drive: ${res.erro}`;
    saida.alertas.push(a);
    saida.relatorioMarkdown += `\n- ${a}\n`;
  }
  return saida;
}

/** Mensagem curta de um item de erro do n8n. */
function mensagemErro(e) {
  const m = e && (e.message || e.description || e);
  return String(m || 'erro não identificado').split('\n')[0].slice(0, 200);
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { montarPlanilha, anexarPlanilha, blocoMemoria, identificacaoArquivo, celula, coluna, mensagemErro, ABAS_PLANILHA, CAB_REGISTRO, COL }; // @exports
} // @exports
