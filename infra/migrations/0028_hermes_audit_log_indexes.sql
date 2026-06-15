CREATE INDEX IF NOT EXISTS hermes_audit_events_created_idx
  ON hermes_audit_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS hermes_audit_events_read_message_ids_gin_idx
  ON hermes_audit_events USING GIN (read_message_ids);

CREATE INDEX IF NOT EXISTS hermes_audit_events_memory_ids_gin_idx
  ON hermes_audit_events USING GIN (memory_ids);

