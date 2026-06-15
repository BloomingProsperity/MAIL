# 部署模式与 Docker 私人部署支持

**用户担忧**（2026-06-12）：讨论 Pebble（桌面 Tauri）等后，是否项目就只适合做原生软件/APP，不再支持 Docker 私人自托管部署了？

**明确回答**：**不是**。我们完全可以（也应该）把 **Docker 私人部署作为第一优先级** 支持，同时可选提供桌面客户端。之前的调研已经覆盖了大量自托管友好项目，设计时可以兼顾两者。

## 当前调研中支持 Docker/自托管的选项

1. **EmailEngine**（强烈推荐作为核心后端）
   - Headless（无 UI），通过统一 REST API 提供聚合能力。
   - 官方大力支持 Docker、Docker Compose、SystemD、Kubernetes。
   - 完美适合私人部署：你部署一个 EmailEngine 实例（带 Redis），然后任何前端（Web、移动、桌面）都可以通过 API 连接。
   - 之前已详细记录其 Docker 注意事项（Redis 低延迟共置、无水平扩展、workers 配置、Prometheus 等）。

2. **Cypht**
   - 纯 Web 自托管，轻量 PHP。
   - 官方 Docker 镜像可用。
   - 本身就以“多账号聚合 combined views”为核心设计。

3. **Zero (Mail-0/Zero)**
   - Next.js 全栈 Web，自托管。
   - Docker 数据库 + 完整 setup 指南（pnpm docker:db:up 等）。

4. **Inbox Zero**
   - 自托管 Web（Next.js）。
   - 一键 CLI + Docker Compose 启动（`npx @inbox-zero/cli setup && start`）。
   - 非常适合私人部署 + AI 功能。

5. **Pebble**
   - 桌面为主（Rust + Tauri 2）。
   - 但有配套 **Pebble-Web**：https://github.com/QingJ01/Pebble-Web
     - 共享相同 Rust core + React 前端。
     - 官方提供 Docker Compose 一键部署命令：
       ```bash
       curl -fsSL https://raw.githubusercontent.com/QingJ01/Pebble-Web/main/docker-compose.yml -o docker-compose.yml && docker compose up -d
       ```
   - 这证明“本地优先桌面 + 可选 Web 自托管”是可以同时支持的。

结论：**没有项目因为选桌面就彻底放弃 Docker 自托管**。我们可以学 Pebble 的“核心复用”思路。

## 推荐的多部署架构（Docker 私人部署优先）

**核心原则**：
- 聚合引擎（连接 IMAP/Gmail API/MS Graph、同步、OAuth、凭证管理）做成可独立部署的服务。
- Web UI 作为主要私人部署界面（Docker Compose 一站式）。
- 桌面客户端可选（可以完全本地运行，或连接自托管后端）。
- 所有核心功能（优先级排序、批量导入、账号转移/共享）都在后端实现，通过 API 暴露，前端（Web/桌面）复用。

### 推荐选项 1：Headless 后端 + Web 前端（Docker 最佳，推荐主力模式）
- **后端**：EmailEngine（或自研类似 Rust/Node 聚合服务）。
- **前端**：Next.js / Nuxt / 简单 React（参考 Zero 或 Inbox Zero）。
- **部署**：一个 `docker-compose.yml` 包含：
  - emailengine（或自定义引擎）
  - redis（必须）
  - web-ui（你的前端）
  - （可选）postgres（存用户规则、偏好、优先级模型等）
  - （可选）meilisearch 或本地索引服务
- **优点**：
  - 私人部署极简单（docker compose up -d）。
  - 易扩展（加 AI 服务、规则引擎服务）。
  - 桌面客户端可 later 做成连接这个后端的 Tauri App（复用同一 API）。
  - 批量导入、优先级计算、转移逻辑全部在后端，Web 和桌面体验一致。
- **如何支持之前讨论的功能**：
  - 智能优先级：后端规则引擎 + 评分服务 + 可选 AI worker。Web 展示 Focus 视图。
  - 批量导入：Web 上传 CSV → 后端循环调用 EmailEngine API 或内部同步服务。
  - 账号转移：后端提供导出加密配置（账号设置 + 规则，不含或加密凭证）的 API，Web 提供下载/上传界面。接收方重新授权。
  - 共享/委托：后端 ACL，支持多用户访问同一账号。

**示例 docker-compose 骨架**（基于 EmailEngine 调研 + 其他项目）：
```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    # 注意：生产需优化配置（noeviction 等）

  emailengine:
    image: postalsys/emailengine:v2
    depends_on:
      - redis
    environment:
      EENGINE_REDIS: redis://redis:6379/2
      # 其他配置
    ports:
      - "3000:3000"   # API + Web UI（如果需要）
    # 生产建议加反代 + HTTPS

  web-ui:
    build: ./web   # 你的 Next.js 或类似
    depends_on:
      - emailengine
    environment:
      ENGINE_URL: http://emailengine:3000
    ports:
      - "8080:3000"

  # 可选：规则/AI/索引服务
  # ai-worker:
  #   ...

volumes:
  redis-data:
```

