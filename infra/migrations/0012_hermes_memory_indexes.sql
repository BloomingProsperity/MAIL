CREATE INDEX IF NOT EXISTS hermes_memories_layer_scope_updated_idx
  ON hermes_memories (layer, scope, updated_at DESC, id DESC);
