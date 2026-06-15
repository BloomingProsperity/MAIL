ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS rfc_in_reply_to_message_id TEXT,
  ADD COLUMN IF NOT EXISTS rfc_references_message_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS messages_rfc_in_reply_to_idx
  ON messages (account_id, rfc_in_reply_to_message_id)
  WHERE rfc_in_reply_to_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_rfc_references_gin_idx
  ON messages USING GIN (rfc_references_message_ids);
