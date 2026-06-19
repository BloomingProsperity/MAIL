export function formatHermesAuditSkillId(skillId: string | undefined) {
  if (!skillId) {
    return "Hermes 操作";
  }

  const labels: Record<string, string> = {
    action_item_extract: "待办提取",
    action_plan: "整理建议",
    email_search_qa: "搜索问答",
    followup_tracker: "跟进识别",
    label_suggest: "标签建议",
    newsletter_cleanup: "订阅整理",
    priority_triage: "优先级判断",
    quick_reply: "快速回复",
    reply_draft: "写回复",
    rewrite_polish: "改写润色",
    memory_review: "学习管理",
    rule_suggest: "整理建议",
    thread_summarize: "邮件总结",
    translate_text: "邮件翻译",
  };
  return labels[skillId] ?? skillId;
}
