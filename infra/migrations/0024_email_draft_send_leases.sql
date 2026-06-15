ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS send_lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS send_lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS email_drafts_send_lease_idx
  ON email_drafts (send_lease_owner, send_lease_expires_at)
  WHERE send_lease_owner IS NOT NULL;
