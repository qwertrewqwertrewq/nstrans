DROP TRIGGER qwen_grant;
ALTER TABLE model_relay_grants RENAME TO model_relay_grants_legacy;
CREATE TABLE model_relay_grants (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  admin_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  action TEXT NOT NULL DEFAULT 'adjust' CHECK(action IN ('adjust','clear')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO model_relay_grants(id,user_id,admin_id,amount,note,created_at)
SELECT id,user_id,admin_id,amount,note,created_at FROM model_relay_grants_legacy;
DROP TABLE model_relay_grants_legacy;
CREATE TRIGGER model_relay_adjust_guard BEFORE INSERT ON model_relay_grants BEGIN
  SELECT RAISE(ABORT,'QUOTA_PENDING') WHERE (NEW.amount<0 OR NEW.action='clear')
    AND EXISTS(SELECT 1 FROM model_relay_usage WHERE user_id=NEW.user_id AND status='reserved');
  SELECT RAISE(ABORT,'QUOTA_EXCEEDED') WHERE COALESCE((SELECT balance FROM model_relay_quotas WHERE user_id=NEW.user_id),0)+NEW.amount<0;
END;
CREATE TRIGGER model_relay_adjust AFTER INSERT ON model_relay_grants BEGIN
  INSERT OR IGNORE INTO model_relay_quotas(user_id,balance,granted) VALUES(NEW.user_id,0,0);
  UPDATE model_relay_quotas SET balance=balance+NEW.amount,granted=granted+MAX(NEW.amount,0) WHERE user_id=NEW.user_id;
END;
