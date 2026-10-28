// ============================================================================
// planilha-xlsx.js — a planilha do Google Sheets (montarPlanilha, planilha.js)
// adaptada para arquivo .xlsx. Fonte única da adaptação, usada pela app
// (webapp/src/planilha-xlsx.js, que escreve com SheetJS) e pela Skill (que
// escreve com xlsx.js).
//
// Memória de cálculo: no Sheets, cada medida filtra a série inteira com
// FILTER(), que só existe no Excel 2021/365. No .xlsx, a série de cada item
// ocupa linhas contíguas da aba "Série coletada" (montarPlanilha a grava item
// a item), então cada FILTER vira um IF sobre o intervalo fixo do item, numa
// fórmula matricial, que funciona em qualquer versão do Excel e no
// LibreOffice. O auditor vê o intervalo exato de linhas usado.
// ============================================================================
const { montarPlanilha, coluna, COL } = require('./planilha.js'); // @exports

const S = "'Série coletada'!";
const literal = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** Os dois FILTER() que blocoMemoria (planilha.js) monta para um item. */
function filtrosSheets(numeroItem) {
  const doItem = `${S}$${COL.item}$2:$${COL.item}=${literal(numeroItem)}`;
  const precos = `${S}$${COL.preco}$2:$${COL.preco}`;
  const etapa = `${S}$${COL.etapa}$2:$${COL.etapa}`;
  return {
    entrada: `FILTER(${precos},${doItem},(${etapa}="")+(LEFT(${etapa},3)="IQR"))`,
    saneada: `FILTER(${precos},${doItem},${S}$${COL.situacao}$2:$${COL.situacao}="aproveitado")`
  };
}

/** Os mesmos filtros sobre as linhas [ini, fim] do item, como IF matricial. */
function filtrosXlsx(ini, fim) {
  const faixa = (c) => `${S}$${c}$${ini}:$${c}$${fim}`;
  const etapa = faixa(COL.etapa);
  return {
    entrada: `IF((${etapa}="")+(LEFT(${etapa},3)="IQR"),${faixa(COL.preco)})`,
    saneada: `IF(${faixa(COL.situacao)}="aproveitado",${faixa(COL.preco)})`
  };
}

/** Linhas (1-based) da série de cada item na aba "Série coletada" (linha 1 = cabeçalho). */
function faixasDosItens(s) {
  const faixas = {};
  let linha = 2;
  for (const it of s.itens) {
    const n = it.serieColetada.length;
    faixas[it.numeroItem] = n ? { ini: linha, fim: linha + n - 1 } : null;
    linha += n;
  }
  return faixas;
}

/**
 * Troca os FILTER() da memória de cálculo pelos intervalos fixos. Devolve as
 * linhas novas e o conjunto de células (ex.: "B5") que viram fórmula matricial.
 * @param {string} valorDe com que valor a coluna "Confere?" compara ("fluxo" na app, "relatório" na Skill)
 */
function adaptarMemoria(s, valores, valorDe = 'fluxo') {
  const faixas = faixasDosItens(s);
  const matriciais = new Set();
  let item = null;
  const saida = valores.map((linha, i) => {
    if (i === 0) {
      return ['Memória de cálculo por item. Cada fórmula usa as linhas do item na aba "Série coletada" (intervalo fixo, fórmula matricial); ' +
        `a coluna "Confere?" compara com o valor do ${valorDe} (tolerância 1e-9).`, ...linha.slice(1)];
    }
    // Cabeçalho do bloco: "Item <n> — ..." (celula() pode ter posto apóstrofo)
    const titulo = String(linha[0] || '').replace(/^'/, '');
    const it = s.itens.find((x) => titulo.startsWith(`Item ${x.numeroItem} — `));
    if (it) item = it;
    const f = linha[1];
    if (!item || typeof f !== 'string' || !f.includes('FILTER(')) return linha;
    const faixa = faixas[item.numeroItem];
    if (!faixa) return linha.map((v, k) => (k === 1 ? '' : v)); // sem série não há o que calcular
    const de = filtrosSheets(item.numeroItem);
    const para = filtrosXlsx(faixa.ini, faixa.fim);
    const nova = f.split(de.entrada).join(para.entrada).split(de.saneada).join(para.saneada);
    if (nova.includes('FILTER(')) throw new Error(`Memória de cálculo do item ${item.numeroItem}: fórmula com FILTER() não reconhecida (${f.slice(0, 80)}…)`);
    matriciais.add(`${coluna(2)}${i + 1}`);
    return linha.map((v, k) => (k === 1 ? nova : v));
  });
  return { valores: saida, matriciais };
}

/**
 * Abas do .xlsx a partir da saída do relatório: os mesmos valores do Sheets
 * (formato USER_ENTERED), com a memória de cálculo adaptada.
 * @param {object} s saída de montarSaida (relatorio.js)
 * @param {{ valorDe?: string }} opcoes valorDe: ver adaptarMemoria; fora de "fluxo", os rótulos "(fluxo)" mudam junto
 * @returns {{ titulo: string, abas: Array<{ nome: string, linhas: any[][], matriciais: Set<string> }> }}
 */
function abasXlsx(s, opcoes) {
  const valorDe = (opcoes && opcoes.valorDe) || 'fluxo';
  const trocas = { 'Fórmula (calculada pelo Sheets)': 'Fórmula (calculada pela planilha)' };
  if (valorDe !== 'fluxo') Object.assign(trocas, { 'Valor do fluxo': `Valor do ${valorDe}`, 'Total global (fluxo)': `Total global (${valorDe})` });
  const p = montarPlanilha(s);
  const abas = p.dados.map((bloco) => {
    const nome = /^'(.*)'!/.exec(bloco.range)[1].replace(/''/g, "'");
    const linhas = bloco.values.map((l) => l.map((v) => (typeof v === 'string' && trocas[v] !== undefined ? trocas[v] : v)));
    if (nome !== 'Memória de cálculo') return { nome, linhas, matriciais: new Set() };
    const m = adaptarMemoria(s, linhas, valorDe);
    return { nome, linhas: m.valores, matriciais: m.matriciais };
  });
  return { titulo: p.titulo, abas };
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { abasXlsx, adaptarMemoria, faixasDosItens, filtrosSheets, filtrosXlsx }; // @exports
} // @exports
