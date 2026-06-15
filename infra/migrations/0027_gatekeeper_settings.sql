CREATE TABLE IF NOT EXISTS gatekeeper_settings (
  account_id UUID PRIMARY KEY REFERENCES connected_accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'off_accept_all',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode IN ('before_inbox', 'inside_email', 'off_accept_all'))
);

CREATE INDEX IF NOT EXISTS gatekeeper_settings_mode_idx
  ON gatekeeper_settings (mode, account_id);
