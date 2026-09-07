PRAGMA foreign_keys = ON;

CREATE TABLE search_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL DEFAULT 'general' REFERENCES games(id) ON DELETE CASCADE,
  source_text TEXT NOT NULL,
  normalized_source TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id, normalized_source)
);

CREATE INDEX search_exclusions_game_idx ON search_exclusions(game_id, updated_at);
