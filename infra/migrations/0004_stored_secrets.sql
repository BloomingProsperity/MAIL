CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS stored_secrets (
  secret_ref TEXT NOT NULL UNIQUE,
  secret_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (secret_ref)
);

CREATE INDEX IF NOT EXISTS stored_secrets_ref_idx
  ON stored_secrets (secret_ref);
