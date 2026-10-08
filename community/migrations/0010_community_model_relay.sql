-- Preserve quotas and historical usage; remove the old Qwen credential and routing.
ALTER TABLE qwen_proxy_config RENAME TO model_relay_config;
ALTER TABLE qwen_quotas RENAME TO model_relay_quotas;
ALTER TABLE qwen_quota_grants RENAME TO model_relay_grants;
ALTER TABLE qwen_usage RENAME TO model_relay_usage;
ALTER TABLE model_relay_config DROP COLUMN protocol;
ALTER TABLE model_relay_config ADD COLUMN routes_json TEXT NOT NULL
  DEFAULT '{"translation":"gemini-2.5-flash-lite","search":"gemini-2.5-flash","vision":"gemini-2.5-flash"}';
UPDATE model_relay_config SET enabled=0,endpoint='https://generativelanguage.googleapis.com/v1beta',
  encrypted_key=NULL,key_iv=NULL,models_json='[]',updated_at=CURRENT_TIMESTAMP WHERE id=1;
