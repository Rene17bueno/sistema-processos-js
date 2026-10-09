// Controle de Processos — versão online (site estático + Supabase). Sem build: abre direto no GitHub Pages.
'use strict';
const A = window.Analytics, h = A.h;
const db = supabase.createClient(SUPABASE.url, SUPABASE.key);
const ABAS = ['COMPRAS', 'COMPRADO', 'ENVIADO'];
const CATEGORIAS = ['Tecnologia da Informação', 'Mobiliário', 'Material de Escritório', 'Embalagens e Logística', 'Manutenção e EPI', 'Serviços', 'Outros'];
const S = { user: null, flash: null };
const root = document.getElementById('app');

// ---------- utilidades ----------
const dataBR = (s) => String(s).slice(0, 10).split('-').reverse().join('/');
const dataHoraBR = (q) => new Date(q).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).replace(',', '');
const localIso = (q) => new Date(q).toLocaleString('sv-SE'); // AAAA-MM-DD HH:MM:SS no fuso do navegador
const hojeISO = () => A.hoje();
const go = (p) => { location.hash = '#/' + p; };
const flash = (m, t = 'ok') => { S.flash = [m, t]; };
const brl = A.brl;

function cnpjDig(b) {
  const pesos = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const r = pesos.reduce((s, p, i) => s + +b[i] * p, 0) % 11; return String(r < 2 ? 0 : 11 - r);
}
const cnpjValido = (c) => { if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false; const b = c.slice(0, 12) + cnpjDig(c.slice(0, 12)); return c === b + cnpjDig(b); };

async function todas(tabela, sel, filtro) { // contorna o limite de 1000 linhas por requisição
  const out = [];
  for (let i = 0; ; i += 1000) {
    let q = db.from(tabela).select(sel).order('id').range(i, i + 999); if (filtro) q = filtro(q);
    const { data, error } = await q; if (error) throw error; out.push(...data); if (data.length < 1000) return out;
  }
}
async function carregaProcs() {
  const [ps, hs] = await Promise.all([todas('processos', '*, clientes(razao_social,cnpj), empresas(nome)'), todas('historico', 'processo_id, quando', (q) => q.like('acao', '% para ENVIADO'))]);
  const fim = {}; for (const x of hs) { const d = localIso(x.quando); if (!fim[x.processo_id] || d > fim[x.processo_id]) fim[x.processo_id] = d; }
  return ps.map((p) => ({ ...p, cliente: p.clientes.razao_social, cnpj: p.clientes.cnpj, empresa: p.empresas.nome, conclusao: fim[p.id] || null }));
}

function layout(corpo) {
  const u = S.user, f = S.flash; S.flash = null;
  const atual = (location.hash.split(/[/?]/)[1] || 'painel');
  const links = [['painel', 'Painel'], ['processos', 'Processos'], ['clientes', 'Clientes'], ...(u.perfil === 'administrador' ? [['empresas', 'Empresas'], ['usuarios', 'Usuários']] : [])];
  return `<nav>${links.map(([k, v]) => `<a class="${atual.startsWith(k.slice(0, 5)) ? 'on' : ''}" href="#/${k}">${v}</a>`).join('')}<span class="sp"></span><span>${h(u.nome)} (${h(u.perfil)})</span><a href="#/sair">Sair</a></nav>
<main>${f ? `<div class="${f[1] === 'ok' ? 'ok' : 'er'}">${h(f[0])}</div>` : ''}${corpo}</main>`;
}
const erroMsg = (e) => (e && e.code === '23505' ? 'Já existe um registro com esse valor único (número ou CNPJ).' : e && e.code === '42501' ? 'Sem permissão para esta ação.' : 'Erro ao salvar: ' + (e?.message || e));

// ---------- telas ----------
function telaLogin() {
  return { html: `<div class="card" style="max-width:380px;margin:60px auto"><h1>Controle de Processos</h1><div id="msg"></div>
<form id="f"><label>E-mail</label><input type="email" name="email" required autofocus autocomplete="username"><label>Senha</label><input type="password" name="senha" required autocomplete="current-password"><p><button>Entrar</button></p></form></div>`,
  bind() {
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault(); const fd = new FormData(ev.target), b = ev.target.querySelector('button'); b.disabled = true;
      const { error } = await db.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('senha') });
      if (error) { b.disabled = false; document.getElementById('msg').innerHTML = '<div class="er">E-mail ou senha inválidos.</div>'; } else { S.user = null; go('painel'); render(); }
    };
  } };
}

