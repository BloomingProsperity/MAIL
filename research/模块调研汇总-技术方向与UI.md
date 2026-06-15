# 邮箱聚合产品模块调研汇总

日期：2026-06-12

目标：做一个快速、方便、Spark-like 的邮箱聚合产品。左侧只放主要功能，AI、Hermes/Ollama/OpenAI API、别名转发、域名管理集中放在设置里。桌面端优先考虑 Rust/Tauri，同时提供 Docker 自托管服务端。

## 2026-06-12 简化调整

新的产品方向更轻：

- 后端模型入口只保留 **Hermes**。Email Hub 不直接管理 Ollama、OpenAI API、LM Studio、vLLM 等 provider；这些由 Hermes 自己支持和管理。
- 左侧主导航增加 **添加邮箱**。
- 所有邮箱接入都放进“添加邮箱”目录页，像 Workspace 应用目录一样选择服务。
- “添加邮箱”首批服务：Gmail、Outlook、163 邮箱、QQ 邮箱、Proton Mail、个人域名邮箱。
- 设置页只保留：Hermes、别名转发、域名管理。
- 收件箱底部 AI 框只显示 Hermes，不再暴露一堆模型选项。

简化后的信息架构：

```text
收件箱
添加邮箱
待办
搜索
设置

设置
  - Hermes
  - 别名转发
  - 域名管理
```

这版更接近用户的真实心智：先把邮箱加进来，再在统一收件箱里处理邮件；AI 能力默认由 Hermes 提供，不让用户在 Email Hub 里配置一堆底层 API。

## 2026-06-12 视觉修正：去 AI 味

本次 UI 不再使用蓝紫/青绿渐变、毛玻璃、发光阴影和漂浮卡片，避免看起来像通用 AI SaaS 模板或苹果系工具。参考成熟设计系统后，改成更偏“邮件工作台”的方向：

- 主体用中性色和清晰层级：背景、内容区、分隔线先稳定下来，不靠饱和色撑页面。
- 动作色只保留一个砖红/铜色系，负责主按钮、当前选中和关键强调。
- 侧栏用深森林绿，形成专业工具感；状态色只在标签、提示、成功/异常里少量出现。
- 布局减少独立方框：邮箱服务改成目录式列表，邮件列表和设置表格用分隔线组织，不做悬浮卡片。
- 底部 Hermes 命令框保留，但取消星光/渐变/玻璃感，做成稳定的命令栏。

参考：

