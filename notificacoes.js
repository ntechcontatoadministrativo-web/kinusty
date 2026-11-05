// Notificações no celular (Web Push), como as do WhatsApp: chegam mesmo com o site fechado.
// - Lembrete: ANTES_MIN minutos antes do treino do aluno
// - Avaliação: quando o treino acaba, pedindo para o aluno avaliar (até DEPOIS_MIN minutos depois)
const webpush = require('web-push');
const { db } = require('./db');

const ANTES_MIN = 30;
const DEPOIS_MIN = 120;
const SITE = process.env.SITE_URL || 'https://kinusty.onrender.com';

const DIAS_KEYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const pad = n => String(n).padStart(2, '0');
const hojeStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutos = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const primeiroNome = nome => String(nome || '').split(' ')[0];

// ---------- Chaves VAPID ----------
// Vêm das variáveis VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ou são geradas uma vez e guardadas no banco
let chavePublica = null;
async function prepararChaves() {
  if (chavePublica) return chavePublica;
  let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const novas = webpush.generateVAPIDKeys();
    await db.run(`INSERT INTO config (chave, valor) VALUES ('vapid_publica', ?), ('vapid_privada', ?) ON CONFLICT (chave) DO NOTHING`, novas.publicKey, novas.privateKey);
    const rows = await db.all(`SELECT chave, valor FROM config WHERE chave IN ('vapid_publica', 'vapid_privada')`);
    const c = Object.fromEntries(rows.map(r => [r.chave, r.valor]));
    pub = c.vapid_publica; priv = c.vapid_privada;
  }
  webpush.setVapidDetails(SITE, pub, priv);
  chavePublica = pub;
  return pub;
}

// ---------- Inscrições dos aparelhos ----------
async function inscrever(userId, sub) {
  const endpoint = String(sub?.endpoint || '');
  const { p256dh, auth } = sub?.keys || {};
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof p256dh !== 'string' || typeof auth !== 'string')
    throw Object.assign(new Error('Inscrição de notificação inválida.'), { status: 400 });
  await db.run(`INSERT INTO push_inscricoes (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`, endpoint, userId, p256dh, auth);
}

const desinscrever = (userId, endpoint) => db.run('DELETE FROM push_inscricoes WHERE user_id = ? AND endpoint = ?', userId, String(endpoint || ''));

// Envia para todos os aparelhos dos usuários; apaga inscrições que o celular já cancelou
async function enviar(userIds, montar) {
  if (!userIds.length) return 0;
  await prepararChaves();
  const subs = await db.all(`SELECT pi.*, u.nome FROM push_inscricoes pi JOIN users u ON u.id = pi.user_id WHERE pi.user_id = ANY(?::int[])`, userIds);
  let ok = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(montar(s)), { TTL: 3600, urgency: 'high' });
      ok++;
    } catch (e) {
      if ([404, 410].includes(e.statusCode)) await db.run('DELETE FROM push_inscricoes WHERE endpoint = ?', s.endpoint);
      else console.error('Falha ao enviar notificação:', e.statusCode || '', e.body || e.message);
    }
  }));
  return ok;
}

const enviarTeste = userId => enviar([userId], s => ({
  titulo: '🏐 Kinusty Volleyball',
  corpo: `Tudo certo, ${primeiroNome(s.nome)}! As notificações dos seus treinos estão ativadas.`,
  url: '/aluno.html', tag: 'teste',
}));

// ---------- Agendador ----------
// As turmas ficam em memória para o banco só ser consultado perto dos horários de treino
let turmas = null;
async function recarregarTurmas() {
  turmas = await db.all('SELECT id, nome, horario_inicio, horario_fim, dias FROM turmas WHERE ativo = 1');
}

// Marca como enviado e devolve quem ainda não recebeu (seguro mesmo se rodar duas vezes ao mesmo tempo)
async function alunosParaAvisar(turma, data, dia, tipo) {
  const rows = await db.all(`INSERT INTO notificacoes_enviadas (user_id, data, tipo)
    SELECT DISTINCT m.user_id, ?::text, ?::text FROM matriculas m
    WHERE m.turma_id = ? AND m.status = 'ativa' AND m.data_inicio <= ? AND ? = ANY(string_to_array(m.dias, ','))
      AND EXISTS (SELECT 1 FROM push_inscricoes pi WHERE pi.user_id = m.user_id)
      ${tipo === 'avaliacao' ? `AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.user_id = m.user_id AND p.data = ? AND p.presente = 0)
      AND NOT EXISTS (SELECT 1 FROM avaliacoes a WHERE a.user_id = m.user_id AND a.data = ?)` : ''}
    ON CONFLICT DO NOTHING RETURNING user_id`,
    data, tipo, turma.id, data, dia, ...(tipo === 'avaliacao' ? [data, data] : []));
  return rows.map(r => r.user_id);
}

async function avisarTurma(turma, data, dia, tipo) {
  const ids = await alunosParaAvisar(turma, data, dia, tipo);
  if (tipo === 'lembrete') {
    return enviar(ids, s => ({
      titulo: '🏐 Treino daqui a pouco!',
      corpo: `${primeiroNome(s.nome)}, seu treino da ${turma.nome} começa às ${turma.horario_inicio}. Bora pra quadra! 💪`,
      url: '/aluno.html#inicio', tag: `lembrete-${data}`,
    }));
  }
  return enviar(ids, s => ({
    titulo: '⭐ Como foi o treino de hoje?',
    corpo: `${primeiroNome(s.nome)}, o treino da ${turma.nome} acabou. Toque aqui e avalie em poucos segundos!`,
    url: `/aluno.html?avaliar=${data}#inicio`, tag: `avaliacao-${data}`,
  }));
}

let rodando = false;
async function verificar() {
  if (rodando) return;
  rodando = true;
  try {
    if (!turmas) await recarregarTurmas();
    const agora = new Date();
    const min = agora.getHours() * 60 + agora.getMinutes();
    const data = hojeStr(agora), dia = DIAS_KEYS[agora.getDay()];
    for (const t of turmas) {
      if (!t.dias.split(',').includes(dia)) continue;
      const ini = minutos(t.horario_inicio), fim = minutos(t.horario_fim);
      if (min >= ini - ANTES_MIN && min < ini) await avisarTurma(t, data, dia, 'lembrete');
      else if (min >= fim && min < fim + DEPOIS_MIN) await avisarTurma(t, data, dia, 'avaliacao');
    }
  } catch (e) {
    console.error('Falha nas notificações:', e.message);
  } finally {
    rodando = false;
  }
}

function iniciar() {
  prepararChaves().catch(e => console.error('Falha nas chaves de notificação:', e.message));
  verificar();
  setInterval(verificar, 60e3).unref();
}

module.exports = { prepararChaves, inscrever, desinscrever, enviarTeste, recarregarTurmas, iniciar, ANTES_MIN };
