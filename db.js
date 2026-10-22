// Banco de dados Postgres (Neon). A conexão vem de DATABASE_URL.
process.env.TZ = process.env.TZ || 'America/Belem';

const crypto = require('node:crypto');
const pg = require('pg');

// COUNT/SUM de inteiros chegam como bigint/numeric (string) — converte para número
pg.types.setTypeParser(20, v => parseInt(v, 10));
pg.types.setTypeParser(1700, v => parseFloat(v));

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL (string de conexão do Postgres/Neon).');
  process.exit(1);
}

// sslmode=require já é tratado como verify-full pelo driver; explicitar evita o aviso no log
const url = process.env.DATABASE_URL.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
const pool = new pg.Pool({ connectionString: url, max: 5 });

// Permite escrever "?" como placeholder; converte para $1, $2...
const converter = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

function helpers(exec) {
  const q = (sql, params) => exec(converter(sql), params);
  return {
    all: async (sql, ...p) => (await q(sql, p)).rows,
    get: async (sql, ...p) => (await q(sql, p)).rows[0],
    run: async (sql, ...p) => { const r = await q(sql, p); return { changes: r.rowCount, rows: r.rows }; },
  };
}

const db = { ...helpers((sql, p) => pool.query(sql, p)), pool };

async function transacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(helpers((sql, p) => client.query(sql, p)));
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function conferirSenha(senha, armazenado) {
  const [salt, hash] = String(armazenado).split(':');
  if (!salt || !hash) return false;
  const teste = crypto.scryptSync(senha, salt, 64);
  const original = Buffer.from(hash, 'hex');
  return original.length === teste.length && crypto.timingSafeEqual(original, teste);
}

async function getConfig() {
  const rows = await db.all('SELECT chave, valor FROM config');
  return Object.fromEntries(rows.map(r => [r.chave, r.valor]));
}

const AGORA = `to_char(now() AT TIME ZONE 'America/Belem', 'YYYY-MM-DD HH24:MI:SS')`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'aluno',
  telefone TEXT,
  nascimento TEXT,
  cpf TEXT,
  responsavel TEXT,
  telefone_responsavel TEXT,
  contato_emergencia TEXT,
  observacoes_saude TEXT,
  criado_em TEXT NOT NULL DEFAULT ${AGORA}
);

CREATE TABLE IF NOT EXISTS planos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  dias_semana INTEGER NOT NULL,
  preco DOUBLE PRECISION NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS turmas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  categoria TEXT,
  horario_inicio TEXT NOT NULL,
  horario_fim TEXT NOT NULL,
  dias TEXT NOT NULL,
  capacidade INTEGER NOT NULL DEFAULT 20,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS matriculas (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plano_id INTEGER NOT NULL REFERENCES planos(id),
  turma_id INTEGER NOT NULL REFERENCES turmas(id),
  dias TEXT NOT NULL,
  nivel TEXT NOT NULL DEFAULT 'iniciante',
  status TEXT NOT NULL DEFAULT 'ativa',
  dia_vencimento INTEGER NOT NULL DEFAULT 10,
  data_inicio TEXT NOT NULL,
  cancelado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT ${AGORA}
);

CREATE TABLE IF NOT EXISTS mensalidades (
  id SERIAL PRIMARY KEY,
  matricula_id INTEGER NOT NULL REFERENCES matriculas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  valor DOUBLE PRECISION NOT NULL,
  vencimento TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  pago_em TEXT,
  forma_pagamento TEXT,
  criado_em TEXT NOT NULL DEFAULT ${AGORA},
  UNIQUE (matricula_id, competencia)
);

CREATE TABLE IF NOT EXISTS presencas (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  turma_id INTEGER REFERENCES turmas(id),
  data TEXT NOT NULL,
  presente INTEGER NOT NULL DEFAULT 1,
  origem TEXT NOT NULL DEFAULT 'chamada',
  UNIQUE (user_id, data)
);

