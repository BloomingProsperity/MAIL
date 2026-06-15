# 智能优先级排序与“需要的邮件精确排前面”方案

**问题核心**：用户有 N 个邮箱（工作、个人、订阅、通知、域名等），统一收件箱里邮件海量。如何让“真正需要处理的”（高优先级、紧急、来自重要联系人、需要回复的）精确浮到最前面，而不是简单按时间倒序？

## 现有优秀实践（从 Gmail、Outlook、商业工具、开源借鉴）

1. **Gmail Priority Inbox**（经典 ML 模型）
   - 目标：预测用户“是否会对此邮件执行操作”（打开、回复、星标等概率）。
   - 信号：发件人重要性（历史互动频率）、内容类型、线程参与度、用户过去行为、标签。
   - 结果：Important & Unread 置顶 + 分类 Tab（Primary / Social / Promotions）。
   - 2025 更新：搜索默认用 “Most Relevant” AI 排序，而非纯时间。

2. **Outlook Focused Inbox + “Prioritize My Inbox” (Copilot)**
   - Focused vs Other 自动分流。
   - Copilot 版支持自然语言提示（如“把来自老板和客户的邮件优先”）。
   - 行为信号 + 组织上下文 + 可手动调整。

3. **Inbox Zero / 商业 AI 助手**（Superhuman、Shortwave、NewMail、InboxCopilot）
   - 纯英文规则引擎（“如果来自 VIP 且含 'urgent' 则高优先”）。
   - 多信号融合：sender reputation、response latency、semantic urgency、calendar context、attachment presence。
   - Bulk triage + 每日 briefing。
   - 冷邮件自动 blocker + Reply Zero（跟踪待回复）。

4. **Pebble（本地优先参考）**
   - 规则引擎（pebble-rules crate）。
   - Kanban 看板（Todo / Waiting / Done）作为视觉优先级。
   - 本地处理，用户反馈立即影响排序。

5. **Cypht**
   - Sieve filters（服务器端自动移动/标记）。
   - Saved searches + advanced search 作为手动 triage 工具。

## 推荐实现方案（多层混合，最佳实践）

**分层架构（推荐）**：
1. **确定性规则层**（快、可靠、可解释、用户可控）
   - 用户定义规则（支持 AND/OR、发件人、主题关键词、收件人、是否有附件、线程长度、时间范围）。
   - 支持导入 Sieve 脚本（如果后端用 EmailEngine 或直接 IMAP）。
   - 优先级：高/中/低 + 动作（置顶、标星、移到特定“Focus”文件夹、静音）。
   - 实现：本地规则引擎（参考 Pebble）或服务器端（Cypht 风格）。

2. **信号评分层**（启发式 + 轻量 ML）
   - 基础信号（跨账号统一）：
     - 发件人：VIP 列表（用户手动标记 + 历史回复频率 + 过去星标率）。
     - 互动：用户是否经常回复这个发件人/线程。
     - 内容：关键词（urgent, 截止日期, 合同, 发票 等，支持正则或简单 NLP）。
     - 上下文：邮件是否引用了用户最近发送的、是否含日历邀请、附件大小。
     - 账号权重：用户可给不同账号设置基础重要性（工作邮箱 > 订阅邮箱）。
     - 时间衰减 + 最近活跃度。
   - 全局优先级分数 = 加权求和（可调权重）。
   - 统一收件箱排序：先按“优先级桶”（High > Medium > Low）内再按时间，或纯分数排序 + 解释气泡（“因为是老板 + 含截止日期”）。

3. **AI 增强层**（可选，按需）
   - 本地 LLM（Ollama / llama.cpp）或调用 API（Gemini/Claude/OpenAI）做分类：
     - Prompt 示例：“分析这封邮件的重要性（1-5），并给出 1 句理由。考虑发件人是 [sender]，主题 [subject]，正文前 200 字。”
   - 训练信号：用户对邮件的实际操作（打开后多久归档、是否回复、是否星标）作为正负样本。
   - 冷启动：用规则 + 启发式先跑，再逐步让 AI 学习。
   - 隐私友好：本地优先（Pebble 路线）或用户可关闭 AI。

4. **视图与交互**
   - **Focus / 优先视图**：统一收件箱顶部固定“重要”分区（类似 Gmail Important & Unread），下面是其余。
   - 支持手动覆盖 + 反馈（“不重要”按钮立即降低该发件人权重）。
   - 过滤器：只看 High priority + 特定账号 / 标签。
   - 看板集成（参考 Pebble）：把高优先邮件拖到 Todo 列。
   - 每日/每账号摘要（AI 生成）。

**多账号特殊处理**：
- 跨账号全局分数 + 账号颜色/徽章。
- 允许用户为“噪声账号”（订阅、通知）设置低基础分或默认静音。
- 线程合并时，综合所有账号的信号。

**实现难度与建议**：
- MVP：规则引擎 + 简单信号（VIP 列表 + 关键词 + 回复历史）+ 手动星标/归档反馈。
- 中期：本地轻量评分模型 + 可解释性。
- 后期：可选 AI 层。
- 存储：在统一消息模型上加 priority_score 字段 + last_user_action 时间戳。
- 如果用 **EmailEngine** 做后端：拉取后在你的应用层打分排序（最灵活）。
- 如果用 **Pebble 风格本地**：规则和评分直接在 Rust crates 里做，隐私最好。

**参考价值**：
- Inbox Zero 的 “AI Rules in plain English” 是用户体验金标准。
- Gmail 的 per-user 统计模型证明行为信号最强。
- Pebble 的本地规则 + Kanban 证明离线优先可行。

## 用户教育与可解释性（非常重要）
- 每封置顶邮件显示 “为什么排在这里” tooltip。
- 提供“训练我的优先级”向导（快速标记 20 封样例邮件）。
- 允许一键“重置这个账号的优先级模型”。

这部分直接解决“你很多邮箱，重要邮件埋没”的痛点，是聚合工具的核心差异化功能。

---
下一步可补充：具体规则 DSL 设计、评分公式示例、Prompt 模板库。
