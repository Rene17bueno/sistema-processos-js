// Gerador mínimo de .xlsx (OOXML) sem dependências: estilos, mesclagem, filtros, painéis congelados, barras de dados e gráficos nativos.
'use strict';
const zlib = require('node:zlib');

const esc = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colName = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const ref = (r, c) => colName(c) + r;
const abs = (r, c) => `$${colName(c)}$${r}`;

const FONTS = {
  n: { sz: 10 }, b: { sz: 10, b: 1 }, hdr: { sz: 10, b: 1, color: 'FFFFFF' }, title: { sz: 18, b: 1, color: '1F3A5F' },
  sub: { sz: 9, i: 1, color: '5A6779' }, klabel: { sz: 9, b: 1, color: '5A6779' }, kval: { sz: 20, b: 1, color: '1F3A5F' },
  sec: { sz: 12, b: 1, color: '1F3A5F' }, note: { sz: 9, color: '5A6779' }, tot: { sz: 10, b: 1, color: '1F3A5F' },
};
const FILLS = { none: null, hdr: '1F3A5F', zebra: 'F3F5F8', total: 'DCE6F2', kpi: 'EEF2F8', yellow: 'FFF2CC', blue: 'DDEBF7', green: 'E2F0D9' };
const FMTS = { money: '"R$" #,##0.00', date: 'dd/mm/yyyy', int: '#,##0', pct: '0.0%', dec: '#,##0.0' };
const LINE = 'D0D6DE', NAVY = '1F3A5F';
const BORDERS = {
  none: {}, thin: { l: ['thin', LINE], r: ['thin', LINE], t: ['thin', LINE], b: ['thin', LINE] },
  total: { t: ['thin', NAVY], b: ['double', NAVY] }, sec: { b: ['medium', NAVY] }, kpi: { t: ['thin', LINE] },
};

class Workbook {
  constructor() { this.sheets = []; this.xfs = [{}]; this.xfKey = new Map([['{}', 0]]); }
  // Registra (com cache) um estilo de célula e devolve o índice.
  st(o = {}) {
    const k = JSON.stringify(o);
    if (!this.xfKey.has(k)) { this.xfKey.set(k, this.xfs.length); this.xfs.push(o); }
    return this.xfKey.get(k);
  }
  sheet(name, opts = {}) { const s = new Sheet(this, name, opts); this.sheets.push(s); return s; }

