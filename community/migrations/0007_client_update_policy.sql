CREATE TABLE client_update_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  target_version TEXT NOT NULL DEFAULT '0.1.5',
  popup_enabled INTEGER NOT NULL DEFAULT 0 CHECK (popup_enabled IN (0, 1)),
  force_update INTEGER NOT NULL DEFAULT 0 CHECK (force_update IN (0, 1)),
  content TEXT NOT NULL DEFAULT '',
  download_url TEXT NOT NULL DEFAULT 'https://nstrans.221129.xyz/download',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO client_update_policy(id, target_version, popup_enabled, force_update, content, download_url)
VALUES(1, '0.1.5', 0, 0, 'NSTrans 有可用的新版本。', 'https://nstrans.221129.xyz/download');
