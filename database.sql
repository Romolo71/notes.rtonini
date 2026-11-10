PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'superuser')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

-- Assenza della regola = visibile a tutti gli utenti autenticati.
-- Regola presente con 0 account associati = visibile solo al superutente.
CREATE TABLE IF NOT EXISTS note_permissions (
  note_id TEXT PRIMARY KEY,
  everyone INTEGER NOT NULL DEFAULT 0 CHECK (everyone IN (0, 1))
);
CREATE TABLE IF NOT EXISTS note_permission_users (
  note_id TEXT NOT NULL REFERENCES note_permissions(note_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, user_id)
);

CREATE TABLE IF NOT EXISTS course_permissions (
  course_name TEXT PRIMARY KEY COLLATE NOCASE,
  everyone INTEGER NOT NULL DEFAULT 0 CHECK (everyone IN (0, 1))
);
CREATE TABLE IF NOT EXISTS course_permission_users (
  course_name TEXT NOT NULL REFERENCES course_permissions(course_name) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (course_name, user_id)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  client_ip TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS api_cache_expiry ON api_cache(expires_at);
