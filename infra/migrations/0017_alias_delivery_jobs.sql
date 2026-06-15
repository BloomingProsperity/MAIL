CREATE TABLE IF NOT EXISTS alias_delivery_jobs (
  id UUID PRIMARY KEY,
  domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
  alias_id UUID REFERENCES aliases(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,
  destination_id UUID REFERENCES destinations(id) ON DELETE SET NULL,
  destination_email TEXT NOT NULL,
  sender TEXT,
  message_fingerprint TEXT NOT NULL,
  raw_message_ref TEXT,
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
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alias_delivery_jobs_status_not_before_idx
  ON alias_delivery_jobs (status, not_before, created_at);

CREATE INDEX IF NOT EXISTS alias_delivery_jobs_domain_status_idx
  ON alias_delivery_jobs (domain_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS alias_delivery_jobs_destination_status_idx
  ON alias_delivery_jobs (destination_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS alias_delivery_jobs_lease_expires_idx
  ON alias_delivery_jobs (lease_expires_at)
  WHERE status = 'running';
