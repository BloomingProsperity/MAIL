CREATE TABLE IF NOT EXISTS scheduled_sends (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  draft_id UUID NOT NULL REFERENCES email_drafts(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  not_before TIMESTAMPTZ NOT NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  provider_queue_id TEXT,
  provider_message_id TEXT,
  last_error TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_sends_draft_active_uidx
  ON scheduled_sends (account_id, draft_id)
  WHERE status IN ('scheduled', 'queued', 'sending', 'failed');

CREATE INDEX IF NOT EXISTS scheduled_sends_status_not_before_idx
  ON scheduled_sends (status, not_before ASC, scheduled_at ASC);

CREATE INDEX IF NOT EXISTS scheduled_sends_account_status_idx
  ON scheduled_sends (account_id, status, scheduled_at ASC);

CREATE INDEX IF NOT EXISTS scheduled_sends_lease_idx
  ON scheduled_sends (lease_owner, lease_expires_at)
  WHERE lease_owner IS NOT NULL;
