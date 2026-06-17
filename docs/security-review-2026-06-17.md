# Email Hub 安全审查（2026-06-17）

范围：审查 `apps/api-node`、`apps/worker-node`、`apps/web`、`infra`、SQL 迁移和测试中实际可利用的问题。优先关注认证/授权、令牌和密钥保密、Webhook 完整性、SSRF、XSS、附件处理、Hermes/LLM 数据边界、发信滥用、SQL/查询安全、Worker 幂等性、CSV 导入和自托管默认配置。

## 发现的问题

### 1. 严重：公开 API 路由缺少调用方认证和按用户授权网关

**证据：** `createApiHandler` 在请求日志之后直接按 method/path 分发请求；在诊断日志、运营事件、维护清理、Hermes 运行时设置、同步控制、邮箱/邮件读取、草稿/发送/定时发送、域名/别名和账号接入等敏感路由之前，没有 bearer/session/API key 校验。路由里唯一明确的加密校验只作用于 `/api/webhooks/emailengine`。

**利用场景：** 任何能访问 API 绑定地址的进程，都可以通过猜测 account/object ID 来列出私密邮件、下载附件、启动 IMAP/SMTP 接入、修改同步状态、更新 Hermes/runtime 设置、创建草稿、入队发送任务、批准 Hermes 规则或运行维护端点。在自托管部署中，如果 API 被反向代理、绑定到非 loopback 地址、通过隧道暴露，或被另一个已攻陷容器访问，这会变成严重问题。

**严重性：** 严重。

**具体修复建议：** 在 `createApiHandler` 顶部、所有 `/api/*` 路由之前增加 API 认证中间件；仅豁免 `/health`、EmailEngine Webhook 验签端点，以及必须保留自身共享密钥方案的 EmailEngine auth-server callback。要求配置生产级密钥（例如 `EMAILHUB_API_TOKEN`）或接入真实 session；生产环境拒绝默认密钥；并把已认证 user/workspace context 传入每个 service 方法。随后对每个 `accountId`、`messageId`、`mailboxId`、`attachmentId`、`draftId`、`scheduledSendId`、`taskId`、`domainId`、`aliasId`、`memoryId`、skill run、rule candidate、audit event 和 delivery log 查询执行所有权校验。

**建议回归测试：** 启动带保护路由的 API，断言 `GET /api/accounts/{accountId}/messages`、`GET /api/accounts/{accountId}/attachments/{attachmentId}/download`、`POST /api/accounts/{accountId}/drafts/{draftId}/send` 和诊断路由在无 token 时返回 `401`，在 token 属于其他用户时返回 `403/404`，只有资源所有者才返回 `200/202`。

### 2. 严重：账号作用域路由信任 path/query 中的 `accountId`，没有 user/workspace 绑定

**证据：** 邮件读取和附件下载只按调用方提供的 `accountId` 加对象 ID 做作用域限制。SQL 谓词确实匹配 `messages.account_id = $1`，但 `$1` 来自请求 path/query，而不是来自已认证主体的所有权。邮件列表也可以在省略 `accountId` 时运行，因此解析全局邮件列表的路由可能产生跨账号列表。

**利用场景：** 攻击者只要能调用 API，就可以枚举或猜测 account ID，列出邮件、按本地 ID 读取邮件、下载附件，或跨所有账号执行邮件操作，因为路由层没有 `currentUser`，store 层也没有 owner 检查。

**严重性：** 严重。

**具体修复建议：** 不要只从 URL 接受租户作用域。服务端应根据已认证主体解析其可见账号，要求所有账号作用域路由验证 membership，并移除全局邮件列表模式，或将其限制为管理员可用。即使使用不透明本地 ID，也仍要验证每个本地 ID 都 join 到当前用户拥有的账号。

**建议回归测试：** 准备两个用户及各自账号、邮件和附件。验证用户 A 不能列出用户 B 的账号，不能通过 ID 获取用户 B 的邮件，不能下载用户 B 的附件，不能对用户 B 的邮件执行操作，也不能省略 `accountId` 来拿到两个用户的邮件。

### 3. 高危：EmailEngine Webhook 防重放依赖可选 event ID 和长期幂等记录，但没有 freshness window

**证据：** `/api/webhooks/emailengine` 校验 `x-ee-wh-signature` 并规范化事件；当存在 `x-ee-wh-event-id` 时将其用于幂等 key。路由没有时间戳/nonce freshness 校验。如果没有 delivery event ID，幂等 key 会退化为选定事件字段加 payload 稳定 hash。

