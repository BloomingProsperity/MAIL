CREATE TABLE IF NOT EXISTS hermes_message_summaries (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  body_hash TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'detailed',
  focus TEXT NOT NULL DEFAULT 'decisions, action items, deadlines, and reply needs',
  language TEXT NOT NULL DEFAULT 'match the thread',
  summary_text TEXT NOT NULL,
  skill_run_id UUID REFERENCES hermes_skill_runs(id) ON DELETE SET NULL,
  audit_event_id UUID REFERENCES hermes_audit_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (
    account_id,
    message_id,
    mode,
    focus,
    language,
    body_hash
  )
);

CREATE INDEX IF NOT EXISTS hermes_message_summaries_message_idx
  ON hermes_message_summaries (account_id, message_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS hermes_message_summaries_skill_run_idx
  ON hermes_message_summaries (skill_run_id);
