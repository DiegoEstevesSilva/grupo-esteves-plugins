// ============================================================================
// validacao.js — normalização e validação das entradas do fluxo (seção 2).
// Uma pesquisa cobre um edital/processo com um ou mais itens: parâmetros
// comuns (período, UFs, esferas, critérios estatísticos) e, por item, código,
// quantidade, unidade, lote e eventuais desvios (período/UFs/esferas próprios).
// Copiado para o nó Code "Validar entradas" pelo scripts/build-workflow.js.
// ============================================================================

const UFS_VALIDAS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
// Enum confirmado por chamadas reais à API (docs/api-contract.md)
const ESFERAS_VALIDAS = { F: 'Federal', E: 'Estadual', M: 'Municipal' };
const MAX_ITENS = 100;
// Colunas do campo "Itens" do formulário (uma linha por item, separadas por ";" ou tabulação)
const COLUNAS_ITENS_TEXTO = ['numeroItem', 'codigo', 'quantidade', 'unidadeFornecimento', 'lote', 'tipoItem'];

function semAcento(s) {
  return String(s).normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** Aceita array, string separada por vírgula/ponto e vírgula, ou vazio. */
function paraLista(v) {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,;]/);
  return arr.map((x) => String(x).trim()).filter((x) => x !== '');
}

/** Data YYYY-MM-DD válida no calendário. */
function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Subtrai anos de uma data ISO (29/02 → 28/02 quando necessário). */
function menosAnos(iso, anos) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a - anos, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

function mapearEsfera(v) {
  const s = semAcento(v).toUpperCase().trim();
  if (ESFERAS_VALIDAS[s]) return s;
  if (s.startsWith('FED')) return 'F';
  if (s.startsWith('EST')) return 'E';
  if (s.startsWith('MUN')) return 'M';
  return null;
}

function mapearTipo(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = semAcento(v).toLowerCase().trim();
  if (s === 'auto' || s.startsWith('detectar')) return null; // opção do formulário
  if (s === 'material' || s === 'catmat') return 'material';
  if (s === 'servico' || s === 'catser') return 'servico';
  return 'INVALIDO';
}

