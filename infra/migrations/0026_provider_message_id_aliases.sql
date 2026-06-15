ALTER TABLE provider_message_refs
  ADD COLUMN IF NOT EXISTS provider_message_id_aliases JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS provider_message_refs_id_aliases_gin_idx
  ON provider_message_refs USING GIN (provider_message_id_aliases);
