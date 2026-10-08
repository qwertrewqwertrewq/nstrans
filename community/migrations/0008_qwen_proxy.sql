CREATE TABLE qwen_proxy_config (
  id INTEGER PRIMARY KEY CHECK (id=1), enabled INTEGER NOT NULL DEFAULT 0,
  endpoint TEXT NOT NULL DEFAULT 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  encrypted_key TEXT, key_iv TEXT, models_json TEXT NOT NULL,
  max_concurrency INTEGER NOT NULL DEFAULT 2 CHECK(max_concurrency BETWEEN 1 AND 8),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO qwen_proxy_config(id,models_json) VALUES(1,'[]');
CREATE TABLE qwen_quotas (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),
  granted INTEGER NOT NULL DEFAULT 0, spent INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE qwen_quota_grants (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  admin_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount>0),
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE qwen_usage (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  model TEXT NOT NULL, purpose TEXT NOT NULL, cost INTEGER NOT NULL CHECK(cost>0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','success','failed','uncertain')),
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0, upstream_id TEXT, error_code TEXT,
  duration_ms INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
);
CREATE INDEX qwen_usage_user_time ON qwen_usage(user_id,created_at DESC);
CREATE INDEX qwen_usage_status_time ON qwen_usage(status,created_at);
CREATE TRIGGER qwen_grant AFTER INSERT ON qwen_quota_grants BEGIN
  INSERT INTO qwen_quotas(user_id,balance,granted) VALUES(NEW.user_id,NEW.amount,NEW.amount)
    ON CONFLICT(user_id) DO UPDATE SET balance=balance+NEW.amount,granted=granted+NEW.amount;
END;
-- Reservations and deductions are one SQLite transaction, including simultaneous requests.
CREATE TRIGGER qwen_reserve_guard BEFORE INSERT ON qwen_usage BEGIN
  SELECT RAISE(ABORT,'QUOTA_EXCEEDED') WHERE COALESCE((SELECT balance FROM qwen_quotas WHERE user_id=NEW.user_id),0)<NEW.cost;
  SELECT RAISE(ABORT,'PROXY_BUSY') WHERE (SELECT COUNT(*) FROM qwen_usage WHERE user_id=NEW.user_id AND status='reserved')>=2;
  SELECT RAISE(ABORT,'PROXY_BUSY') WHERE (SELECT COUNT(*) FROM qwen_usage WHERE status='reserved')>=(SELECT max_concurrency FROM qwen_proxy_config WHERE id=1);
END;
CREATE TRIGGER qwen_reserve AFTER INSERT ON qwen_usage BEGIN
  UPDATE qwen_quotas SET balance=balance-NEW.cost WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER qwen_settle AFTER UPDATE OF status ON qwen_usage
WHEN OLD.status='reserved' AND NEW.status IN('success','uncertain') BEGIN
  UPDATE qwen_quotas SET spent=spent+NEW.cost WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER qwen_refund AFTER UPDATE OF status ON qwen_usage
WHEN OLD.status='reserved' AND NEW.status='failed' BEGIN
  UPDATE qwen_quotas SET balance=balance+NEW.cost WHERE user_id=NEW.user_id;
END;
