export interface HermesSkill {
  id: string;
  title: string;
  mode: "read" | "draft" | "classify" | "learn";
  description: string;
}

export function getHermesSkills(): HermesSkill[] {
  return [
    skill("thread_summarize", "线程总结", "read", "总结线程状态、争议点和下一步"),
    skill("reply_draft", "生成回复草稿", "draft", "根据上下文生成可编辑回复"),
    skill("rewrite_polish", "改写润色", "draft", "缩短、扩写或调整语气"),
    skill("quick_reply", "快速短回复", "draft", "生成确认、拒绝、推进等短回复"),
    skill("email_search_qa", "自然语言查邮件", "read", "把问题转成搜索并总结结果"),
    skill("action_item_extract", "提取待办", "read", "识别负责人、期限和承诺"),
    skill("priority_triage", "优先级判断", "classify", "给出优先级和理由"),
    skill("label_suggest", "建议标签", "classify", "建议标签、归档、稍后"),
    skill("newsletter_cleanup", "订阅清理", "classify", "识别订阅和营销邮件"),
    skill("followup_tracker", "跟进追踪", "read", "识别待回复和等待对方回复"),
    skill("translate_text", "翻译邮件", "read", "翻译邮件正文、选中文本或草稿，保留格式和语气"),
    skill("action_plan", "执行计划", "learn", "把自然语言邮箱操作转成可确认计划"),
    skill("rule_suggest", "规则建议", "learn", "从重复行为生成候选规则"),
    skill("memory_review", "记忆管理", "learn", "查看、修改、删除偏好"),
  ];
}

function skill(
  id: string,
  title: string,
  mode: HermesSkill["mode"],
  description: string,
): HermesSkill {
  return { id, title, mode, description };
}
