CREATE TABLE IF NOT EXISTS provider_send_identities (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_identity_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  identity_type TEXT NOT NULL DEFAULT 'alias',
  verification_state TEXT NOT NULL DEFAULT 'unverified',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  capabilities JSONB NOT NULL DEFAULT '{}',
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, provider_identity_id),
  CONSTRAINT provider_send_identities_identity_type_chk CHECK (
    identity_type IN (
      'account',
      'alias',
      'shared_mailbox',
      'send_on_behalf',
      'group',
      'unknown'
    )
  ),
  CONSTRAINT provider_send_identities_verification_state_chk CHECK (
    verification_state IN ('verified', 'pending', 'unverified', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS provider_send_identities_account_verified_idx
  ON provider_send_identities (
    account_id,
    verification_state,
    enabled,
    last_seen_at DESC
  );

CREATE INDEX IF NOT EXISTS provider_send_identities_account_email_idx
  ON provider_send_identities (account_id, lower(email))
  WHERE enabled = TRUE;