async function telaPainel(q) {
  const m = ['3', '6', '12', '0'].includes(q.get('meses')) ? +q.get('meses') : 12, procs = await carregaProcs(), d = A.calcular(procs, m), k = d.kpi;
  const chips = [[3, '3 meses'], [6, '6 meses'], [12, '12 meses'], [0, 'Tudo']].map(([v, t]) => `<a class="chip${v === m ? ' on' : ''}" href="#/painel?meses=${v}">${t}</a>`).join(' ');
  const kp = (t, v, sub = '') => `<div class="kpi"><small>${t}</small><b>${v}</b><i>${sub || '&nbsp;'}</i></div>`;
  const ant = d.antigos.map((r) => `<tr><td><a href="#/proc/${r.id}">${h(r.numero)}</a></td><td>${h(r.cliente)}</td><td>${h(r.descricao)}</td><td>${h(r.status)}</td><td class="num">${brl(r.valor)}</td><td class="num">${r.idade} dias</td></tr>`).join('');
  return { html: layout(`<div class="top"><h1>Painel gerencial</h1><button class="g" id="exp">⬇ Exportar Excel</button></div>
<p style="margin:0 0 14px">${chips} <span class="sub" style="margin-left:8px">${h(d.periodo)}</span></p>
<div class="kpis">${kp('Processos', k.n, `${k.porStatus.ENVIADO.n} enviados`)}${kp('Valor total', A.curto(k.valor), brl(k.valor))}${kp('Ticket médio', A.curto(k.ticket))}
${kp('Em aberto', k.abertos, A.curto(k.valorAberto))}${kp('Lead time médio', A.num(k.leadMedio) + ' d', 'abertura → envio')}${kp('Taxa de conclusão', A.num(k.taxa * 100, 0) + '%')}</div>
<div class="pg"><div class="card w"><h3>Valor aberto por mês</h3>${A.colunas(d.mensal)}</div>
<div class="card"><h3>Situação dos processos</h3>${A.rosca(A.STATUS.map((st) => ({ nome: st, ...k.porStatus[st], cor: A.COR[st] })))}</div>
<div class="card"><h3>Envelhecimento dos processos em aberto</h3>${A.barras(d.aging, A.curto, '#e0a800')}</div>
<div class="card"><h3>Top clientes por valor</h3>${A.barras(d.clientes.slice(0, 7))}</div>
<div class="card"><h3>Valor por categoria</h3>${A.barras(d.categorias, A.curto, '#2e7d32')}</div>
<div class="card w"><h3>Por empresa</h3>${A.rosca(d.empresas.map((e, i) => ({ ...e, cor: A.PALETA[i % A.PALETA.length] })))}</div>
<div class="card w"><h3>Processos em aberto mais antigos</h3><table><tr><th>Nº</th><th>Cliente</th><th>Descrição</th><th>Status</th><th class="num">Valor</th><th class="num">Idade</th></tr>${ant || '<tr><td colspan="6">Nenhum processo em aberto.</td></tr>'}</table></div></div>`),
  bind: () => { document.getElementById('exp').onclick = (ev) => exportar(ev.target, procs, m); } };
}

