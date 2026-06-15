CREATE TABLE IF NOT EXISTS provider_mailbox_refs (
  id UUID PRIMARY KEY,
  mailbox_id UUID REFERENCES mailboxes(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_mailbox_id TEXT NOT NULL,
  display_name TEXT,
  role TEXT,
  gmail_label_id TEXT,
  graph_folder_id TEXT,
  imap_path TEXT,
  imap_delimiter TEXT,
  imap_uidvalidity TEXT,
  imap_uid_next TEXT,
  imap_highest_modseq TEXT,
  raw_ref JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, provider_mailbox_id)
);

CREATE INDEX IF NOT EXISTS provider_mailbox_refs_account_provider_idx
  ON provider_mailbox_refs (account_id, provider);

CREATE TABLE IF NOT EXISTS provider_message_refs (
  id UUID PRIMARY KEY,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_mailbox_ref_id UUID REFERENCES provider_mailbox_refs(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  gmail_history_id TEXT,
  graph_message_id TEXT,
  graph_change_key TEXT,
  graph_conversation_id TEXT,
  imap_mailbox_id TEXT,
  imap_uidvalidity TEXT,
  imap_uid TEXT,
  imap_modseq TEXT,
  raw_ref JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, provider_message_id),
  UNIQUE (account_id, provider, gmail_message_id),
  UNIQUE (account_id, provider, graph_message_id),
  UNIQUE (account_id, provider, imap_mailbox_id, imap_uidvalidity, imap_uid)
);

CREATE INDEX IF NOT EXISTS provider_message_refs_message_idx
  ON provider_message_refs (message_id);

CREATE INDEX IF NOT EXISTS provider_message_refs_account_provider_idx
  ON provider_message_refs (account_id, provider);

CREATE TABLE IF NOT EXISTS provider_message_tombstones (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_identity JSONB NOT NULL,
  provider_message_id TEXT,
  provider_mailbox_id TEXT,
  deleted_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT 'provider_deleted',
  idempotency_key TEXT NOT NULL UNIQUE,
  raw_event JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_message_tombstones_account_provider_idx
  ON provider_message_tombstones (account_id, provider, deleted_at DESC);

ALTER TABLE sync_cursors
  ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES mailboxes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS cursor_scope TEXT NOT NULL DEFAULT 'account',
  ADD COLUMN IF NOT EXISTS provider_mailbox_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_history_id TEXT,
  ADD COLUMN IF NOT EXISTS graph_delta_link TEXT,
  ADD COLUMN IF NOT EXISTS imap_uidvalidity TEXT,
  ADD COLUMN IF NOT EXISTS imap_highest_uid TEXT,
  ADD COLUMN IF NOT EXISTS imap_uid_next TEXT,
  ADD COLUMN IF NOT EXISTS imap_highest_modseq TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS reset_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sync_cursors_provider_mailbox_idx
  ON sync_cursors (account_id, provider, provider_mailbox_id);
