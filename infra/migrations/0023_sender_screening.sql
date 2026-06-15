CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sender_screening_rules (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  sender_email TEXT,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  created_from_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scope IN ('email', 'domain')),
  CHECK (status IN ('unknown', 'accepted', 'blocked')),
  CHECK (
    (scope = 'email' AND sender_email IS NOT NULL AND domain IS NOT NULL)
    OR (scope = 'domain' AND sender_email IS NULL AND domain IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sender_screening_rules_email_uidx
  ON sender_screening_rules (account_id, lower(sender_email))
  WHERE scope = 'email';

CREATE UNIQUE INDEX IF NOT EXISTS sender_screening_rules_domain_uidx
  ON sender_screening_rules (account_id, lower(domain))
  WHERE scope = 'domain';

CREATE INDEX IF NOT EXISTS sender_screening_rules_account_status_idx
  ON sender_screening_rules (account_id, status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS sender_screening_events (
  id UUID PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES sender_screening_rules(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sender_screening_events_rule_created_idx
  ON sender_screening_events (rule_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS sender_screening_events_account_created_idx
  ON sender_screening_events (account_id, created_at DESC, id DESC);
