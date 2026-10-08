-- New accounts only: existing accounts and repeated OAuth logins are not credited.
CREATE TABLE model_relay_signup_grants (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount>0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER model_relay_signup_credit AFTER INSERT ON users BEGIN
  INSERT INTO model_relay_signup_grants(user_id,amount) VALUES(NEW.id,30);
  INSERT INTO model_relay_quotas(user_id,balance,granted,spent) VALUES(NEW.id,30,30,0);
END;
