#!/usr/bin/env node
// ============================================================================
// pesquisar.js — pesquisa de preços pela IN SEGES/ME nº 65/2021, art. 5º, II
// (contratações similares da Administração Pública), com os dados abertos do
// Compras.gov.br. Executa, item a item, as mesmas etapas do motor do Grupo
// Esteves & Esteves: identificação no catálogo, coleta paginada, normalização,
// inconsistentes, unidade, IQR e estimativa (média ou mediana pelo CV).
//
// Os cálculos ficam todos aqui, nunca a cargo do modelo de IA: o número final
// é determinístico e pode ser refeito a partir dos arquivos gerados.
//
// Uso:
//   node scripts/pesquisar.js --entrada entrada.json --saida pasta-da-pesquisa
//   node scripts/pesquisar.js --verificar          (só testa o acesso à API)
//
// Opções:
//   --tempo-max S   para de iniciar itens novos depois de S segundos (padrão 240;
//                   0 = sem limite). Rodar o mesmo comando de novo continua de
//                   onde parou: os itens prontos ficam em <saida>/itens/.
//   --sem-pncp      (edição Completa) não busca os links dos editais no PNCP.
//
// Códigos de saída: 0 pesquisa concluída (qualquer status) · 2 entrada inválida
// · 3 sem acesso à API · 10 incompleta (rode de novo) · 1 erro inesperado.
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const EDICAO = JSON.parse(fs.readFileSync(path.join(__dirname, 'edicao.json'), 'utf8'));
const { validarEntradas } = require('./motor/validacao.js');
const { ENDPOINTS, identificarItem, coletarPrecos, montarUrl } = require('./motor/coleta.js');
const P = require('./motor/pipeline.js');
const { markdownParaHtml, escaparHtml } = require('./motor/resposta.js');
const PNCP = EDICAO.linksPncp ? require('./motor/pncp.js') : null;

