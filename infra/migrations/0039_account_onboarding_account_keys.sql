CREATE TABLE IF NOT EXISTS account_onboarding_account_keys (
  email TEXT NOT NULL,
  provider TEXT NOT NULL,
  account_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, provider)
);

INSERT INTO account_onboarding_account_keys (
  email,
  provider,
  account_id,
  created_at,
  updated_at
)
SELECT
  email,
  provider,
  id,
  created_at,
  updated_at
FROM connected_accounts
ON CONFLICT (email, provider) DO NOTHING;
