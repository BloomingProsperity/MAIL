ALTER TABLE message_state
  ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_action_token TEXT,
  ADD COLUMN IF NOT EXISTS undo_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS message_state_done_at_idx
  ON message_state (done_at)
  WHERE done_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS message_state_undo_token_idx
  ON message_state (last_action_token)
  WHERE last_action_token IS NOT NULL;