CREATE TABLE IF NOT EXISTS avisos (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT ${AGORA}
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expira_em BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

ALTER TABLE mensalidades ADD COLUMN IF NOT EXISTS mp_payment_id TEXT;

-- Campos da ficha de inscrição
ALTER TABLE users ADD COLUMN IF NOT EXISTS sexo TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS parentesco_responsavel TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_responsavel TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ja_jogou INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS autoriza_imagem INTEGER;
-- Acompanhantes de plano casal/família não precisam de e-mail (não fazem login)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Planos em grupo: tipo (individual/casal/familia), quantas pessoas e dias obrigatórios
ALTER TABLE planos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE planos ADD COLUMN IF NOT EXISTS pessoas INTEGER NOT NULL DEFAULT 1;
ALTER TABLE planos ADD COLUMN IF NOT EXISTS dias_fixos TEXT;

-- grupo_id = matrícula do titular (quem paga); valor = 0 para os acompanhantes (NULL usa o preço do plano)
ALTER TABLE matriculas ADD COLUMN IF NOT EXISTS grupo_id INTEGER;
ALTER TABLE matriculas ADD COLUMN IF NOT EXISTS valor DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_mens_user ON mensalidades(user_id);
CREATE INDEX IF NOT EXISTS idx_mens_comp ON mensalidades(competencia);
CREATE INDEX IF NOT EXISTS idx_pres_data ON presencas(data);
CREATE INDEX IF NOT EXISTS idx_mat_user ON matriculas(user_id);
`;

// Cria as tabelas e os dados iniciais (planos, turmas, configurações, admin)
async function inicializar() {
  await pool.query(SCHEMA);

  if (!(await db.get('SELECT COUNT(*) AS n FROM planos')).n) {
    for (const [nome, dias, preco] of [['Plano 2x na semana', 2, 150], ['Plano 3x na semana', 3, 200], ['Plano 4x na semana', 4, 230]])
      await db.run('INSERT INTO planos (nome, dias_semana, preco) VALUES (?, ?, ?)', nome, dias, preco);
  }

  // Plano casal: valor total para os dois. Plano família: só terça e quinta (horário do Kids), valor pelo nº de pessoas.
  if (!(await db.get("SELECT COUNT(*) AS n FROM planos WHERE tipo != 'individual'")).n) {
    const grupo = [
      ['Plano Casal 2x na semana', 2, 280, 'casal', 2, null],
      ['Plano Casal 3x na semana', 3, 370, 'casal', 2, null],
      ['Plano Casal 4x na semana', 4, 420, 'casal', 2, null],
      ['Plano Família — 2 pessoas', 2, 270, 'familia', 2, 'ter,qui'],
      ['Plano Família — 3 pessoas', 2, 405, 'familia', 3, 'ter,qui'],
      ['Plano Família — 4 pessoas', 2, 540, 'familia', 4, 'ter,qui'],
    ];
    for (const p of grupo)
      await db.run('INSERT INTO planos (nome, dias_semana, preco, tipo, pessoas, dias_fixos) VALUES (?, ?, ?, ?, ?, ?)', ...p);
  }

  if (!(await db.get('SELECT COUNT(*) AS n FROM turmas')).n) {
    const turmas = [
      ['Turma Kids', 'Kids', '18:00', '19:00', 'seg,ter,qui,sex', 20],
      ['Turma DS', 'Misto', '19:00', '20:00', 'ter,qui', 24],
      ['Feminino', 'Feminino', '19:00', '20:00', 'seg,ter,qui,sex', 24],
      ['Masculino', 'Masculino', '20:00', '21:00', 'seg,ter,qui,sex', 24],
    ];
    for (const t of turmas)
      await db.run('INSERT INTO turmas (nome, categoria, horario_inicio, horario_fim, dias, capacidade) VALUES (?, ?, ?, ?, ?, ?)', ...t);
  }

  const padrao = {
    nome_escola: 'Kinusty Volleyball',
    whatsapp: '5591985915148',
    instagram: 'kinustyvolleyball',
    endereco: 'Igreja dos Capuchinhos — Belém/PA',
    chave_pix: 'kinustyvolleyball@pix.com',
    dia_vencimento: '10',
  };
  for (const [k, v] of Object.entries(padrao))
    await db.run('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO NOTHING', k, v);

  if (!(await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")).n) {
    await db.run("INSERT INTO users (nome, email, senha_hash, role) VALUES (?, ?, ?, 'admin')",
      'Administrador Kinusty', 'admin@kinusty.com', hashSenha(process.env.ADMIN_SENHA || 'kinusty2026'));
  }
}

module.exports = { db, pool, hashSenha, conferirSenha, transacao, getConfig, inicializar };
