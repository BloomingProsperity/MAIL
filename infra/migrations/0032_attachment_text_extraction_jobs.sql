CREATE TABLE IF NOT EXISTS attachment_text_extraction_jobs (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_attachment_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  not_before TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  error_message TEXT,
  extracted_text TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS attachment_text_jobs_status_not_before_idx
  ON attachment_text_extraction_jobs (status, not_before, created_at)
  WHERE status IN ('queued', 'failed');

CREATE INDEX IF NOT EXISTS attachment_text_jobs_account_status_idx
  ON attachment_text_extraction_jobs (account_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS attachment_text_jobs_message_idx
  ON attachment_text_extraction_jobs (message_id, status);
