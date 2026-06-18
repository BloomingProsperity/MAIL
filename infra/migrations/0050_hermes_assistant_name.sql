ALTER TABLE hermes_runtime_settings
  ADD COLUMN IF NOT EXISTS assistant_name TEXT NOT NULL DEFAULT 'Hermes';