const OPCOES = {
  coleta: { esperaMax429Ms: 65000 },
  identificacao: { tentativas: 3, esperaMax429Ms: 65000 },
  pncp: { orcamentoMs: 3 * 60 * 1000 },
  timeoutColetaMs: 60000,
  timeoutPncpMs: 15000
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mensagemErro = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 300);
const ISO_BR = (agora) => new Date(agora - 3 * 3600e3).toISOString();
const hojeBrasilia = (agora) => ISO_BR(agora).slice(0, 10);
const dataHoraBrasilia = (agora) => { const s = ISO_BR(agora); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 19)} (horário de Brasília)`; };

class ErroEntrada extends Error {}
class SemAcesso extends Error {}

// ---------------------------------------------------------------------------
// HTTP (GET, JSON) na interface que o motor espera: http(url) → { statusCode, body, headers }
// ---------------------------------------------------------------------------
function criarHttp({ buscar, timeoutMs, respostas, relogio }) {
  return async function http(url) {
    const t0 = relogio();
    try {
      const r = await buscar(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json', 'user-agent': `skill-pesquisa-precos/${EDICAO.versao}` } });
      const texto = await r.text();
      let body = texto;
      try { body = JSON.parse(texto); } catch (e) { /* texto puro */ }
      if (respostas) respostas.push({ url, status: r.status, ms: relogio() - t0, sha256: sha256(Buffer.from(texto, 'utf8')), corpo: texto });
      return { statusCode: r.status, body, headers: Object.fromEntries(r.headers) };
    } catch (e) {
      if (respostas) respostas.push({ url, status: null, ms: relogio() - t0, erro: mensagemErro(e) });
      throw e;
    }
  };
}

/** Uma consulta leve ao catálogo, para saber se o ambiente alcança a API. */
async function verificarAcesso(buscar) {
  const url = montarUrl(ENDPOINTS.catalogoMaterial, { codigoItem: 470419, pagina: 1, tamanhoPagina: 10 });
  let r;
  try {
    r = await buscar(url, { signal: AbortSignal.timeout(30000), headers: { accept: 'application/json' } });
  } catch (e) {
    const causa = e && e.cause ? ` (${e.cause.code || e.cause.message})` : '';
    throw new SemAcesso(`não foi possível conectar a dadosabertos.compras.gov.br: ${mensagemErro(e)}${causa}`);
  }
  if (r.status === 403 || r.status === 407) throw new SemAcesso(`a conexão com dadosabertos.compras.gov.br foi bloqueada (HTTP ${r.status}); o domínio provavelmente não está liberado neste ambiente`);
  return { ok: true, status: r.status };
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
function lerEntrada(arg) {
  if (!arg) throw new ErroEntrada('informe --entrada <arquivo.json>');
  const texto = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
  try { return JSON.parse(texto.replace(/^﻿/, '')); } catch (e) { throw new ErroEntrada(`entrada não é um JSON válido: ${mensagemErro(e)}`); }
}

/** Regras da edição, antes da validação do motor. */
function regrasDaEdicao(corpo) {
  const erros = [];
  const n = Array.isArray(corpo.itens) ? corpo.itens.length : (corpo.codigo ? 1 : 0);
  if (n > EDICAO.maxItens) {
    erros.push(`A edição ${EDICAO.nome} pesquisa até ${EDICAO.maxItens} itens por vez (a entrada tem ${n}). ${EDICAO.mensagemLimite || ''}`.trim());
  }
  if (!EDICAO.parametrosEstatisticos && (corpo.limiarCV !== undefined || corpo.fatorIQR !== undefined)) {
    erros.push(`Na edição ${EDICAO.nome} o limiar do CV (25%) e o fator do IQR (1,5) são fixos; retire limiarCV e fatorIQR da entrada.`);
  }
  return erros;
}

// ---------------------------------------------------------------------------
// Um item: catálogo → coleta → normalização → [PNCP] → inconsistentes → unidade → IQR → estimativa
// ---------------------------------------------------------------------------
async function pesquisarItem(atual, { http, httpPncp, dormir, cachePncp, relogio, usarPncp }) {
  const p = atual.item.params;
  const ident = await identificarItem(http, dormir, p.codigo, p.tipoItem, OPCOES.identificacao);
  if (ident.erro) {
    return P.estadoSemColeta(atual, 'NAO_IDENTIFICADO', ident.erro, { tipoItem: p.tipoItem, descricao: null, alertas: [], consultas: ident.consultas });
  }
  let estado = P.criarEstado(atual, ident);
  estado.dataHoraAcesso = dataHoraBrasilia(relogio());
  const coleta = await coletarPrecos(http, dormir, estado.item.tipo, estado.params, OPCOES.coleta);
  estado = P.etapaNormalizar(estado, coleta, ENDPOINTS[estado.item.tipo]);
  if (usarPncp) {
    let r;
    try {
      r = await PNCP.consultarPncp(httpPncp, dormir, estado.serieColetada.map((x) => x.idCompra), { ...OPCOES.pncp, cache: cachePncp, base: {} });
    } catch (e) {
      r = { mapa: {}, encontrados: 0, erro: mensagemErro(e) };
    }
    estado = P.etapaPncp(estado, r);
  }
  estado = P.etapaInconsistentes(estado);
  estado = P.etapaUnidade(estado);
  estado = P.etapaIQR(estado);
  estado = P.etapaEstimativa(estado);
  return estado;
}

// ---------------------------------------------------------------------------
// Planilha (.xlsx) — edição Completa. A estrutura vem de montarPlanilha (a
// mesma do Google Sheets); cada FILTER() da memória de cálculo vira um IF
// matricial sobre as linhas do item, que funciona em qualquer Excel e no
// LibreOffice. O arquivo é escrito por gerar_planilha.py (openpyxl).
// ---------------------------------------------------------------------------
function letraColuna(n) { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

function dadosPlanilha(s) {
  const { montarPlanilha, COL } = require('./motor/planilha.js');
  const p = montarPlanilha(s);
  const S = "'Série coletada'!";
  const literal = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const faixas = {};
  let linha = 2;
  for (const it of s.itens) { const n = it.serieColetada.length; faixas[it.numeroItem] = n ? { ini: linha, fim: linha + n - 1 } : null; linha += n; }
  const filtrosSheets = (num) => {
    const doItem = `${S}$${COL.item}$2:$${COL.item}=${literal(num)}`;
    const precos = `${S}$${COL.preco}$2:$${COL.preco}`;
    const etapa = `${S}$${COL.etapa}$2:$${COL.etapa}`;
    return { entrada: `FILTER(${precos},${doItem},(${etapa}="")+(LEFT(${etapa},3)="IQR"))`, saneada: `FILTER(${precos},${doItem},${S}$${COL.situacao}$2:$${COL.situacao}="aproveitado")` };
  };
  const filtrosXlsx = (ini, fim) => {
    const faixa = (c) => `${S}$${c}$${ini}:$${c}$${fim}`;
    const etapa = faixa(COL.etapa);
    return { entrada: `IF((${etapa}="")+(LEFT(${etapa},3)="IQR"),${faixa(COL.preco)})`, saneada: `IF(${faixa(COL.situacao)}="aproveitado",${faixa(COL.preco)})` };
  };
  const trocas = [['Valor do fluxo', 'Valor do relatório'], ['Total global (fluxo)', 'Total global (relatório)'], ['Fórmula (calculada pelo Sheets)', 'Fórmula (calculada pela planilha)']];
  const abas = p.dados.map((bloco) => {
    const nome = /^'(.*)'!/.exec(bloco.range)[1].replace(/''/g, "'");
    const matriciais = [];
    let item = null;
    const linhas = bloco.values.map((l, i) => {
      let lin = l.map((v) => { let x = v; for (const [de, para] of trocas) if (x === de) x = para; return x; });
      if (nome !== 'Memória de cálculo') return lin;
      if (i === 0) return ['Memória de cálculo por item. Cada fórmula usa as linhas do item na aba "Série coletada" (intervalo fixo, fórmula matricial); a coluna "Confere?" compara com o valor do relatório (tolerância 1e-9).', ...lin.slice(1)];
      const titulo = String(lin[0] || '').replace(/^'/, '');
      const it = s.itens.find((x) => titulo.startsWith(`Item ${x.numeroItem} — `));
      if (it) item = it;
      const f = lin[1];
      if (!item || typeof f !== 'string' || !f.includes('FILTER(')) return lin;
      const faixa = faixas[item.numeroItem];
      if (!faixa) return lin.map((v, k) => (k === 1 ? '' : v));
      const de = filtrosSheets(item.numeroItem);
      const para = filtrosXlsx(faixa.ini, faixa.fim);
      const nova = f.split(de.entrada).join(para.entrada).split(de.saneada).join(para.saneada);
      if (nova.includes('FILTER(')) throw new Error(`memória de cálculo do item ${item.numeroItem}: fórmula não reconhecida`);
      matriciais.push(`${letraColuna(1)}${i + 1}`);
      return lin.map((v, k) => (k === 1 ? nova : v));
    });
    return { nome, linhas, matriciais };
  });
  return { titulo: p.titulo, abas };
}

function gerarPlanilha(s, pasta) {
  const dados = path.join(pasta, '.planilha-dados.json');
  const destino = path.join(pasta, 'planilha.xlsx');
  fs.writeFileSync(dados, JSON.stringify(dadosPlanilha(s)));
  const script = path.join(__dirname, 'gerar_planilha.py');
  // No Windows, "python3" e "python" podem ser o atalho da Microsoft Store (sai
  // com erro sem rodar nada): por isso tenta "py" primeiro e segue para o próximo
  // candidato a cada falha. PYTHON=<caminho> força um interpretador.
  const candidatos = [process.env.PYTHON, ...(process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'])].filter(Boolean);
  const erros = [];
  for (const py of candidatos) {
    const r = spawnSync(py, [script, dados, destino], { encoding: 'utf8' });
    if (r.error) { erros.push(`${py}: não encontrado`); continue; }
    if (r.status === 0 && fs.existsSync(destino)) { fs.unlinkSync(dados); return { gerada: true, arquivo: destino }; }
    const msg = (r.stderr || r.stdout || '').trim().split('\n').pop() || `saiu com código ${r.status}`;
    erros.push(`${py}: ${/store|microsoft/i.test(msg) || r.status === 9009 ? 'atalho da Microsoft Store, não é o Python instalado' : msg}`);
  }
  return { gerada: false, erro: erros.join('; ') || 'Python não encontrado' };
}

// ---------------------------------------------------------------------------
// Relatório em HTML (para abrir no navegador e imprimir em PDF)
// ---------------------------------------------------------------------------
function htmlRelatorio(md, titulo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(titulo)}</title>
<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:1200px;margin:0 auto;padding:24px;line-height:1.45;color:#1f2328;background:#fff}
h1{font-size:1.5em;border-bottom:2px solid #d0d7de;padding-bottom:.3em;margin-top:1.6em}h2{font-size:1.25em;margin-top:1.4em}h3{font-size:1.05em}
table{border-collapse:collapse;margin:.6em 0;font-size:.82em;width:100%}th,td{border:1px solid #d0d7de;padding:4px 6px;vertical-align:top}th{background:#f6f8fa;text-align:left}
blockquote{margin:.8em 0;padding:.4em 1em;border-left:4px solid #0969da;background:#f6f8fa}code{font-size:.9em}
@media print{body{padding:0;max-width:none}h1{page-break-before:auto}table{font-size:7.5pt}tr{page-break-inside:avoid}}</style></head><body>
${markdownParaHtml(md)}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
/**
 * @param {object} corpo entrada (mesmo formato do webhook do motor)
 * @param {object} o { saida, buscar?, dormir?, relogio?, tempoMaxS?, semPncp?, verificar?, log? }
 */
async function executar(corpo, o) {
  const buscar = o.buscar || fetch;
  const dormir = o.dormir || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const relogio = o.relogio || Date.now;
  const log = o.log || ((m) => process.stderr.write(m + '\n'));
  const t0 = relogio();
  const pasta = path.resolve(o.saida);

  const errosEdicao = regrasDaEdicao(corpo);
  if (errosEdicao.length) throw Object.assign(new ErroEntrada('entrada recusada'), { erros: errosEdicao });
  const v = validarEntradas(corpo, hojeBrasilia(relogio()));
  if (!v.valido) throw Object.assign(new ErroEntrada('entrada recusada'), { erros: v.erros, alertas: v.alertas });

  if (o.verificar !== false) await verificarAcesso(buscar);

  // Continuação: a mesma entrada na mesma pasta reaproveita os itens prontos
  fs.mkdirSync(path.join(pasta, 'itens'), { recursive: true });
  const hashEntrada = sha256(JSON.stringify(corpo));
  const arqEntrada = path.join(pasta, 'entrada.json');
  let controle = fs.existsSync(path.join(pasta, '.controle.json')) ? JSON.parse(fs.readFileSync(path.join(pasta, '.controle.json'), 'utf8')) : null;
  if (controle && controle.hashEntrada !== hashEntrada) {
    throw Object.assign(new ErroEntrada('pasta de saída ocupada'), { erros: [`A pasta ${pasta} já tem uma pesquisa com outra entrada. Use outra pasta em --saida.`] });
  }
  if (!controle) {
    controle = { hashEntrada, inicio: relogio(), dataHoraPesquisa: dataHoraBrasilia(relogio()) };
    fs.writeFileSync(path.join(pasta, '.controle.json'), JSON.stringify(controle));
    fs.writeFileSync(arqEntrada, JSON.stringify(corpo, null, 2));
  }

  const itens = P.separarItens({ params: v.params, alertas: v.alertas, dataHoraPesquisa: controle.dataHoraPesquisa });
  const usarPncp = !!PNCP && !o.semPncp;
  const cachePncp = {};
  const estados = [];
  let novos = 0;
  for (let i = 0; i < itens.length; i++) {
    const atual = itens[i];
    const id = `${String(i + 1).padStart(3, '0')}-${String(atual.item.numeroItem).replace(/[^\w.-]+/g, '_').slice(0, 40)}`;
    const arqEstado = path.join(pasta, 'itens', `${id}.estado.json`);
    if (fs.existsSync(arqEstado)) { estados.push(JSON.parse(fs.readFileSync(arqEstado, 'utf8'))); continue; }
    if (novos > 0 && o.tempoMaxS > 0 && (relogio() - t0) / 1000 > o.tempoMaxS) {
      return { incompleta: true, prontos: estados.length, total: itens.length, pasta };
    }
    log(`→ item ${atual.item.numeroItem} (${atual.item.params.codigo}): pesquisando…`);
    const respostas = EDICAO.trilha ? [] : null;
    const http = criarHttp({ buscar, timeoutMs: OPCOES.timeoutColetaMs, respostas, relogio });
    const httpPncp = criarHttp({ buscar, timeoutMs: OPCOES.timeoutPncpMs, respostas, relogio });
    let estado;
    try {
      estado = await pesquisarItem(atual, { http, httpPncp, dormir, cachePncp, relogio, usarPncp });
    } catch (e) {
      estado = P.estadoSemColeta(atual, 'ERRO', mensagemErro(e));
    }
    if (respostas) {
      fs.writeFileSync(path.join(pasta, 'itens', `${id}.respostas.jsonl.gz`), zlib.gzipSync(respostas.map((x) => JSON.stringify(x)).join('\n') + '\n'));
    }
    fs.writeFileSync(arqEstado, JSON.stringify(estado));
    novos++;
    estados.push(estado);
    log(`  item ${atual.item.numeroItem}: ${estado.status}${estado.estimativa && estado.estimativa.valorEstimado != null ? ` · R$ ${estado.estimativa.valorEstimado}` : ''} (${estado.serieColetada.length} registros)`);
  }

  // Relatório, planilha e arquivos
  const saida = P.montarSaida(estados);
  const arquivos = [];
  if (EDICAO.planilha && saida.totalRegistrosColetados > 0) {
    let pl;
    try { pl = gerarPlanilha(saida, pasta); } catch (e) { pl = { gerada: false, erro: mensagemErro(e) }; }
    if (pl.gerada) {
      arquivos.push({ nome: 'planilha.xlsx', sha256: sha256(fs.readFileSync(pl.arquivo)), descricao: 'planilha do edital: resumo, série coletada, descartados, memória de cálculo com fórmulas e requisições' });
      saida.planilha = { gerada: true, arquivo: 'planilha.xlsx' };
    } else {
      saida.planilha = { gerada: false, erro: pl.erro };
      saida.alertas.push(`A planilha .xlsx não foi gerada (${pl.erro}). Corrija o Python (openpyxl instalado; no Windows, PYTHON=<caminho do python.exe>) e rode o mesmo comando de novo: os itens prontos são reaproveitados e relatório, resumo e planilha saem juntos.`);
    }
  } else {
    saida.planilha = { gerada: false, motivo: EDICAO.planilha ? 'nenhum registro coletado' : `não incluída na edição ${EDICAO.nome}` };
  }
  saida.documento = null;
  saida.edicao = { nome: EDICAO.nome, versao: EDICAO.versao };

  const json = JSON.stringify(saida, null, 1);
  fs.writeFileSync(path.join(pasta, 'resultado.json'), json);
  arquivos.unshift({ nome: 'resultado.json', sha256: sha256(Buffer.from(json, 'utf8')), descricao: 'saída completa: série coletada, descartes com motivo, estatísticas e alertas de cada item' });
  if (EDICAO.trilha) {
    for (const f of fs.readdirSync(path.join(pasta, 'itens')).filter((x) => x.endsWith('.respostas.jsonl.gz')).sort()) {
      arquivos.push({ nome: `itens/${f}`, sha256: sha256(zlib.gunzipSync(fs.readFileSync(path.join(pasta, 'itens', f)))), descricao: 'respostas brutas da API, uma por linha, cada uma com o SHA-256 do corpo' });
    }
  }

  const A = ['', '# Anexo — arquivos da pesquisa', ''];
  A.push('Arquivos entregues com este relatório (SHA-256 do conteúdo, para conferência de integridade):', '');
  for (const a of arquivos) A.push(`- \`${a.nome}\` — ${a.descricao}. SHA-256 \`${a.sha256}\``);
  if (EDICAO.planilha && saida.planilha && saida.planilha.erro) A.push(`- Planilha .xlsx: não gerada nesta execução (${saida.planilha.erro}).`);
  A.push('', `Relatório gerado pela Skill Pesquisa de Preços – ${EDICAO.nome} (versão ${EDICAO.versao}), do ${EDICAO.autor}. Os valores foram calculados por código determinístico a partir dos dados abertos; o modelo de IA não altera números.`);
  saida.relatorioMarkdown += A.join('\n') + '\n';
  fs.writeFileSync(path.join(pasta, 'relatorio.md'), saida.relatorioMarkdown);
  const titulo = `Relatório de pesquisa de preços${saida.processo && saida.processo.numero ? ` – Processo ${saida.processo.numero}` : ''}`;
  fs.writeFileSync(path.join(pasta, 'relatorio.html'), htmlRelatorio(saida.relatorioMarkdown, titulo));

  const resumo = {
    status: saida.status,
    edicao: `${EDICAO.nome} ${EDICAO.versao}`,
    processo: saida.processo,
    dataHoraPesquisa: saida.dataHoraPesquisa,
    valorTotalGlobal: saida.consolidacao.valorTotalGlobal,
    itensComValor: saida.consolidacao.itensComValor,
    itensSemValor: saida.consolidacao.itensSemValor,
    lotes: saida.consolidacao.lotes,
    itens: saida.quadroResumo.map((q, k) => ({ ...q, registrosColetados: saida.itens[k].serieColetada.length, descartados: saida.itens[k].descartados.length, alertas: saida.itens[k].alertas })),
    alertasGerais: saida.alertas,
    arquivos: ['relatorio.md', 'relatorio.html', ...arquivos.map((a) => a.nome)],
    pasta,
    segundos: Math.round((relogio() - (controle.inicio || t0)) / 1000)
  };
  fs.writeFileSync(path.join(pasta, 'resumo.json'), JSON.stringify(resumo, null, 2));
  return { incompleta: false, resumo, saida };
}

