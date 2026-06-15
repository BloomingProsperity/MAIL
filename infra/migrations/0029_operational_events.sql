CREATE TABLE IF NOT EXISTS operational_events (
  id TEXT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  service TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  event TEXT NOT NULL,
  request_id TEXT,
  account_id TEXT,
  lane TEXT,
  job_id TEXT,
  message TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS operational_events_occurred_idx
  ON operational_events (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS operational_events_service_level_idx
  ON operational_events (service, level, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS operational_events_account_idx
  ON operational_events (account_id, occurred_at DESC, id DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS operational_events_lane_idx
  ON operational_events (lane, occurred_at DESC, id DESC)
  WHERE lane IS NOT NULL;

CREATE INDEX IF NOT EXISTS operational_events_job_idx
  ON operational_events (job_id, occurred_at DESC, id DESC)
  WHERE job_id IS NOT NULL;