- [Atlassian Design - Color](https://atlassian.design/foundations/color)
- [Carbon Design System - Color](https://carbondesignsystem.com/elements/color/overview/)
- [Radix Colors](https://www.radix-ui.com/colors)
- [B2B SaaS color palettes 2026](https://tentackles.com/blog/b2b-saas-color-palettes-2026-that-stand-out)

## 1. 账号授权与邮件同步

结论：

- 个人 Gmail / Outlook 不能真正“一键自动授权本机所有账号”。桌面端可以扫描本机浏览器 profile metadata，发现候选邮箱，再用 `login_hint=email` 批量打开 OAuth 授权窗口。
- Gmail 推荐 Gmail API：首次全量同步保存 `historyId`，后续用 `users.history.list` 增量；服务端可用 Pub/Sub `watch` 唤醒同步。
- Outlook 推荐 Microsoft Graph：按 folder 维护 deltaLink；Graph subscription 作为唤醒信号，真正一致性靠 delta query。
- Web 版只负责 OAuth 入口和管理界面，长期同步、cursor、索引、AI 处理必须在后端 worker。
- 桌面版负责本机账号发现、OS keychain、本地 SQLite/Tantivy、系统托盘和快速打开。

推荐实现：

1. 桌面端扫描 Chrome / Edge / Brave 的 `Local State -> profile.info_cache`，只拿邮箱、profile 名称、浏览器来源。
2. 为每个候选邮箱生成 Google OAuth URL，带 `prompt=select_account` 和 `login_hint=email`。
3. 用户逐个确认授权后，后端拿真实邮箱地址去重，开始同步。
4. Google Workspace / Microsoft 365 企业场景另做管理员批量授权。

参考：

- [Google OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Gmail API sync guide](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Gmail API push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Microsoft OAuth auth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft Graph mail overview](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview)
- [Microsoft Graph message delta query](https://learn.microsoft.com/en-us/graph/delta-query-messages)
- [Microsoft Graph change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview)
- [Chromium user data directory](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md)
- [Fleet Chrome profiles table](https://fleetdm.com/tables/google_chrome_profiles)

## 2. Smart Inbox / 邮件排序

结论：

- 不要只做一个 AI 分数。更好的方式是“先分桶，再排序，再让用户纠偏”。
- 首页建议分为：现在处理、待回复、重点、客户/项目、通知/票据、订阅、低优先级。
- 验证码、支付失败、客户投诉、今天到期、会议临近短时置顶；Newsletter、促销、自动通知折叠或批量处理。

MVP 排序方案：

```text
rank_score =
  manual_override
  + 60 * time_sensitive_now
  + 45 * needs_reply
  + 35 * vip_or_customer
  + 30 * project_relevance
  + 25 * interaction_affinity
  + 15 * provider_importance
  + recency_decay
  - 35 * newsletter_or_bulk
  - 30 * auto_notification
  - 45 * user_often_archives_sender
```

需要记录的字段：

- 邮件元数据：账号、provider、thread/message id、from/to/cc、subject、snippet、时间、headers、附件、provider labels。
- 转发字段：original_from、forwarded_by、original_message_id、canonical_thread_id。
- 用户行为：打开、回复、标重要、稍后、归档、删除、移动到重点/其他、永远这样处理。
- AI 字段：category、needs_reply、deadline_at、urgency_level、project_id、customer_id、summary、reason、confidence。

UI 建议：

- 邮件行上显示优先级分数、标签和一句“为什么排前面”。
- 每封邮件提供纠偏：重要/不重要、不是待回复、以后放订阅、这个发件人总是重点。
- 订阅和通知提供批量完成、批量归档、按发件人折叠。

参考：

- [Spark Smart Inbox](https://sparkmailapp.com/features/smart_inbox)
- [Spark Smart Inbox customization](https://support.readdle.com/spark/personalization/customize-your-smart-inbox)
- [Gmail Priority Inbox](https://support.google.com/a/users/answer/9282734)
- [Gmail Priority Inbox paper](https://research.google.com/pubs/archive/36955.pdf)
- [Outlook Focused Inbox](https://support.microsoft.com/en-us/office/focused-inbox-for-outlook-f445ad7f-02f4-4294-a82e-71d8964e3978)
- [Shortwave AI Assistant](https://www.shortwave.com/docs/guides/ai-assistant/)
- [Superhuman Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005619081101-Default-Split-Inbox)
- [HEY how it works](https://www.hey.com/how-it-works/)

## 3. 底部 AI 助手框

结论：

- 这是产品的核心差异点。它不应该只是聊天窗口，而是“邮箱命令入口”。
- 入口建议固定在底部，支持 `Ctrl/Cmd+K` 聚焦，右侧放模型选择：Hermes / Ollama / OpenAI API / LM Studio / vLLM。
- AI 结果要带来源邮件/附件引用；写操作先生成预览和草稿，不直接发送。

底部命令框 P0 能力：

1. 搜索 / 问答：找邮件、找附件、问历史上下文。
2. 总结：总结当前线程、选中邮件、搜索结果集。
3. 写信：写新邮件、写回复、改写、翻译、调整语气。
4. 找附件：合同、账单、PDF、截图等。
5. 生成待办：deadline、跟进事项、提醒。
6. 批量处理：归档订阅、打标签、移动文件夹，先预览再确认。

技术架构：

```text
AI Dock
 -> Intent Router
 -> Context Builder
 -> Hybrid Retrieval
 -> LLM Provider Adapter
 -> Tool Executor
 -> Preview / Confirm
 -> Mail Store
```

Provider Adapter 建议统一 OpenAI-compatible：

```ts
interface AIProvider {
  id: string;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    jsonSchema: boolean;
    embeddings: boolean;
    local: boolean;
    maxContext: number;
  };
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest): AsyncIterable<ChatDelta>;
  embed?(texts: string[]): Promise<number[][]>;
  health(): Promise<ProviderStatus>;
}
```

参考：

- [Spark AI Assistant](https://sparkmailapp.com/features/ai-assistant)
- [Spark AI Assistant help](https://sparkmailapp.com/help/spark-ai/ai-assistant)
- [Spark CLI with Ollama / LM Studio](https://sparkmailapp.com/blog/introducing-spark-cli)
- [Shortwave AI Assistant](https://www.shortwave.com/blog/new-shortwave-ai-email-assistant/)
- [Gmail Gemini in Gmail](https://support.google.com/mail/answer/14199860)
- [Outlook Copilot summarize](https://support.microsoft.com/en-us/office/summarize-an-email-thread-with-copilot-in-outlook-a79873f2-396b-46dc-b852-7fe5947ab640)
- [Superhuman Ask AI](https://help.superhuman.com/hc/en-us/articles/46005676610829-Ask-AI)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat)
- [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/stable/serving/online_serving/)
- [LocalAI getting started](https://localai.io/basics/getting_started/index.html)
- [Hermes providers](https://hermes-agent.nousresearch.com/docs/integrations/providers)

## 4. 别名转发与域名管理

结论：

- 第一版不要做完整邮箱服务器，做轻量 MX 转发服务。
- 如果产品主打极简收件箱，别名/域名可以放设置；但写信、回信时必须前置显示 From 身份切换和自动匹配回复身份。
- MVP 必须有域名 DNS 引导、别名创建、目标邮箱、catch-all、投递日志和失败重发。

推荐 Docker 架构：

```text
MX/Postfix 或 Haraka
 -> 入站解析/队列
 -> 别名路由服务
 -> 转发 worker / webhook worker / 失败重试
 -> 投递日志
```

路由优先级：

```text
精确别名 > 禁用/黑洞别名 > catch-all/regex 自动创建 > 域名默认路由 > 拒收
```

MVP：

- 添加域名、DNS 验证、MX 状态检测。
- 添加目标邮箱/收件人并验证。
- 创建自定义/随机别名。
- 别名转发到一个或多个目标邮箱。
- catch-all 开关。
- 禁用/黑洞别名。
- 收件 webhook。
- 投递日志和失败重发。
- CSV 导入/导出。

参考：

- [SimpleLogin docs](https://simplelogin.io/docs/)
- [SimpleLogin GitHub](https://github.com/simple-login/app)
- [addy.io self-hosting](https://addy.io/self-hosting/)
- [addy.io Docker](https://github.com/anonaddy/docker)
- [Forward Email self-hosted](https://forwardemail.net/en/self-hosted)
- [Cloudflare Email Routing docs](https://developers.cloudflare.com/email-service/)
- [ImprovMX webhooks](https://improvmx.com/guides/webhooks/)
- [Fastmail aliases](https://www.fastmail.help/hc/en-us/articles/360060591073-How-to-set-up-aliases)
- [Proton aliases](https://proton.me/support/creating-aliases)

## 5. 桌面端与 Docker 技术栈

结论：

- 推荐 Tauri v2 + Rust core + React/Vite/TypeScript。
- Rust 负责 OAuth callback、本机 profile 扫描、SQLite/Tantivy、本地 keychain、系统通知、托盘、后台同步。
- Web UI 只负责交互。
- Docker 服务端负责长期同步、转发、AI gateway、多设备访问。

推荐技术栈：

- 桌面壳：Tauri v2 + Rust。
- 前端：React/Vite/TypeScript。
- 本地数据：SQLite。
- 本地全文搜索：Tantivy。
- 服务端搜索：Meilisearch 或 Typesense。
- 后端服务：Rust Axum 或 Node/NestJS 均可；如果核心同步/路由想统一，Rust 更干净。
- 队列：Redis。
- 服务端数据库：Postgres。
- AI 网关：OpenAI-compatible provider adapter；团队/自托管可接 LiteLLM。
- 部署：Docker Compose：`web + api + sync-worker + mx + redis + postgres + search + ai-gateway`。

参考项目：

- [Tauri](https://v2.tauri.app/start/)
- [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)
- [Tauri system tray](https://v2.tauri.app/learn/system-tray/)
- [Mailspring](https://github.com/Foundry376/Mailspring)
- [Mailspring Sync](https://github.com/Foundry376/Mailspring-Sync)
- [Velo](https://github.com/avihaymenahem/velo)
- [Exo](https://github.com/ankitvgupta/exo)
- [Inbox Zero](https://github.com/elie222/inbox-zero)
- [email-oauth2-proxy](https://github.com/simonrob/email-oauth2-proxy)
- [corky](https://github.com/btakita/corky)
- [Tantivy](https://github.com/quickwit-oss/tantivy)
- [Meilisearch](https://github.com/meilisearch/meilisearch)
- [Typesense](https://github.com/typesense/typesense)

## 6. UI / 市场打开方向

结论：

- 不要定位成“又一个 AI 邮箱”。更清楚的方向是：一个极简统一收件箱，底部一句话就能搜索、总结、回复、整理，同时支持本地模型和自带 API。
- 左侧只放主要功能是对的。AI provider、别名转发、域名管理放设置，避免主界面复杂化。
- 差异点：跨账号 + 底部 AI 命令框 + 本地模型/自带 Key + 别名身份自动匹配。

推荐 IA：

- 左侧：收件箱、待办、搜索、设置。
- 收件箱内部：现在处理、待回复、重点、客户/项目、通知/票据、订阅。
- 设置：账号接入、AI 模型、别名转发、域名管理。
- 写信/回信：自动显示推荐 From 身份，比如 `billing@demo.site`。

产品首屏方向：

1. Spark-like 三栏收件箱 + 底部 AI 框。
2. 今日处理台 + 收件箱。
3. 多邮箱/多身份聚合首屏。

推荐先走第 1 个，逐步吸收第 2 和第 3 个的能力。

参考：

- [Spark Smart Inbox](https://sparkmailapp.com/features/smart_inbox)
- [Spark AI Assistant](https://sparkmailapp.com/help/spark-ai/ai-assistant)
- [Shortwave AI Assistant](https://www.shortwave.com/docs/guides/ai-assistant/)
- [Superhuman Command shortcuts](https://help.superhuman.com/hc/en-us/articles/46005701270541-Desktop-Shortcuts)
- [Missive AI Assistant](https://missiveapp.com/ai-assistant)
- [Front AI](https://front.com/)

## 推荐落地顺序

1. 静态 UI 原型：收件箱三栏 + 底部 AI 框 + 设置页四模块。
2. Tauri/Rust 桌面壳：系统托盘、本机 Chrome/Edge profile metadata 扫描。
3. Gmail OAuth + 同步：loopback OAuth、SQLite、historyId 增量同步。
4. 搜索：Tantivy 本地全文索引。
5. AI：OpenAI-compatible adapter，先接 Hermes/Ollama/OpenAI API。
6. Smart Inbox：规则分桶 + 用户行为 + LLM 分类。
7. 别名转发：Docker Compose 轻量 MX 转发。
8. Outlook/Graph 同步。
9. 团队版：Workspace/M365 管理员批量授权。

## 本次 UI 图

- 去 AI 味新版添加邮箱：`C:\Users\h\Documents\邮箱管理聚合\email-hub-grounded-add-mail.png`
- 去 AI 味新版设置页：`C:\Users\h\Documents\邮箱管理聚合\email-hub-grounded-settings.png`
- 去 AI 味新版移动端检查：`C:\Users\h\Documents\邮箱管理聚合\email-hub-grounded-mobile-add-mail.png`
- 收件箱 + 底部 AI 框：`C:\Users\h\Documents\邮箱管理聚合\email-hub-ai-inbox.png`
- 设置页模块：`C:\Users\h\Documents\邮箱管理聚合\email-hub-settings-modules.png`
- 移动端检查图：`C:\Users\h\Documents\邮箱管理聚合\email-hub-mobile-ai-inbox.png`
- 简化版添加邮箱目录：`C:\Users\h\Documents\邮箱管理聚合\email-hub-add-mail.png`
- 简化版 Hermes 设置页：`C:\Users\h\Documents\邮箱管理聚合\email-hub-hermes-settings.png`