**利用场景：** 任何捕获过有效签名 Webhook body 和 signature 的人，都可以无限期重放它。取决于存储保留和清理策略，这可能重新入队同步任务、制造运营噪音、恢复旧状态转换，或在幂等记录过期后触发重复处理。

**严重性：** 高危。

**具体修复建议：** 要求签名覆盖的 timestamp header，或在签名 body 内嵌 delivery timestamp；拒绝超过短时间偏移窗口的事件；对会产生状态变更的事件要求稳定 delivery event ID；并将 replay key 至少保留到最大可接受重放窗口之后。对缺失 event ID 的变更类事件应拒绝或隔离。

**建议回归测试：** 使用相同 event ID 提交两次有效签名 Webhook 并断言重复处理；提交带旧 timestamp 的同一签名 Webhook 并断言 `401/409`；提交没有 event ID 的有效 `messageNew` 签名事件并断言拒绝或隔离。

### 4. 高危：开发用 webhook/auth/service secret 是应用默认值，并且 compose 自动使用这些默认值

**证据：** `readApiConfig` 将 `EMAILENGINE_WEBHOOK_SECRET`、`EMAILENGINE_AUTH_SERVER_SECRET` 和 `EENGINE_SECRET` 默认设为 `dev-emailhub-secret`。`infra/docker-compose.yml` 也为 EmailEngine service secret、Webhook secret 和 auth-server URL 凭据提供同一默认值。

**利用场景：** 如果运维人员把默认 compose 栈部署到 localhost 之外，或转发了 API，攻击者可以用已知共享密钥伪造 EmailEngine Webhook，并可能与 EmailEngine auth-server 路径交互。

**严重性：** 高危。

**具体修复建议：** 仅在显式 `EMAILHUB_ALLOW_DEV_SECRETS=true` 或 `NODE_ENV=development` 时允许开发默认值。生产 compose/health check 应在检测到默认密钥或缺少 EmailEngine access/prepared token 时使 readiness 失败。文档应指导生成密钥，而不是在 service URL 中嵌入通用默认值。

**建议回归测试：** 在 `NODE_ENV=production` 且没有密钥/使用默认密钥时运行配置解析，断言启动或 readiness 失败；配置随机真实密钥时断言 readiness 可以通过。

### 5. 高危：如果未认证 settings/probe 路由可达，运维可配置 fetch URL 会成为 SSRF/内网访问跳板

**证据：** API 在任何认证网关之前暴露 Hermes provider probe 和 runtime configuration 路由。Compose 还允许通过运行时环境变量配置 Hermes chat completions/version check URL、OAuth endpoint、Gmail/Microsoft profile URL 和 EmailEngine URL。probe 路由接受请求 body，并可能触发出站连接测试。

**利用场景：** 如果攻击者能访问网络上的 API，就可以利用 provider-probe/runtime 端点探测或访问内网服务、云 metadata 地址、仅 loopback 可达的管理端口，或 Docker service name。即使这些 endpoint 原本只应由运维配置，未认证访问也会把它们变成 SSRF 工具。

**严重性：** 高危。

**具体修复建议：** 所有 provider probe/runtime configuration 端点必须放在管理员认证后；默认增加 URL allowlist，或拒绝 private/link-local/loopback/CIDR 地址；互联网 provider 要求 HTTPS；将 test/probe 功能与用户可控输入分离。

**建议回归测试：** 断言 Hermes provider probe 对 `http://127.0.0.1`、`http://169.254.169.254`、Docker service name 和 RFC1918 私网地址的请求会在任何网络调用前被拒绝。

### 6. 中危：HTML 邮件通过 `template.innerHTML` 转成文本；当前未直接注入，但必须把这个作为硬性不变量

**证据：** message reader 优先使用纯文本；如果存在存储的 `bodyHtml`，会把它赋值给 `<template>` 后读取 `textContent`，而不是直接渲染。源码扫描未发现 `dangerouslySetInnerHTML`。这比渲染 raw HTML 安全，但应用仍会存储并传输来自不可信邮件的 raw HTML。

**利用场景：** 如果未来 UI 改动直接渲染 `bodyHtml`、Hermes summary/translation/draft、label、sender name 或 diagnostics，存储型恶意邮件/provider 内容就会立刻变成 XSS。由于当前 API 没有调用方认证边界，XSS 还可以读取邮件内容并发起状态变更 API 请求。

**严重性：** 当前中危；一旦引入 raw HTML 渲染则为高危。

**具体修复建议：** 在任何富 HTML 邮件展示之前增加中心化 sanitizer/rendering 策略。如果必须展示富 HTML 邮件，应使用严格 allowlist sanitizer、受限 CSP 的 sandboxed iframe、阻断 script/event/form、安全重写链接、图片代理/隐私控制，并增加测试，禁止 sanitizer 组件之外出现 `dangerouslySetInnerHTML`。

