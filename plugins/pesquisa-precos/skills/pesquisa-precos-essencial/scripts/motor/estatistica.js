// ============================================================================
// estatistica.js — funções puras de estatística para a pesquisa de preços
// (IN SEGES/ME nº 65/2021, arts. 3º, V e VII; 6º, §§ 3º a 5º).
//
// Este arquivo é a fonte única da lógica estatística: o script
// scripts/build-workflow.js copia o conteúdo (sem o bloco de exportação) para
// os nós Code "Aplicar IQR" e "Calcular estimativa" do n8n.
// Sem dependências externas.
// ============================================================================

/** Arredonda para 2 casas (meio para cima). Usar SOMENTE no resultado final. */
function arred2(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  return Math.round((x + Math.sign(x) * Number.EPSILON) * 100) / 100;
}

/** Cópia ordenada (crescente) de uma lista de números. */
function ordenar(valores) {
  return valores.slice().sort((a, b) => a - b);
}

/**
 * Quartil por interpolação linear — equivalente ao QUARTIL.INC do Excel,
 * PERCENTIL.INC e ao tipo 7 do R.
 * posição h = (n − 1) × p (base 0); Q = x[⌊h⌋] + (h − ⌊h⌋) × (x[⌊h⌋+1] − x[⌊h⌋])
 */
function quantilInc(valores, p) {
  const x = ordenar(valores);
  const n = x.length;
  if (n === 0) return null;
  if (n === 1) return x[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return x[lo] + (h - lo) * (x[hi] - x[lo]);
}

function media(valores) {
  if (!valores.length) return null;
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

function mediana(valores) {
  return quantilInc(valores, 0.5);
}

/** Desvio padrão AMOSTRAL (divisor n − 1), equivalente ao DESVPAD.A do Excel. */
function desvioPadraoAmostral(valores) {
  const n = valores.length;
  if (n < 2) return null;
  const m = media(valores);
  const soma = valores.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(soma / (n - 1));
}

/** Estatísticas descritivas com precisão total (sem arredondamento). */
function estatisticasDescritivas(valores) {
  const n = valores.length;
  const m = media(valores);
  const dp = desvioPadraoAmostral(valores);
  return {
    n,
    media: m,
    mediana: mediana(valores),
    menor: n ? Math.min(...valores) : null,
    maior: n ? Math.max(...valores) : null,
    desvioPadrao: dp,
    cv: dp !== null && m ? dp / m : null
  };
}

/**
 * Aplica o método IQR UMA única vez (sem iterações) sobre a lista de registros.
 * - abaixo de Q1 − fator×IQR  → "IQR_inferior" (inexequível)
 * - acima  de Q3 + fator×IQR  → "IQR_superior" (excessivamente elevado)
 * Casos-limite:
 * - menos de 4 preços: não aplica e justifica;
 * - IQR = 0: mantém apenas os valores iguais à mediana.
 *
 * @param {Array<object>} registros
 * @param {number} fator  fator multiplicador (padrão 1,5)
 * @param {(r: object) => number} obterPreco
 * @returns {{ mantidos, descartados: Array<{registro, etapa, motivo}>, quartis, aplicado, justificativa }}
 */
function aplicarIQR(registros, fator, obterPreco) {
  const precos = registros.map(obterPreco);
  const n = precos.length;
  const quartis = {
    metodo: 'interpolação linear (QUARTIL.INC do Excel / tipo 7 do R)',
    Q1: null, Q3: null, IQR: null, fator,
    limiteInferior: null, limiteSuperior: null, mediana: null
  };

  if (n < 4) {
    return {
      mantidos: registros.slice(), descartados: [], quartis, aplicado: false,
      justificativa: `O método IQR não foi aplicado porque a série possui apenas ${n} preço(s) ` +
        '(mínimo de 4 para que os quartis sejam representativos). Nenhum valor foi excluído nesta etapa.'
    };
  }

  const Q1 = quantilInc(precos, 0.25);
  const Q3 = quantilInc(precos, 0.75);
  const IQR = Q3 - Q1;
  const med = mediana(precos);
  Object.assign(quartis, {
    Q1, Q3, IQR, mediana: med,
    limiteInferior: Q1 - fator * IQR,
    limiteSuperior: Q3 + fator * IQR
  });

  const mantidos = [];
  const descartados = [];

  if (IQR === 0) {
    // Série sem dispersão interquartil: qualquer valor ≠ mediana é atípico.
    registros.forEach((r, i) => {
      const p = precos[i];
      if (p === med) mantidos.push(r);
      else if (p < med) descartados.push({ registro: r, etapa: 'IQR_inferior', motivo: `IQR = 0: preço ${p} diferente (abaixo) da mediana ${med}` });
      else descartados.push({ registro: r, etapa: 'IQR_superior', motivo: `IQR = 0: preço ${p} diferente (acima) da mediana ${med}` });
    });
    return {
      mantidos, descartados, quartis, aplicado: true,
      justificativa: 'O intervalo interquartil resultou igual a zero (Q1 = Q3); por isso foram mantidos apenas ' +
        'os preços iguais à mediana e os demais foram tratados como atípicos.'
    };
  }

  registros.forEach((r, i) => {
    const p = precos[i];
    if (p < quartis.limiteInferior) {
      descartados.push({ registro: r, etapa: 'IQR_inferior', motivo: `Preço ${p} abaixo do limite inferior ${quartis.limiteInferior} (inexequível)` });
    } else if (p > quartis.limiteSuperior) {
      descartados.push({ registro: r, etapa: 'IQR_superior', motivo: `Preço ${p} acima do limite superior ${quartis.limiteSuperior} (excessivamente elevado)` });
    } else {
      mantidos.push(r);
    }
  });

  return {
    mantidos, descartados, quartis, aplicado: true,
    justificativa: `Aplicado o método IQR uma única vez, com fator ${String(fator).replace('.', ',')}: foram excluídos os preços fora do ` +
      'intervalo [Q1 − fator × IQR; Q3 + fator × IQR].'
  };
}

/**
 * Define o preço estimado sobre a série saneada.
 * - n < 3            → status AMOSTRA_INSUFICIENTE, sem valor automático (art. 6º, § 5º)
 * - CV ≤ limiarCV    → média   (série homogênea)
 * - CV > limiarCV    → mediana (série heterogênea)
 * O arredondamento (2 casas) é feito apenas no valor final.
 */
function calcularEstimativa(precos, limiarCV) {
  const est = estatisticasDescritivas(precos);
  const regraDecisao = { limiarCV, resultado: null };

  if (est.n < 3) {
    return {
      status: 'AMOSTRA_INSUFICIENTE', estatisticas: est, regraDecisao,
      metodoAplicado: null, valorEstimadoBruto: null, valorEstimado: null
    };
  }

  // cv nulo só ocorre com média zero, impossível após o saneamento (preços > 0);
  // por segurança, trata como heterogênea.
  const homogenea = est.cv !== null && est.cv <= limiarCV;
  regraDecisao.resultado = homogenea ? 'media' : 'mediana';
  const bruto = homogenea ? est.media : est.mediana;

  return {
    status: 'OK', estatisticas: est, regraDecisao,
    metodoAplicado: homogenea ? 'Média' : 'Mediana',
    valorEstimadoBruto: bruto,
    valorEstimado: arred2(bruto)
  };
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { arred2, ordenar, quantilInc, media, mediana, desvioPadraoAmostral, estatisticasDescritivas, aplicarIQR, calcularEstimativa }; // @exports
} // @exports
