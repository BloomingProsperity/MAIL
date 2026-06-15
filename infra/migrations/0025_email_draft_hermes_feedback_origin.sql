ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS hermes_draft_text TEXT;

CREATE INDEX IF NOT EXISTS email_drafts_hermes_feedback_idx
  ON email_drafts (hermes_skill_run_id, created_at DESC, id DESC)
  WHERE source = 'hermes_reply'
    AND hermes_skill_run_id IS NOT NULL
    AND hermes_draft_text IS NOT NULL;
