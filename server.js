// Protótipo ETAPA 1 — Node.js puro (sem npm install). Requer Node 22.5+.  Rodar: node server.js
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const A = require('./analytics');

const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1'; // use HOST=0.0.0.0 para liberar a rede local
const ABAS = ['COMPRAS', 'COMPRADO', 'ENVIADO'];
const CATEGORIAS = ['Tecnologia da Informação', 'Mobiliário', 'Material de Escritório', 'Embalagens e Logística', 'Manutenção e EPI', 'Serviços'];
const DB_FILE = path.join(__dirname, 'dados.sqlite');
const novo = !fs.existsSync(DB_FILE);
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');

// ---------- utilidades ----------
const hash = (s) => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(s, salt, 32).toString('hex'); };
const confere = (s, h) => {
  const [salt, k] = (h || '00:00').split(':'); const a = crypto.scryptSync(s, Buffer.from(salt, 'hex'), 32), b = Buffer.from(k, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (s) => s.slice(0, 10).split('-').reverse().join('/');
const dataHoraBR = (s) => dataBR(s) + ' ' + s.slice(11, 16);
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

function cnpjDig(b) {
  const pesos = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const r = pesos.reduce((s, p, i) => s + +b[i] * p, 0) % 11; return String(r < 2 ? 0 : 11 - r);
}
const cnpjCompleto = (b12) => { const b = b12 + cnpjDig(b12); return b + cnpjDig(b); };
const cnpjValido = (c) => /^\d{14}$/.test(c) && !/^(\d)\1{13}$/.test(c) && c === cnpjCompleto(c.slice(0, 12));
const cnpjFmt = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const unico = (e) => /UNIQUE/.test(e.message);

// ---------- banco ----------
if (novo) {
  db.exec(`
  CREATE TABLE usuarios(id INTEGER PRIMARY KEY, nome TEXT NOT NULL, login TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL,
    perfil TEXT NOT NULL CHECK(perfil IN('administrador','operador')), ativo INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE empresas(id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE);
  CREATE TABLE clientes(id INTEGER PRIMARY KEY, razao_social TEXT NOT NULL, cnpj TEXT NOT NULL UNIQUE, contato TEXT, telefone TEXT, email TEXT, endereco TEXT);
  CREATE TABLE processos(id INTEGER PRIMARY KEY, numero TEXT NOT NULL UNIQUE, cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id), descricao TEXT NOT NULL, categoria TEXT NOT NULL DEFAULT 'Outros', valor REAL NOT NULL CHECK(valor>=0),
    data_abertura TEXT NOT NULL, observacoes TEXT, status TEXT NOT NULL DEFAULT 'COMPRAS' CHECK(status IN('COMPRAS','COMPRADO','ENVIADO')));
  CREATE TABLE historico(id INTEGER PRIMARY KEY, processo_id INTEGER NOT NULL REFERENCES processos(id), usuario TEXT NOT NULL,
    acao TEXT NOT NULL, quando TEXT NOT NULL DEFAULT(datetime('now','localtime')));
  CREATE INDEX ix_proc_status ON processos(status);`);
  // DADOS FICTÍCIOS (gerados de forma determinística) — troque as senhas no primeiro acesso
  let sd = 20260; const rnd = () => (sd = (sd * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length)], between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const addDias = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const hora = () => `${String(between(8, 17)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:00`;
  const u = db.prepare('INSERT INTO usuarios(nome,login,senha_hash,perfil) VALUES(?,?,?,?)');
  u.run('Administrador', 'admin', hash('admin123'), 'administrador'); u.run('Operador Demo', 'operador', hash('operador123'), 'operador');
  u.run('Carla Mendes', 'carla', hash('operador123'), 'operador'); u.run('Rafael Torres', 'rafael', hash('operador123'), 'operador');
  const NOMES = ['Administrador', 'Operador Demo', 'Carla Mendes', 'Rafael Torres'];
  ['Empresa Alfa Ltda', 'Empresa Beta Comércio', 'Gama Distribuidora', 'Delta Serviços'].forEach((e) => db.prepare('INSERT INTO empresas(nome) VALUES(?)').run(e));
  const CLI = ['Agropecuária Vale Verde S/A', 'Indústria Metalúrgica Modelo Ltda', 'Comercial Teste ME', 'Cooperativa Horizonte', 'Transportadora Rota Sul Ltda', 'Supermercados Bom Preço',
    'Clínica Saúde Integral', 'Construtora Alicerce S/A', 'Distribuidora Norte Paraná', 'Laticínios Campo Belo', 'Escola Futuro Brilhante', 'Hotel Vista Mar', 'Farmácia Vida Plena', 'Tecnologia Pixel Soft'];
  const CONT = ['Maria Souza', 'João Lima', 'Ana Costa', 'Pedro Alves', 'Juliana Prado', 'Carlos Nogueira', 'Fernanda Dias'], CID = ['Maringá', 'Londrina', 'Curitiba', 'Cascavel', 'Campo Mourão', 'Ponta Grossa'];
  CLI.forEach((r, i) => db.prepare('INSERT INTO clientes(razao_social,cnpj,contato,telefone,email,endereco) VALUES(?,?,?,?,?,?)')
    .run(r, cnpjCompleto(String(11222333 + i * 1234567).slice(0, 8) + String(i + 1).padStart(4, '0')), CONT[i % CONT.length], `(44) 9${between(1000, 9999)}-${between(1000, 9999)}`, `contato${i}@exemplo.com`, `Rua Fictícia, ${(i + 1) * 100} - ${CID[i % CID.length]}/PR`));
  // categoria, itens, preço unitário (mín, máx), quantidade (mín, máx), peso
  const CAT = [['Tecnologia da Informação', ['Notebooks corporativos', 'Monitores 24"', 'Switches gerenciáveis', 'Servidor de arquivos', 'Licenças de software'], 900, 6500, 2, 30, 3],
    ['Mobiliário', ['Cadeiras ergonômicas', 'Mesas de reunião', 'Estações de trabalho', 'Armários de aço'], 350, 2200, 4, 40, 2],
    ['Material de Escritório', ['Papel A4 (resmas)', 'Toner e cartuchos', 'Material de papelaria', 'Pastas e arquivos'], 25, 400, 20, 300, 3],
    ['Embalagens e Logística', ['Caixas de papelão', 'Filme stretch', 'Paletes PBR', 'Fita de arrumação'], 5, 120, 100, 2000, 3],
    ['Manutenção e EPI', ['Luvas e EPIs', 'Ferramentas manuais', 'Peças de reposição', 'Uniformes'], 15, 350, 30, 400, 2],
    ['Serviços', ['Consultoria técnica', 'Manutenção preventiva', 'Treinamento in company'], 1500, 9000, 1, 6, 1]];
  const pesos = CAT.flatMap((c, i) => Array(c[6]).fill(i));
  const hj = hoje(), obs = ['', '', 'Registro de demonstração.', 'Entrega urgente solicitada pelo cliente.', 'Cotação com 3 fornecedores anexada.', 'Aguardando aprovação da diretoria.'];
  const lista = Array.from({ length: 150 }, () => {
    const age = Math.floor(rnd() ** 1.2 * 365), c = CAT[pick(pesos)], item = pick(c[1]), qtd = between(c[4], c[5]), un = c[2] + rnd() * (c[3] - c[2]);
    const r = rnd(); let st = age > 45 ? (r < 0.92 ? 'ENVIADO' : r < 0.98 ? 'COMPRADO' : 'COMPRAS') : age > 15 ? (r < 0.55 ? 'ENVIADO' : r < 0.85 ? 'COMPRADO' : 'COMPRAS') : (r < 0.15 ? 'ENVIADO' : r < 0.45 ? 'COMPRADO' : 'COMPRAS');
    if (st === 'ENVIADO' && age < 3) st = 'COMPRADO'; if (st === 'COMPRADO' && age < 1) st = 'COMPRAS';
    let d1 = Math.min(between(1, 6), age), d2 = 0;
    if (st === 'ENVIADO') { d2 = Math.min(d1 + between(2, 9), age); if (d2 <= d1) d1 = d2 - 1; }
    return { abertura: addDias(hj, -age), cat: c[0], desc: c[0] === 'Serviços' ? item : `${item} (${qtd} un.)`, valor: Math.round(un * qtd * 100) / 100, st, d1, d2,
      cli: 1 + Math.floor(rnd() ** 1.8 * CLI.length), emp: 1 + Math.floor(rnd() * 4), obs: pick(obs) };
  }).sort((x, y) => x.abertura.localeCompare(y.abertura));
  const seq = {}; db.exec('BEGIN');
  for (const p of lista) {
    const ano = p.abertura.slice(0, 4); seq[ano] = (seq[ano] || 0) + 1;
    const pid = Number(db.prepare('INSERT INTO processos(numero,cliente_id,empresa_id,descricao,categoria,valor,data_abertura,observacoes,status) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(`${ano}-${String(seq[ano]).padStart(4, '0')}`, p.cli, p.emp, p.desc, p.cat, p.valor, p.abertura, p.obs, p.st).lastInsertRowid);
    const hist = db.prepare('INSERT INTO historico(processo_id,usuario,acao,quando) VALUES(?,?,?,?)');
    hist.run(pid, pick(NOMES), 'Processo criado em COMPRAS', `${p.abertura} ${hora()}`);
    if (p.st !== 'COMPRAS') hist.run(pid, pick(NOMES), 'Movido de COMPRAS para COMPRADO', `${addDias(p.abertura, p.d1)} ${hora()}`);
    if (p.st === 'ENVIADO') hist.run(pid, pick(NOMES), 'Movido de COMPRADO para ENVIADO', `${addDias(p.abertura, p.d2)} ${hora()}`);
  }
  db.exec('COMMIT');
}
const logProc = (pid, user, acao) => db.prepare('INSERT INTO historico(processo_id,usuario,acao) VALUES(?,?,?)').run(pid, user.nome, acao);

// ---------- layout ----------
const CSS = `*{box-sizing:border-box}body{font:15px system-ui,Segoe UI,Arial;margin:0;background:#f3f5f8;color:#1c2430}
nav{background:#1f3a5f;display:flex;gap:4px;align-items:center;padding:0 16px}nav a,nav span{color:#fff;padding:14px 12px;text-decoration:none}nav a:hover{background:#2c4d7c}.sp{flex:1}
main{max-width:none;margin:24px 0;padding:0 24px}h1{font-size:22px;margin:0 0 16px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 3px #0002;padding:18px;margin-bottom:16px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #e5e9ef}th{font-size:12px;text-transform:uppercase;color:#5a6779}
.btn,button{background:#1f3a5f;color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer;text-decoration:none;font-size:14px;display:inline-block}
.btn.s,button.s{background:#e5e9ef;color:#1c2430}.btn.g,button.g{background:#2e7d32}
label{display:block;font-size:13px;color:#5a6779;margin:10px 0 4px}input,select,textarea{width:100%;padding:8px;border:1px solid #c7ced8;border-radius:6px;font:inherit}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}@media(max-width:700px){.g2{grid-template-columns:1fr}}
.tabs{display:flex;gap:6px;margin-bottom:12px}.tabs a{padding:9px 18px;border-radius:6px 6px 0 0;background:#dde3ec;color:#1c2430;text-decoration:none}.tabs a.on{background:#fff;font-weight:600;box-shadow:0 -2px 0 #1f3a5f inset}
.badge{background:#1f3a5f;color:#fff;border-radius:10px;padding:1px 8px;font-size:12px;margin-left:6px}
.ok,.er{padding:10px 14px;border-radius:6px;margin-bottom:14px}.ok{background:#e3f4e5;color:#1b5e20}.er{background:#fde7e5;color:#8c1d18}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}.kpi{background:#fff;border-radius:8px;box-shadow:0 1px 3px #0002;padding:14px 16px;border-top:3px solid #1f3a5f}.kpi small{display:block;color:#5a6779;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.kpi b{font-size:22px;color:#1f3a5f}.kpi i{display:block;font-style:normal;font-size:12px;color:#5a6779;margin-top:2px}
.pg{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pg .w{grid-column:1/-1}@media(max-width:800px){.pg{grid-template-columns:1fr}}.card h3{margin:0 0 10px;font-size:15px;color:#1f3a5f}
.chip{padding:6px 12px;border-radius:16px;background:#dde3ec;color:#1c2430;text-decoration:none;font-size:13px}.chip.on{background:#1f3a5f;color:#fff}.num{text-align:right}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}form.in{display:inline}`;

function layout(s, titulo, corpo) {
  const u = s.u, f = s.flash; delete s.flash; let menu = '';
  if (u) {
    const links = { painel: 'Painel', processos: 'Processos', clientes: 'Clientes', ...(u.perfil === 'administrador' && { empresas: 'Empresas', usuarios: 'Usuários' }) };
    menu = Object.entries(links).map(([k, v]) => `<a href="?p=${k}">${v}</a>`).join('') + `<span class="sp"></span><span>${h(u.nome)} (${h(u.perfil)})</span><a href="?p=sair">Sair</a>`;
  }
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(titulo)} · Controle de Processos</title><style>${CSS}</style></head><body><nav>${menu}</nav><main>${f ? `<div class="${f[1] === 'ok' ? 'ok' : 'er'}">${h(f[0])}</div>` : ''}${corpo}</main></body></html>`;
}

// ---------- servidor ----------
const sessions = new Map();
class Redirect { constructor(to) { this.to = to; } }
class Status { constructor(code, msg) { this.code = code; this.msg = msg; } }
const ir = (p) => { throw new Redirect('?p=' + p); };

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x'); const q = url.searchParams;
    const post = req.method === 'POST' ? new URLSearchParams(body) : null;
    const cookie = /sid=([a-f0-9]{48})/.exec(req.headers.cookie || ''); let sid = cookie?.[1];
    if (!sid || !sessions.has(sid)) { sid = crypto.randomBytes(24).toString('hex'); sessions.set(sid, { csrf: crypto.randomBytes(16).toString('hex') }); }
    const s = sessions.get(sid);
    try {
      const html = rota(s, q, post, sid);
      if (typeof html === 'object') { res.writeHead(200, { 'Content-Type': html.type, 'Content-Disposition': `attachment; filename="${html.nome}"`, 'Content-Length': html.buf.length }); return res.end(html.buf); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/`, 'X-Frame-Options': 'DENY' });
      res.end(html);
    } catch (e) {
      if (e instanceof Redirect) { res.writeHead(302, { Location: e.to, 'Set-Cookie': `sid=${e.sid || sid}; HttpOnly; SameSite=Strict; Path=/` }); res.end(); }
      else if (e instanceof Status) { res.writeHead(e.code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(e.msg); }
      else { console.error(e); res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Erro interno.'); }
    }
  });
});

