ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_iterations INTEGER;
ALTER TABLE users ADD COLUMN github_login TEXT;

UPDATE users SET username = login, github_login = login WHERE username IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci_idx ON users(username COLLATE NOCASE) WHERE username IS NOT NULL;

CREATE TABLE client_login_tickets (
  token_hash TEXT PRIMARY KEY,
  build_version TEXT NOT NULL,
  key_id TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ticket_expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX client_login_tickets_expiry_idx ON client_login_tickets(ticket_expires_at);
