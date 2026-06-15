ALTER TABLE hermes_rule_candidates
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS rule_type TEXT,
  ADD COLUMN IF NOT EXISTS evidence_message_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE hermes_rules
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS candidate_id UUID REFERENCES hermes_rule_candidates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rule_type TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE hermes_rule_runs
  ADD COLUMN IF NOT EXISTS candidate_id UUID REFERENCES hermes_rule_candidates(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS hermes_rule_candidates_account_status_idx
  ON hermes_rule_candidates (account_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS hermes_rule_candidates_evidence_gin_idx
  ON hermes_rule_candidates USING GIN (evidence_message_ids);

CREATE INDEX IF NOT EXISTS hermes_rules_account_enabled_idx
  ON hermes_rules (account_id, enabled, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS hermes_rule_runs_candidate_mode_idx
  ON hermes_rule_runs (candidate_id, mode, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS feedback_events_message_created_idx
  ON feedback_events (message_id, created_at DESC);
