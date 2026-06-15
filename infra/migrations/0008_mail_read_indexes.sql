CREATE INDEX IF NOT EXISTS messages_account_received_id_idx
  ON messages (account_id, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS message_locations_mailbox_message_idx
  ON message_locations (mailbox_id, message_id);

CREATE INDEX IF NOT EXISTS messages_from_email_trgm_idx
  ON messages USING GIN (from_email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS messages_from_name_trgm_idx
  ON messages USING GIN (from_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS messages_snippet_trgm_idx
  ON messages USING GIN (snippet gin_trgm_ops);