### 推荐选项 2：纯 Web 自托管（最简单 Docker 私人部署）
- 类似 Cypht、Zero、Inbox Zero 模式。
- 整个应用打包成 Docker Compose（Web + DB + 引擎）。
- 优先级排序、批量导入、转移全部在 Web 内完成。
- 优点：一键部署，用户直接浏览器访问，无需装客户端。
- 缺点：纯 Web，离线能力弱（除非加 PWA）。

### 推荐选项 3：本地优先桌面 + 可选 Web（Pebble 模式）
- 主力桌面（Tauri + Rust），数据本地 SQLite + Tantivy。
- 提供 Pebble-Web 风格的 Docker 版本（共享核心逻辑）。
- 或者桌面 App 可选择“连接自托管后端”模式（混合）。
- 适合重度隐私/离线用户。
- 之前讨论的 Pebble 很多特性（规则、Kanban、备份导出）天然支持转移和本地优先级计算。

### 混合推荐（最灵活）
- **核心聚合服务**（Docker 部署）：负责所有账号连接、同步、OAuth、凭证安全存储。
- **Web UI**（Docker）：主要私人部署界面，实现优先级视图、批量导入、规则管理、导出/导入、共享 ACL。
- **可选桌面客户端**（Tauri）：完全本地模式（数据不走服务器），或连接自托管 Web/引擎（复用 API + 规则）。
- 这样：
  - 想纯私人 Docker 部署的用户：只跑 Web 部分。
  - 想桌面体验的用户：装桌面 App（可独立用，或连服务器）。
  - 转移功能：在 Web 提供导出，桌面也支持导入/导出文件。

## 之前功能如何在 Docker 私人部署中实现

- **智能优先级排序**：
  - 规则引擎和评分逻辑放在后端服务（Docker 容器）。
  - Web 前端调用 API 获取排序后的列表 + Focus 分区。
  - 用户反馈（星标、归档）通过 API 回写，影响模型。
  - 可选加 AI worker 容器。

- **批量导入**：
  - Web 上传 CSV → 后端解析 → 批量注册账号（EmailEngine API 或内部）。
  - 进度通过 WebSocket 或轮询展示。
  - 国内授权码流程在 Web 向导中引导。

- **账号转移/分享**：
  - Web 提供“导出配置”按钮（生成加密 JSON/zip）。
  - 导入页面：上传后解析，提示重新授权。
  - 共享：后端支持账号级 ACL，多用户登录后看到共享账号。
  - 完全符合之前“配置导出 + 重新认证”安全建议。

所有这些功能**不依赖桌面**，可以在纯 Docker Web 栈里完整实现。

## 对计划的建议

1. **把“Docker 私人自托管部署”明确写成首要非功能需求**。
2. **架构决策**：推荐“可独立部署的聚合引擎 + Web UI”作为主线，桌面作为可选增强（参考 Pebble-Web 模式）。
3. **MVP 范围**：
   - 必须支持 docker compose 一键启动（Web + 必要依赖）。
   - 批量导入、优先级排序、配置导出/导入 都要在 Web 端可用。
4. **避免锁定**：
   - 不要把核心逻辑只塞进 Tauri Rust 代码。
   - 引擎部分用语言无关的 API（REST + WebSocket），这样 Web 和桌面都能用。
5. **文档**：在项目里提供：
   - 推荐 docker-compose.yml（带注释）。
   - 部署指南（开发 / 生产 / 更新）。
   - “如何只部署 Web 部分” vs “如何跑纯本地桌面”说明。

**总结**：Pebble 只是我们调研的一个优秀参考（尤其本地优先 + 规则 + 备份机制），**不是唯一方向**。EmailEngine + Web 前端、Cypht 风格、Zero 风格都完全支持 Docker 私人部署，而且更容易让普通用户（不想装桌面软件）用起来。

这个项目**完全可以同时支持**：
- Docker 私人自托管 Web（主力）
- 可选原生桌面客户端
- 甚至未来移动端

如果你更倾向纯 Web/Docker 路线，我们可以把后续讨论重点放在那个方向（例如推荐用 EmailEngine 做引擎 + Next.js 做 UI）。

需要我现在：
- 写一个完整的推荐 `docker-compose.yml` + 部署文档？
- 调整之前的优先级/批量导入/转移方案，明确只针对 Web/Docker 实现？
- 还是继续等你的整体计划，一起评审时重点讨论部署策略？

把你的顾虑或倾向告诉我，我马上调整调研和建议。私人部署支持绝对不会被丢掉。