/** Lê número opcional; aceita vírgula decimal. */
function numeroOpcional(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Quantidade no padrão brasileiro ("1.000", "2,5", "1.234,50") ou número. */
function quantidadeOpcional(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v).trim().replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function textoOpcional(v) {
  if (v === undefined || v === null) return null;
  return String(v).trim() || null;
}

/**
 * Busca o valor do campo pelo nome técnico ou por rótulos do formulário.
 * O Form Trigger devolve os campos pelo rótulo; o webhook, pelo nome técnico.
 */
function campo(bruto, nomes) {
  for (const n of nomes) {
    if (bruto[n] !== undefined && bruto[n] !== null && bruto[n] !== '') return bruto[n];
  }
  return undefined;
}

/**
 * Converte o texto do formulário em itens. Cada linha:
 *   nº do item; código; quantidade; unidade; lote; tipo   (só o código é obrigatório)
 * Uma linha com um único valor é o código. Aceita colunas coladas de planilha
 * (tabulação) e ignora uma linha de cabeçalho no início.
 */
function itensDeTexto(txt) {
  const itens = [];
  let primeira = true;
  for (const linha of String(txt).split(/\r?\n/)) {
    if (!linha.trim()) continue;
    const c = linha.split(/\t|;/).map((x) => x.trim());
    const codigo = c.length === 1 ? c[0] : c[1];
    const cabecalho = primeira && !/^\d+$/.test(codigo || '');
    primeira = false;
    if (cabecalho) continue;
    if (c.length === 1) { itens.push({ codigo: c[0] }); continue; }
    const it = {};
    COLUNAS_ITENS_TEXTO.forEach((k, j) => { if (c[j] !== undefined && c[j] !== '') it[k] = c[j]; });
    itens.push(it);
  }
  return itens;
}

/** Valida o período; devolve true se as duas datas são válidas e coerentes. */
function validarPeriodo(ini, fim, hoje, erros, rotulo) {
  let ok = true;
  if (ini === undefined || ini === null) { erros.push(`${rotulo}Campo obrigatório ausente: dataInicio (YYYY-MM-DD).`); ok = false; }
  else if (!dataValida(ini)) { erros.push(`${rotulo}dataInicio inválida: "${ini}". Use o formato YYYY-MM-DD.`); ok = false; }
  if (fim === undefined || fim === null) { erros.push(`${rotulo}Campo obrigatório ausente: dataFim (YYYY-MM-DD).`); ok = false; }
  else if (!dataValida(fim)) { erros.push(`${rotulo}dataFim inválida: "${fim}". Use o formato YYYY-MM-DD.`); ok = false; }
  if (ok) {
    if (fim < ini) { erros.push(`${rotulo}dataFim (${fim}) é anterior a dataInicio (${ini}).`); ok = false; }
    if (fim > hoje) { erros.push(`${rotulo}dataFim (${fim}) não pode ser futura (data da pesquisa: ${hoje}).`); ok = false; }
  }
  return ok;
}

function validarEsferas(v, erros, rotulo) {
  const esferas = [];
  for (const e of paraLista(v)) {
    const m = mapearEsfera(e);
    if (!m) erros.push(`${rotulo}Esfera inválida: "${e}". Valores aceitos: F (Federal), E (Estadual), M (Municipal).`);
    else if (!esferas.includes(m)) esferas.push(m);
  }
  return esferas;
}

function validarUfs(v, erros, rotulo) {
  const ufs = [];
  for (const u of paraLista(v)) {
    const s = u.toUpperCase();
    if (!UFS_VALIDAS.includes(s)) erros.push(`${rotulo}UF inválida: "${u}".`);
    else if (!ufs.includes(s)) ufs.push(s);
  }
  return ufs;
}

/** Alerta normativo (não bloqueante) para período iniciado há mais de 1 ano. */
function alertaPeriodo(dataInicio, hoje) {
  const limite = menosAnos(hoje, 1);
  if (!(dataInicio < limite)) return null;
  return `O período pesquisado inicia em ${dataInicio}, antes de ${limite} (1 ano antes da data da pesquisa). ` +
    'O art. 5º, II, da IN SEGES/ME nº 65/2021 considera contratações "em execução ou concluídas no período de 1 (um) ano ' +
    'anterior à data da pesquisa de preços"; o uso de período maior exige justificativa e aplicação de índice de ' +
    'atualização de preços (art. 5º, § 3º).';
}

const mesmoConjunto = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const listaOuTodas = (l) => (l.length ? l.join(', ') : 'todas');

/**
 * @param {object} bruto  corpo da requisição (webhook) ou campos do formulário
 * @param {string} hoje   data da pesquisa, YYYY-MM-DD (fuso America/Sao_Paulo)
 * @returns {{ valido: boolean, erros: string[], alertas: string[], params: { processo, comum, itens } }}
 *   `alertas` são gerais (valem para todo o edital). Cada item traz os próprios
 *   `alertas`, `desvios` e `params` (formato consumido pela coleta e pelo tratamento).
 */
function validarEntradas(bruto, hoje) {
  const erros = [];
  const alertas = [];
  bruto = bruto && typeof bruto === 'object' ? bruto : {};

  const processo = {
    numero: textoOpcional(campo(bruto, ['processo', 'numeroProcesso', 'Nº do processo'])),
    orgao: textoOpcional(campo(bruto, ['orgao', 'Órgão'])),
    objeto: textoOpcional(campo(bruto, ['objeto', 'Objeto']))
  };

  // --- parâmetros comuns (Parte I) ---
  const iniBruto = campo(bruto, ['dataInicio', 'Data inicial', 'Data de início']);
  const fimBruto = campo(bruto, ['dataFim', 'Data final', 'Data de fim']);
  const dataInicio = iniBruto === undefined ? null : String(iniBruto);
  const dataFim = fimBruto === undefined ? null : String(fimBruto);
  const periodoOk = validarPeriodo(dataInicio, dataFim, hoje, erros, '');
  const esferas = validarEsferas(campo(bruto, ['esferas', 'Esferas']), erros, '');
  const ufs = validarUfs(campo(bruto, ['ufs', 'UFs']), erros, '');

  const tipoBruto = campo(bruto, ['tipoItem', 'Tipo do item']);
  let tipoComum = mapearTipo(tipoBruto);
  if (tipoComum === 'INVALIDO') { erros.push(`tipoItem inválido: "${tipoBruto}". Valores aceitos: "material" ou "servico".`); tipoComum = null; }

  const limiarBruto = campo(bruto, ['limiarCV', 'Limiar do CV']);
  const fatorBruto = campo(bruto, ['fatorIQR', 'Fator IQR']);
  let limiarCV = numeroOpcional(limiarBruto);
  if (limiarCV === undefined) limiarCV = 0.25;
  else if (!(limiarCV > 0 && limiarCV <= 1)) erros.push(`limiarCV inválido: "${limiarBruto}". Informe uma fração entre 0 e 1 (ex.: 0.25 = 25%).`);
  let fatorIQR = numeroOpcional(fatorBruto);
  if (fatorIQR === undefined) fatorIQR = 1.5;
  else if (!(fatorIQR > 0)) erros.push(`fatorIQR inválido: "${fatorBruto}". Informe um número maior que zero (padrão 1.5).`);

  if (periodoOk) { const a = alertaPeriodo(dataInicio, hoje); if (a) alertas.push(a); }

  const comum = { dataInicio, dataFim, esferas, ufs, tipoItem: tipoComum, limiarCV, fatorIQR, dataPesquisa: hoje };

  // --- itens: lista (webhook), texto (formulário) ou item único legado (codigo no corpo) ---
  let brutos = campo(bruto, ['itens', 'Itens']);
  if (typeof brutos === 'string') brutos = itensDeTexto(brutos);
  else if (brutos !== undefined && !Array.isArray(brutos)) {
    erros.push('itens deve ser uma lista de objetos ({ numeroItem, codigo, quantidade, ... }) ou texto com uma linha por item.');
    brutos = [];
  }
  if (brutos === undefined) {
    const codigoLegado = campo(bruto, ['codigo', 'Código CATMAT/CATSER', 'Código']);
    brutos = codigoLegado === undefined ? [] : [{
      codigo: codigoLegado,
      unidadeFornecimento: campo(bruto, ['unidadeFornecimento', 'Unidade de fornecimento']),
      quantidade: campo(bruto, ['quantidade', 'Quantidade'])
    }];
  }
  if (!brutos.length) erros.push('Informe ao menos um item com o código CATMAT/CATSER (campo itens).');
  if (brutos.length > MAX_ITENS) erros.push(`Foram informados ${brutos.length} itens; o limite por pesquisa é ${MAX_ITENS}. Divida a pesquisa em partes.`);

  const itens = [];
  const numeros = {};
  brutos.slice(0, MAX_ITENS).forEach((b, idx) => {
    b = b && typeof b === 'object' ? b : { codigo: b };
    const numeroBruto = campo(b, ['numeroItem', 'item', 'numero']);
    const numeroItem = numeroBruto === undefined ? String(idx + 1) : String(numeroBruto).trim();
    const rot = `Item ${numeroItem}: `;
    if (numeros[numeroItem]) erros.push(`${rot}número de item repetido. Cada item do edital deve ter número próprio (ex.: 1, 2 ou 1-A, 1-B para cotas).`);
    numeros[numeroItem] = true;

    let codigo = null;
    const codigoBruto = campo(b, ['codigo', 'codigoItem']);
    if (codigoBruto === undefined) erros.push(`${rot}código CATMAT/CATSER ausente.`);
    else {
      const s = String(codigoBruto).trim();
      if (!/^\d{1,9}$/.test(s) || Number(s) === 0) erros.push(`${rot}codigo inválido: "${codigoBruto}". Informe apenas dígitos (código CATMAT/CATSER).`);
      else codigo = String(Number(s));
    }

    const tipoItemBruto = campo(b, ['tipoItem', 'tipo']);
    let tipoItem = mapearTipo(tipoItemBruto);
    if (tipoItem === 'INVALIDO') { erros.push(`${rot}tipoItem inválido: "${tipoItemBruto}". Valores aceitos: "material" ou "servico".`); tipoItem = null; }
    if (tipoItem === null) tipoItem = tipoComum;

    const qtdBruto = campo(b, ['quantidade', 'qtd']);
    let quantidade = quantidadeOpcional(qtdBruto);
    if (quantidade === undefined) quantidade = null;
    else if (!(quantidade > 0)) { erros.push(`${rot}quantidade inválida: "${qtdBruto}". Informe um número maior que zero.`); quantidade = null; }

    // Parâmetros específicos do item (desvios em relação à Parte I)
    const iniItemBruto = campo(b, ['dataInicio']);
    const fimItemBruto = campo(b, ['dataFim']);
    const temPeriodo = iniItemBruto !== undefined || fimItemBruto !== undefined;
    const iniItem = iniItemBruto === undefined ? dataInicio : String(iniItemBruto);
    const fimItem = fimItemBruto === undefined ? dataFim : String(fimItemBruto);
    const periodoItemOk = temPeriodo ? validarPeriodo(iniItem, fimItem, hoje, erros, rot) : periodoOk;
    const ufsItem = campo(b, ['ufs']) === undefined ? ufs : validarUfs(campo(b, ['ufs']), erros, rot);
    const esferasItem = campo(b, ['esferas']) === undefined ? esferas : validarEsferas(campo(b, ['esferas']), erros, rot);

    const desvios = [];
    if (iniItem !== dataInicio || fimItem !== dataFim) {
      desvios.push({ campo: 'período', comum: `${dataInicio} a ${dataFim}`, item: `${iniItem} a ${fimItem}` });
    }
    if (!mesmoConjunto(ufsItem, ufs)) desvios.push({ campo: 'UFs', comum: listaOuTodas(ufs), item: listaOuTodas(ufsItem) });
    if (!mesmoConjunto(esferasItem, esferas)) desvios.push({ campo: 'esferas', comum: listaOuTodas(esferas), item: listaOuTodas(esferasItem) });
    const justificativaDesvio = textoOpcional(campo(b, ['justificativa', 'justificativaDesvio']));

    const alertasItem = [];
    if (temPeriodo && periodoItemOk && iniItem !== dataInicio) { const a = alertaPeriodo(iniItem, hoje); if (a) alertasItem.push(a); }
    if (desvios.length && !justificativaDesvio) {
      alertasItem.push(`Parâmetros diferentes dos comuns (${desvios.map((d) => d.campo).join(', ')}) sem justificativa registrada. ` +
        'Registre o motivo do desvio (art. 3º, III), por exemplo a ampliação por falta de amostra.');
    }
    if (quantidade === null) alertasItem.push('Quantidade a contratar não informada: o valor total do item não foi calculado.');

    itens.push({
      indice: idx,
      numeroItem,
      quantidade,
      lote: textoOpcional(campo(b, ['lote', 'grupo'])),
      descricaoInformada: textoOpcional(campo(b, ['descricao'])),
      desvios, justificativaDesvio, alertas: alertasItem,
      params: {
        dataInicio: iniItem, dataFim: fimItem, codigo, tipoItem,
        tipoInformado: tipoItem !== null,
        esferas: esferasItem, ufs: ufsItem,
        unidadeFornecimento: textoOpcional(campo(b, ['unidadeFornecimento', 'unidade'])),
        limiarCV, fatorIQR, dataPesquisa: hoje
      }
    });
  });

  return { valido: erros.length === 0, erros, alertas, params: { processo, comum, itens } };
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { validarEntradas, itensDeTexto, quantidadeOpcional, dataValida, menosAnos, paraLista, UFS_VALIDAS, ESFERAS_VALIDAS }; // @exports
} // @exports
