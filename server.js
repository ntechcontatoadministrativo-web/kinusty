const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, hashSenha, conferirSenha, transacao, getConfig, inicializar } = require('./db');
const mp = require('./mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSAO_DIAS = 30;

app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Utilidades de data ----------
const DIAS_KEYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const DIAS_NOMES = { dom: 'Domingo', seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado' };

const pad = n => String(n).padStart(2, '0');
const fmtData = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = () => fmtData(new Date());
const competenciaAtual = () => hoje().slice(0, 7);
const parseData = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDias = (s, n) => { const d = parseData(s); d.setDate(d.getDate() + n); return fmtData(d); };
const diaSemana = s => DIAS_KEYS[parseData(s).getDay()];

function deslocarCompetencia(comp, meses) {
  const [y, m] = comp.split('-').map(Number);
  const d = new Date(y, m - 1 + meses, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function vencimentoDe(comp, dia) {
  const [y, m] = comp.split('-').map(Number);
  const ultimo = new Date(y, m, 0).getDate();
  return `${comp}-${pad(Math.min(dia, ultimo))}`;
}

// Status "atrasada" é derivado: pendente com vencimento já passado
function statusMensalidade(m) {
  if (m.status === 'pendente' && m.vencimento < hoje()) return 'atrasada';
  return m.status;
}

// ---------- Geração automática de mensalidades ----------
async function gerarMensalidades(comp = competenciaAtual()) {
  const [y, m] = comp.split('-').map(Number);
  const ultimoDia = new Date(y, m, 0).getDate();
  const r = await db.run(`
    INSERT INTO mensalidades (matricula_id, user_id, competencia, valor, vencimento)
    SELECT m.id, m.user_id, ?::text, COALESCE(m.valor, p.preco), ?::text || '-' || lpad(LEAST(m.dia_vencimento, ?::int)::text, 2, '0')
    FROM matriculas m JOIN planos p ON p.id = m.plano_id
    WHERE m.status = 'ativa' AND substr(m.data_inicio, 1, 7) <= ?::text AND COALESCE(m.valor, p.preco) > 0
    ON CONFLICT (matricula_id, competencia) DO NOTHING`, comp, comp, ultimoDia, comp);
  return r.changes;
}

// ---------- Sessões / autenticação ----------
function lerCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

async function criarSessao(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = Date.now() + SESSAO_DIAS * 864e5;
  await db.run('INSERT INTO sessions (token, user_id, expira_em) VALUES (?, ?, ?)', token, userId, expira);
  res.setHeader('Set-Cookie', `kv_sessao=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSAO_DIAS * 86400}${req.secure ? '; Secure' : ''}`);
}

app.use(async (req, _res, next) => {
  const token = lerCookies(req).kv_sessao;
  if (token && req.path.startsWith('/api/')) {
    try {
      const s = await db.get(`SELECT u.id, u.nome, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expira_em > ?`, token, Date.now());
      if (s) { req.user = s; req.token = token; }
    } catch (e) { return next(e); }
  }
  next();
});

const exigirLogin = (req, res, next) => req.user ? next() : res.status(401).json({ erro: 'Faça login para continuar.' });
const exigirAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ erro: 'Acesso restrito à administração.' });
const exigirAluno = (req, res, next) => req.user?.role === 'aluno' ? next() : res.status(403).json({ erro: 'Área exclusiva para alunos.' });

// Envolve as rotas: devolve o retorno como JSON e trata erros
const rota = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (r !== undefined && !res.headersSent) res.json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ erro: e.message });
    console.error(e);
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
};
const falha = (status, message) => Object.assign(new Error(message), { status });

// ---------- Validação de matrícula ----------
async function ocupacaoTurma(turmaId, ignorarMatriculaId = 0) {
  const rows = await db.all(`SELECT dias FROM matriculas WHERE turma_id = ? AND status = 'ativa' AND id != ?`, turmaId, ignorarMatriculaId);
  const occ = {};
  rows.forEach(r => r.dias.split(',').forEach(d => { occ[d] = (occ[d] || 0) + 1; }));
  return occ;
}

// As turmas não têm limite de vagas por enquanto: só confere plano, turma e dias
async function validarEscolha({ plano_id, turma_id, dias }) {
  const plano = await db.get('SELECT * FROM planos WHERE id = ? AND ativo = 1', Number(plano_id) || 0);
  if (!plano) throw falha(400, 'Escolha um plano válido.');
  const turma = await db.get('SELECT * FROM turmas WHERE id = ? AND ativo = 1', Number(turma_id) || 0);
  if (!turma) throw falha(400, 'Escolha uma turma válida.');
  const diasTurma = turma.dias.split(',');
  // Plano família: dias obrigatórios (terça e quinta)
  const escolhidos = plano.dias_fixos ? plano.dias_fixos.split(',') : [...new Set(Array.isArray(dias) ? dias : [])];
  if (escolhidos.length !== plano.dias_semana)
    throw falha(400, `O ${plano.nome} exige escolher exatamente ${plano.dias_semana} dias.`);
  if (escolhidos.some(d => !diasTurma.includes(d)))
    throw falha(400, `A turma ${turma.nome} treina apenas: ${diasTurma.map(d => DIAS_NOMES[d]).join(', ')}.`);
  return { plano, turma, dias: DIAS_KEYS.filter(d => escolhidos.includes(d)) };
}

const limpar = v => (typeof v === 'string' ? v.trim() : v) || null;
const simNao = v => (v === true || v === 1 || v === '1' || v === 'sim' ? 1 : v === false || v === 0 || v === '0' || v === 'nao' ? 0 : null);

function calcIdade(nasc) {
  const n = parseData(nasc), h = new Date();
  let i = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) i--;
  return i;
}

