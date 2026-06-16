ALTER TABLE hermes_rule_runs
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS hermes_rule_runs_id_candidate_account_uidx
  ON hermes_rule_runs (id, candidate_id, account_id);

CREATE TABLE IF NOT EXISTS hermes_action_plans (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES hermes_rule_candidates(id) ON DELETE RESTRICT,
  simulation_id UUID NOT NULL,
  command TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requires_confirmation',
  workspace JSONB NOT NULL DEFAULT '{}',
  safety JSONB NOT NULL DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '[]',
  audit_event_id UUID REFERENCES hermes_audit_events(id) ON DELETE SET NULL,
  confirmation_id UUID,
  confirmation_audit_event_id UUID REFERENCES hermes_audit_events(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES hermes_rules(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirming_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  failure_message TEXT,
  CONSTRAINT hermes_action_plans_status_check
    CHECK (status IN ('requires_confirmation', 'confirming', 'completed', 'failed')),
  CONSTRAINT hermes_action_plans_intent_check
    CHECK (intent IN ('create_mailbox_rule')),
  CONSTRAINT hermes_action_plans_simulation_binding_fkey
    FOREIGN KEY (simulation_id, candidate_id, account_id)
    REFERENCES hermes_rule_runs (id, candidate_id, account_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS hermes_action_plans_account_status_idx
  ON hermes_action_plans (account_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS hermes_action_plans_candidate_idx
  ON hermes_action_plans (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS hermes_action_plans_simulation_idx
  ON hermes_action_plans (simulation_id);

CREATE INDEX IF NOT EXISTS hermes_action_plans_audit_event_idx
  ON hermes_action_plans (audit_event_id)
  WHERE audit_event_id IS NOT NULL;
