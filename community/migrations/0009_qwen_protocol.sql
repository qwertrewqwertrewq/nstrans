-- Preserve existing routing until the administrator explicitly changes protocol.
ALTER TABLE qwen_proxy_config ADD COLUMN protocol TEXT NOT NULL DEFAULT 'auto'
  CHECK(protocol IN ('auto','chat','responses','anthropic'));
