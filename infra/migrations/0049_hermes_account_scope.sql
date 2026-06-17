ALTER TABLE hermes_memories
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE;

ALTER TABLE hermes_skill_runs
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE;

ALTER TABLE hermes_audit_events
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE;

UPDATE hermes_skill_runs run
SET account_id = (run.input->>'accountId')::uuid
WHERE run.account_id IS NULL
  AND run.input ? 'accountId'
  AND run.input->>'accountId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1
    FROM connected_accounts account
    WHERE account.id = (run.input->>'accountId')::uuid
  );

UPDATE hermes_memories memory
SET account_id = (memory.content->>'accountId')::uuid
WHERE memory.account_id IS NULL
  AND memory.content ? 'accountId'
  AND memory.content->>'accountId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1
    FROM connected_accounts account
    WHERE account.id = (memory.content->>'accountId')::uuid
  );

UPDATE hermes_audit_events audit
SET account_id = run.account_id
FROM hermes_skill_runs run
WHERE audit.account_id IS NULL
  AND audit.skill_run_id = run.id
  AND run.account_id IS NOT NULL;

UPDATE hermes_audit_events audit
SET account_id = message_scope.account_id
FROM (
  SELECT
    audit.id,
    (ARRAY_AGG(DISTINCT messages.account_id))[1] AS account_id
  FROM hermes_audit_events audit
  JOIN messages
    ON messages.id = ANY(audit.read_message_ids)
  WHERE audit.account_id IS NULL
  GROUP BY audit.id
  HAVING COUNT(DISTINCT messages.account_id) = 1
) message_scope
WHERE audit.account_id IS NULL
  AND audit.id = message_scope.id;

CREATE INDEX IF NOT EXISTS hermes_memories_account_layer_scope_updated_idx
  ON hermes_memories (account_id, layer, scope, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS hermes_skill_runs_account_created_idx
  ON hermes_skill_runs (account_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS hermes_audit_events_account_created_idx
  ON hermes_audit_events (account_id, created_at DESC, id DESC);
