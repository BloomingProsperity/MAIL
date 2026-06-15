CREATE INDEX IF NOT EXISTS hermes_feedback_skill_run_created_idx
  ON hermes_feedback (skill_run_id, created_at DESC, id DESC);
