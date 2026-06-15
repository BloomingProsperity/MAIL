ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

UPDATE email_drafts
SET source_message_id = reply_to_message_id
WHERE source_message_id IS NULL
  AND reply_to_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_drafts_source_message_idx
  ON email_drafts (account_id, source_message_id)
  WHERE source_message_id IS NOT NULL;