async function exportar(btn, procs, m) {
  btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Gerando…';
  try {
    const hs = await todas('historico', 'quando, usuario, acao, processos(numero)');
    const hist = hs.map((x) => ({ quando: localIso(x.quando).replace(' ', 'T'), numero: x.processos.numero, usuario: x.usuario, acao: x.acao }));
    const bytes = A.xlsxCompleto(A.calcular(procs, m), S.user.nome, hist);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: `Relatorio_Processos_${hojeISO()}.xlsx` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { alert('Falha ao gerar o Excel: ' + (e.message || e)); }
  btn.disabled = false; btn.textContent = txt;
}

async function telaProcessos(q) {
  const aba = ABAS.includes(q.get('aba')) ? q.get('aba') : 'COMPRAS', busca = (q.get('q') || '').trim().toLowerCase(), procs = await carregaProcs();
  const cont = Object.fromEntries(ABAS.map((a) => [a, procs.filter((p) => p.status === a).length]));
  const rows = procs.filter((p) => p.status === aba && (!busca || [p.numero, p.descricao, p.cliente].some((x) => x.toLowerCase().includes(busca)))).sort((a, b) => b.id - a.id);
  const tabs = ABAS.map((a) => `<a class="${a === aba ? 'on' : ''}" href="#/processos?aba=${a}">${a}<span class="badge">${cont[a]}</span></a>`).join('');
  const linhas = rows.map((r) => `<tr><td><a href="#/proc/${r.id}">${h(r.numero)}</a></td><td>${h(r.cliente)}</td><td>${h(r.empresa)}</td><td>${h(r.categoria)}</td><td>${h(r.descricao)}</td><td class="num">${brl(r.valor)}</td><td>${dataBR(r.data_abertura)}</td></tr>`).join('');
  return { html: layout(`<div class="top"><h1>Processos</h1><a class="btn" href="#/proc/novo">+ Novo processo</a></div>
<form class="top" id="busca" style="justify-content:flex-start;gap:8px"><input name="q" placeholder="Buscar por número, cliente ou descrição" value="${h(q.get('q') || '')}" style="max-width:380px"><button class="s">Buscar</button></form>
<div class="tabs">${tabs}</div><div class="card"><table><tr><th>Nº</th><th>Cliente</th><th>Empresa</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th><th>Abertura</th></tr>${linhas || '<tr><td colspan="7">Nenhum processo nesta aba.</td></tr>'}</table></div>`),
  bind: () => { document.getElementById('busca').onsubmit = (ev) => { ev.preventDefault(); go(`processos?aba=${aba}&q=${encodeURIComponent(new FormData(ev.target).get('q'))}`); }; } };
}

async function telaProcVer(id) {
  const { data: r, error } = await db.from('processos').select('*, clientes(razao_social,cnpj), empresas(nome)').eq('id', id).maybeSingle();
  if (error || !r) { go('processos'); return null; }
  const { data: hist } = await db.from('historico').select('*').eq('processo_id', id).order('quando', { ascending: false }).order('id', { ascending: false });
  const btn = ABAS.filter((a) => a !== r.status).map((a) => `<button class="g" data-para="${a}">Mover para ${a}</button> `).join('');
  const c = r.clientes.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return { html: layout(`<div class="top"><h1>Processo ${h(r.numero)} <span class="badge">${h(r.status)}</span></h1><a class="btn s" href="#/processos?aba=${r.status}">Voltar</a></div>
<div class="card"><div class="g2"><div><b>Cliente:</b> ${h(r.clientes.razao_social)} (${c})</div><div><b>Empresa:</b> ${h(r.empresas.nome)}</div><div><b>Valor:</b> ${brl(r.valor)}</div><div><b>Abertura:</b> ${dataBR(r.data_abertura)}</div><div><b>Categoria:</b> ${h(r.categoria)}</div></div>
<p><b>Descrição:</b> ${h(r.descricao).replace(/\n/g, '<br>')}</p><p><b>Observações:</b> ${h(r.observacoes).replace(/\n/g, '<br>')}</p><p>${btn}<a class="btn" href="#/proc/${id}/editar">Editar dados</a></p></div>
<div class="card"><h3>Histórico</h3><table><tr><th>Quando</th><th>Quem</th><th>O que aconteceu</th></tr>${(hist || []).map((x) => `<tr><td>${dataHoraBR(x.quando)}</td><td>${h(x.usuario)}</td><td>${h(x.acao)}</td></tr>`).join('')}</table></div>`),
  bind() {
    document.querySelectorAll('[data-para]').forEach((b) => { b.onclick = async () => {
      b.disabled = true; const { error: e } = await db.from('processos').update({ status: b.dataset.para }).eq('id', id);
      flash(e ? erroMsg(e) : `Processo movido para ${b.dataset.para}.`, e ? 'er' : 'ok'); render();
    }; });
  } };
}

async function telaProcForm(idParam) {
  const id = idParam === 'novo' ? 0 : +idParam;
  const [{ data: clientes }, { data: empresas }] = await Promise.all([db.from('clientes').select('id,razao_social').order('razao_social'), db.from('empresas').select('id,nome').order('nome')]);
  let r = { numero: '', cliente_id: '', empresa_id: '', descricao: '', categoria: CATEGORIAS[0], valor: '', data_abertura: hojeISO(), observacoes: '' };
  if (id) { const { data } = await db.from('processos').select('*').eq('id', id).maybeSingle(); if (!data) { go('processos'); return null; } r = data; }
  const opt = (l, col, sel) => l.map((x) => `<option value="${x.id}"${x.id == sel ? ' selected' : ''}>${h(x[col])}</option>`).join('');
  return { html: layout(`<h1>${id ? 'Editar' : 'Novo'} processo</h1><div id="msg"></div><form class="card" id="f"><div class="g2">
<div><label>Número de identificação</label><input name="numero" required maxlength="30" value="${h(r.numero)}"></div>
<div><label>Data de abertura</label><input type="date" name="data_abertura" required value="${h(r.data_abertura)}"></div>
<div><label>Cliente</label><select name="cliente_id" required><option value="">Selecione</option>${opt(clientes, 'razao_social', r.cliente_id)}</select></div>
<div><label>Empresa</label><select name="empresa_id" required><option value="">Selecione</option>${opt(empresas, 'nome', r.empresa_id)}</select></div></div>
<label>Categoria</label><select name="categoria">${CATEGORIAS.map((c) => `<option${c === r.categoria ? ' selected' : ''}>${h(c)}</option>`).join('')}</select>
<label>Descrição</label><textarea name="descricao" required maxlength="500" rows="3">${h(r.descricao)}</textarea>
<label>Valor (R$)</label><input name="valor" required inputmode="decimal" placeholder="1.500,00" value="${r.valor === '' ? '' : h(Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))}">
<label>Observações</label><textarea name="observacoes" rows="3">${h(r.observacoes)}</textarea>
<p><button>Salvar</button> <a class="btn s" href="#/processos">Cancelar</a></p></form>`),
  bind() {
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault(); const fd = new FormData(ev.target), g = (k) => (fd.get(k) || '').trim(), msg = document.getElementById('msg');
      const v = { numero: g('numero'), cliente_id: +g('cliente_id'), empresa_id: +g('empresa_id'), descricao: g('descricao'), categoria: g('categoria'),
        valor: Number(g('valor').replace(/\./g, '').replace(',', '.')), data_abertura: g('data_abertura'), observacoes: g('observacoes') };
      if (!(v.valor >= 0)) { msg.innerHTML = '<div class="er">Valor inválido.</div>'; return; }
      const b = ev.target.querySelector('button'); b.disabled = true;
      const { data, error } = id ? await db.from('processos').update(v).eq('id', id).select('id').single() : await db.from('processos').insert(v).select('id').single();
      if (error) { b.disabled = false; msg.innerHTML = `<div class="er">${h(erroMsg(error))}</div>`; return; }
      flash('Processo salvo.'); go('proc/' + data.id);
    };
  } };
}