// ---------------------------------------------------------------------------
// Linha de comando
// ---------------------------------------------------------------------------
function args(argv) {
  const a = { tempoMaxS: 240 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--entrada') a.entrada = argv[++i];
    else if (k === '--saida') a.saida = argv[++i];
    else if (k === '--tempo-max') a.tempoMaxS = Number(argv[++i]);
    else if (k === '--sem-pncp') a.semPncp = true;
    else if (k === '--verificar') a.soVerificar = true;
    else if (k === '--ajuda' || k === '-h' || k === '--help') a.ajuda = true;
    else throw new ErroEntrada(`opção desconhecida: ${k}`);
  }
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a.ajuda) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 25).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  if (a.soVerificar) {
    await verificarAcesso(fetch);
    console.log(JSON.stringify({ acesso: 'ok', api: 'https://dadosabertos.compras.gov.br', edicao: `${EDICAO.nome} ${EDICAO.versao}` }));
    return 0;
  }
  const corpo = lerEntrada(a.entrada);
  const saida = a.saida || `pesquisa-precos-${ISO_BR(Date.now()).slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}`;
  const r = await executar(corpo, { saida, tempoMaxS: a.tempoMaxS, semPncp: a.semPncp });
  if (r.incompleta) {
    console.log(JSON.stringify({ status: 'INCOMPLETA', itensProntos: r.prontos, totalItens: r.total, pasta: r.pasta,
      instrucao: 'Rode exatamente o mesmo comando de novo para continuar; os itens prontos não são refeitos.' }, null, 2));
    return 10;
  }
  console.log(JSON.stringify(r.resumo, null, 2));
  return 0;
}

if (require.main === module) {
  main().then((c) => process.exit(c)).catch((e) => {
    if (e instanceof ErroEntrada) {
      console.log(JSON.stringify({ status: 'ENTRADA_INVALIDA', erros: e.erros || [e.message], alertas: e.alertas || [] }, null, 2));
      process.exit(2);
    }
    if (e instanceof SemAcesso) {
      console.log(JSON.stringify({ status: 'SEM_ACESSO_API', erro: e.message,
        instrucao: 'O ambiente precisa de acesso de rede a dadosabertos.compras.gov.br. Veja references/fontes.md, seção "Acesso de rede".' }, null, 2));
      process.exit(3);
    }
    console.log(JSON.stringify({ status: 'ERRO', erro: mensagemErro(e) }, null, 2));
    process.exit(1);
  });
}

module.exports = { executar, verificarAcesso, dadosPlanilha, regrasDaEdicao, EDICAO };
