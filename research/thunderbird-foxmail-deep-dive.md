# Thunderbird / Foxmail 细颗粒度调研

日期：2026-06-14

## 结论

Thunderbird 适合作为后端拆分和可维护性参考：账号、收信服务器、发信身份、真实目录、虚拟视图、过滤规则、搜索索引、扩展和诊断都有清楚边界。

Foxmail 适合作为国内邮箱接入体验参考：QQ/腾讯企业邮箱、扫码登录、企业通讯录、撤回、超大附件、快速排错、简短用户文案做得更贴近国内用户。Foxmail 是闭源产品，不应作为后端架构依据。

Email Hub 的方向：后端学 Thunderbird 的结构，前端和接入体验吸收 Foxmail、Outlook、Spark 的效率，但普通用户界面不暴露 OAuth、Graph、IMAP、SMTP、API 等技术词。

## Thunderbird 可借鉴点

### 1. 界面拆分

Thunderbird 的主界面不是简单三栏，而是文件夹栏、邮件列表、阅读区、快速过滤、工具栏和状态区协作。

落到 Email Hub：

- 第一栏只放全局功能：邮箱、添加邮箱、搜索、设置。
- 第二栏放真实目录、统一目录、常用分类、保存视图、标签和账号分组。
- 邮件列表支持紧凑、标准、宽松三种密度。
- 阅读区动作栏只展示上下文动作：回复、全部回复、转发、归档、删除、垃圾邮件、移动、更多。
- 同步状态面向用户，技术细节进入诊断日志。

### 2. 账号和身份

Thunderbird 将账号、收信服务器、发信身份分开。一个邮箱账号可能有多个发信身份、签名、别名和发信服务器。

Email Hub 后端应保持：

```text
connected_accounts
account_incoming_servers
account_outgoing_servers
account_identities
mailboxes
message_locations
message_state
messages
threads
search_documents
```

不要把“一个邮箱地址”当成唯一 From 身份。Gmail 别名、腾讯企业邮箱别名、群组发信、代发都需要多身份模型。

### 3. 真实目录和虚拟视图

Thunderbird 的 Saved Search / Virtual Folder 是条件视图，不复制邮件。删除视图不删除源邮件。

Email Hub 规则：

- `mailboxes` 存真实 provider 目录或标签。
- `unified_views` 存跨账号聚合视图。
- `saved_views` 存验证码、账单、发票、物流、旅行、会议、系统告警、待回复、大附件等常用分类。
- `message_locations` 支持同一封 Gmail 邮件出现在多个标签中。
- 保存视图内的删除、归档、移动必须作用到真实 `message_id`，并写操作日志。

### 4. 搜索和快速过滤

Thunderbird 区分 Global Search 和 Quick Filter。Global Search 跨账号和目录；Quick Filter 只过滤当前列表。

Email Hub 对应接口：

```text
GET /api/search?q=...
GET /api/messages?viewId=...&q=...
GET /api/messages?quickFilter[]=unread
GET /api/messages?quickFilter[]=starred
GET /api/messages?quickFilter[]=contacts
GET /api/messages?quickFilter[]=tags
GET /api/messages?quickFilter[]=attachments
```

Hermes 可以解释、总结、生成查询建议，但不能替代确定性的搜索和过滤逻辑。

### 5. 过滤规则

Thunderbird 规则是账号级、可排序、可手动运行，也可在收信、发信、归档时运行。顺序会影响结果。

Email Hub 规则：

- 第一版按账号生效。
- Hermes 学到的规则先进入 shadow mode。
- 启用前展示历史命中样例。
- 低风险动作可以自动：加标签、分类、降优先级、建议归档。
- 高风险动作必须确认：删除、转发、发送、撤回、退订、拉黑。

## Foxmail 可借鉴点

### 1. 接入体验

Foxmail 官方页面强调简洁、性能和大邮箱响应。Mac 页面强调腾讯企业邮箱自动配置、企业通讯录、撤回和超大附件。

Email Hub 文案：

- “登录 Google 账号”
- “登录 Microsoft 账号”
- “输入授权码”
- “使用 Apple 专用密码”
- “启动 Proton Bridge”
- “重新登录”
- “查看诊断日志”

普通页面不写 OAuth、Graph、IMAP、SMTP、API。技术词只放诊断详情。

### 2. 服务商能力矩阵

Foxmail 的公开更新日志体现了 provider-specific 能力：

- QQ 邮箱扫码或密码登录。
- 腾讯企业邮箱通过企业微信扫码登录。
- 群组成员身份发信。
- 代发。
- 企业邮箱已读状态。
- 发件人别名和联系人显示名同步。
- WeDrive 附件选择和保存。
- Gmail 添加。
- 日历和联系人同步。
- 标签同步。
- 按邮件大小、收信时间过滤。

Email Hub 已建立 `provider_capabilities`，前端应根据能力隐藏不支持的入口，而不是显示“开发中”。

关键字段：

```text
supportsWebLogin
supportsScanLogin
supportsMailboxPassword
supportsServerSearch
supportsLabels
supportsAliasSync
supportsContacts
supportsCalendar
supportsSendAsGroup
supportsSendOnBehalf
supportsReadReceipts
supportsRecall
supportsLargeAttachment
supportsCloudAttachment
supportsOnlineArchive
supportsJunkFiltering
requiresLocalBridge
setupHints
```

### 3. 写信链路

正常邮件客户端应具备：

- 回复、全部回复、转发。
- 草稿自动保存。
- From 身份、别名、Reply-To、签名。
- CC / BCC。
- 快速短语和模板。
- 定时发送。
- 优先级。
- 附件预览、批量下载、超大附件。
- 发送前检查：空主题、疑似忘记附件、重复收件人、疑似错收件人。

Hermes 只能生成草稿、改写、建议和检查，不能绕过用户直接发送。

## 已落地到项目

- `GET /api/mail-providers/capabilities`
- `GET /api/mail-providers/capabilities/:provider`
- 服务商能力字段覆盖 Gmail、Outlook、iCloud、163、QQ、腾讯企业邮箱、Proton Bridge、个人域名。
- 用户文案保持中文可读，不出现 OAuth、Graph、IMAP、SMTP、API。
- 测试覆盖 alias 解析、技术词禁用、扫码登录、授权码、Proton Bridge、本地能力显示。

## 后续任务

1. 前端添加邮箱页读取 capability catalog，不硬编码服务商能力。
2. 第二栏补常用分类 saved views：验证码、账单、发票、物流、旅行、会议、系统告警、待回复、大附件。
3. 写信模块补身份、签名、模板、定时发送、发送前检查。
4. 规则引擎补账号级排序、模拟命中、审计日志。
5. 同步中心补下一步动作：重新登录、检查授权码、启动 Proton Bridge、稍后自动重试、查看诊断。

## Sources

- Thunderbird product page: https://www.thunderbird.net/en-US/
- Thunderbird message filters: https://support.mozilla.org/en-US/kb/organize-your-messages-using-filters
- Thunderbird global search: https://support.mozilla.org/en-US/kb/global-search
- Thunderbird quick filter: https://support.mozilla.org/en-US/kb/quick-filter-toolbar
- Thunderbird Gmail setup: https://support.mozilla.org/en-US/kb/thunderbird-and-gmail
- Thunderbird junk controls: https://support.mozilla.org/en-US/kb/thunderbird-and-junk-spam-messages
- Foxmail Windows official page: https://www.foxmail.com/win/en/
- Foxmail Mac official page: https://www.foxmail.com/mac/
