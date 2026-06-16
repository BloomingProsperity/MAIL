ALTER TABLE labels
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE;

ALTER TABLE labels
  DROP CONSTRAINT IF EXISTS labels_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS labels_account_name_uidx
  ON labels (account_id, lower(name))
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS label_assignments_label_message_idx
  ON label_assignments (label_id, message_id);
