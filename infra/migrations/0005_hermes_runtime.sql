INSERT INTO hermes_skills (id, title, enabled)
VALUES
  ('thread_summarize', '总结线程', TRUE),
  ('reply_draft', '生成回复草稿', TRUE),
  ('rewrite_polish', '改写润色', TRUE),
  ('quick_reply', '生成短回复', TRUE),
  ('email_search_qa', '自然语言查邮件', TRUE),
  ('action_item_extract', '提取待办', TRUE),
  ('priority_triage', '优先级判断', TRUE),
  ('label_suggest', '建议标签', TRUE),
  ('newsletter_cleanup', '订阅清理', TRUE),
  ('followup_tracker', '跟进识别', TRUE),
  ('rule_suggest', '规则建议', TRUE),
  ('memory_review', '记忆管理', TRUE),
  ('translate_text', '翻译邮件', TRUE)
ON CONFLICT (id)
DO UPDATE SET title = EXCLUDED.title;

ALTER TABLE hermes_skill_runs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE hermes_audit_events
  ADD COLUMN IF NOT EXISTS skill_run_id UUID REFERENCES hermes_skill_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS hermes_audit_events_skill_run_idx
  ON hermes_audit_events (skill_run_id);
