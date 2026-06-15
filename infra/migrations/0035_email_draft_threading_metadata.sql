ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS thread_action TEXT,
  ADD COLUMN IF NOT EXISTS thread_in_reply_to TEXT,
  ADD COLUMN IF NOT EXISTS thread_references TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS thread_emailengine_message_id TEXT,
  ADD COLUMN IF NOT EXISTS thread_gmail_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS thread_graph_message_id TEXT;

CREATE INDEX IF NOT EXISTS email_drafts_threading_idx
  ON email_drafts (account_id, source_message_id)
  WHERE thread_in_reply_to IS NOT NULL
     OR thread_emailengine_message_id IS NOT NULL;
