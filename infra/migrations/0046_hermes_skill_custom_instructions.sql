ALTER TABLE hermes_skill_settings
  ADD COLUMN IF NOT EXISTS custom_instructions TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hermes_skill_settings_custom_instructions_chk'
  ) THEN
    ALTER TABLE hermes_skill_settings
      ADD CONSTRAINT hermes_skill_settings_custom_instructions_chk
      CHECK (char_length(custom_instructions) <= 2000);
  END IF;
END
$$;
