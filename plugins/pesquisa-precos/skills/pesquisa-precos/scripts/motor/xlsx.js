// ============================================================================
// xlsx.js — escreve um arquivo .xlsx (Office Open XML) sem dependências: o
// .xlsx é um zip de XML, montado aqui com zlib.deflateRawSync e um CRC-32
// próprio (zlib.crc32 não existe no Node 18). Usado pela Skill para a
// planilha da pesquisa.
//
// Células no formato USER_ENTERED do Google Sheets (ver celula() em
// planilha.js): número → número; "'" no início → texto literal (inclusive
// "'=..." e "'0012"); "=" no início → fórmula; demais → texto.
//
// As fórmulas ficam sem valor em cache e o workbook pede recálculo ao abrir
// (fullCalcOnLoad): quem abre o arquivo calcula tudo, e a coluna "Confere?"
// não diz "sim" antes disso. QUARTILE.INC e STDEV.S recebem o prefixo _xlfn.
// (funções "novas" do Excel 2010), senão o Excel mostra #NOME?.
// ============================================================================
const zlib = require('zlib');

const FUNCOES_NOVAS = ['QUARTILE.INC', 'STDEV.S'];
const MAX_TEXTO = 32767; // limite de caracteres de uma célula no Excel
const LARGURA_PADRAO = 18;

// --- zip ---------------------------------------------------------------------
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Zip (método DEFLATE) a partir de [{ nome, dados: Buffer|string }]. Data fixa
 * (01/01/2026 00:00): o mesmo conteúdo gera o mesmo arquivo.
 */
function zip(arquivos) {
  const DATA = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const locais = [];
  const central = [];
  let posicao = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const dados = Buffer.isBuffer(a.dados) ? a.dados : Buffer.from(a.dados, 'utf8');
    const comprimido = zlib.deflateRawSync(dados);
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // versão necessária
    local.writeUInt16LE(0x0800, 6);       // nomes em UTF-8
    local.writeUInt16LE(8, 8);            // DEFLATE
    local.writeUInt16LE(0, 10);           // hora
    local.writeUInt16LE(DATA, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    const cab = Buffer.alloc(46);
    cab.writeUInt32LE(0x02014b50, 0);
    cab.writeUInt16LE(20, 4);             // versão que criou
    cab.writeUInt16LE(20, 6);
    cab.writeUInt16LE(0x0800, 8);
    cab.writeUInt16LE(8, 10);
    cab.writeUInt16LE(0, 12);
    cab.writeUInt16LE(DATA, 14);
    cab.writeUInt32LE(crc, 16);
    cab.writeUInt32LE(comprimido.length, 20);
    cab.writeUInt32LE(dados.length, 24);
    cab.writeUInt16LE(nome.length, 28);
    cab.writeUInt32LE(posicao, 42);       // (30–41: extra, comentário, disco, atributos = 0)
    locais.push(local, nome, comprimido);
    central.push(cab, nome);
    posicao += local.length + nome.length + comprimido.length;
  }
  const dir = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(posicao, 16);
  return Buffer.concat([...locais, dir, fim]);
}

// --- XML ---------------------------------------------------------------------
/** Escape de XML; remove os caracteres de controle que o XML 1.0 não admite. */
function xml(s) {
  return String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Letra da coluna a partir do índice 0 (0 → A, 26 → AA). */
function letraColuna(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const comPrefixo = (f) => FUNCOES_NOVAS.reduce((x, fn) => x.split(`_xlfn.${fn}(`).join(`${fn}(`).split(`${fn}(`).join(`_xlfn.${fn}(`), f);

/** Uma célula no formato USER_ENTERED → XML (ou '' se vazia). */
function celulaXml(v, ref, matricial, estilo) {
  const s = estilo ? ` s="${estilo}"` : '';
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : '';
  if (typeof v === 'boolean') v = v ? 'sim' : 'não';
  let t = String(v);
  if (t.startsWith('=')) {
    const f = xml(comPrefixo(t.slice(1)));
    return `<c r="${ref}"${s}>${matricial ? `<f t="array" ref="${ref}">${f}</f>` : `<f>${f}</f>`}</c>`;
  }
  if (t.startsWith("'")) t = t.slice(1);
  if (t.length > MAX_TEXTO) t = t.slice(0, MAX_TEXTO);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>`;
}

/**
 * @param {{ linhas: any[][], matriciais?: Iterable<string>, cabecalho?: boolean, largura?: number }} aba
 *   cabecalho: linha 1 em negrito, com fundo, e painel congelado abaixo dela
 */
function folhaXml(aba) {
  const matriciais = new Set(aba.matriciais || []);
  const largura = aba.largura || LARGURA_PADRAO;
  let maxC = 0;
  const linhas = aba.linhas.map((linha, r) => {
    const cels = linha.map((v, c) => {
      const ref = `${letraColuna(c)}${r + 1}`;
      const x = celulaXml(v, ref, matriciais.has(ref), aba.cabecalho && r === 0 ? 1 : 0);
      if (x && c + 1 > maxC) maxC = c + 1;
      return x;
    }).join('');
    return cels ? `<row r="${r + 1}">${cels}</row>` : '';
  }).join('');
  const dim = maxC ? `A1:${letraColuna(maxC - 1)}${Math.max(aba.linhas.length, 1)}` : 'A1';
  const painel = aba.cabecalho
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="${dim}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${painel}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (maxC ? `<cols><col min="1" max="${maxC}" width="${largura}" customWidth="1"/></cols>` : '') +
    `<sheetData>${linhas}</sheetData>` +
    '</worksheet>';
}

/** Nomes de aba válidos no Excel: até 31 caracteres, sem []:*?/\ e sem repetir. */
function nomesDeAba(nomes) {
  const usados = new Set();
  return nomes.map((n) => {
    const base = String(n || 'Planilha').replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Planilha';
    let nome = base;
    for (let k = 2; usados.has(nome.toLowerCase()); k++) nome = `${base.slice(0, 31 - String(k).length - 1)} ${k}`;
    usados.add(nome.toLowerCase());
    return nome;
  });
}

const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/**
 * @param {{ titulo?: string, autor?: string, abas: Array<{ nome: string, linhas: any[][], matriciais?: Iterable<string>, cabecalho?: boolean, largura?: number }> }} p
 * @returns {Buffer} o arquivo .xlsx
 */
function gerarXlsx(p) {
  const abas = p.abas.length ? p.abas : [{ nome: 'Planilha', linhas: [] }];
  const nomes = nomesDeAba(abas.map((a) => a.nome));
  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${xml(p.titulo || '')}</dc:title><dc:creator>${xml(p.autor || '')}</dc:creator>` +
    '</cp:coreProperties>';
  const livro = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}">` +
    '<bookViews><workbookView/></bookViews><sheets>' +
    nomes.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
  const relsLivro = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${abas.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    '</Relationships>';
  return zip([
    { nome: '[Content_Types].xml', dados: tipos },
    { nome: '_rels/.rels', dados: rels },
    { nome: 'docProps/core.xml', dados: core },
    { nome: 'xl/workbook.xml', dados: livro },
    { nome: 'xl/_rels/workbook.xml.rels', dados: relsLivro },
    { nome: 'xl/styles.xml', dados: ESTILOS },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: folhaXml(a) }))
  ]);
}

if (typeof module !== 'undefined' && module.exports) { // @exports
  module.exports = { gerarXlsx, zip, crc32, xml, letraColuna, celulaXml, nomesDeAba, comPrefixo }; // @exports
} // @exports
