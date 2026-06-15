export interface HermesSkill {
  id: string;
  title: string;
  description: string;
  mode: "read" | "draft" | "classify" | "learn";
}

export interface MemoryLayer {
  id: string;
  title: string;
  description: string;
  editable: boolean;
}

export function getHermesSkills(): HermesSkill[] {
  return [
    {
      id: "thread_summarize",
      title: "线程总结",
      description: "把长线程压成当前状态、争议点和下一步。",
      mode: "read"
    },
    {
      id: "translate_text",
      title: "邮件翻译",
      description: "忠实翻译正文，保留段落、名单、日期和语气。",
      mode: "read"
    },
    {
      id: "reply_draft",
      title: "生成回复草稿",
      description: "基于当前邮件、身份和历史语气写可编辑草稿。",
      mode: "draft"
    },
    {
      id: "rewrite_polish",
      title: "改写润色",
      description: "缩短、扩写、调整语气，不直接发送。",
      mode: "draft"
    },
    {
      id: "quick_reply",
      title: "快速短回复",
      description: "生成确认、拒绝、推进、追问等短回复。",
      mode: "draft"
    },
    {
      id: "email_search_qa",
      title: "自然语言查邮件",
      description: "把问题转成搜索条件并总结命中邮件。",
      mode: "read"
    },
    {
      id: "action_item_extract",
      title: "提取待办",
      description: "识别负责人、期限、承诺和下一步。",
      mode: "read"
    },
    {
      id: "priority_triage",
      title: "优先级判断",
      description: "给出高、中、低优先级和可解释理由。",
      mode: "classify"
    },
    {
      id: "label_suggest",
      title: "建议标签",
      description: "建议标签、归档、稍后和项目归类。",
      mode: "classify"
    },
    {
      id: "newsletter_cleanup",
      title: "订阅清理",
      description: "识别营销、订阅和低优先级批量邮件。",
      mode: "classify"
    },
    {
      id: "followup_tracker",
      title: "跟进追踪",
      description: "识别待回复和等待对方回复的线程。",
      mode: "read"
    },
    {
      id: "rule_suggest",
      title: "规则建议",
      description: "从重复行为中生成候选规则并影子运行。",
      mode: "learn"
    },
    {
      id: "memory_review",
      title: "记忆管理",
      description: "查看、修改和删除学习到的偏好。",
      mode: "learn"
    }
  ];
}

export function getMemoryLayers(): MemoryLayer[] {
  return [
    {
      id: "working_memory",
      title: "当前线程上下文",
      description: "只在当前会话里使用，不长期保存。",
      editable: false
    },
    {
      id: "semantic_profile",
      title: "用户事实和偏好",
      description: "比如常用项目、默认语言、重要客户。",
      editable: true
    },
    {
      id: "writing_style_profile",
      title: "写作风格",
      description: "称呼、长度、语气、结尾和常用表达。",
      editable: true
    },
    {
      id: "contact_memory",
      title: "联系人偏好",
      description: "客户、同事、供应商、VIP 和域名关系。",
      editable: true
    },
    {
      id: "procedural_memory",
      title: "已确认规则",
      description: "用户确认过的分类、归档、提醒工作流。",
      editable: true
    },
    {
      id: "episodic_examples",
      title: "确认过的好样本",
      description: "少量用于学习风格的邮件样本。",
      editable: true
    }
  ];
}
