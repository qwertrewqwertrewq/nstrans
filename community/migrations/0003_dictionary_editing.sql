PRAGMA foreign_keys = ON;

ALTER TABLE translations ADD COLUMN bonus_score INTEGER NOT NULL DEFAULT 0;

CREATE TABLE dictionary_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  translation_id INTEGER REFERENCES translations(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'api')),
  score_delta INTEGER NOT NULL,
  before_source TEXT NOT NULL,
  before_target TEXT NOT NULL,
  after_source TEXT NOT NULL,
  after_target TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX dictionary_edits_translation_idx ON dictionary_edits(translation_id, created_at DESC);
CREATE INDEX dictionary_edits_user_idx ON dictionary_edits(user_id, created_at DESC);
