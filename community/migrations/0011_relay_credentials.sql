CREATE TABLE model_relay_credentials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('google','bailian','deepseek')),
  workspace TEXT NOT NULL DEFAULT '',
  encrypted_key TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO model_relay_credentials(id,name,platform,encrypted_key,key_iv)
SELECT 'legacy-google','原 Google API Key','google',encrypted_key,key_iv
FROM model_relay_config WHERE id=1 AND encrypted_key IS NOT NULL;
UPDATE model_relay_config SET models_json='[{"id":"gemini-2.5-flash","capability":"multimodal-search","enabled":true,"translationCost":1,"searchCost":2,"visionCost":2},{"id":"gemini-2.5-flash-lite","capability":"multimodal-search","enabled":true,"translationCost":1,"searchCost":2,"visionCost":2}]'
WHERE models_json='[]' AND encrypted_key IS NOT NULL;
UPDATE model_relay_config SET models_json=(
 SELECT json_group_array(json(json_set(value,'$.platform','google','$.model',json_extract(value,'$.id'),'$.keyId','legacy-google')))
 FROM json_each(model_relay_config.models_json)
) WHERE encrypted_key IS NOT NULL;
CREATE TABLE model_relay_catalog (
  credential_id TEXT NOT NULL REFERENCES model_relay_credentials(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  PRIMARY KEY(credential_id,model_id)
);
UPDATE model_relay_config SET models_json='[]',enabled=0
WHERE encrypted_key IS NULL AND NOT EXISTS (
 SELECT 1 FROM json_each(model_relay_config.models_json) WHERE json_extract(value,'$.platform') IS NOT NULL
);
UPDATE model_relay_config SET encrypted_key=NULL,key_iv=NULL;
