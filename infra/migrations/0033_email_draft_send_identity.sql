ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS from_address TEXT,
  ADD COLUMN IF NOT EXISTS from_name TEXT;

CREATE INDEX IF NOT EXISTS email_drafts_from_address_idx
  ON email_drafts (account_id, lower(from_address))
  WHERE from_address IS NOT NULL;
