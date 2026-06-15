CREATE TABLE IF NOT EXISTS account_credentials (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  credential_kind TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, credential_kind)
);

CREATE TABLE IF NOT EXISTS account_provider_settings (
  account_id UUID PRIMARY KEY REFERENCES connected_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  native_provider TEXT,
  capabilities JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  mailbox_key TEXT NOT NULL DEFAULT '',
  cursor_type TEXT NOT NULL,
  cursor_value TEXT,
  cursor_json JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, mailbox_key, cursor_type)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY,
  account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,
  job_id UUID,
  mode TEXT NOT NULL DEFAULT 'incremental',
  status TEXT NOT NULL DEFAULT 'running',
  cursor_before JSONB NOT NULL DEFAULT '{}',
  cursor_after JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mail_engine_events (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  account_id TEXT,
  mailbox_id TEXT,
  provider_message_id TEXT,
  provider_thread_id TEXT,
  provider_event_name TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  raw_payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'received',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mail_engine_events_account_received_idx
  ON mail_engine_events (account_id, received_at DESC);

CREATE INDEX IF NOT EXISTS mail_engine_events_kind_received_idx
  ON mail_engine_events (kind, received_at DESC);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id UUID PRIMARY KEY,
  job_type TEXT NOT NULL,
  account_id TEXT,
  mailbox_id TEXT,
  trigger_event_id UUID REFERENCES mail_engine_events(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  not_before TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (trigger_event_id)
);

CREATE INDEX IF NOT EXISTS sync_jobs_status_not_before_idx
  ON sync_jobs (status, not_before, created_at);

CREATE INDEX IF NOT EXISTS sync_jobs_account_status_idx
  ON sync_jobs (account_id, status, created_at);

CREATE TABLE IF NOT EXISTS engine_commands (
  id UUID PRIMARY KEY,
  command_type TEXT NOT NULL,
  account_id TEXT NOT NULL,
  target JSONB NOT NULL DEFAULT '{}',
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  idempotency_key TEXT NOT NULL UNIQUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS engine_commands_status_created_idx
  ON engine_commands (status, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sync_runs_job_id_fkey'
      AND conrelid = 'sync_runs'::regclass
  ) THEN
    ALTER TABLE sync_runs
      ADD CONSTRAINT sync_runs_job_id_fkey
      FOREIGN KEY (job_id)
      REFERENCES sync_jobs(id)
      ON DELETE SET NULL;
  END IF;
END
$$;
