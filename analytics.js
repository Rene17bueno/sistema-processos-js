// Camada analítica: agregações, gráficos SVG do painel e relatório Excel gerencial.
'use strict';
const { Workbook } = require('./xlsx');

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const STATUS = ['COMPRAS', 'COMPRADO', 'ENVIADO'];
const COR = { COMPRAS: '#e0a800', COMPRADO: '#2f6db5', ENVIADO: '#2e7d32' };
const PALETA = ['#1f3a5f', '#2f6db5', '#4f9bd9', '#e0a800', '#2e7d32', '#8e5ea2', '#c0504d', '#7f8c8d'];
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const dias = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);
const serial = (iso) => Math.round(Date.parse(iso.slice(0, 10)) / 864e5) + 25569; // data -> número de série do Excel
const mesLabel = (ym) => `${MES[+ym.slice(5, 7) - 1]}/${ym.slice(2, 4)}`;
const brl = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const curto = (v) => v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : brl(v);
const num = (v, d = 1) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const cnpjFmt = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const soma = (a, f) => a.reduce((s, x) => s + f(x), 0);

function agrupa(procs, chave) {
  const m = new Map();
  for (const p of procs) { const k = chave(p); const g = m.get(k) || { nome: k, n: 0, valor: 0 }; g.n++; g.valor += p.valor; m.set(k, g); }
  return [...m.values()].sort((a, b) => b.valor - a.valor);
}