// ---------- Mercado Pago ----------
const urlBase = req => (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// Consulta o pagamento no Mercado Pago e atualiza a mensalidade correspondente.
// O status vem sempre da API do MP (nunca do navegador), então não dá para forjar um pagamento.
async function processarPagamentoMP(paymentId, userId = null) {
  const p = await mp.buscarPagamento(paymentId);
  const id = Number(/^mens-(\d+)$/.exec(p.external_reference || '')?.[1]) || 0;
  const m = await db.get('SELECT * FROM mensalidades WHERE id = ?', id);
  if (!m || (userId && m.user_id !== userId)) throw falha(404, 'Pagamento não encontrado.');
  if (p.status === 'approved') {
    if (Number(p.transaction_amount) + 0.009 < m.valor) {
      console.warn(`Pagamento MP ${p.id} com valor menor que a mensalidade ${m.id}`);
      return { status: 'valor_divergente' };
    }
    await db.run(`UPDATE mensalidades SET status = 'paga', pago_em = ?, forma_pagamento = ?, mp_payment_id = ? WHERE id = ? AND status IN ('pendente','em_analise')`,
      fmtData(new Date(p.date_approved || Date.now())), mp.formaPagamento(p), String(p.id), m.id);
  } else if (['refunded', 'charged_back'].includes(p.status)) {
    await db.run(`UPDATE mensalidades SET status = 'pendente', pago_em = NULL WHERE id = ? AND mp_payment_id = ?`, m.id, String(p.id));
  }
  return { status: p.status };
}

app.post('/api/mercadopago/webhook', async (req, res) => {
  const tipo = req.query.type || req.query.topic || req.body?.type;
  const paymentId = req.query['data.id'] || req.body?.data?.id || (req.query.topic === 'payment' ? req.query.id : null);
  if (tipo !== 'payment' || !paymentId) return res.sendStatus(200);
  if (!mp.assinaturaValida(req, paymentId)) return res.sendStatus(401);
  try {
    await processarPagamentoMP(paymentId);
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook Mercado Pago:', e.message);
    res.sendStatus(e.status === 404 ? 200 : 500); // 500 faz o MP tentar de novo
  }
});

// =====================================================
// ROTAS PÚBLICAS
// =====================================================
app.get('/api/publico/info', rota(async () => {
  const [cfg, planos, turmas] = await Promise.all([
    getConfig(),
    db.all('SELECT id, nome, dias_semana, preco, tipo, pessoas, dias_fixos FROM planos WHERE ativo = 1 ORDER BY tipo DESC, pessoas, dias_semana'),
    db.all('SELECT * FROM turmas WHERE ativo = 1 ORDER BY horario_inicio, nome'),
  ]);
  return {
    escola: { nome: cfg.nome_escola, whatsapp: cfg.whatsapp, instagram: cfg.instagram, endereco: cfg.endereco },
    planos: planos.map(p => ({ ...p, dias_fixos: p.dias_fixos ? p.dias_fixos.split(',') : null })),
    turmas: turmas.map(t => ({ ...t, dias: t.dias.split(',') })),
    dias_nomes: DIAS_NOMES,
  };
}));

// Dados de uma pessoa da ficha de inscrição. O 1º aluno é o titular (login e pagamento).
function dadosAluno(a, i, titular) {
  const quem = i === 0 ? '' : ` (${i + 1}ª pessoa)`;
  const nome = limpar(a.nome);
  if (!nome || nome.length < 3) throw falha(400, `Informe o nome completo${quem}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.nascimento || '')) throw falha(400, `Informe a data de nascimento${quem}.`);
  const menor = calcIdade(a.nascimento) < 18;
  if (menor && (!limpar(a.responsavel) || !limpar(a.telefone_responsavel)))
    throw falha(400, `Para menores de 18 anos, informe o nome e o telefone do responsável${quem}.`);
  if (i === 0 && !limpar(a.telefone) && !menor) throw falha(400, 'Informe um telefone/WhatsApp.');
  if (i === 0 && (!limpar(a.endereco) || !limpar(a.bairro) || !limpar(a.cidade))) throw falha(400, 'Informe endereço, bairro e cidade.');
  return {
    nome, nascimento: a.nascimento, sexo: ['F', 'M', 'O'].includes(a.sexo) ? a.sexo : null,
    telefone: limpar(a.telefone), cpf: limpar(a.cpf),
    // Casal/família moram juntos: os acompanhantes usam o endereço do titular
    endereco: limpar(a.endereco) ?? titular?.endereco ?? null, bairro: limpar(a.bairro) ?? titular?.bairro ?? null, cidade: limpar(a.cidade) ?? titular?.cidade ?? null,
    responsavel: limpar(a.responsavel), parentesco_responsavel: limpar(a.parentesco_responsavel),
    telefone_responsavel: limpar(a.telefone_responsavel), email_responsavel: limpar(a.email_responsavel)?.toLowerCase() ?? null,
    contato_emergencia: limpar(a.contato_emergencia), observacoes_saude: limpar(a.observacoes_saude),
    ja_jogou: simNao(a.ja_jogou), nivel: ['iniciante', 'intermediario', 'avancado'].includes(a.nivel) ? a.nivel : 'iniciante',
    turma_id: a.turma_id,
  };
}

app.post('/api/matricula', rota(async (req, res) => {
  const b = req.body || {};
  const email = limpar(b.email)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw falha(400, 'Informe um e-mail válido.');
  if (!b.senha || String(b.senha).length < 6) throw falha(400, 'A senha deve ter pelo menos 6 caracteres.');
  const imagem = simNao(b.autoriza_imagem);
  if (imagem === null) throw falha(400, 'Responda se autoriza o uso de imagem.');
  if (!b.aceite) throw falha(400, 'É necessário aceitar os termos da escolinha.');
  if (await db.get('SELECT 1 FROM users WHERE email = ?', email)) throw falha(409, 'Este e-mail já está cadastrado. Faça login.');

  const plano = await db.get('SELECT * FROM planos WHERE id = ? AND ativo = 1', Number(b.plano_id) || 0);
  if (!plano) throw falha(400, 'Escolha um plano válido.');
  const lista = Array.isArray(b.alunos) ? b.alunos : [];
  if (lista.length !== plano.pessoas)
    throw falha(400, plano.pessoas > 1 ? `O ${plano.nome} precisa das informações de ${plano.pessoas} pessoas.` : 'Informe os dados do aluno.');
  const alunos = [];
  for (const [i, a] of lista.entries()) {
    const d = dadosAluno(a || {}, i, alunos[0]);
    alunos.push({ ...d, ...(await validarEscolha({ plano_id: plano.id, turma_id: d.turma_id, dias: b.dias })) });
  }

  const cfg = await getConfig();
  const userId = await transacao(async tx => {
    let titular = null;
    for (const [i, a] of alunos.entries()) {
      // Só o titular tem login; os demais recebem uma senha aleatória e não entram no sistema
      const u = await tx.get(`INSERT INTO users (nome, email, senha_hash, telefone, nascimento, cpf, sexo, endereco, bairro, cidade, responsavel, parentesco_responsavel,
          telefone_responsavel, email_responsavel, contato_emergencia, observacoes_saude, ja_jogou, autoriza_imagem, indicado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        a.nome, i === 0 ? email : null, hashSenha(i === 0 ? String(b.senha) : crypto.randomBytes(16).toString('hex')), a.telefone, a.nascimento, a.cpf, a.sexo,
        a.endereco, a.bairro, a.cidade, a.responsavel, a.parentesco_responsavel, a.telefone_responsavel, a.email_responsavel,
        a.contato_emergencia, a.observacoes_saude, a.ja_jogou, imagem, i === 0 ? limpar(b.indicado_por)?.slice(0, 120) ?? null : null);
      const m = await tx.get(`INSERT INTO matriculas (user_id, plano_id, turma_id, dias, nivel, dia_vencimento, data_inicio, grupo_id, valor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, u.id, plano.id, a.turma.id, a.dias.join(','), a.nivel, Number(cfg.dia_vencimento) || 10, hoje(),
        titular?.matricula ?? null, titular ? 0 : null);
      if (!titular) titular = { user: u.id, matricula: m.id };
    }
    if (alunos.length > 1) await tx.run('UPDATE matriculas SET grupo_id = id WHERE id = ?', titular.matricula);
    // Primeira mensalidade (do plano inteiro, no nome do titular) vence em 3 dias
    await tx.run('INSERT INTO mensalidades (matricula_id, user_id, competencia, valor, vencimento) VALUES (?, ?, ?, ?, ?)',
      titular.matricula, titular.user, competenciaAtual(), plano.preco, addDias(hoje(), 3));
    return titular.user;
  });

  await criarSessao(req, res, userId);
  return { ok: true, redirecionar: '/aluno.html' };
}));

// ---------- Auth ----------
app.post('/api/auth/login', rota(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const u = await db.get('SELECT * FROM users WHERE email = ?', email);
  if (!u || !conferirSenha(String(req.body?.senha || ''), u.senha_hash)) throw falha(401, 'E-mail ou senha incorretos.');
  await criarSessao(req, res, u.id);
  return { ok: true, role: u.role, redirecionar: u.role === 'admin' ? '/admin.html' : '/aluno.html' };
}));

app.post('/api/auth/logout', rota(async (req, res) => {
  if (req.token) await db.run('DELETE FROM sessions WHERE token = ?', req.token);
  res.setHeader('Set-Cookie', 'kv_sessao=; HttpOnly; Path=/; Max-Age=0');
  return { ok: true };
}));

app.get('/api/me', exigirLogin, rota(req => ({ user: req.user })));

// =====================================================
// ÁREA DO ALUNO
// =====================================================
const aluno = express.Router();
aluno.use(exigirLogin, exigirAluno);

function matriculaDo(userId) {
  return db.get(`SELECT m.*, p.nome AS plano_nome, p.preco, p.dias_semana, p.tipo AS plano_tipo, p.pessoas, COALESCE(m.valor, p.preco) AS valor_mensal,
      t.nome AS turma_nome, t.horario_inicio, t.horario_fim, t.dias AS turma_dias
    FROM matriculas m JOIN planos p ON p.id = m.plano_id JOIN turmas t ON t.id = m.turma_id
    WHERE m.user_id = ? ORDER BY m.id DESC LIMIT 1`, userId);
}

// Pessoas do mesmo plano casal/família (o titular primeiro)
const grupoDa = mat => !mat?.grupo_id ? [] : db.all(`SELECT u.id, u.nome, t.nome AS turma, m.status, (m.id = m.grupo_id) AS titular
  FROM matriculas m JOIN users u ON u.id = m.user_id JOIN turmas t ON t.id = m.turma_id WHERE m.grupo_id = ? ORDER BY (m.id = m.grupo_id) DESC, m.id`, mat.grupo_id);

const CAMPOS_PERFIL = 'id, nome, email, telefone, nascimento, cpf, sexo, endereco, bairro, cidade, responsavel, parentesco_responsavel, telefone_responsavel, email_responsavel, contato_emergencia, observacoes_saude, ja_jogou, autoriza_imagem, indicado_por, indicado_por_id, criado_em';

function proximasAulas(mat, qtd = 6) {
  if (!mat || mat.status !== 'ativa') return [];
  const dias = mat.dias.split(',');
  const out = [];
  let d = hoje();
  for (let i = 0; i < 30 && out.length < qtd; i++, d = addDias(d, 1)) {
    if (dias.includes(diaSemana(d))) out.push({ data: d, dia: DIAS_NOMES[diaSemana(d)], horario: `${mat.horario_inicio}–${mat.horario_fim}` });
  }
  return out;
}

async function frequencia(userId, desde) {
  const r = await db.get(`SELECT COUNT(*) AS total, COALESCE(SUM(presente), 0) AS presentes FROM presencas WHERE user_id = ? AND data >= ?`, userId, desde);
  return { total: r.total, presentes: r.presentes, taxa: r.total ? Math.round((r.presentes / r.total) * 100) : null };
}

const listarMensalidades = async userId =>
  (await db.all('SELECT * FROM mensalidades WHERE user_id = ? ORDER BY competencia DESC', userId)).map(m => ({ ...m, status: statusMensalidade(m) }));

aluno.get('/resumo', rota(async req => {
  const mat = await matriculaDo(req.user.id);
  const perfil = await db.get(`SELECT ${CAMPOS_PERFIL} FROM users WHERE id = ?`, req.user.id);
  const mens = await listarMensalidades(req.user.id);
  const aberta = [...mens].reverse().find(m => ['pendente', 'atrasada', 'em_analise'].includes(m.status));
  const avisos = await db.all('SELECT * FROM avisos ORDER BY id DESC LIMIT 5');
  const presencaHoje = await db.get('SELECT presente FROM presencas WHERE user_id = ? AND data = ?', req.user.id, hoje());
  const treinaHoje = mat?.status === 'ativa' && mat.dias.split(',').includes(diaSemana(hoje()));
  const cfg = await getConfig();
  return {
    perfil, matricula: mat || null, grupo: await grupoDa(mat), proximas_aulas: proximasAulas(mat), mensalidade_aberta: aberta || null,
    em_atraso: mens.filter(m => m.status === 'atrasada').length,
    frequencia_30d: await frequencia(req.user.id, addDias(hoje(), -30)),
    frequencia_total: await frequencia(req.user.id, '0000-00-00'),
    avisos, treina_hoje: treinaHoje, checkin_hoje: !!presencaHoje?.presente,
    pix: cfg.chave_pix, whatsapp: cfg.whatsapp, dias_nomes: DIAS_NOMES, mercadopago: mp.configurado(),
  };
}));

aluno.post('/mensalidades/:id/mercadopago', rota(async req => {
  const m = await db.get('SELECT * FROM mensalidades WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
  if (!m) throw falha(404, 'Mensalidade não encontrada.');
  if (!['pendente', 'em_analise'].includes(m.status)) throw falha(400, 'Essa mensalidade não está em aberto.');
  const cfg = await getConfig();
  const [y, mes] = m.competencia.split('-');
  const url = await mp.criarCheckout({
    mensalidade: m, aluno: req.user, baseUrl: urlBase(req),
    titulo: `Mensalidade ${mes}/${y} — ${cfg.nome_escola || 'Kinusty Volleyball'}`,
  });
  return { url };
}));

// Chamado quando o aluno volta do checkout: confirma na hora, sem esperar o webhook
aluno.post('/mercadopago/confirmar', rota(async req => {
  const id = String(req.body?.payment_id || '');
  if (!/^\d+$/.test(id)) throw falha(400, 'Pagamento inválido.');
  return processarPagamentoMP(id, req.user.id);
}));

aluno.get('/mensalidades', rota(req => listarMensalidades(req.user.id)));

aluno.post('/mensalidades/:id/informar-pagamento', rota(async req => {
  const m = await db.get('SELECT * FROM mensalidades WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
  if (!m) throw falha(404, 'Mensalidade não encontrada.');
  if (m.status !== 'pendente') throw falha(400, 'Essa mensalidade não está pendente.');
  await db.run("UPDATE mensalidades SET status = 'em_analise', forma_pagamento = ? WHERE id = ?", limpar(req.body?.forma) || 'PIX', m.id);
  return { ok: true };
}));

aluno.get('/presencas', rota(req =>
  db.all(`SELECT p.data, p.presente, p.origem, t.nome AS turma FROM presencas p LEFT JOIN turmas t ON t.id = p.turma_id
    WHERE p.user_id = ? ORDER BY p.data DESC LIMIT 120`, req.user.id)
));

aluno.post('/checkin', rota(async req => {
  const mat = await matriculaDo(req.user.id);
  if (!mat || mat.status !== 'ativa') throw falha(400, 'Sua matrícula não está ativa.');
  if (!mat.dias.split(',').includes(diaSemana(hoje()))) throw falha(400, 'Hoje não é um dos seus dias de treino.');
  await db.run(`INSERT INTO presencas (user_id, turma_id, data, presente, origem) VALUES (?, ?, ?, 1, 'checkin')
    ON CONFLICT (user_id, data) DO UPDATE SET presente = 1`, req.user.id, mat.turma_id, hoje());
  return { ok: true };
}));

aluno.put('/perfil', rota(async req => {
  const b = req.body || {};
  const nome = limpar(b.nome);
  if (!nome || nome.length < 3) throw falha(400, 'Informe o nome completo.');
  await db.run(`UPDATE users SET nome = ?, telefone = ?, endereco = ?, bairro = ?, cidade = ?, responsavel = ?, parentesco_responsavel = ?, telefone_responsavel = ?,
      email_responsavel = ?, contato_emergencia = ?, observacoes_saude = ?, autoriza_imagem = COALESCE(?, autoriza_imagem) WHERE id = ?`,
    nome, limpar(b.telefone), limpar(b.endereco), limpar(b.bairro), limpar(b.cidade), limpar(b.responsavel), limpar(b.parentesco_responsavel),
    limpar(b.telefone_responsavel), limpar(b.email_responsavel), limpar(b.contato_emergencia), limpar(b.observacoes_saude), simNao(b.autoriza_imagem), req.user.id);
  return { ok: true };
}));

async function trocarSenha(req) {
  const u = await db.get('SELECT senha_hash FROM users WHERE id = ?', req.user.id);
  if (!conferirSenha(String(req.body?.atual || ''), u.senha_hash)) throw falha(400, 'Senha atual incorreta.');
  if (String(req.body?.nova || '').length < 6) throw falha(400, 'A nova senha deve ter pelo menos 6 caracteres.');
  await db.run('UPDATE users SET senha_hash = ? WHERE id = ?', hashSenha(String(req.body.nova)), req.user.id);
  return { ok: true };
}
aluno.put('/senha', rota(trocarSenha));

// Troca de plano / dias: vale a partir da próxima mensalidade gerada
aluno.put('/plano', rota(async req => {
  const mat = await matriculaDo(req.user.id);
  if (!mat) throw falha(404, 'Matrícula não encontrada.');
  if (mat.status === 'cancelada') throw falha(400, 'Matrícula cancelada. Fale com a escolinha para reativar.');
  if (mat.grupo_id) throw falha(400, 'Plano casal/família: fale com a escolinha para alterar.');
  const { plano, turma, dias } = await validarEscolha(req.body || {});
  if (plano.tipo !== 'individual') throw falha(400, 'Para mudar para o plano casal ou família, fale com a escolinha.');
  await db.run('UPDATE matriculas SET plano_id = ?, turma_id = ?, dias = ? WHERE id = ?', plano.id, turma.id, dias.join(','), mat.id);
  return { ok: true };
}));

app.use('/api/aluno', aluno);

// =====================================================
// ÁREA ADMINISTRATIVA
// =====================================================
const admin = express.Router();
admin.use(exigirLogin, exigirAdmin);

admin.get('/dashboard', rota(async () => {
  await gerarMensalidades();
  const comp = competenciaAtual();
  const hj = hoje();
  const inicioMes = `${comp}-01`;

  const meses = Array.from({ length: 6 }, (_, i) => deslocarCompetencia(comp, i - 5));

  // Consultas independentes rodam em paralelo
  const [contagemRows, { v: mrr }, { n: novosMes }, { n: cancelMes }, totaisMens, receitaRows, todasMat, porPlano, ativasRows, turmas, nascimentos, freq, aniversariantes, ultimas, inadimplentes] = await Promise.all([
    db.all('SELECT status, COUNT(*) AS n FROM matriculas GROUP BY status'),
    db.get(`SELECT COALESCE(SUM(COALESCE(m.valor, p.preco)), 0) AS v FROM matriculas m JOIN planos p ON p.id = m.plano_id WHERE m.status = 'ativa'`),
    db.get('SELECT COUNT(*) AS n FROM matriculas WHERE data_inicio >= ?', inicioMes),
    db.get('SELECT COUNT(*) AS n FROM matriculas WHERE cancelado_em >= ?', inicioMes),
    db.get(`SELECT
        COALESCE(SUM(valor) FILTER (WHERE status = 'paga' AND substr(pago_em, 1, 7) = ?), 0) AS recebido_mes,
        COALESCE(SUM(valor) FILTER (WHERE competencia = ? AND status != 'cancelada'), 0) AS previsto_mes,
        COALESCE(SUM(valor) FILTER (WHERE status IN ('pendente','em_analise') AND vencimento >= ?), 0) AS a_receber,
        COUNT(*) FILTER (WHERE status IN ('pendente','em_analise') AND vencimento >= ?) AS a_receber_qtd,
        COALESCE(SUM(valor) FILTER (WHERE status = 'pendente' AND vencimento < ?), 0) AS em_atraso,
        COUNT(*) FILTER (WHERE status = 'pendente' AND vencimento < ?) AS em_atraso_qtd,
        COUNT(DISTINCT user_id) FILTER (WHERE status = 'pendente' AND vencimento < ?) AS inadimplentes,
        COUNT(*) FILTER (WHERE status = 'em_analise') AS em_analise
      FROM mensalidades`, comp, comp, hj, hj, hj, hj, hj),
    // Receita dos últimos 6 meses (por competência): recebido x previsto
    db.all(`SELECT competencia, COALESCE(SUM(CASE WHEN status = 'paga' THEN valor END), 0) AS pago,
        COALESCE(SUM(CASE WHEN status != 'cancelada' THEN valor END), 0) AS previsto
      FROM mensalidades WHERE competencia >= ? GROUP BY competencia`, meses[0]),
    db.all('SELECT data_inicio, cancelado_em, status FROM matriculas'),
    db.all(`SELECT p.nome, p.dias_semana, p.preco, p.tipo, COUNT(m.id) AS alunos, COALESCE(SUM(COALESCE(m.valor, p.preco)), 0) AS receita
      FROM planos p LEFT JOIN matriculas m ON m.plano_id = p.id AND m.status = 'ativa' WHERE p.ativo = 1 OR m.id IS NOT NULL
      GROUP BY p.id ORDER BY p.tipo DESC, p.pessoas, p.dias_semana`),
    db.all(`SELECT turma_id, dias, nivel FROM matriculas WHERE status = 'ativa'`),
    db.all('SELECT * FROM turmas WHERE ativo = 1 ORDER BY horario_inicio, nome'),
    db.all(`SELECT u.nascimento FROM users u JOIN matriculas m ON m.user_id = u.id WHERE m.status = 'ativa' AND u.nascimento IS NOT NULL`),
    db.get(`SELECT COUNT(*) AS total, COALESCE(SUM(presente), 0) AS presentes FROM presencas WHERE data >= ?`, addDias(hj, -30)),
    db.all(`SELECT u.nome, u.nascimento, u.telefone FROM users u JOIN matriculas m ON m.user_id = u.id
      WHERE m.status = 'ativa' AND substr(u.nascimento, 6, 2) = ? ORDER BY substr(u.nascimento, 9, 2)`, comp.slice(5, 7)),
    db.all(`SELECT u.id, u.nome, m.data_inicio, p.nome AS plano, t.nome AS turma FROM matriculas m
      JOIN users u ON u.id = m.user_id JOIN planos p ON p.id = m.plano_id JOIN turmas t ON t.id = m.turma_id ORDER BY m.id DESC LIMIT 6`),
    db.all(`SELECT u.id, u.nome, u.telefone, COUNT(*) AS parcelas, SUM(ms.valor) AS total, MIN(ms.vencimento) AS desde
      FROM mensalidades ms JOIN users u ON u.id = ms.user_id WHERE ms.status = 'pendente' AND ms.vencimento < ?
      GROUP BY u.id ORDER BY total DESC LIMIT 8`, hj),
  ]);

  const contagem = Object.fromEntries(contagemRows.map(r => [r.status, r.n]));
  const ativos = contagem.ativa || 0;
  const { recebido_mes: recebidoMes, previsto_mes: previstoMes } = totaisMens;
  const aReceber = { v: totaisMens.a_receber, n: totaisMens.a_receber_qtd };
  const atraso = { v: totaisMens.em_atraso, n: totaisMens.em_atraso_qtd, alunos: totaisMens.inadimplentes };
  const emAnalise = totaisMens.em_analise;

  const receita = meses.map(c => {
    const r = receitaRows.find(x => x.competencia === c);
    return { competencia: c, pago: r?.pago || 0, previsto: r?.previsto || 0 };
  });

  // Evolução de alunos ativos no fim de cada mês
  const evolucao = meses.map(c => {
    const fim = vencimentoDe(c, 31);
    return {
      competencia: c,
      ativos: todasMat.filter(m => m.data_inicio <= fim && (!m.cancelado_em || m.cancelado_em > fim) && m.status !== 'trancada').length,
      novos: todasMat.filter(m => m.data_inicio.slice(0, 7) === c).length,
    };
  });

  const porTurma = turmas.map(t => {
    const daTurma = ativasRows.filter(m => m.turma_id === t.id);
    const occ = {};
    daTurma.forEach(m => m.dias.split(',').forEach(d => { occ[d] = (occ[d] || 0) + 1; }));
    const pico = Math.max(0, ...t.dias.split(',').map(d => occ[d] || 0));
    return { nome: t.nome, horario: `${t.horario_inicio}–${t.horario_fim}`, alunos: daTurma.length, capacidade: t.capacidade, ocupacao_pico: pico, ocupacao_pct: Math.round((pico / t.capacidade) * 100) };
  });

  const porDia = {};
  ativasRows.forEach(r => r.dias.split(',').forEach(d => { porDia[d] = (porDia[d] || 0) + 1; }));
  const porNivelMap = {};
  ativasRows.forEach(r => { porNivelMap[r.nivel] = (porNivelMap[r.nivel] || 0) + 1; });

  const faixas = { 'Até 12': 0, '13–17': 0, '18–29': 0, '30+': 0 };
  nascimentos.forEach(r => {
    const i = calcIdade(r.nascimento);
    faixas[i <= 12 ? 'Até 12' : i <= 17 ? '13–17' : i <= 29 ? '18–29' : '30+']++;
  });

  return {
    competencia: comp,
    kpis: {
      alunos_ativos: ativos, trancados: contagem.trancada || 0, cancelados: contagem.cancelada || 0,
      novos_mes: novosMes, cancelamentos_mes: cancelMes,
      mrr, ticket_medio: ativos ? mrr / ativos : 0,
      recebido_mes: recebidoMes, previsto_mes: previstoMes,
      a_receber: aReceber.v, a_receber_qtd: aReceber.n,
      em_atraso: atraso.v, em_atraso_qtd: atraso.n, inadimplentes: atraso.alunos,
      taxa_inadimplencia: ativos ? Math.round((atraso.alunos / ativos) * 100) : 0,
      em_analise: emAnalise,
      frequencia_30d: freq.total ? Math.round((freq.presentes / freq.total) * 100) : null,
      projecao_anual: mrr * 12,
    },
    receita, evolucao, por_plano: porPlano, por_turma: porTurma,
    por_dia: ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'].filter(d => porDia[d] || ['seg', 'ter', 'qui', 'sex'].includes(d)).map(d => ({ dia: DIAS_NOMES[d], alunos: porDia[d] || 0 })),
    por_nivel: Object.entries(porNivelMap).map(([nivel, n]) => ({ nivel, n })),
    por_idade: Object.entries(faixas).map(([faixa, n]) => ({ faixa, n })),
    aniversariantes, ultimas, inadimplentes,
  };
}));

// ---------- Alunos ----------
admin.get('/alunos', rota(async req => {
  const { busca = '', status = '', turma = '', plano = '' } = req.query;
  const filtros = [], params = [hoje()];
  if (busca) { filtros.push('(u.nome ILIKE ? OR u.email ILIKE ? OR u.telefone ILIKE ?)'); params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`); }
  if (status) { filtros.push('m.status = ?'); params.push(status); }
  if (Number(turma)) { filtros.push('t.id = ?'); params.push(Number(turma)); }
  if (Number(plano)) { filtros.push('p.id = ?'); params.push(Number(plano)); }
  return db.all(`SELECT u.id, u.nome, u.email, u.telefone, u.nascimento, m.id AS matricula_id, m.status, m.dias, m.nivel, m.data_inicio,
      p.id AS plano_id, p.nome AS plano, COALESCE(m.valor, p.preco) AS preco, m.grupo_id, t.id AS turma_id, t.nome AS turma,
      (SELECT COUNT(*) FROM mensalidades ms WHERE ms.user_id = u.id AND ms.status = 'pendente' AND ms.vencimento < ?) AS atrasadas
    FROM users u JOIN matriculas m ON m.user_id = u.id JOIN planos p ON p.id = m.plano_id JOIN turmas t ON t.id = m.turma_id
    WHERE u.role = 'aluno' ${filtros.map(f => 'AND ' + f).join(' ')}
    ORDER BY lower(u.nome)`, ...params);
}));

