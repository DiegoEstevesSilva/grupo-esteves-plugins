// ============================================================================
// resposta.js — padroniza a resposta dos três caminhos do fluxo (resultado,
// entrada inválida e erro interno) e converte o relatório em HTML para a
// página final do formulário. Copiado para o nó "Preparar resposta".
// ============================================================================

function escaparHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Formatação em linha: `código`, **negrito**, *itálico* e [texto](url). */
function mdInline(s) {
  let h = escaparHtml(s);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return h.replace(/\\\|/g, '|');
}

/** Divide uma linha de tabela Markdown respeitando "\|" escapado. */
function celulas(linha) {
  return linha.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

/** Conversor mínimo de Markdown (títulos, listas, citações, tabelas, parágrafos). */
function markdownParaHtml(md) {
  const linhas = String(md || '').split('\n');
  const out = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^\|/.test(l) && i + 1 < linhas.length && /^\|[-\s|:]+\|?$/.test(linhas[i + 1])) {
      const cab = celulas(l);
      i += 2;
      const corpo = [];
      while (i < linhas.length && /^\|/.test(linhas[i])) { corpo.push(celulas(linhas[i])); i++; }
      out.push('<div class="tabela"><table><thead><tr>' + cab.map((c) => `<th>${mdInline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        corpo.map((r) => '<tr>' + r.map((c) => `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (/^- /.test(l)) {
      const itens = [];
      while (i < linhas.length && /^- /.test(linhas[i])) { itens.push(`<li>${mdInline(linhas[i].slice(2))}</li>`); i++; }
      out.push(`<ul>${itens.join('')}</ul>`);
      continue;
    }
    if (/^> ?/.test(l)) {
      const q = [];
      while (i < linhas.length && /^> ?/.test(linhas[i])) { q.push(mdInline(linhas[i].replace(/^> ?/, ''))); i++; }
      out.push(`<blockquote>${q.join('<br>')}</blockquote>`);
      continue;
    }
    const p = [];
    while (i < linhas.length && !/^\s*$/.test(linhas[i]) && !/^(#{1,4}\s|\||- |> ?)/.test(linhas[i])) { p.push(mdInline(linhas[i])); i++; }
    if (p.length) out.push(`<p>${p.join('<br>')}</p>`);
    else { out.push(`<p>${mdInline(l)}</p>`); i++; }
  }
  return out.join('\n');
}

const ESTILO = '<style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:16px;line-height:1.45;color:#1f2328}' +
  'h1{font-size:1.5em;margin-top:1.4em}h2{font-size:1.2em;margin-top:1.6em;border-bottom:1px solid #d0d7de}h3{font-size:1.05em;margin-top:1.2em}.tabela{overflow-x:auto}' +
  'table{border-collapse:collapse;font-size:12px;margin:8px 0}th,td{border:1px solid #d0d7de;padding:4px 6px;vertical-align:top}' +
  'th{background:#f6f8fa}blockquote{margin:12px 0;padding:10px 14px;background:#eef6ff;border-left:4px solid #0969da;font-size:1.1em}' +
  'code{background:#f6f8fa;padding:1px 4px}.erro{color:#cf222e}</style>';

function pagina(titulo, corpoHtml) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escaparHtml(titulo)}</title>${ESTILO}</head><body>${corpoHtml}</body></html>`;
}

/**
 * Decide o tipo de resposta a partir do item recebido:
 * - saída do "Montar relatório" (tem relatorioMarkdown) → 200 (502 se todos os itens
 *   falharam na coleta; 400 se nenhum código foi identificado no catálogo)
 * - validação/identificação reprovada (tem erros[])      → 400
 * - saída de erro de um nó Code (tem error)              → 500, sem stack trace
 * @returns {{ httpStatus: number, corpo: object, html: string }}
 */
function prepararResposta(json) {
  if (json && typeof json.relatorioMarkdown === 'string') {
    return {
      // Todos os itens com falha de coleta → 502; nenhum item identificado no catálogo → 400
      httpStatus: json.status === 'ERRO' ? 502 : json.status === 'NAO_IDENTIFICADO' ? 400 : 200,
      corpo: json,
      html: pagina('Relatório de Pesquisa de Preços', markdownParaHtml(json.relatorioMarkdown))
    };
  }
  if (json && Array.isArray(json.erros)) {
    const corpo = { status: 'ERRO', tipoErro: 'entrada_invalida', mensagem: 'Requisição inválida. Corrija os campos indicados em erros.', erros: json.erros };
    return {
      httpStatus: 400, corpo,
      html: pagina('Entrada inválida', `<h1 class="erro">Entrada inválida</h1><ul>${json.erros.map((e) => `<li>${escaparHtml(e)}</li>`).join('')}</ul><p>Volte e corrija os campos.</p>`)
    };
  }
  const bruto = json && json.error !== undefined ? (json.error && json.error.message ? json.error.message : json.error) : 'erro não identificado';
  const detalhe = String(bruto).split('\n')[0].slice(0, 200);
  const corpo = {
    status: 'ERRO', tipoErro: 'erro_interno',
    mensagem: 'Falha interna ao processar a pesquisa de preços. Tente novamente; se o problema persistir, contate o administrador do fluxo.',
    detalhe
  };
  return { httpStatus: 500, corpo, html: pagina('Erro', `<h1 class="erro">Erro ao processar a pesquisa</h1><p>${escaparHtml(corpo.mensagem)}</p><p><code>${escaparHtml(detalhe)}</code></p>`) };
}

/**
 * Página final do formulário a partir da resposta do webhook (o formulário
 * chama o webhook do próprio fluxo). Aceita o corpo 200 (relatório), 400
 * (erros[]), 500/502 (mensagem/detalhe) ou a saída de erro do HTTP Request.
 */
function paginaFormulario(corpo) {
  if (corpo && (typeof corpo.relatorioMarkdown === 'string' || Array.isArray(corpo.erros))) return prepararResposta(corpo).html;
  const erro = corpo && (corpo.detalhe || corpo.mensagem || (corpo.error && (corpo.error.message || corpo.error)));
  return prepararResposta({ error: erro || 'Não foi possível obter a resposta da pesquisa.' }).html;
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { prepararResposta, paginaFormulario, markdownParaHtml, escaparHtml }; // @exports
} // @exports
