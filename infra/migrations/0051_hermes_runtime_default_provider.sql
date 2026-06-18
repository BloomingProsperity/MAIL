ALTER TABLE hermes_runtime_settings
  ALTER COLUMN provider_key SET DEFAULT 'openai-api',
  ALTER COLUMN model SET DEFAULT 'gpt-5.2';