// meses = 3 | 6 | 12 | 0 (todo o histórico)
function dados(db, meses) {
  const hj = hoje(); const d0 = new Date(hj + 'T00:00:00Z');
  if (meses) d0.setUTCMonth(d0.getUTCMonth() - meses);
  const desde = meses ? d0.toISOString().slice(0, 10) : '0000-00-00';
  const procs = db.prepare(`SELECT p.*, c.razao_social cliente, c.cnpj, e.nome empresa,
      (SELECT MAX(x.quando) FROM historico x WHERE x.processo_id=p.id AND x.acao LIKE '% para ENVIADO') conclusao
    FROM processos p JOIN clientes c ON c.id=p.cliente_id JOIN empresas e ON e.id=p.empresa_id
    WHERE p.data_abertura>=? ORDER BY p.data_abertura DESC, p.numero DESC`).all(desde);
  for (const p of procs) {
    p.conclusao = p.status === 'ENVIADO' && p.conclusao ? p.conclusao.slice(0, 10) : null;
    p.leadTime = p.conclusao ? Math.max(0, dias(p.data_abertura, p.conclusao)) : null;
    p.idade = p.status === 'ENVIADO' ? null : Math.max(0, dias(p.data_abertura, hj));
  }
  const porStatus = Object.fromEntries(STATUS.map((s) => { const l = procs.filter((p) => p.status === s); return [s, { n: l.length, valor: soma(l, (p) => p.valor) }]; }));
  const conc = procs.filter((p) => p.leadTime !== null), abertos = procs.filter((p) => p.status !== 'ENVIADO');
  const valor = soma(procs, (p) => p.valor);
  const kpi = {
    n: procs.length, valor, ticket: procs.length ? valor / procs.length : 0, porStatus,
    abertos: abertos.length, valorAberto: soma(abertos, (p) => p.valor),
    leadMedio: conc.length ? soma(conc, (p) => p.leadTime) / conc.length : 0,
    taxa: procs.length ? porStatus.ENVIADO.n / procs.length : 0,
  };
  // série mensal contínua (meses sem movimento aparecem zerados)
  const mensal = []; const ini = procs.length ? procs[procs.length - 1].data_abertura.slice(0, 7) : hj.slice(0, 7);
  for (let [y, m] = [+ini.slice(0, 4), +ini.slice(5, 7)]; `${y}-${String(m).padStart(2, '0')}` <= hj.slice(0, 7); m === 12 ? (y++, m = 1) : m++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`; const l = procs.filter((p) => p.data_abertura.startsWith(ym));
    mensal.push({ ym, label: mesLabel(ym), n: l.length, valor: soma(l, (p) => p.valor) });
  }
  const faixas = [['0 a 7 dias', 0, 7], ['8 a 15 dias', 8, 15], ['16 a 30 dias', 16, 30], ['Mais de 30 dias', 31, 1e9]];
  const aging = faixas.map(([nome, a, b]) => { const l = abertos.filter((p) => p.idade >= a && p.idade <= b); return { nome, n: l.length, valor: soma(l, (p) => p.valor) }; });
  const clientes = agrupa(procs, (p) => p.cliente).map((g) => ({ ...g, cnpj: procs.find((p) => p.cliente === g.nome).cnpj }));
  return {
    meses, desde, hoje: hj, procs, kpi, mensal, aging, clientes,
    categorias: agrupa(procs, (p) => p.categoria), empresas: agrupa(procs, (p) => p.empresa),
    antigos: [...abertos].sort((a, b) => b.idade - a.idade).slice(0, 8),
    periodo: meses ? `Últimos ${meses} meses (desde ${desde.split('-').reverse().join('/')})` : 'Todo o histórico',
  };
}

// ---------- gráficos SVG (painel) ----------
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function colunas(items) {
  const W = 640, H = 240, pl = 8, pb = 28, pt = 22, max = Math.max(...items.map((i) => i.valor), 1), bw = (W - pl * 2) / items.length;
  const bars = items.map((i, k) => {
    const bh = ((H - pb - pt) * i.valor) / max, x = pl + k * bw + bw * 0.18, y = H - pb - bh;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="#1f3a5f"><title>${h(i.label)}: ${brl(i.valor)} (${i.n} proc.)</title></rect>
<text x="${(x + bw * 0.32).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="${items.length > 9 ? 9 : 10}" fill="#5a6779">${i.valor ? curto(i.valor).replace('R$ ', '') : ''}</text>
<text x="${(x + bw * 0.32).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#1c2430">${h(i.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><line x1="${pl}" x2="${W - pl}" y1="${H - pb}" y2="${H - pb}" stroke="#c7ced8"/>${bars}</svg>`;
}

function barras(items, fmt = curto, cor = '#2f6db5') {
  const W = 520, rh = 28, lw = 175, vw = 80, max = Math.max(...items.map((i) => i.valor), 1);
  const rows = items.map((i, k) => {
    const y = k * rh, bw = ((W - lw - vw) * i.valor) / max;
    return `<text x="0" y="${y + 18}" font-size="12" fill="#1c2430">${h(trunc(i.nome, 27))}<title>${h(i.nome)}</title></text>
<rect x="${lw}" y="${y + 5}" width="${Math.max(bw, 1).toFixed(1)}" height="16" rx="3" fill="${cor}"/>
<text x="${(lw + bw + 6).toFixed(1)}" y="${y + 18}" font-size="11" fill="#5a6779">${fmt(i.valor)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${items.length * rh}" width="100%" role="img">${rows}</svg>`;
}

function rosca(items) {
  const tot = soma(items, (i) => i.valor) || 1, R = 52, C = 2 * Math.PI * R; let acc = 0;
  const arcs = items.map((i) => {
    const len = (C * i.valor) / tot, a = `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${i.cor}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 80 80)"><title>${h(i.nome)}: ${brl(i.valor)}</title></circle>`;
    acc += len; return a;
  }).join('');
  const leg = items.map((i) => `<div style="display:flex;gap:8px;align-items:center;margin:6px 0"><i style="width:12px;height:12px;border-radius:3px;background:${i.cor}"></i><b>${h(i.nome)}</b> <span style="color:#5a6779">${i.n} proc. · ${curto(i.valor)} · ${num((100 * i.valor) / tot, 0)}%</span></div>`).join('');
  return `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 160 160" width="150" role="img">${arcs}<text x="80" y="76" text-anchor="middle" font-size="11" fill="#5a6779">Total</text><text x="80" y="94" text-anchor="middle" font-size="13" font-weight="700" fill="#1f3a5f">${curto(tot)}</text></svg><div>${leg}</div></div>`;
}

// ---------- relatório Excel ----------
function gerarXlsx(d, usuario) {
  const wb = new Workbook(), k = d.kpi;
  const gerado = new Date().toLocaleString('pt-BR');
  const rodape = `Controle de Processos · gerado em ${gerado}`;
  const T = (o) => o; // atalho p/ legibilidade dos estilos
  const sub = `${d.periodo}  |  Gerado em ${gerado} por ${usuario}  |  Dados fictícios de demonstração`;

  // ===== 1. Resumo Executivo =====
  const rs = wb.sheet('Resumo Executivo', { grid: false, tab: '1F3A5F', footer: rodape });
  rs.widths = [2, 16, 16, 16, 16, 3, 16, 16, 16, 16, 16, 16];
  rs.set(1, 2, 'Controle de Processos — Relatório Gerencial', T({ font: 'title' })).merge(1, 2, 1, 12); rs.heights.set(1, 30);
  rs.set(2, 2, sub, T({ font: 'sub' })).merge(2, 2, 2, 12);
  const kpiBox = (r, c, label, val, fmt) => {
    rs.set(r, c, label.toUpperCase(), T({ font: 'klabel', fill: 'kpi', h: 'center', border: 'kpi' })).merge(r, c, r, c + 1, T({ font: 'klabel', fill: 'kpi', border: 'kpi' }));
    rs.set(r + 1, c, val, T({ font: 'kval', fill: 'kpi', h: 'center', fmt })).merge(r + 1, c, r + 1, c + 1, T({ font: 'kval', fill: 'kpi' }));
  };
  rs.heights.set(5, 34); rs.heights.set(8, 34);
  kpiBox(4, 2, 'Processos no período', k.n, 'int'); kpiBox(4, 4, 'Valor total', k.valor, 'money');
  kpiBox(4, 7, 'Ticket médio', k.ticket, 'money'); kpiBox(4, 9, 'Lead time médio (dias)', k.leadMedio, 'dec');
  kpiBox(7, 2, 'Em compras', k.porStatus.COMPRAS.n, 'int'); kpiBox(7, 4, 'Comprado (aguard. envio)', k.porStatus.COMPRADO.n, 'int');
  kpiBox(7, 7, 'Enviado', k.porStatus.ENVIADO.n, 'int'); kpiBox(7, 9, 'Taxa de conclusão', k.taxa, 'pct');
  rs.set(4, 11, 'VALOR EM ABERTO', T({ font: 'klabel', fill: 'kpi', h: 'center', border: 'kpi' })).merge(4, 11, 4, 12, T({ font: 'klabel', fill: 'kpi', border: 'kpi' }));
  rs.set(5, 11, k.valorAberto, T({ font: 'kval', fill: 'kpi', h: 'center', fmt: 'money' })).merge(5, 11, 5, 12, T({ font: 'kval', fill: 'kpi' }));
  rs.set(7, 11, 'PROCESSOS EM ABERTO', T({ font: 'klabel', fill: 'kpi', h: 'center', border: 'kpi' })).merge(7, 11, 7, 12, T({ font: 'klabel', fill: 'kpi', border: 'kpi' }));
  rs.set(8, 11, k.abertos, T({ font: 'kval', fill: 'kpi', h: 'center', fmt: 'int' })).merge(8, 11, 8, 12, T({ font: 'kval', fill: 'kpi' }));

  const hd = T({ font: 'hdr', fill: 'hdr', h: 'center', border: 'thin', wrap: true });
  // Tabela genérica: colunas [{t, key, fmt, h}] a partir da coluna c0; retorna próxima linha livre e faixas
  const tabela = (r, c0, titulo, cols, linhas, totalCols) => {
    rs.set(r, c0, titulo, T({ font: 'sec', border: 'sec' })).merge(r, c0, r, c0 + cols.length - 1, T({ font: 'sec', border: 'sec' }));
    cols.forEach((c, i) => rs.set(r + 1, c0 + i, c.t, hd)); rs.heights.set(r + 1, 30);
    linhas.forEach((l, j) => cols.forEach((c, i) => {
      const z = j % 2 ? 'zebra' : 'none', v = c.f ? c.f(l) : l[c.key];
      rs.set(r + 2 + j, c0 + i, v, T({ fill: z, border: 'thin', fmt: c.fmt, h: c.h || (typeof v === 'number' ? 'right' : 'left') }));
    }));
    const a = r + 2, b = r + 1 + linhas.length, t = b + 1;
    cols.forEach((c, i) => {
      const L = String.fromCharCode(64 + c0 + i), est = T({ font: 'tot', fill: 'total', border: 'total', fmt: c.fmt, h: i ? 'right' : 'left' });
      if (i === 0) rs.set(t, c0 + i, 'Total', est);
      else if (totalCols.includes(c.key)) rs.set(t, c0 + i, soma(linhas, (l) => l[c.key]), est, `SUM(${L}${a}:${L}${b})`);
      else rs.set(t, c0 + i, null, est);
    });
    return { a, b, t, next: t + 3 };
  };
  const col = (t, key, fmt, f) => ({ t, key, fmt, f });
  const sobTot = (g, total) => (total ? g.valor / total : 0);

  let r = 10;
  const mens = tabela(r, 2, 'Evolução mensal de processos', [col('Mês', 'label'), col('Qtd.', 'n', 'int'), col('Valor (R$)', 'valor', 'money'), col('Ticket médio', null, 'money', (l) => (l.n ? l.valor / l.n : 0))], d.mensal, ['n', 'valor']);
  rs.charts.push({ title: 'Valor aberto por mês (R$)', type: 'col', cat: [mens.a, 2, mens.b, 2], val: [mens.a, 4, mens.b, 4], fmt: '"R$" #,##0', lblFmt: '#,##0', color: '1F3A5F', from: [r, 7], to: [Math.max(mens.t, r + 15), 12] });
  r = Math.max(mens.next, r + 18);
  const top = d.clientes.slice(0, 10);
  const cli = tabela(r, 2, 'Top 10 clientes por valor', [col('Cliente', 'nome'), col('Qtd.', 'n', 'int'), col('Valor (R$)', 'valor', 'money'), col('% do total', null, 'pct', (l) => sobTot(l, k.valor))], top, ['n', 'valor']);
  rs.widths[1] = 30; rs.widths[6] = 26; // colunas B e G comportam nomes de cliente/empresa
  rs.charts.push({ title: 'Top clientes (R$)', type: 'bar', cat: [cli.a, 2, cli.b, 2], val: [cli.a, 4, cli.b, 4], fmt: '"R$" #,##0', lblFmt: '#,##0', color: '2F6DB5', from: [r, 7], to: [Math.max(cli.t, r + 15), 12] });
  r = Math.max(cli.next, r + 18);
  const est = tabela(r, 2, 'Distribuição por status', [col('Status', 'nome'), col('Qtd.', 'n', 'int'), col('Valor (R$)', 'valor', 'money'), col('% do valor', null, 'pct', (l) => sobTot(l, k.valor))], STATUS.map((s) => ({ nome: s, ...k.porStatus[s] })), ['n', 'valor']);
  const cat = tabela(est.next, 2, 'Distribuição por categoria', [col('Categoria', 'nome'), col('Qtd.', 'n', 'int'), col('Valor (R$)', 'valor', 'money'), col('% do valor', null, 'pct', (l) => sobTot(l, k.valor))], d.categorias, ['n', 'valor']);
  const emp = tabela(est.next, 7, 'Distribuição por empresa', [col('Empresa', 'nome'), col('Qtd.', 'n', 'int'), col('Valor (R$)', 'valor', 'money'), col('% do valor', null, 'pct', (l) => sobTot(l, k.valor))], d.empresas, ['n', 'valor']);
  const ag = tabela(Math.max(cat.next, emp.next), 2, 'Envelhecimento dos processos em aberto', [col('Faixa de idade', 'nome'), col('Qtd.', 'n', 'int'), col('Valor (R$)', 'valor', 'money'), col('% do valor', null, 'pct', (l) => (k.valorAberto ? l.valor / k.valorAberto : 0))], d.aging, ['n', 'valor']);
  rs.set(ag.next, 2, 'Notas: lead time = dias entre a abertura e a mudança para ENVIADO (processos concluídos). Taxa de conclusão = enviados ÷ total do período. Os totais usam fórmulas do Excel.', T({ font: 'note' })).merge(ag.next, 2, ag.next, 12);
  rs.bars.push({ sqref: `D${cli.a}:D${cli.b}`, color: '9DB9DE' });

  // ===== 2. Processos (base detalhada) =====
  const ps = wb.sheet('Processos', { tab: '2F6DB5', footer: rodape });
  ps.widths = [13, 12, 34, 20, 24, 24, 44, 13, 17, 13, 12, 12];
  ps.set(1, 1, 'Base detalhada de processos', T({ font: 'title' })).merge(1, 1, 1, 12); ps.heights.set(1, 30);
  ps.set(2, 1, sub, T({ font: 'sub' })).merge(2, 1, 2, 12);
  const H = ['Nº do processo', 'Abertura', 'Cliente', 'CNPJ', 'Empresa', 'Categoria', 'Descrição', 'Status', 'Valor (R$)', 'Conclusão', 'Lead time (dias)', 'Idade (dias)'];
  H.forEach((t, i) => ps.set(4, i + 1, t, hd)); ps.heights.set(4, 32);
  const COREXC = { COMPRAS: 'yellow', COMPRADO: 'blue', ENVIADO: 'green' };
  d.procs.forEach((p, j) => {
    const R = 5 + j, z = j % 2 ? 'zebra' : 'none', b = { fill: z, border: 'thin' };
    ps.set(R, 1, p.numero, T({ ...b, h: 'center' })); ps.set(R, 2, serial(p.data_abertura), T({ ...b, fmt: 'date', h: 'center' }));
    ps.set(R, 3, p.cliente, T(b)); ps.set(R, 4, cnpjFmt(p.cnpj), T({ ...b, h: 'center' })); ps.set(R, 5, p.empresa, T(b)); ps.set(R, 6, p.categoria, T(b));
    ps.set(R, 7, p.descricao, T(b)); ps.set(R, 8, p.status, T({ font: 'b', fill: COREXC[p.status], border: 'thin', h: 'center' }));
    ps.set(R, 9, p.valor, T({ ...b, fmt: 'money' }));
    ps.set(R, 10, p.conclusao ? serial(p.conclusao) : null, T({ ...b, fmt: 'date', h: 'center' }));
    ps.set(R, 11, p.leadTime, T({ ...b, fmt: 'int', h: 'center' })); ps.set(R, 12, p.idade, T({ ...b, fmt: 'int', h: 'center' }));
  });
  const fim = 4 + d.procs.length, tr = fim + 1, tst = { font: 'tot', fill: 'total', border: 'total' };
  for (let c = 1; c <= 12; c++) ps.set(tr, c, null, T(tst));
  ps.set(tr, 1, 'Total (filtrado)', T(tst));
  ps.set(tr, 8, d.procs.length, T({ ...tst, fmt: 'int', h: 'center' }), `SUBTOTAL(103,A5:A${fim})`);
  ps.set(tr, 9, k.valor, T({ ...tst, fmt: 'money' }), `SUBTOTAL(109,I5:I${fim})`);
  ps.set(tr, 11, k.leadMedio, T({ ...tst, fmt: 'dec', h: 'center' }), `IFERROR(SUBTOTAL(101,K5:K${fim}),0)`);
  ps.freeze = [4, 1]; ps.filter = `A4:L${fim}`; ps.printTitleRow = 4;
  if (d.procs.length) ps.bars.push({ sqref: `I5:I${fim}`, color: '9DB9DE' });

  // ===== 3. Por Cliente =====
  const cs = wb.sheet('Por Cliente', { tab: '2E7D32', footer: rodape });
  cs.widths = [6, 38, 20, 10, 18, 18, 12, 14];
  cs.set(1, 1, 'Análise por cliente (curva ABC)', T({ font: 'title' })).merge(1, 1, 1, 8); cs.heights.set(1, 30);
  cs.set(2, 1, sub, T({ font: 'sub' })).merge(2, 1, 2, 8);
  ['#', 'Cliente', 'CNPJ', 'Qtd.', 'Valor (R$)', 'Ticket médio', '% do total', 'Classe ABC'].forEach((t, i) => cs.set(4, i + 1, t, hd)); cs.heights.set(4, 30);
  let ac = 0;
  d.clientes.forEach((g, j) => {
    const R = 5 + j, z = j % 2 ? 'zebra' : 'none', b = { fill: z, border: 'thin' }; ac += g.valor;
    const cl = ac - g.valor < 0.8 * k.valor ? (ac - g.valor < 0.5 * k.valor ? 'A' : 'B') : 'C';
    cs.set(R, 1, j + 1, T({ ...b, h: 'center' })); cs.set(R, 2, g.nome, T(b)); cs.set(R, 3, cnpjFmt(g.cnpj), T({ ...b, h: 'center' }));
    cs.set(R, 4, g.n, T({ ...b, fmt: 'int', h: 'center' })); cs.set(R, 5, g.valor, T({ ...b, fmt: 'money' }));
    cs.set(R, 6, g.valor / g.n, T({ ...b, fmt: 'money' }), `E${R}/D${R}`); cs.set(R, 7, g.valor / k.valor, T({ ...b, fmt: 'pct', h: 'center' }), `E${R}/E$${5 + d.clientes.length}`);
    cs.set(R, 8, cl, T({ font: 'b', fill: cl === 'A' ? 'green' : cl === 'B' ? 'yellow' : 'blue', border: 'thin', h: 'center' }));
  });
  const ct = 5 + d.clientes.length; for (let c = 1; c <= 8; c++) cs.set(ct, c, null, T(tst));
  cs.set(ct, 2, 'Total', T(tst)); cs.set(ct, 4, k.n, T({ ...tst, fmt: 'int', h: 'center' }), `SUM(D5:D${ct - 1})`);
  cs.set(ct, 5, k.valor, T({ ...tst, fmt: 'money' }), `SUM(E5:E${ct - 1})`); cs.set(ct, 6, k.ticket, T({ ...tst, fmt: 'money' }), `E${ct}/D${ct}`);
  cs.set(ct, 7, 1, T({ ...tst, fmt: 'pct', h: 'center' }), `SUM(G5:G${ct - 1})`);
  cs.set(ct + 2, 1, 'Classe A = clientes que somam até 50% do valor; B = até 80%; C = restante.', T({ font: 'note' })).merge(ct + 2, 1, ct + 2, 8);
  cs.freeze = [4, 2]; cs.filter = `A4:H${ct - 1}`; cs.bars.push({ sqref: `E5:E${ct - 1}`, color: '9DB9DE' });

  // ===== 4. Histórico =====
  return { wb, rodape, sub, T, hd, tst };
}

// Aba de histórico recebe linhas do banco; separada para não carregar tudo quando não precisa.
function xlsxCompleto(db, d, usuario) {
  const { wb, rodape, sub, T, hd } = gerarXlsx(d, usuario);
  const hs = wb.sheet('Histórico', { tab: '7F8C8D', footer: rodape });
  hs.widths = [18, 14, 20, 52];
  hs.set(1, 1, 'Trilha de auditoria — movimentações', T({ font: 'title' })).merge(1, 1, 1, 4); hs.heights.set(1, 30);
  hs.set(2, 1, sub, T({ font: 'sub' })).merge(2, 1, 2, 4);
  ['Data e hora', 'Processo', 'Usuário', 'Ação'].forEach((t, i) => hs.set(4, i + 1, t, hd)); hs.heights.set(4, 28);
  const linhas = db.prepare(`SELECT x.quando, p.numero, x.usuario, x.acao FROM historico x JOIN processos p ON p.id=x.processo_id
    WHERE p.data_abertura>=? ORDER BY x.quando DESC, x.id DESC`).all(d.desde);
  linhas.forEach((l, j) => {
    const R = 5 + j, b = { fill: j % 2 ? 'zebra' : 'none', border: 'thin' };
    hs.set(R, 1, l.quando.split(/[ T]/)[0].split('-').reverse().join('/') + ' ' + l.quando.slice(11, 16), T({ ...b, h: 'center' }));
    hs.set(R, 2, l.numero, T({ ...b, h: 'center' })); hs.set(R, 3, l.usuario, T(b)); hs.set(R, 4, l.acao, T(b));
  });
  hs.freeze = [4, 0]; hs.filter = `A4:D${4 + Math.max(linhas.length, 1)}`; hs.printTitleRow = 4;
  return wb.build();
}

module.exports = { dados, xlsxCompleto, colunas, barras, rosca, brl, curto, num, cnpjFmt, h, STATUS, COR, PALETA };
