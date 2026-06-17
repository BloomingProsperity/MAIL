CREATE INDEX IF NOT EXISTS hermes_rule_runs_rule_mode_idx
  ON hermes_rule_runs (rule_id, mode, created_at DESC, id DESC)
  WHERE rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hermes_rule_runs_account_mode_idx
  ON hermes_rule_runs (account_id, mode, created_at DESC, id DESC)
  WHERE account_id IS NOT NULL;
