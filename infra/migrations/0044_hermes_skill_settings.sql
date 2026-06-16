CREATE TABLE IF NOT EXISTS hermes_skill_settings (
  skill_id TEXT PRIMARY KEY REFERENCES hermes_skills(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_context_chars INTEGER NOT NULL DEFAULT 24000,
  memory_limit INTEGER NOT NULL DEFAULT 6,
  allow_body_read BOOLEAN NOT NULL DEFAULT TRUE,
  allow_memory_write BOOLEAN NOT NULL DEFAULT FALSE,
  require_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hermes_skill_settings_context_chars_chk
    CHECK (max_context_chars BETWEEN 1000 AND 200000),
  CONSTRAINT hermes_skill_settings_memory_limit_chk
    CHECK (memory_limit BETWEEN 0 AND 50)
);

CREATE INDEX IF NOT EXISTS hermes_skill_settings_enabled_idx
  ON hermes_skill_settings (enabled);
