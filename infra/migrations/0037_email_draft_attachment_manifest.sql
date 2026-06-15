ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS attachment_manifest JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS email_drafts_attachment_manifest_gin_idx
  ON email_drafts USING GIN (attachment_manifest);
