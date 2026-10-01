ALTER TABLE api_keys ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE api_keys ADD COLUMN device_id TEXT;
ALTER TABLE api_keys ADD COLUMN device_name TEXT;
CREATE INDEX api_keys_device_idx ON api_keys(user_id, device_id, revoked_at);

CREATE TABLE client_auth_flows (
  browser_token_hash TEXT PRIMARY KEY,
  poll_token_hash TEXT NOT NULL UNIQUE,
  build_version TEXT NOT NULL,
  platform TEXT,
  variant TEXT,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  encrypted_api_key TEXT,
  encryption_iv TEXT,
  browser_started_at TEXT,
  completed_at TEXT,
  claimed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX client_auth_flows_expiry_idx ON client_auth_flows(expires_at);
