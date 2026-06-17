ALTER TABLE hermes_rules
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

WITH ranked_rules AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY account_id
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM hermes_rules
  WHERE sort_order IS NULL
)
UPDATE hermes_rules
SET sort_order = ranked_rules.row_number * 1000
FROM ranked_rules
WHERE hermes_rules.id = ranked_rules.id;

ALTER TABLE hermes_rules
  ALTER COLUMN sort_order SET DEFAULT 1000,
  ALTER COLUMN sort_order SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hermes_rules_sort_order_chk'
  ) THEN
    ALTER TABLE hermes_rules
      ADD CONSTRAINT hermes_rules_sort_order_chk
      CHECK (sort_order BETWEEN 0 AND 1000000);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS hermes_rules_account_sort_idx
  ON hermes_rules (account_id, sort_order ASC, created_at DESC, id DESC);
