ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS content_id TEXT,
  ADD COLUMN IF NOT EXISTS embedded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inline BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS encoded_in_message BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS attachments_message_id_idx
  ON attachments (message_id);

CREATE INDEX IF NOT EXISTS attachments_content_type_idx
  ON attachments (content_type);
