CREATE TABLE IF NOT EXISTS web_auth_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS web_auth_users_email_normalized_idx
  ON web_auth_users (email_normalized);

CREATE UNIQUE INDEX IF NOT EXISTS web_auth_users_single_owner_idx
  ON web_auth_users (role)
  WHERE role = 'owner';
