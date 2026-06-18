use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HermesSkill {
    pub id: &'static str,
    pub title: &'static str,
    pub mode: &'static str,
    pub description: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemoryLayer {
    pub id: &'static str,
    pub title: &'static str,
    pub editable: bool,
    pub description: &'static str,
}

pub fn hermes_skills() -> Vec<HermesSkill> {
    vec![
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
        skill("rule_suggest", "规则建议", "learn", "从重复行为生成候选规则"),
        skill("memory_review", "记忆管理", "learn", "查看、修改、删除偏好"),
    ]
}

pub fn memory_layers() -> Vec<MemoryLayer> {
    vec![
        memory("working_memory", "当前线程上下文", false, "临时上下文"),
        memory("semantic_profile", "用户事实和偏好", true, "项目、语言和重要客户"),
        memory("writing_style_profile", "写作风格", true, "称呼、长度、语气和结尾"),
        memory("contact_memory", "联系人偏好", true, "客户、同事、供应商和 VIP"),
        memory("procedural_memory", "已确认规则", true, "用户确认过的规则和工作流"),
        memory("episodic_examples", "确认过的好样本", true, "少量写作风格样本"),
    ]
}

fn skill(
    id: &'static str,
    title: &'static str,
    mode: &'static str,
    description: &'static str,
) -> HermesSkill {
    HermesSkill {
        id,
        title,
        mode,
        description,
    }
}

fn memory(
    id: &'static str,
    title: &'static str,
    editable: bool,
    description: &'static str,
) -> MemoryLayer {
    MemoryLayer {
        id,
        title,
        editable,
        description,
    }
}
