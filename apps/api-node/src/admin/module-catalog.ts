import type { ApiConfig } from "../http/router-types.js";

export interface AdminModuleApiRoute {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  purpose: string;
  accountScoped: boolean;
  requiresConfirmation?: boolean;
}

export interface AdminModuleHermesAccess {
  callable: boolean;
  toolIds: string[];
  safety: "read_only" | "draft_only" | "confirmation_required";
}

export interface AdminModuleCatalogItem {
  id: string;
  label: string;
  status: "available" | "unavailable";
  adminApi: AdminModuleApiRoute[];
  hermes: AdminModuleHermesAccess;
}

export interface AdminHermesBoundary {
  authority: "product_admin";
  allowedScope: string[];
  forbiddenScope: string[];
  confirmationRequiredFor: string[];
}

export interface AdminModuleCatalog {
  hermesBoundary: AdminHermesBoundary;
  modules: AdminModuleCatalogItem[];
}

export function buildAdminModuleCatalog(config: ApiConfig): AdminModuleCatalog {
  return {
    hermesBoundary: {
      authority: "product_admin",
      allowedScope: [
        "mailboxes",
        "messages",
        "search",
        "drafts",
        "sending",
        "labels",
        "sync",
        "domains",
        "settings",
      ],
      forbiddenScope: [
        "repository_code",
        "source_files",
        "migrations",
        "deployment_scripts",
        "runtime_process_control",
      ],
      confirmationRequiredFor: [
        "send_mail",
        "delete_or_trash_mail",
        "bulk_mail_changes",
        "domain_changes",
        "sync_reauthorization",
      ],
    },
    modules: [
      moduleItem({
        id: "mail_read",
        label: "邮箱读取",
        available: Boolean(config.mailReadStore),
        routes: [
          route("GET", "/api/messages", "跨账号聚合搜索邮件", false),
          route(
            "GET",
            "/api/accounts/{accountId}/messages",
            "搜索指定账号邮件",
            true,
          ),
          route(
            "GET",
            "/api/accounts/{accountId}/messages/{messageId}",
            "读取邮件详情",
            true,
          ),
        ],
        hermes: {
          callable: Boolean(config.mailReadStore),
          toolIds: ["mail.search", "mail.read"],
          safety: "read_only",
        },
      }),
      moduleItem({
        id: "mail_compose",
        label: "写信与发送",
        available: Boolean(config.mailComposeService),
        routes: [
          route(
            "POST",
            "/api/accounts/{accountId}/messages/{messageId}/compose/reply",
            "创建回复草稿种子",
            true,
          ),
          route(
            "POST",
            "/api/accounts/{accountId}/compose/drafts",
            "保存草稿",
            true,
          ),
          route(
            "POST",
            "/api/accounts/{accountId}/compose/drafts/{draftId}/send",
            "发送已确认草稿",
            true,
            true,
          ),
        ],
        hermes: {
          callable: Boolean(config.mailComposeService),
          toolIds: ["compose.seed", "compose.draft", "compose.send"],
          safety: "confirmation_required",
        },
      }),
      moduleItem({
        id: "hermes",
        label: "Hermes",
        available: Boolean(config.hermesService),
        routes: [
          route(
            "POST",
            "/api/hermes/skills/email_search_qa/run",
            "自然语言邮件搜索",
            false,
          ),
          route(
            "POST",
            "/api/accounts/{accountId}/messages/{messageId}/hermes/reply-draft",
            "根据邮件生成回复草稿",
            true,
          ),
          route("GET", "/api/hermes/runtime", "读取 Hermes 连接配置", false),
          route("POST", "/api/hermes/runtime/test", "测试 Hermes 连接", false),
        ],
        hermes: {
          callable: Boolean(config.hermesService),
          toolIds: ["hermes.search", "hermes.replyDraft"],
          safety: "draft_only",
        },
      }),
      moduleItem({
        id: "mail_actions",
        label: "邮件动作",
        available: Boolean(config.mailActionService),
        routes: [
          route(
            "POST",
            "/api/accounts/{accountId}/messages/{messageId}/actions",
            "归档、标记、移动或加标签",
            true,
            true,
          ),
        ],
        hermes: {
          callable: Boolean(config.mailActionService),
          toolIds: ["mail.action"],
          safety: "confirmation_required",
        },
      }),
      moduleItem({
        id: "labels",
        label: "标签",
        available: Boolean(config.labelService),
        routes: [
          route("GET", "/api/accounts/{accountId}/labels", "列出标签", true),
          route("POST", "/api/accounts/{accountId}/labels", "创建或更新标签", true),
        ],
        hermes: {
          callable: Boolean(config.labelService),
          toolIds: ["labels.list", "labels.upsert"],
          safety: "confirmation_required",
        },
      }),
      moduleItem({
        id: "sync",
        label: "同步中心",
        available: Boolean(config.syncCenterStore || config.syncControlService),
        routes: [
          route("GET", "/api/sync-center/accounts", "列出同步账号", false),
          route(
            "POST",
            "/api/sync-center/accounts/{accountId}/resync",
            "触发账号重新同步",
            true,
            true,
          ),
        ],
        hermes: {
          callable: Boolean(config.syncCenterStore || config.syncControlService),
          toolIds: ["sync.list", "sync.resync"],
          safety: "confirmation_required",
        },
      }),
      moduleItem({
        id: "onboarding",
        label: "添加邮箱",
        available: Boolean(
          config.oauthOnboardingService || config.accountOnboardingService,
        ),
        routes: [
          route(
            "POST",
            "/api/accounts/oauth/{provider}/start",
            "启动官方 OAuth 登录",
            false,
          ),
          route("POST", "/api/accounts/imap-smtp/test", "测试账号连接", false),
          route("POST", "/api/accounts/imap-smtp", "添加 IMAP/SMTP 账号", false),
        ],
        hermes: {
          callable: Boolean(
            config.oauthOnboardingService || config.accountOnboardingService,
          ),
          toolIds: ["onboarding.oauthStart", "onboarding.test", "onboarding.add"],
          safety: "confirmation_required",
        },
      }),
      moduleItem({
        id: "domains",
        label: "配置域名",
        available: Boolean(config.domainAliasService),
        routes: [
          route("GET", "/api/domains", "列出域名配置", false),
          route("POST", "/api/domains", "创建域名配置", false, true),
          route("POST", "/api/domains/{domainId}/verify", "验证 DNS", false),
        ],
        hermes: {
          callable: Boolean(config.domainAliasService),
          toolIds: ["domains.read", "domains.verify"],
          safety: "confirmation_required",
        },
      }),
    ],
  };
}

function moduleItem(input: {
  id: string;
  label: string;
  available: boolean;
  routes: AdminModuleApiRoute[];
  hermes: AdminModuleHermesAccess;
}): AdminModuleCatalogItem {
  return {
    id: input.id,
    label: input.label,
    status: input.available ? "available" : "unavailable",
    adminApi: input.routes,
    hermes: input.hermes,
  };
}

function route(
  method: AdminModuleApiRoute["method"],
  path: string,
  purpose: string,
  accountScoped: boolean,
  requiresConfirmation?: boolean,
): AdminModuleApiRoute {
  return {
    method,
    path,
    purpose,
    accountScoped,
    ...(requiresConfirmation ? { requiresConfirmation } : {}),
  };
}
