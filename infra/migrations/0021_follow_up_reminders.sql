CREATE TABLE IF NOT EXISTS follow_up_reminders (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'open',
  due_at TIMESTAMPTZ NOT NULL,
  title TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  hermes_skill_run_id UUID REFERENCES hermes_skill_runs(id) ON DELETE SET NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT follow_up_reminders_kind_chk
    CHECK (kind IN ('manual', 'needs_reply', 'waiting_on_them')),
  CONSTRAINT follow_up_reminders_status_chk
    CHECK (status IN ('open', 'due', 'done', 'cancelled')),
  CONSTRAINT follow_up_reminders_source_chk
    CHECK (source IN ('manual', 'hermes_followup'))
);

CREATE INDEX IF NOT EXISTS follow_up_reminders_account_status_due_idx
  ON follow_up_reminders (account_id, status, due_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS follow_up_reminders_message_idx
  ON follow_up_reminders (message_id, status);

CREATE INDEX IF NOT EXISTS follow_up_reminders_due_open_idx
  ON follow_up_reminders (status, due_at ASC)
  WHERE status IN ('open', 'due');

CREATE INDEX IF NOT EXISTS follow_up_reminders_lease_idx
  ON follow_up_reminders (lease_expires_at)
  WHERE lease_owner IS NOT NULL;
