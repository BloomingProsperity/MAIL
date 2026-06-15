ALTER TABLE engine_commands
  ADD COLUMN IF NOT EXISTS not_before TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS engine_commands_status_not_before_idx
  ON engine_commands (status, not_before, created_at);

CREATE INDEX IF NOT EXISTS engine_commands_account_status_idx
  ON engine_commands (account_id, status, created_at);