**建议回归测试：** 渲染包含 `<img onerror>`、`<svg onload>`、`javascript:` 链接和 CSS/event handler 的邮件、Hermes 输出、label、sender name、subject 和 error。断言没有脚本执行、没有不安全 URL 可点击，并且 raw HTML 不会出现在 sanitizer 边界之外。

### 7. 中危：附件响应流式传输 provider 内容，沿用 provider MIME type，文件名处理有限

**证据：** 附件下载通过 `accountId` 和本地 `attachmentId` 查找本地附件，然后使用存储的 provider attachment ID 调用 EmailEngine。响应会流式返回 `download.contentType ?? attachment.contentType`，并把替换了引号、反斜杠和 CR/LF 的文件名放入 quoted filename。

**利用场景：** 恶意 provider 附件可以设置误导性的 MIME type 或文件名。缺少 `X-Content-Type-Options: nosniff`、对高风险类型回退到 `application/octet-stream`、RFC 5987 filename 处理和最大流式字节限制时，浏览器/代理可能嗅探可执行内容，大型或慢速 provider stream 也可能占用 API 资源。

**严重性：** 中危。

**具体修复建议：** 添加 `X-Content-Type-Options: nosniff`；对危险或非法 content type 默认使用 `application/octet-stream`；同时输出 `filename` 和 `filename*`；按存储的大小和配置上限强制最大流式字节数；并避免在任何客户端 DTO 中返回 provider attachment ID。

**建议回归测试：** 准备带 CR/LF 文件名、路径穿越文件名、HTML/SVG content type、content length 不匹配和超大 stream 的附件。断言 header 安全、不会 inline 渲染、超大内容会中断，并且 API JSON 不包含 provider attachment ID。

### 8. 中危：诊断和运营事件端点未认证，虽然有日志脱敏 helper，仍是数据暴露面

**证据：** 只要 backing store 存在，路由就直接返回诊断日志和运营事件。logger 会对许多敏感 key 名和敏感 query 参数做脱敏，但日志 context 仍可能包含 account ID、event name、endpoint URL、运营错误；如果未来记录不充分脱敏的 context，还可能包含 snippet 等私密内容。

**利用场景：** 未认证攻击者可以读取运营历史、account ID、request ID、provider endpoint URL，以及已脱敏但仍敏感的工作流元数据。这可用于目标发现；如果某些 route 记录了脱敏不足的 context，还可能泄露私密邮件相关内容。

**严重性：** 中危。

**具体修复建议：** 诊断/运营事件必须要求管理员认证；最小化保留 context；对允许记录的字段使用 allowlist；扩大脱敏测试覆盖 authorization code、cookie、provider payload、email body、snippet、subject、sender name 和 Hermes prompt/response。

**建议回归测试：** 无管理员凭据读取 diagnostics/operational events 时断言 `401`；记录包含 OAuth code、refresh token、cookie、subject、body 和 provider payload 的事件，断言存储/返回内容只有安全占位符。

## 正向观察

- Webhook HMAC 校验使用 `timingSafeEqual`，并拒绝缺失签名。
- 邮件读取和附件 SQL 使用参数化查询，并通过本地 attachment/message join，而不是从客户端接收 provider attachment ID。
- Web 当前把 HTML 转成可读文本，而不是直接渲染 raw email HTML；源码扫描未发现 `dangerouslySetInnerHTML`。
- Compose 默认把 API 绑定到 `127.0.0.1:8080`，降低了本地开发环境的暴露面。

## 优先测试待办

1. 针对每个 account/message/mailbox/attachment/draft/scheduled-send/domain/alias/memory/rule/audit 路由增加未认证和跨用户 IDOR 测试。
2. 增加伪造 Webhook、重放 Webhook、缺失 event ID、旧 timestamp 和幂等重复测试。
3. 增加附件 header 和超大 stream 测试。
4. 增加 Hermes prompt injection/数据边界测试，覆盖恶意邮件、memory、搜索结果和用户反馈。
5. 增加 XSS 测试，覆盖 HTML/text/snippet、sender name、subject、label、Hermes 输出、diagnostics 和 error。
6. 增加 SSRF denylist 测试，覆盖 IMAP/SMTP host、Hermes URL、OAuth URL、EmailEngine URL、alias webhook URL 和 attachment URL。
7. 增加重复 send/schedule replay 和 idempotency-key 测试。
8. 增加 CSV 导入公式注入、畸形行、超大文件和部分导入回滚测试。