  stylesXml() {
    const fontKeys = Object.keys(FONTS), fillKeys = Object.keys(FILLS), borderKeys = Object.keys(BORDERS), fmtKeys = Object.keys(FMTS);
    const fonts = fontKeys.map((k) => { const f = FONTS[k]; return `<font>${f.b ? '<b/>' : ''}${f.i ? '<i/>' : ''}<sz val="${f.sz}"/><color rgb="FF${f.color || '1C2430'}"/><name val="Calibri"/><family val="2"/></font>`; }).join('');
    const fills = '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      fillKeys.slice(1).map((k) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${FILLS[k]}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
    const side = (n, v) => (v ? `<${n} style="${v[0]}"><color rgb="FF${v[1]}"/></${n}>` : `<${n}/>`);
    const borders = borderKeys.map((k) => { const b = BORDERS[k]; return `<border>${side('left', b.l)}${side('right', b.r)}${side('top', b.t)}${side('bottom', b.b)}<diagonal/></border>`; }).join('');
    const numFmts = fmtKeys.map((k, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(FMTS[k])}"/>`).join('');
    const xfs = this.xfs.map((o) => {
      const fmt = o.fmt ? 164 + fmtKeys.indexOf(o.fmt) : 0;
      const al = `<alignment${o.h ? ` horizontal="${o.h}"` : ''} vertical="${o.v || 'center'}"${o.wrap ? ' wrapText="1"' : ''}${o.indent ? ` indent="${o.indent}"` : ''}/>`;
      return `<xf numFmtId="${fmt}" fontId="${Math.max(0, fontKeys.indexOf(o.font || 'n'))}" fillId="${Math.max(0, fillKeys.indexOf(o.fill || 'none'))}" borderId="${Math.max(0, borderKeys.indexOf(o.border || 'none'))}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${fmtKeys.length}">${numFmts}</numFmts><fonts count="${fontKeys.length}">${fonts}</fonts><fills count="${fillKeys.length + 1}">${fills}</fills><borders count="${borderKeys.length}">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }

  build() {
    const files = []; const add = (name, xml) => files.push({ name, data: Buffer.from(xml, 'utf8') });
    const NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    let ct = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    let chartN = 0, drawN = 0; const names = [];
    this.sheets.forEach((s, i) => {
      const n = i + 1; ct += `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
      let drawRid = '';
      if (s.charts.length) {
        const dn = ++drawN; drawRid = 'rId1';
        add(`xl/worksheets/_rels/sheet${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/drawing" Target="../drawings/drawing${dn}.xml"/></Relationships>`);
        ct += `<Override PartName="/xl/drawings/drawing${dn}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
        let anchors = '', rels = '';
        s.charts.forEach((c, j) => {
          const cn = ++chartN; ct += `<Override PartName="/xl/charts/chart${cn}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
          add(`xl/charts/chart${cn}.xml`, chartXml(c, s.name));
          rels += `<Relationship Id="rId${j + 1}" Type="${NS}/chart" Target="../charts/chart${cn}.xml"/>`;
          anchors += `<xdr:twoCellAnchor><xdr:from><xdr:col>${c.from[1] - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.from[0] - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c.to[1]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.to[0]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${j + 2}" name="Gráfico ${j + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${NS}" r:id="rId${j + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
        });
        add(`xl/drawings/drawing${dn}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`);
        add(`xl/drawings/_rels/drawing${dn}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
      }
      add(`xl/worksheets/sheet${n}.xml`, s.xml(i === 0, drawRid));
      names.push(s);
    });
    const dn = [];
    names.forEach((s, i) => {
      if (s.filter) dn.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!${s.filter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`);
      if (s.printTitleRow) dn.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(s.name)}'!$${s.printTitleRow}:$${s.printTitleRow}</definedName>`);
    });
    add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS}"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000"/></bookViews><sheets>${this.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${dn.length ? `<definedNames>${dn.join('')}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
    add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${this.sheets.length + 1}" Type="${NS}/styles" Target="styles.xml"/></Relationships>`);
    add('xl/styles.xml', this.stylesXml());
    add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    files.unshift({ name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${ct}</Types>`) });
    return zip(files);
  }
}

class Sheet {
  constructor(wb, name, o = {}) {
    this.wb = wb; this.name = name.slice(0, 31); this.rows = new Map(); this.merges = []; this.widths = []; this.heights = new Map();
    this.grid = o.grid !== false; this.tab = o.tab; this.landscape = o.landscape !== false; this.freeze = null; this.filter = null;
    this.bars = []; this.charts = []; this.printTitleRow = null; this.footer = o.footer || '';
  }
  // v: número | texto | null (célula só estilizada).  f: fórmula opcional (v vira o valor em cache).
  set(r, c, v, style = {}, f) {
    if (!this.rows.has(r)) this.rows.set(r, new Map());
    this.rows.get(r).set(c, { v, s: this.wb.st(style), f });
    return this;
  }
  merge(r1, c1, r2, c2, style) {
    this.merges.push(`${ref(r1, c1)}:${ref(r2, c2)}`);
    if (style) for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (!(this.rows.get(r)?.has(c))) this.set(r, c, null, style);
    return this;
  }
  xml(selected, drawRid) {
    let maxR = 1, maxC = 1; const rows = [...this.rows.keys()].sort((a, b) => a - b);
    const data = rows.map((r) => {
      maxR = Math.max(maxR, r); const cells = [...this.rows.get(r).entries()].sort((a, b) => a[0] - b[0]).map(([c, x]) => {
        maxC = Math.max(maxC, c); const a = ref(r, c);
        if (x.f) return `<c r="${a}" s="${x.s}"><f>${esc(x.f)}</f><v>${Number.isFinite(x.v) ? x.v : 0}</v></c>`;
        if (x.v === null || x.v === undefined || x.v === '') return `<c r="${a}" s="${x.s}"/>`;
        if (typeof x.v === 'number') return `<c r="${a}" s="${x.s}"><v>${Number.isFinite(x.v) ? x.v : 0}</v></c>`;
        return `<c r="${a}" s="${x.s}" t="inlineStr"><is><t xml:space="preserve">${esc(x.v)}</t></is></c>`;
      }).join('');
      const ht = this.heights.get(r);
      return `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    let pane = '';
    if (this.freeze) {
      const [fr, fc] = this.freeze; // linhas/colunas congeladas
      pane = `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${ref(fr + 1, fc + 1)}" activePane="${fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight'}" state="frozen"/>`;
    }
    const cols = this.widths.length ? `<cols>${this.widths.map((w, i) => (w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : '')).join('')}</cols>` : '';
    const cf = this.bars.map((b, i) => `<conditionalFormatting sqref="${b.sqref}"><cfRule type="dataBar" priority="${i + 1}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF${b.color}"/></dataBar></cfRule></conditionalFormatting>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr>${this.tab ? `<tabColor rgb="FF${this.tab}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${ref(maxR, maxC)}"/><sheetViews><sheetView${this.grid ? '' : ' showGridLines="0"'}${selected ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${data}</sheetData>${this.filter ? `<autoFilter ref="${this.filter}"/>` : ''}${this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}${cf}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${this.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L${esc(this.footer)}&amp;RPágina &amp;P de &amp;N</oddFooter></headerFooter>${drawRid ? `<drawing r:id="${drawRid}"/>` : ''}</worksheet>`;
  }
}

// Gráfico de barras/colunas. c: {title, type:'col'|'bar', cat:[r1,c1,r2,c2], val:[r1,c1,r2,c2], serName, color, fmt, from:[r,c], to:[r,c]}
function chartXml(c, sheetName) {
  const rng = ([r1, c1, r2, c2]) => `'${esc(sheetName)}'!${abs(r1, c1)}:${abs(r2, c2)}`;
  const horiz = c.type === 'bar';
  const txt = (sz, bold, color) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"><a:solidFill><a:srgbClr val="1F3A5F"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="pt-BR" sz="1200" b="1"><a:solidFill><a:srgbClr val="1F3A5F"/></a:solidFill></a:rPr><a:t>${esc(c.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="${horiz ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(c.serName || c.title)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${c.color || '1F3A5F'}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/><c:dLbls><c:numFmt formatCode="${esc(c.lblFmt || c.fmt || 'General')}" sourceLinked="0"/><c:spPr><a:noFill/></c:spPr>${txt(800, 0, '5A6779')}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:cat><c:strRef><c:f>${rng(c.cat)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${rng(c.val)}</c:f></c:numRef></c:val></c:ser><c:gapWidth val="55"/><c:axId val="111111"/><c:axId val="222222"/></c:barChart><c:catAx><c:axId val="111111"/><c:scaling><c:orientation val="${horiz ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="BFC7D1"/></a:solidFill></a:ln></c:spPr>${txt(800, 0, '1C2430')}<c:crossAx val="222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'b' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5E9EF"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${esc(c.fmt || 'General')}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txt(800, 0, '5A6779')}<c:crossAx val="111111"/><c:crosses val="${horiz ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx><c:spPr><a:noFill/></c:spPr></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D0D6DE"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
}

function zip(files) {
  const parts = [], cd = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), raw = f.data, comp = zlib.deflateRawSync(raw), crc = zlib.crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    cd.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

module.exports = { Workbook, colName, ref };
