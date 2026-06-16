CREATE TABLE IF NOT EXISTS hermes_message_translations (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  body_hash TEXT NOT NULL,
  target_language TEXT NOT NULL,
  source_language TEXT NOT NULL DEFAULT 'auto',
  tone TEXT NOT NULL DEFAULT 'preserve original meaning and formatting',
  translated_text TEXT NOT NULL,
  skill_run_id UUID REFERENCES hermes_skill_runs(id) ON DELETE SET NULL,
  audit_event_id UUID REFERENCES hermes_audit_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (
    account_id,
    message_id,
    target_language,
    source_language,
    tone,
    body_hash
  )
);

CREATE INDEX IF NOT EXISTS hermes_message_translations_message_idx
  ON hermes_message_translations (account_id, message_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS hermes_message_translations_skill_run_idx
  ON hermes_message_translations (skill_run_id);
