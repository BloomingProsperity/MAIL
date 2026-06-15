CREATE INDEX IF NOT EXISTS idx_message_classification_priority_score
  ON message_classification (priority_score DESC, message_id);
