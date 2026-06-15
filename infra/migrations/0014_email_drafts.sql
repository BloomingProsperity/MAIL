CREATE TABLE IF NOT EXISTS email_drafts (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  to_emails JSONB NOT NULL DEFAULT '[]',
  cc_emails JSONB NOT NULL DEFAULT '[]',
  bcc_emails JSONB NOT NULL DEFAULT '[]',
  body_text TEXT,
  body_html TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'manual',
  reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  hermes_skill_run_id UUID REFERENCES hermes_skill_runs(id) ON DELETE SET NULL,
  provider_queue_id TEXT,
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_drafts_account_status_updated_idx
  ON email_drafts (account_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS email_drafts_account_sent_idx
  ON email_drafts (account_id, sent_at DESC)
  WHERE sent_at IS NOT NULL;
