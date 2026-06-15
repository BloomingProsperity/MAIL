CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS connected_accounts (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  provider TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  display_name TEXT,
  sync_state TEXT NOT NULL DEFAULT 'reauth_required',
  engine_provider TEXT NOT NULL DEFAULT 'emailengine',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, provider)
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  provider_mailbox_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider_mailbox_id)
);

CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY,
  normalized_subject TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES threads(id) ON DELETE SET NULL,
  provider_message_id TEXT NOT NULL,
  internet_message_id TEXT,
  subject TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL,
  snippet TEXT,
  body_text TEXT,
  body_html TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider_message_id)
);

CREATE TABLE IF NOT EXISTS message_state (
  message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  unread BOOLEAN NOT NULL DEFAULT TRUE,
  starred BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  snoozed_until TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_classification (
  message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL DEFAULT 'P4 FYI / Updates',
  priority_score INTEGER NOT NULL DEFAULT 0,
  reasons TEXT[] NOT NULL DEFAULT '{}',
  classified_by TEXT NOT NULL DEFAULT 'rules',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_locations (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, mailbox_id)
);

CREATE TABLE IF NOT EXISTS labels (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'mint',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS label_assignments (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, label_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  provider_attachment_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, provider_attachment_id)
);

CREATE TABLE IF NOT EXISTS search_documents (
  message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  document TSVECTOR,
  raw_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_documents_document_idx ON search_documents USING GIN (document);
CREATE INDEX IF NOT EXISTS messages_subject_trgm_idx ON messages USING GIN (subject gin_trgm_ops);

CREATE TABLE IF NOT EXISTS feedback_events (
  id UUID PRIMARY KEY,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  provider TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hermes_skills (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS hermes_skill_runs (
  id UUID PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES hermes_skills(id),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hermes_memories (
  id UUID PRIMARY KEY,
  layer TEXT NOT NULL,
  scope TEXT NOT NULL,
  content JSONB NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hermes_writing_profiles (
  id UUID PRIMARY KEY,
  profile_name TEXT NOT NULL,
  style JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hermes_rule_candidates (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  condition JSONB NOT NULL DEFAULT '{}',
  action JSONB NOT NULL DEFAULT '{}',
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  status TEXT NOT NULL DEFAULT 'shadow',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hermes_rules (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  condition JSONB NOT NULL DEFAULT '{}',
  action JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hermes_rule_runs (
  id UUID PRIMARY KEY,
  rule_id UUID REFERENCES hermes_rules(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'shadow',
  result JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hermes_feedback (
  id UUID PRIMARY KEY,
  skill_run_id UUID REFERENCES hermes_skill_runs(id) ON DELETE SET NULL,
  feedback_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hermes_audit_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  read_message_ids UUID[] NOT NULL DEFAULT '{}',
  memory_ids UUID[] NOT NULL DEFAULT '{}',
  action JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS destinations (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aliases (
  id UUID PRIMARY KEY,
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  local_part TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain_id, local_part)
);

CREATE TABLE IF NOT EXISTS alias_routes (
  alias_id UUID NOT NULL REFERENCES aliases(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  PRIMARY KEY (alias_id, destination_id)
);

CREATE TABLE IF NOT EXISTS routing_rules (
  id UUID PRIMARY KEY,
  domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_logs (
  id UUID PRIMARY KEY,
  domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
  alias_id UUID REFERENCES aliases(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
