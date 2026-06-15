CREATE TABLE IF NOT EXISTS hermes_runtime_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mode TEXT NOT NULL DEFAULT 'openai_compatible',
  provider_key TEXT NOT NULL DEFAULT 'custom',
  endpoint_url TEXT,
  model TEXT NOT NULL DEFAULT 'hermes-email',
  api_key_secret_ref TEXT REFERENCES stored_secrets(secret_ref) ON DELETE SET NULL,
  api_key_updated_at TIMESTAMPTZ,
  update_policy TEXT NOT NULL DEFAULT 'manual',
  update_channel TEXT NOT NULL DEFAULT 'stable',
  installed_version TEXT,
  latest_version TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hermes_runtime_settings_singleton CHECK (id = 'default'),
  CONSTRAINT hermes_runtime_settings_mode_chk CHECK (
    mode IN ('builtin', 'external_hermes', 'openai_compatible')
  ),
  CONSTRAINT hermes_runtime_settings_provider_key_chk CHECK (
    provider_key ~ '^[a-z0-9][a-z0-9_-]{1,79}$'
  ),
  CONSTRAINT hermes_runtime_update_policy_chk CHECK (
    update_policy IN ('manual', 'notify', 'auto_patch')
  ),
  CONSTRAINT hermes_runtime_update_channel_chk CHECK (
    update_channel IN ('stable', 'preview')
  )
);

CREATE INDEX IF NOT EXISTS hermes_runtime_settings_enabled_idx
  ON hermes_runtime_settings (enabled);

CREATE INDEX IF NOT EXISTS hermes_runtime_settings_provider_idx
  ON hermes_runtime_settings (provider_key);
