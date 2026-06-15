ALTER TABLE provider_message_refs
  ADD COLUMN IF NOT EXISTS emailengine_email_id TEXT,
  ADD COLUMN IF NOT EXISTS internet_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS provider_message_refs_emailengine_email_id_uidx
  ON provider_message_refs (account_id, provider, emailengine_email_id)
  WHERE provider = 'emailengine' AND emailengine_email_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS provider_message_refs_internet_message_id_idx
  ON provider_message_refs (account_id, provider, internet_message_id)
  WHERE internet_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_internet_message_id_idx
  ON messages (account_id, internet_message_id)
  WHERE internet_message_id IS NOT NULL;