admin.get('/alunos/:id', rota(async req => {
  const u = await db.get(`SELECT ${CAMPOS_PERFIL} FROM users WHERE id = ? AND role = 'aluno'`, Number(req.params.id) || 0);
  if (!u) throw falha(404, 'Aluno não encontrado.');
  const matricula = await matriculaDo(u.id);
  return {
    aluno: { ...u, idade: u.nascimento ? calcIdade(u.nascimento) : null },
    matricula, grupo: await grupoDa(matricula),
    indicado_por: u.indicado_por_id ? await db.get('SELECT id, nome FROM users WHERE id = ?', u.indicado_por_id) : null,
    indicados: await db.all(`SELECT u.id, u.nome, m.status, m.data_inicio FROM users u LEFT JOIN matriculas m ON m.user_id = u.id
      WHERE u.indicado_por_id = ? ORDER BY m.data_inicio`, u.id),
    mensalidades: await listarMensalidades(u.id),
    presencas: await db.all('SELECT data, presente, origem FROM presencas WHERE user_id = ? ORDER BY data DESC LIMIT 30', u.id),
    frequencia_30d: await frequencia(u.id, addDias(hoje(), -30)),
  };
}));

admin.put('/alunos/:id/matricula', rota(async req => {
  const mat = await matriculaDo(Number(req.params.id) || 0);
  if (!mat) throw falha(404, 'Matrícula não encontrada.');
  const b = req.body || {};
  const status = ['ativa', 'trancada', 'cancelada'].includes(b.status) ? b.status : mat.status;
  const reativando = status === 'ativa' && mat.status !== 'ativa';
  const escolha = await validarEscolha({ plano_id: b.plano_id ?? mat.plano_id, turma_id: b.turma_id ?? mat.turma_id, dias: b.dias ?? mat.dias.split(',') });
  const nivel = ['iniciante', 'intermediario', 'avancado'].includes(b.nivel) ? b.nivel : mat.nivel;
  const venc = Math.min(28, Math.max(1, Number(b.dia_vencimento) || mat.dia_vencimento));
  const canceladoEm = status === 'cancelada' ? (mat.cancelado_em || hoje()) : null;
  await transacao(async tx => {
    await tx.run(`UPDATE matriculas SET status = ?, plano_id = ?, turma_id = ?, dias = ?, nivel = ?, dia_vencimento = ?, cancelado_em = ? WHERE id = ?`,
      status, escolha.plano.id, escolha.turma.id, escolha.dias.join(','), nivel, venc, canceladoEm, mat.id);
    // Ao cancelar, mensalidades futuras em aberto são canceladas
    if (status === 'cancelada') await tx.run(`UPDATE mensalidades SET status = 'cancelada' WHERE matricula_id = ? AND status = 'pendente' AND vencimento >= ?`, mat.id, hoje());
  });
  if (reativando) await gerarMensalidades();
  return { ok: true };
}));