async function telaClientes() {
  const { data } = await db.from('clientes').select('*').order('razao_social');
  const linhas = data.map((r) => `<tr><td>${h(r.razao_social)}</td><td>${A.cnpjFmt(r.cnpj)}</td><td>${h(r.contato)}</td><td>${h(r.telefone)}</td><td><a href="#/cliente/${r.id}">Editar</a></td></tr>`).join('');
  return { html: layout(`<div class="top"><h1>Clientes</h1><a class="btn" href="#/cliente/novo">+ Novo cliente</a></div><div class="card"><table><tr><th>Razão social</th><th>CNPJ</th><th>Contato</th><th>Telefone</th><th></th></tr>${linhas}</table></div>`) };
}

async function telaCliForm(idParam) {
  const id = idParam === 'novo' ? 0 : +idParam; let r = { razao_social: '', cnpj: '', contato: '', telefone: '', email: '', endereco: '' };
  if (id) { const { data } = await db.from('clientes').select('*').eq('id', id).maybeSingle(); if (!data) { go('clientes'); return null; } r = data; }
  const inp = (n, l, extra = '') => `<div><label>${l}</label><input name="${n}" ${extra} value="${h(n === 'cnpj' && r.cnpj.length === 14 ? A.cnpjFmt(r.cnpj) : r[n] ?? '')}"></div>`;
  return { html: layout(`<h1>${id ? 'Editar' : 'Novo'} cliente</h1><div id="msg"></div><form class="card" id="f"><div class="g2">${inp('razao_social', 'Razão social', 'required maxlength="150"')}${inp('cnpj', 'CNPJ', 'required placeholder="00.000.000/0000-00"')}${inp('contato', 'Contato', 'maxlength="100"')}${inp('telefone', 'Telefone', 'maxlength="30"')}${inp('email', 'E-mail', 'type="email" maxlength="120"')}${inp('endereco', 'Endereço', 'maxlength="200"')}</div><p><button>Salvar</button> <a class="btn s" href="#/clientes">Cancelar</a></p></form>`),
  bind() {
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault(); const fd = new FormData(ev.target), g = (k) => (fd.get(k) || '').trim(), msg = document.getElementById('msg');
      const v = { razao_social: g('razao_social'), cnpj: g('cnpj').replace(/\D/g, ''), contato: g('contato'), telefone: g('telefone'), email: g('email'), endereco: g('endereco') };
      if (!cnpjValido(v.cnpj)) { msg.innerHTML = '<div class="er">CNPJ inválido.</div>'; return; }
      const { error } = id ? await db.from('clientes').update(v).eq('id', id) : await db.from('clientes').insert(v);
      if (error) { msg.innerHTML = `<div class="er">${h(erroMsg(error))}</div>`; return; }
      flash('Cliente salvo.'); go('clientes');
    };
  } };
}

