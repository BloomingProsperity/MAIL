-- Current self-hosted datasets are expected to be small enough for a regular
-- index build. Large production installs should run an online equivalent.
WITH ranked_worker_runs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY rule_id, message_id, mode
      ORDER BY created_at DESC, id DESC
    ) AS row_number
  FROM hermes_rule_runs
  WHERE rule_id IS NOT NULL
    AND message_id IS NOT NULL
    AND mode = 'active'
)
DELETE FROM hermes_rule_runs
USING ranked_worker_runs
WHERE hermes_rule_runs.id = ranked_worker_runs.id
  AND ranked_worker_runs.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS hermes_rule_runs_rule_message_active_uidx
  ON hermes_rule_runs (rule_id, message_id, mode)
  WHERE rule_id IS NOT NULL
    AND message_id IS NOT NULL
    AND mode = 'active';
