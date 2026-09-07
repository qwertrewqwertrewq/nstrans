PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX api_keys_user_idx ON api_keys(user_id, revoked_at);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  japanese_name TEXT NOT NULL,
  chinese_name TEXT NOT NULL,
  poster_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX games_status_idx ON games(status, created_at);
INSERT INTO games(id, japanese_name, chinese_name, status) VALUES ('general', '汎用ゲーム', '通用游戏', 'approved');
INSERT INTO games(id, japanese_name, chinese_name, status) VALUES ('zelda-totk', 'ゼルダの伝説 ティアーズ オブ ザ キングダム', '塞尔达传说：王国之泪', 'approved');

CREATE TABLE terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source_text TEXT NOT NULL,
  normalized_source TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('term', 'phrase')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id, normalized_source)
);
CREATE INDEX terms_game_idx ON terms(game_id, updated_at);

CREATE TABLE translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  target_text TEXT NOT NULL,
  normalized_target TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  provenance TEXT NOT NULL DEFAULT 'community' CHECK (provenance IN ('translategemma', 'wikimedia', 'community')),
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(term_id, normalized_target)
);
CREATE INDEX translations_rank_idx ON translations(term_id, score DESC, updated_at DESC);

CREATE TABLE votes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  translation_id INTEGER NOT NULL REFERENCES translations(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, translation_id)
);

-- A new distinct translation always survives. If it becomes the fourth option,
-- one existing lowest-score translation is removed; RANDOM() resolves score ties.
CREATE TRIGGER translations_keep_top_three
AFTER INSERT ON translations
WHEN (SELECT COUNT(*) FROM translations WHERE term_id = NEW.term_id) > 3
BEGIN
  DELETE FROM translations
  WHERE id = (
    SELECT id FROM translations
    WHERE term_id = NEW.term_id AND id != NEW.id
    ORDER BY score ASC, RANDOM()
    LIMIT 1
  );
END;