async function telaEmpresas() {
  if (S.user.perfil !== 'administrador') { go('painel'); return null; }
  const { data } = await db.from('empresas').select('*').order('nome');
  return { html: layout(`<h1>Empresas</h1><form class="card" id="f"><label>Nova empresa</label><input name="nome" required maxlength="100"><p><button>Adicionar</button></p></form><div class="card"><table><tr><th>Nome</th></tr>${data.map((r) => `<tr><td>${h(r.nome)}</td></tr>`).join('')}</table></div>`),
  bind() {
    document.getElementById('f').onsubmit = async (ev) => { ev.preventDefault(); const { error } = await db.from('empresas').insert({ nome: new FormData(ev.target).get('nome').trim() }); flash(error ? erroMsg(error) : 'Empresa cadastrada.', error ? 'er' : 'ok'); render(); };
  } };
}

async function telaUsuarios() {
  if (S.user.perfil !== 'administrador') { go('painel'); return null; }
  const { data } = await db.from('perfis').select('*').order('nome');
  const linhas = data.map((r) => { const eu = r.id === S.user.id; return `<tr><td>${h(r.nome)}</td><td>${h(r.email || '')}</td>
<td>${eu ? h(r.perfil) : `<select data-perfil="${r.id}"><option value="operador"${r.perfil === 'operador' ? ' selected' : ''}>operador</option><option value="administrador"${r.perfil === 'administrador' ? ' selected' : ''}>administrador</option></select>`}</td>
<td>${r.ativo ? 'Ativo' : '<b style="color:#8c1d18">Aguardando liberação</b>'}</td><td>${eu ? '' : `<button class="s" data-ativo="${r.id}" data-v="${r.ativo ? 0 : 1}">${r.ativo ? 'Desativar' : 'Liberar acesso'}</button>`}</td></tr>`; }).join('');
  return { html: layout(`<h1>Usuários</h1><p class="sub">Contas novas são criadas no painel do Supabase (Authentication → Users) e aparecem aqui aguardando liberação.</p><div class="card"><table><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th></th></tr>${linhas}</table></div>`),
  bind() {
    const upd = async (id, campos) => { const { error } = await db.from('perfis').update(campos).eq('id', id); flash(error ? erroMsg(error) : 'Usuário atualizado.', error ? 'er' : 'ok'); render(); };
    document.querySelectorAll('[data-ativo]').forEach((b) => { b.onclick = () => upd(b.dataset.ativo, { ativo: b.dataset.v === '1' }); });
    document.querySelectorAll('[data-perfil]').forEach((s) => { s.onchange = () => upd(s.dataset.perfil, { perfil: s.value }); });
  } };
}

// ---------- roteador ----------
async function render() {
  try {
    const [path, qs = ''] = (location.hash.slice(2) || 'painel').split('?'), q = new URLSearchParams(qs), seg = path.split('/');
    const { data: { session } } = await db.auth.getSession();
    let v;
    if (!session) { S.user = null; v = telaLogin(); }
    else {
      if (seg[0] === 'sair') { await db.auth.signOut(); S.user = null; location.hash = '#/login'; return render(); }
      if (!S.user || S.user.id !== session.user.id) {
        const { data } = await db.from('perfis').select('nome,perfil,ativo').eq('id', session.user.id).maybeSingle();
        if (!data || !data.ativo) { root.innerHTML = '<div class="card" style="max-width:420px;margin:60px auto"><h1>Acesso pendente</h1><p>Sua conta ainda não foi liberada por um administrador.</p><p><a class="btn s" href="#/sair">Sair</a></p></div>'; return; }
        S.user = { id: session.user.id, nome: data.nome, perfil: data.perfil };
      }
      root.innerHTML = layout('<p class="sub">Carregando…</p>');
      v = seg[0] === 'processos' ? await telaProcessos(q)
        : seg[0] === 'proc' ? (seg[2] === 'editar' || seg[1] === 'novo' ? await telaProcForm(seg[1]) : await telaProcVer(+seg[1]))
        : seg[0] === 'clientes' ? await telaClientes() : seg[0] === 'cliente' ? await telaCliForm(seg[1])
        : seg[0] === 'empresas' ? await telaEmpresas() : seg[0] === 'usuarios' ? await telaUsuarios() : await telaPainel(q);
      if (!v) return;
    }
    root.innerHTML = v.html; if (v.bind) v.bind();
  } catch (e) { console.error(e); root.innerHTML = `<main><div class="er">Erro: ${h(e.message || e)}</div><p><a class="btn s" href="#/painel">Recarregar</a></p></main>`; }
}
window.addEventListener('hashchange', render);
render();
