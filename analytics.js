// Versão Node (SQLite): lê o banco local e delega os cálculos ao módulo compartilhado em docs/.
'use strict';
const A = require('./docs/analytics');
const SQL = `SELECT p.*, c.razao_social cliente, c.cnpj, e.nome empresa,
  (SELECT MAX(x.quando) FROM historico x WHERE x.processo_id=p.id AND x.acao LIKE '% para ENVIADO') conclusao
  FROM processos p JOIN clientes c ON c.id=p.cliente_id JOIN empresas e ON e.id=p.empresa_id`;
const dados = (db, meses) => A.calcular(db.prepare(SQL).all(), meses);
const xlsxCompleto = (db, d, usuario) => A.xlsxCompleto(d, usuario, db.prepare(
  'SELECT x.quando, p.numero, x.usuario, x.acao FROM historico x JOIN processos p ON p.id=x.processo_id').all());
module.exports = { ...A, dados, xlsxCompleto };
