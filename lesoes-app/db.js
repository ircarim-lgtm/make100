// Banco SQLite embutido no Node (node:sqlite, Node >= 22.13).
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, login TEXT NOT NULL UNIQUE, senha TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin','examinador','estomaterapeuta')),
  ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expira_em INTEGER NOT NULL
);
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
  id INTEGER PRIMARY KEY AUTOINCREMENT, em TEXT NOT NULL, user_id TEXT, user_nome TEXT, acao TEXT NOT NULL, alvo TEXT
);
`;

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return {
    all: (sql, ...p) => db.prepare(sql).all(...p),
    get: (sql, ...p) => db.prepare(sql).get(...p),
    run: (sql, ...p) => db.prepare(sql).run(...p),
    close: () => db.close(),
  };
}
