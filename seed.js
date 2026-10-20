// Popula o sistema com alunos fictícios para demonstração do painel.
//   npm run seed   -> adiciona dados de demonstração
//   npm run reset  -> apaga todas as tabelas e recria do zero (somente admin, sem demo)
const { db, pool, hashSenha, transacao, inicializar } = require('./db');

async function reset() {
  await pool.query('DROP TABLE IF EXISTS sessions, presencas, mensalidades, matriculas, avisos, users, turmas, planos, config CASCADE');
  await inicializar();
  console.log('Banco recriado. Login admin: admin@kinusty.com / kinusty2026');
}

const nomes = ['Ana', 'Beatriz', 'Carla', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Júlia', 'Larissa', 'Mariana', 'Natália', 'Paula', 'Rafaela', 'Sofia', 'Vitória', 'Yasmin'];
const nomesM = ['André', 'Bruno', 'Caio', 'Diego', 'Enzo', 'Felipe', 'Gustavo', 'Henrique', 'Igor', 'João', 'Lucas', 'Mateus', 'Pedro', 'Rafael', 'Samuel', 'Thiago', 'Vinícius'];
const sobrenomes = ['Silva', 'Souza', 'Costa', 'Pereira', 'Oliveira', 'Lima', 'Carvalho', 'Ribeiro', 'Almeida', 'Barbosa', 'Rodrigues', 'Monteiro', 'Sawada', 'Cardoso', 'Nascimento', 'Moraes'];

let semente = 42;
const rnd = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

// INSERT de várias linhas de uma vez (bem mais rápido num banco remoto)
async function inserirLote(tx, tabela, colunas, linhas, extra = '') {
  for (let i = 0; i < linhas.length; i += 200) {
    const lote = linhas.slice(i, i + 200);
    const valores = lote.map(() => `(${colunas.map(() => '?').join(', ')})`).join(', ');
    await tx.run(`INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES ${valores} ${extra}`, ...lote.flat());
  }
}

async function seed() {
  await inicializar();
  const { gerarMensalidades } = require('./server');
  const planos = await db.all('SELECT * FROM planos ORDER BY dias_semana');
  const turmas = await db.all('SELECT * FROM turmas');
  const porNome = n => turmas.find(t => t.nome === n);
  const hoje = new Date();
  const senha = hashSenha('aluno123');
  const total = 64;

  await transacao(async tx => {
    for (let i = 0; i < total; i++) {
      const kids = i % 6 === 0;
      const fem = !kids && rnd() < 0.55;
      const primeiro = fem || (kids && rnd() < 0.5) ? pick(nomes) : pick(nomesM);
      const nome = `${primeiro} ${pick(sobrenomes)} ${pick(sobrenomes)}`;
      const email = `${primeiro.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}.demo${i}@exemplo.com`;
      const idade = kids ? 8 + Math.floor(rnd() * 5) : 14 + Math.floor(rnd() * 26);
      const nasc = new Date(hoje.getFullYear() - idade, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28));
      const tel = `(91) 9${8000 + Math.floor(rnd() * 1999)}-${1000 + Math.floor(rnd() * 8999)}`;
      const menor = idade < 18;

      // Matrículas distribuídas nos últimos ~7 meses, crescendo com o tempo
      const inicio = new Date(hoje); inicio.setDate(inicio.getDate() - Math.floor(Math.pow(rnd(), 0.8) * 210));

      const turma = kids ? porNome('Turma Kids') : rnd() < 0.15 ? porNome('Turma DS') : fem ? porNome('Feminino') : porNome('Masculino');
      const diasTurma = turma.dias.split(',');
      const r = rnd();
      let plano = r < 0.45 ? planos[0] : r < 0.8 ? planos[1] : planos[2];
      if (plano.dias_semana > diasTurma.length) plano = planos[0];
      const dias = [...diasTurma].sort(() => rnd() - 0.5).slice(0, plano.dias_semana);

      let status = 'ativa', cancelado = null;
      if (rnd() < 0.08) { status = 'cancelada'; const c = new Date(inicio); c.setDate(c.getDate() + 30 + Math.floor(rnd() * 60)); cancelado = fmt(c > hoje ? hoje : c); }
      else if (rnd() < 0.04) status = 'trancada';

      const u = await tx.get(`INSERT INTO users (nome, email, senha_hash, telefone, nascimento, responsavel, telefone_responsavel, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, nome, email, senha, tel, fmt(nasc), menor ? `Responsável de ${primeiro}` : null, menor ? tel : null, `${fmt(inicio)} 10:00:00`);
      await tx.run(`INSERT INTO matriculas (user_id, plano_id, turma_id, dias, nivel, status, dia_vencimento, data_inicio, cancelado_em)
        VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?)`, u.id, plano.id, turma.id, DIAS.filter(d => dias.includes(d)).join(','),
        pick(['iniciante', 'iniciante', 'intermediario', 'avancado']), status, fmt(inicio), cancelado);
    }
  });

  // Mensalidades retroativas (com pagamentos) e presenças
  const mats = await db.all('SELECT m.*, p.preco FROM matriculas m JOIN planos p ON p.id = m.plano_id');
  const mens = [], pres = [];
  for (const m of mats) {
    const ini = new Date(m.data_inicio + 'T00:00:00');
    const fim = m.cancelado_em ? new Date(m.cancelado_em + 'T00:00:00') : hoje;
    const bomPagador = rnd() < 0.85;
    for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d <= fim; d.setMonth(d.getMonth() + 1)) {
      const comp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      const venc = `${comp}-10`;
      const vencido = new Date(venc + 'T00:00:00') < hoje;
      const mesAtual = comp === fmt(hoje).slice(0, 7);
      let status = 'pendente', pago = null, forma = null;
      if ((vencido && (bomPagador || rnd() < 0.6)) || (!vencido && rnd() < 0.35)) {
        status = 'paga'; forma = pick(['PIX', 'PIX', 'PIX', 'Dinheiro', 'Cartão']);
        const p = new Date(venc + 'T00:00:00'); p.setDate(p.getDate() - 5 + Math.floor(rnd() * 9));
        pago = fmt(p > hoje ? hoje : p);
      } else if (mesAtual && rnd() < 0.3) status = 'em_analise';
      if (m.status === 'trancada' && !vencido) continue;
      mens.push([m.id, m.user_id, comp, m.preco, venc, status, pago, forma]);
    }
    if (m.status !== 'ativa') continue;
    const assiduidade = 0.6 + rnd() * 0.38;
    for (let k = 45; k >= 1; k--) {
      const d = new Date(hoje); d.setDate(d.getDate() - k);
      if (d < ini || !m.dias.split(',').includes(DIAS[d.getDay()])) continue;
      pres.push([m.user_id, m.turma_id, fmt(d), rnd() < assiduidade ? 1 : 0, 'chamada']);
    }
  }

  await transacao(async tx => {
    await inserirLote(tx, 'mensalidades', ['matricula_id', 'user_id', 'competencia', 'valor', 'vencimento', 'status', 'pago_em', 'forma_pagamento'], mens, 'ON CONFLICT DO NOTHING');
    await inserirLote(tx, 'presencas', ['user_id', 'turma_id', 'data', 'presente', 'origem'], pres, 'ON CONFLICT DO NOTHING');
    await tx.run('INSERT INTO avisos (titulo, mensagem) VALUES (?, ?)', 'Bem-vindos à Kinusty!',
      'Treinos às segundas, terças, quintas e sextas na Igreja dos Capuchinhos. Chegue 10 minutos antes e traga sua garrafinha de água. 🏐');
  });

  await gerarMensalidades();
  console.log(`✔ ${total} alunos de demonstração criados (senha de todos: aluno123).`);
}

(process.argv.includes('--reset') ? reset() : seed())
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
