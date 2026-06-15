ALTER TABLE mail_engine_events
  ADD COLUMN IF NOT EXISTS resource_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_email_id TEXT,
  ADD COLUMN IF NOT EXISTS rfc_message_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_uid TEXT,
  ADD COLUMN IF NOT EXISTS provider_path TEXT,
  ADD COLUMN IF NOT EXISTS resource_identity JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS mail_engine_events_resource_key_idx
  ON mail_engine_events (account_id, resource_key, received_at DESC)
  WHERE resource_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS mail_engine_events_provider_email_id_idx
  ON mail_engine_events (account_id, provider_email_id, received_at DESC)
  WHERE provider_email_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mail_engine_events_rfc_message_id_idx
  ON mail_engine_events (account_id, rfc_message_id, received_at DESC)
  WHERE rfc_message_id IS NOT NULL;
