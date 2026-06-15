CREATE TABLE IF NOT EXISTS smart_inbox_sender_rules (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  sender_email TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  created_from_feedback_event_id UUID REFERENCES feedback_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, sender_email, rule_type)
);

CREATE INDEX IF NOT EXISTS smart_inbox_sender_rules_account_sender_idx
  ON smart_inbox_sender_rules (account_id, sender_email);
