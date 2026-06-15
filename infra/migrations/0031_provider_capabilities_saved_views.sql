CREATE TABLE IF NOT EXISTS provider_capabilities (
  provider TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  connection_label TEXT NOT NULL,
  account_group TEXT NOT NULL,
  supports_login BOOLEAN NOT NULL DEFAULT FALSE,
  supports_app_password BOOLEAN NOT NULL DEFAULT FALSE,
  supports_server_search BOOLEAN NOT NULL DEFAULT FALSE,
  supports_calendar BOOLEAN NOT NULL DEFAULT FALSE,
  supports_contacts BOOLEAN NOT NULL DEFAULT FALSE,
  supports_alias_sync BOOLEAN NOT NULL DEFAULT FALSE,
  supports_recall BOOLEAN NOT NULL DEFAULT FALSE,
  supports_read_receipts BOOLEAN NOT NULL DEFAULT FALSE,
  supports_large_attachment BOOLEAN NOT NULL DEFAULT FALSE,
  supports_labels BOOLEAN NOT NULL DEFAULT FALSE,
  requires_local_bridge BOOLEAN NOT NULL DEFAULT FALSE,
  provider_specific_actions TEXT[] NOT NULL DEFAULT '{}',
  aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_capabilities_group_chk CHECK (
    account_group IN ('global', 'domestic', 'private', 'domain')
  )
);

CREATE INDEX IF NOT EXISTS provider_capabilities_group_idx
  ON provider_capabilities (account_group, provider);

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  tone TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  match_config JSONB NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT saved_views_tone_chk CHECK (
    tone IN ('coral', 'blue', 'green', 'yellow', 'purple')
  ),
  CONSTRAINT saved_views_kind_chk CHECK (
    kind IN ('keyword', 'message_fact')
  ),
  CONSTRAINT saved_views_source_chk CHECK (
    source IN ('system', 'user', 'hermes')
  )
);

CREATE INDEX IF NOT EXISTS saved_views_enabled_idx
  ON saved_views (enabled, sort_order, id);

CREATE INDEX IF NOT EXISTS saved_views_source_idx
  ON saved_views (source, id);