// Liga a indicação ao aluno que indicou (ou desfaz, com indicado_por_id vazio)
admin.put('/alunos/:id/indicacao', rota(async req => {
  const id = Number(req.params.id) || 0;
  const quem = Number(req.body?.indicado_por_id) || null;
  if (quem === id) throw falha(400, 'O aluno não pode indicar a si mesmo.');
  if (quem && !(await db.get("SELECT 1 FROM users WHERE id = ? AND role = 'aluno'", quem))) throw falha(400, 'Aluno indicador não encontrado.');
  const r = await db.run("UPDATE users SET indicado_por_id = ? WHERE id = ? AND role = 'aluno'", quem, id);
  if (!r.changes) throw falha(404, 'Aluno não encontrado.');
  return { ok: true };
}));

admin.delete('/alunos/:id', rota(async req => {
  const r = await db.run("DELETE FROM users WHERE id = ? AND role = 'aluno'", Number(req.params.id) || 0);
  if (!r.changes) throw falha(404, 'Aluno não encontrado.');
  return { ok: true };
}));

admin.get('/alunos.csv', rota(async (req, res) => {
  const rows = await db.all(`SELECT u.nome, u.email, u.telefone, u.nascimento, u.sexo, u.cpf, u.endereco, u.bairro, u.cidade, u.responsavel, u.parentesco_responsavel,
      u.telefone_responsavel, u.email_responsavel, CASE u.autoriza_imagem WHEN 1 THEN 'sim' WHEN 0 THEN 'não' END AS uso_imagem, u.observacoes_saude,
      COALESCE(ind.nome, u.indicado_por) AS indicado_por, m.status, p.nome AS plano, COALESCE(m.valor, p.preco) AS preco, t.nome AS turma, m.dias, m.nivel, m.data_inicio
    FROM users u JOIN matriculas m ON m.user_id = u.id JOIN planos p ON p.id = m.plano_id JOIN turmas t ON t.id = m.turma_id LEFT JOIN users ind ON ind.id = u.indicado_por_id
    WHERE u.role = 'aluno' ORDER BY u.nome`);
  const cols = ['nome', 'email', 'telefone', 'nascimento', 'sexo', 'cpf', 'endereco', 'bairro', 'cidade', 'responsavel', 'parentesco_responsavel', 'telefone_responsavel',
    'email_responsavel', 'uso_imagem', 'observacoes_saude', 'indicado_por', 'status', 'plano', 'preco', 'turma', 'dias', 'nivel', 'data_inicio'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="alunos-kinusty-${hoje()}.csv"`);
  res.send(csv);
}));

// ---------- Financeiro ----------
admin.get('/mensalidades', rota(async req => {
  const { competencia = '', status = '', busca = '' } = req.query;
  await gerarMensalidades();
  const filtros = [], params = [];
  if (competencia) { filtros.push('ms.competencia = ?'); params.push(competencia); }
  if (busca) { filtros.push('u.nome ILIKE ?'); params.push(`%${busca}%`); }
  let rows = (await db.all(`SELECT ms.*, u.nome, u.telefone FROM mensalidades ms JOIN users u ON u.id = ms.user_id
    ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''} ORDER BY ms.vencimento DESC, u.nome`, ...params))
    .map(m => ({ ...m, status: statusMensalidade(m) }));
  if (status) rows = rows.filter(r => r.status === status);
  const tot = s => rows.filter(r => r.status === s).reduce((a, r) => a + r.valor, 0);
  return { itens: rows, totais: { paga: tot('paga'), pendente: tot('pendente'), em_analise: tot('em_analise'), atrasada: tot('atrasada') } };
}));

admin.post('/mensalidades/:id/pagar', rota(async req => {
  const data = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.data || '') ? req.body.data : hoje();
  const r = await db.run(`UPDATE mensalidades SET status = 'paga', pago_em = ?, forma_pagamento = ? WHERE id = ? AND status IN ('pendente','em_analise')`,
    data, limpar(req.body?.forma) || 'PIX', Number(req.params.id) || 0);
  if (!r.changes) throw falha(400, 'Mensalidade não pode ser baixada.');
  return { ok: true };
}));

admin.post('/mensalidades/:id/estornar', rota(async req => {
  await db.run(`UPDATE mensalidades SET status = 'pendente', pago_em = NULL WHERE id = ?`, Number(req.params.id) || 0);
  return { ok: true };
}));

admin.post('/mensalidades/:id/cancelar', rota(async req => {
  await db.run(`UPDATE mensalidades SET status = 'cancelada' WHERE id = ? AND status != 'paga'`, Number(req.params.id) || 0);
  return { ok: true };
}));

admin.post('/mensalidades/gerar', rota(async req => {
  const comp = /^\d{4}-\d{2}$/.test(req.body?.competencia || '') ? req.body.competencia : competenciaAtual();
  return { ok: true, criadas: await gerarMensalidades(comp) };
}));

// ---------- Chamada / presença ----------
admin.get('/chamada', rota(async req => {
  const data = /^\d{4}-\d{2}-\d{2}$/.test(req.query.data || '') ? req.query.data : hoje();
  const dia = diaSemana(data);
  const alunos = (await db.all(`SELECT u.id, u.nome, m.dias, p.presente, p.origem FROM matriculas m JOIN users u ON u.id = m.user_id
    LEFT JOIN presencas p ON p.user_id = u.id AND p.data = ?
    WHERE m.turma_id = ? AND m.status = 'ativa' ORDER BY lower(u.nome)`, data, Number(req.query.turma_id) || 0))
    .map(a => ({ ...a, treina_no_dia: a.dias.split(',').includes(dia) }));
  return { data, dia: DIAS_NOMES[dia], alunos };
}));

admin.post('/chamada', rota(async req => {
  const { data, turma_id, presencas } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) throw falha(400, 'Data inválida.');
  await transacao(async tx => {
    for (const p of presencas || []) {
      await tx.run(`INSERT INTO presencas (user_id, turma_id, data, presente, origem) VALUES (?, ?, ?, ?, 'chamada')
        ON CONFLICT (user_id, data) DO UPDATE SET presente = excluded.presente, turma_id = excluded.turma_id`, Number(p.user_id), Number(turma_id) || null, data, p.presente ? 1 : 0);
    }
  });
  return { ok: true };
}));

// ---------- Turmas, planos, avisos, configurações ----------
admin.get('/turmas', rota(async () => {
  const out = [];
  for (const t of await db.all('SELECT * FROM turmas ORDER BY ativo DESC, horario_inicio')) out.push({ ...t, ocupacao: await ocupacaoTurma(t.id) });
  return out;
}));

function dadosTurma(b) {
  const dias = DIAS_KEYS.filter(d => (b.dias || []).includes(d));
  if (!limpar(b.nome)) throw falha(400, 'Informe o nome da turma.');
  if (!dias.length) throw falha(400, 'Selecione ao menos um dia.');
  if (!/^\d{2}:\d{2}$/.test(b.horario_inicio || '') || !/^\d{2}:\d{2}$/.test(b.horario_fim || '')) throw falha(400, 'Horário inválido.');
  return [limpar(b.nome), limpar(b.categoria), b.horario_inicio, b.horario_fim, dias.join(','), Math.max(1, Number(b.capacidade) || 20), b.ativo === false ? 0 : 1];
}
admin.post('/turmas', rota(async req => {
  await db.run('INSERT INTO turmas (nome, categoria, horario_inicio, horario_fim, dias, capacidade, ativo) VALUES (?, ?, ?, ?, ?, ?, ?)', ...dadosTurma(req.body || {}));
  return { ok: true };
}));
admin.put('/turmas/:id', rota(async req => {
  await db.run('UPDATE turmas SET nome = ?, categoria = ?, horario_inicio = ?, horario_fim = ?, dias = ?, capacidade = ?, ativo = ? WHERE id = ?',
    ...dadosTurma(req.body || {}), Number(req.params.id) || 0);
  return { ok: true };
}));

admin.get('/planos', rota(() => db.all('SELECT * FROM planos ORDER BY tipo DESC, pessoas, dias_semana')));
admin.put('/planos/:id', rota(async req => {
  const preco = Number(req.body?.preco);
  if (!(preco > 0)) throw falha(400, 'Preço inválido.');
  await db.run('UPDATE planos SET nome = COALESCE(?, nome), preco = ?, ativo = ? WHERE id = ?',
    limpar(req.body?.nome), preco, req.body?.ativo === false ? 0 : 1, Number(req.params.id) || 0);
  return { ok: true };
}));

admin.get('/avisos', rota(() => db.all('SELECT * FROM avisos ORDER BY id DESC')));
admin.post('/avisos', rota(async req => {
  const titulo = limpar(req.body?.titulo), mensagem = limpar(req.body?.mensagem);
  if (!titulo || !mensagem) throw falha(400, 'Preencha título e mensagem.');
  await db.run('INSERT INTO avisos (titulo, mensagem) VALUES (?, ?)', titulo, mensagem);
  return { ok: true };
}));
admin.delete('/avisos/:id', rota(async req => { await db.run('DELETE FROM avisos WHERE id = ?', Number(req.params.id) || 0); return { ok: true }; }));

admin.get('/config', rota(async req => ({
  ...(await getConfig()),
  mercadopago: { ativo: mp.configurado(), teste: mp.modoTeste(), webhook: `${urlBase(req)}/api/mercadopago/webhook` },
})));
admin.put('/config', rota(async req => {
  const permitidas = ['nome_escola', 'whatsapp', 'instagram', 'endereco', 'chave_pix', 'dia_vencimento'];
  for (const k of permitidas) {
    if (req.body?.[k] !== undefined)
      await db.run('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor', k, String(req.body[k]).trim());
  }
  return { ok: true };
}));

admin.put('/senha', rota(trocarSenha));

app.use('/api/admin', admin);

app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ erro: 'Erro interno. Tente novamente.' }); });

// Rotinas: gera mensalidades do mês e limpa sessões expiradas
async function rotinas() {
  try {
    await gerarMensalidades();
    await db.run('DELETE FROM sessions WHERE expira_em < ?', Date.now());
  } catch (e) { console.error('Falha nas rotinas:', e.message); }
}

if (require.main === module) {
  inicializar().then(() => {
    rotinas();
    setInterval(rotinas, 6 * 3600e3).unref();
    app.listen(PORT, () => {
      console.log(`\n🏐 Kinusty Volleyball rodando em http://localhost:${PORT}`);
      console.log('   Admin: admin@kinusty.com / kinusty2026 (troque a senha em Configurações)\n');
    });
  }).catch(e => { console.error('Não foi possível conectar ao banco:', e.message); process.exit(1); });
}

module.exports = { app, gerarMensalidades };