function rota(s, q, post, sid) {
  const p = q.get('p') || 'painel', id = +q.get('id') || 0;
  const campo = () => `<input type="hidden" name="csrf" value="${s.csrf}">`;
  const f = (k) => (post.get(k) ?? '').trim();
  const flash = (m, t = 'ok') => { s.flash = [m, t]; };
  const csrfOk = () => { const a = Buffer.from(post.get('csrf') || ''), b = Buffer.from(s.csrf); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Status(400, 'Requisição inválida (CSRF).'); };

  if (p === 'sair') { sessions.delete(sid); ir('login'); }
  if (p === 'login') {
    if (post) {
      csrfOk();
      const r = db.prepare('SELECT * FROM usuarios WHERE login=? AND ativo=1').get(f('login'));
      const ok = confere(post.get('senha') || '', r?.senha_hash) && r; // hash sempre calculado (evita enumeração por tempo)
      if (ok) { sessions.delete(sid); const n = crypto.randomBytes(24).toString('hex'); sessions.set(n, { csrf: s.csrf, u: { id: r.id, nome: r.nome, perfil: r.perfil } }); sid = n; throw Object.assign(new Redirect('?p=painel'), { sid: n }); }
      flash('Usuário ou senha inválidos.', 'er');
    }
    return layout(s, 'Entrar', `<div class="card" style="max-width:360px;margin:60px auto"><h1>Controle de Processos</h1><form method="post">${campo()}<label>Usuário</label><input name="login" required autofocus><label>Senha</label><input type="password" name="senha" required><p><button>Entrar</button></p></form></div>`);
  }
  if (!s.u) ir('login');
  if (post) csrfOk();
  const admin = () => { if (s.u.perfil !== 'administrador') throw new Status(403, 'Acesso restrito ao administrador.'); };
  const opt = (t, col, sel) => db.prepare(`SELECT id,${col} FROM ${t} ORDER BY ${col}`).all().map((x) => `<option value="${x.id}"${x.id == sel ? ' selected' : ''}>${h(x[col])}</option>`).join('');

  switch (p) {
    case 'exportar': {
      const m = [3, 6, 12].includes(+q.get('meses')) ? +q.get('meses') : 0, d = A.dados(db, m);
      return { buf: A.xlsxCompleto(db, d, s.u.nome), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nome: `Relatorio_Processos_${hoje()}.xlsx` };
    }
    case 'painel': {
      const m = [3, 6, 12].includes(+q.get('meses')) ? +q.get('meses') : 12, d = A.dados(db, m), k = d.kpi;
      const chips = [[3, '3 meses'], [6, '6 meses'], [12, '12 meses'], [0, 'Tudo']].map(([v, t]) => `<a class="chip${v === m ? ' on' : ''}" href="?p=painel&meses=${v}">${t}</a>`).join(' ');
      const kp = (t, v, sub = '') => `<div class="kpi"><small>${t}</small><b>${v}</b><i>${sub || '&nbsp;'}</i></div>`;
      const linhasAnt = d.antigos.map((r) => `<tr><td><a href="?p=proc_ver&id=${r.id}">${h(r.numero)}</a></td><td>${h(r.cliente)}</td><td>${h(r.descricao)}</td><td>${h(r.status)}</td><td class="num">${A.brl(r.valor)}</td><td class="num">${r.idade} dias</td></tr>`).join('');
      return layout(s, 'Painel', `<div class="top"><h1>Painel gerencial</h1><a class="btn g" href="?p=exportar&meses=${m}">⬇ Exportar Excel</a></div>
<p style="margin:0 0 14px">${chips} <span style="color:#5a6779;font-size:13px;margin-left:8px">${h(d.periodo)}</span></p>
<div class="kpis">${kp('Processos', k.n, `${k.porStatus.ENVIADO.n} enviados`)}${kp('Valor total', A.curto(k.valor), A.brl(k.valor))}${kp('Ticket médio', A.curto(k.ticket))}
${kp('Em aberto', k.abertos, A.curto(k.valorAberto))}${kp('Lead time médio', A.num(k.leadMedio) + ' d', 'abertura → envio')}${kp('Taxa de conclusão', A.num(k.taxa * 100, 0) + '%')}</div>
<div class="pg"><div class="card w"><h3>Valor aberto por mês</h3>${A.colunas(d.mensal)}</div>
<div class="card"><h3>Situação dos processos</h3>${A.rosca(A.STATUS.map((st) => ({ nome: st, ...k.porStatus[st], cor: A.COR[st] })))}</div>
<div class="card"><h3>Envelhecimento dos processos em aberto</h3>${A.barras(d.aging, (v) => A.curto(v), '#e0a800')}</div>
<div class="card"><h3>Top clientes por valor</h3>${A.barras(d.clientes.slice(0, 7))}</div>
<div class="card"><h3>Valor por categoria</h3>${A.barras(d.categorias, A.curto, '#2e7d32')}</div>
<div class="card w"><h3>Por empresa</h3>${A.rosca(d.empresas.map((e, i) => ({ ...e, cor: A.PALETA[i % A.PALETA.length] })))}</div>
<div class="card w"><h3>Processos em aberto mais antigos</h3><table><tr><th>Nº</th><th>Cliente</th><th>Descrição</th><th>Status</th><th class="num">Valor</th><th class="num">Idade</th></tr>${linhasAnt || '<tr><td colspan="6">Nenhum processo em aberto.</td></tr>'}</table></div></div>`);
    }
    case 'processos': {
      const aba = ABAS.includes(q.get('aba')) ? q.get('aba') : 'COMPRAS', busca = (q.get('q') || '').trim(), l = `%${busca}%`;
      const cont = Object.fromEntries(db.prepare('SELECT status,COUNT(*) n FROM processos GROUP BY status').all().map((r) => [r.status, r.n]));
      const rows = db.prepare(`SELECT p.*,c.razao_social,e.nome empresa FROM processos p JOIN clientes c ON c.id=p.cliente_id JOIN empresas e ON e.id=p.empresa_id
        WHERE p.status=? AND (?='' OR p.numero LIKE ? OR p.descricao LIKE ? OR c.razao_social LIKE ?) ORDER BY p.id DESC`).all(aba, busca, l, l, l);
      const tabs = ABAS.map((a) => `<a class="${a === aba ? 'on' : ''}" href="?p=processos&aba=${a}">${a}<span class="badge">${cont[a] || 0}</span></a>`).join('');
      const linhas = rows.map((r) => `<tr><td><a href="?p=proc_ver&id=${r.id}">${h(r.numero)}</a></td><td>${h(r.razao_social)}</td><td>${h(r.empresa)}</td><td>${h(r.descricao)}</td><td>${brl(r.valor)}</td><td>${dataBR(r.data_abertura)}</td></tr>`).join('');
      return layout(s, 'Processos', `<div class="top"><h1>Processos</h1><span><a class="btn s" href="?p=exportar&meses=0">⬇ Exportar Excel</a> <a class="btn" href="?p=proc_form">+ Novo processo</a></span></div>
<form class="top" method="get" style="justify-content:flex-start;gap:8px"><input type="hidden" name="p" value="processos"><input type="hidden" name="aba" value="${h(aba)}"><input name="q" placeholder="Buscar por número, cliente ou descrição" value="${h(busca)}" style="max-width:380px"><button class="s">Buscar</button></form>
<div class="tabs">${tabs}</div><div class="card"><table><tr><th>Nº</th><th>Cliente</th><th>Empresa</th><th>Descrição</th><th>Valor</th><th>Abertura</th></tr>${linhas || '<tr><td colspan="6">Nenhum processo nesta aba.</td></tr>'}</table></div>`);
    }
    case 'proc_form': {
      let r = { numero: '', cliente_id: '', empresa_id: '', descricao: '', categoria: CATEGORIAS[0], valor: '', data_abertura: hoje(), observacoes: '' };
      if (id) r = db.prepare('SELECT * FROM processos WHERE id=?').get(id) || ir('processos');
      if (post) {
        const v = { numero: f('numero'), cliente_id: +f('cliente_id'), empresa_id: +f('empresa_id'), descricao: f('descricao'), categoria: CATEGORIAS.includes(f('categoria')) ? f('categoria') : 'Outros',
          valor: Number(f('valor').replace(/\./g, '').replace(',', '.')), data_abertura: f('data_abertura'), observacoes: f('observacoes') };
        const dt = new Date(v.data_abertura + 'T00:00:00Z');
        const erro = !v.numero || v.numero.length > 30 ? 'Informe o número do processo (máx. 30 caracteres).'
          : !v.cliente_id || !v.empresa_id ? 'Selecione cliente e empresa.'
          : !v.descricao || v.descricao.length > 500 ? 'Descrição obrigatória (máx. 500 caracteres).'
          : !(v.valor >= 0) ? 'Valor inválido.'
          : isNaN(dt) || dt.toISOString().slice(0, 10) !== v.data_abertura ? 'Data inválida.' : '';
        let msg = erro, novoId = id;
        if (!erro) try {
          const vals = Object.values(v);
          if (id) { db.prepare('UPDATE processos SET numero=?,cliente_id=?,empresa_id=?,descricao=?,categoria=?,valor=?,data_abertura=?,observacoes=? WHERE id=?').run(...vals, id); logProc(id, s.u, 'Dados do processo editados'); }
          else { const i = db.prepare('INSERT INTO processos(numero,cliente_id,empresa_id,descricao,categoria,valor,data_abertura,observacoes) VALUES(?,?,?,?,?,?,?,?)').run(...vals); novoId = Number(i.lastInsertRowid); logProc(novoId, s.u, 'Processo criado em COMPRAS'); }
          flash('Processo salvo.'); ir('proc_ver&id=' + novoId);
        } catch (e) { if (e instanceof Redirect) throw e; msg = unico(e) ? 'Já existe um processo com esse número.' : 'Erro ao salvar.'; }
        flash(msg, 'er'); r = v;
      }
      return layout(s, 'Processo', `<h1>${id ? 'Editar' : 'Novo'} processo</h1><form class="card" method="post">${campo()}<div class="g2">
<div><label>Número de identificação</label><input name="numero" required maxlength="30" value="${h(r.numero)}"></div>
<div><label>Data de abertura</label><input type="date" name="data_abertura" required value="${h(r.data_abertura)}"></div>
<div><label>Cliente</label><select name="cliente_id" required><option value="">Selecione</option>${opt('clientes', 'razao_social', r.cliente_id)}</select></div>
<div><label>Empresa</label><select name="empresa_id" required><option value="">Selecione</option>${opt('empresas', 'nome', r.empresa_id)}</select></div></div>
<label>Categoria</label><select name="categoria">${[...CATEGORIAS, 'Outros'].map((c) => `<option${c === r.categoria ? ' selected' : ''}>${h(c)}</option>`).join('')}</select>
<label>Descrição</label><textarea name="descricao" required maxlength="500" rows="3">${h(r.descricao)}</textarea>
<label>Valor (R$)</label><input name="valor" required inputmode="decimal" placeholder="1.500,00" value="${r.valor === '' || isNaN(r.valor) ? '' : h(Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))}">
<label>Observações</label><textarea name="observacoes" rows="3">${h(r.observacoes)}</textarea>
<p><button>Salvar</button> <a class="btn s" href="?p=processos">Cancelar</a></p></form>`);
    }
    case 'proc_ver': {
      const r = db.prepare('SELECT p.*,c.razao_social,c.cnpj,e.nome empresa FROM processos p JOIN clientes c ON c.id=p.cliente_id JOIN empresas e ON e.id=p.empresa_id WHERE p.id=?').get(id) || ir('processos');
      if (post) {
        const para = f('para');
        if (ABAS.includes(para) && para !== r.status) { db.prepare('UPDATE processos SET status=? WHERE id=?').run(para, id); logProc(id, s.u, `Movido de ${r.status} para ${para}`); flash(`Processo movido para ${para}.`); }
        ir('proc_ver&id=' + id);
      }
      const btn = ABAS.filter((a) => a !== r.status).map((a) => `<form class="in" method="post">${campo()}<input type="hidden" name="para" value="${a}"><button class="g">Mover para ${a}</button></form> `).join('');
      const hist = db.prepare('SELECT * FROM historico WHERE processo_id=? ORDER BY id DESC').all(id).map((x) => `<tr><td>${dataHoraBR(x.quando)}</td><td>${h(x.usuario)}</td><td>${h(x.acao)}</td></tr>`).join('');
      return layout(s, 'Processo ' + r.numero, `<div class="top"><h1>Processo ${h(r.numero)} <span class="badge">${h(r.status)}</span></h1><a class="btn s" href="?p=processos&aba=${h(r.status)}">Voltar</a></div>
<div class="card"><div class="g2"><div><b>Cliente:</b> ${h(r.razao_social)} (${cnpjFmt(r.cnpj)})</div><div><b>Empresa:</b> ${h(r.empresa)}</div><div><b>Valor:</b> ${brl(r.valor)}</div><div><b>Abertura:</b> ${dataBR(r.data_abertura)}</div></div>
<p><b>Descrição:</b> ${h(r.descricao).replace(/\n/g, '<br>')}</p><p><b>Observações:</b> ${h(r.observacoes).replace(/\n/g, '<br>')}</p><p>${btn}<a class="btn" href="?p=proc_form&id=${id}">Editar dados</a></p></div>
<div class="card"><h3 style="margin-top:0">Histórico</h3><table><tr><th>Quando</th><th>Quem</th><th>O que aconteceu</th></tr>${hist}</table></div>`);
    }
    case 'clientes': {
      const linhas = db.prepare('SELECT * FROM clientes ORDER BY razao_social').all().map((r) => `<tr><td>${h(r.razao_social)}</td><td>${cnpjFmt(r.cnpj)}</td><td>${h(r.contato)}</td><td>${h(r.telefone)}</td><td><a href="?p=cli_form&id=${r.id}">Editar</a></td></tr>`).join('');
      return layout(s, 'Clientes', `<div class="top"><h1>Clientes</h1><a class="btn" href="?p=cli_form">+ Novo cliente</a></div><div class="card"><table><tr><th>Razão social</th><th>CNPJ</th><th>Contato</th><th>Telefone</th><th></th></tr>${linhas}</table></div>`);
    }
    case 'cli_form': {
      let r = { razao_social: '', cnpj: '', contato: '', telefone: '', email: '', endereco: '' };
      if (id) r = db.prepare('SELECT * FROM clientes WHERE id=?').get(id) || ir('clientes');
      if (post) {
        const v = { razao_social: f('razao_social'), cnpj: f('cnpj').replace(/\D/g, ''), contato: f('contato'), telefone: f('telefone'), email: f('email'), endereco: f('endereco') };
        let msg = !v.razao_social || v.razao_social.length > 150 ? 'Razão social obrigatória (máx. 150).' : !cnpjValido(v.cnpj) ? 'CNPJ inválido.'
          : v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ? 'E-mail inválido.' : '';
        if (!msg) try {
          const vals = Object.values(v);
          if (id) db.prepare('UPDATE clientes SET razao_social=?,cnpj=?,contato=?,telefone=?,email=?,endereco=? WHERE id=?').run(...vals, id);
          else db.prepare('INSERT INTO clientes(razao_social,cnpj,contato,telefone,email,endereco) VALUES(?,?,?,?,?,?)').run(...vals);
          flash('Cliente salvo.'); ir('clientes');
        } catch (e) { if (e instanceof Redirect) throw e; msg = unico(e) ? 'CNPJ já cadastrado.' : 'Erro ao salvar.'; }
        flash(msg, 'er'); r = v;
      }
      const inp = (n, l, extra = '') => `<div><label>${l}</label><input name="${n}" ${extra} value="${h(n === 'cnpj' && r.cnpj.length === 14 ? cnpjFmt(r.cnpj) : r[n])}"></div>`;
      return layout(s, 'Cliente', `<h1>${id ? 'Editar' : 'Novo'} cliente</h1><form class="card" method="post">${campo()}<div class="g2">${inp('razao_social', 'Razão social', 'required maxlength="150"')}${inp('cnpj', 'CNPJ', 'required placeholder="00.000.000/0000-00"')}${inp('contato', 'Contato', 'maxlength="100"')}${inp('telefone', 'Telefone', 'maxlength="30"')}${inp('email', 'E-mail', 'type="email" maxlength="120"')}${inp('endereco', 'Endereço', 'maxlength="200"')}</div><p><button>Salvar</button> <a class="btn s" href="?p=clientes">Cancelar</a></p></form>`);
    }
    case 'empresas': {
      admin();
      if (post) {
        const n = f('nome');
        if (!n || n.length > 100) flash('Nome inválido.', 'er');
        else try { db.prepare('INSERT INTO empresas(nome) VALUES(?)').run(n); flash('Empresa cadastrada.'); } catch { flash('Empresa já cadastrada.', 'er'); }
        ir('empresas');
      }
      const linhas = db.prepare('SELECT * FROM empresas ORDER BY nome').all().map((r) => `<tr><td>${h(r.nome)}</td></tr>`).join('');
      return layout(s, 'Empresas', `<h1>Empresas</h1><form class="card" method="post">${campo()}<label>Nova empresa</label><input name="nome" required maxlength="100"><p><button>Adicionar</button></p></form><div class="card"><table><tr><th>Nome</th></tr>${linhas}</table></div>`);
    }
    case 'usuarios': {
      admin();
      if (post) {
        const acao = f('acao'), uid = +f('uid'), senha = post.get('senha') || '';
        if (acao === 'novo') {
          const nome = f('nome'), login = f('login'), perfil = f('perfil');
          if (!nome || !/^[a-z0-9._-]{3,30}$/i.test(login) || senha.length < 8 || !['administrador', 'operador'].includes(perfil)) flash('Dados inválidos (login 3-30 caracteres, senha mínima de 8).', 'er');
          else try { db.prepare('INSERT INTO usuarios(nome,login,senha_hash,perfil) VALUES(?,?,?,?)').run(nome, login, hash(senha), perfil); flash('Usuário criado.'); } catch { flash('Login já existe.', 'er'); }
        } else if (acao === 'senha' && senha.length >= 8) { db.prepare('UPDATE usuarios SET senha_hash=? WHERE id=?').run(hash(senha), uid); flash('Senha alterada.'); }
        else if (acao === 'ativo' && uid !== s.u.id) { db.prepare('UPDATE usuarios SET ativo=1-ativo WHERE id=?').run(uid); flash('Situação alterada.'); }
        else flash('Ação não permitida.', 'er');
        ir('usuarios');
      }
      const linhas = db.prepare('SELECT * FROM usuarios ORDER BY nome').all().map((r) => `<tr><td>${h(r.nome)}</td><td>${h(r.login)}</td><td>${h(r.perfil)}</td><td>${r.ativo ? 'Ativo' : 'Inativo'}</td><td>
<form class="in" method="post">${campo()}<input type="hidden" name="acao" value="ativo"><input type="hidden" name="uid" value="${r.id}"><button class="s">${r.ativo ? 'Desativar' : 'Ativar'}</button></form>
<form class="in" method="post">${campo()}<input type="hidden" name="acao" value="senha"><input type="hidden" name="uid" value="${r.id}"><input type="password" name="senha" placeholder="nova senha" minlength="8" style="width:130px"><button class="s">Trocar</button></form></td></tr>`).join('');
      return layout(s, 'Usuários', `<h1>Usuários</h1><form class="card" method="post">${campo()}<input type="hidden" name="acao" value="novo"><div class="g2">
<div><label>Nome</label><input name="nome" required maxlength="100"></div><div><label>Login</label><input name="login" required maxlength="30"></div>
<div><label>Senha (mín. 8)</label><input type="password" name="senha" required minlength="8"></div>
<div><label>Perfil</label><select name="perfil"><option value="operador">Operador</option><option value="administrador">Administrador</option></select></div></div><p><button>Criar usuário</button></p></form>
<div class="card"><table><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th></th></tr>${linhas}</table></div>`);
    }
    default: ir('painel');
  }
}

server.listen(PORT, HOST, () => console.log(`Sistema rodando em http://${HOST}:${PORT}  (Ctrl+C para parar)`));
