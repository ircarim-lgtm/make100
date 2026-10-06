// Banco de dados: Postgres quando há DATABASE_URL/POSTGRES_URL (Vercel, produção),
// senão SQLite embutido no Node (node:sqlite, Node >= 22.13) para uso local/Docker.
const TABLES = (auto) => `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, login TEXT NOT NULL UNIQUE, senha TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin','examinador','estomaterapeuta')),
  ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expira_em BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS tentativas (chave TEXT PRIMARY KEY, n INTEGER NOT NULL, ate BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS pacientes (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, prontuario TEXT NOT NULL UNIQUE,
  data_nascimento TEXT, sexo TEXT, leito TEXT, comorbidades TEXT, braden TEXT,
  consentimento_por TEXT NOT NULL, consentimento_em TEXT NOT NULL,
  criado_por TEXT NOT NULL, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS registros (
  id TEXT PRIMARY KEY, paciente_id TEXT NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  local TEXT, observacoes TEXT, status TEXT NOT NULL DEFAULT 'rascunho',
  foto_arquivo TEXT, foto_tipo TEXT, foto_em TEXT,
  criado_por TEXT NOT NULL, criado_por_nome TEXT NOT NULL, criado_em TEXT NOT NULL,
  enviado_em TEXT, avaliacao TEXT, avaliacao_visto INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reg_pac ON registros(paciente_id);
CREATE INDEX IF NOT EXISTS idx_reg_status ON registros(status);
CREATE TABLE IF NOT EXISTS auditoria (
  id ${auto}, em TEXT NOT NULL, user_id TEXT, user_nome TEXT, acao TEXT NOT NULL, alvo TEXT
);
`;

async function openPg(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000 });
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const q = (sql, p) => pool.query(toPg(sql), p);
  const c = await pool.connect();
  try { // lock evita corrida entre instâncias na criação do esquema
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(7424)');
    await c.query(TABLES('SERIAL PRIMARY KEY'));
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return {
    all: async (sql, ...p) => (await q(sql, p)).rows,
    get: async (sql, ...p) => (await q(sql, p)).rows[0],
    run: async (sql, ...p) => { await q(sql, p); },
  };
}

async function openSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(TABLES('INTEGER PRIMARY KEY AUTOINCREMENT'));
  return {
    all: async (sql, ...p) => db.prepare(sql).all(...p),
    get: async (sql, ...p) => db.prepare(sql).get(...p),
    run: async (sql, ...p) => { db.prepare(sql).run(...p); },
  };
}

export async function openDb(sqliteFile) {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return url ? openPg(url) : openSqlite(sqliteFile);
}
