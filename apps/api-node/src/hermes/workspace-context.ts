import type { LabelDto, LabelService } from "../labels/labels.js";
import type {
  MailNavigationSummary,
  MailNavigationSummaryService,
} from "../mail-navigation/navigation-summary.js";
import type {
  SyncCenterAccount,
  SyncCenterStore,
} from "../sync-center/sync-center-store.js";
import type { HermesRuleCandidate, HermesRule, HermesRuleService } from "./rules.js";
import type { HermesSkill } from "./skills.js";

export interface HermesWorkspaceMailEngineContext {
  provider: "emailengine";
  ok: boolean;
  missing: string[];
  warnings: string[];
  readiness: {
    status: "ready" | "degraded";
    summary: string;
  };
  capabilities: {
    imapSmtpOnboarding: boolean;
    attachmentDownload: boolean;
    send: boolean;
  };
}

export interface HermesWorkspaceOperationBoundary {
  id: string;
  title: string;
  mode: "read_only" | "draft_only" | "confirmation_required";
  description: string;
}

export interface HermesWorkspaceContext {
  generatedAt: string;
  accountScope: {
    requestedAccountId?: string;
    availableAccountIds: string[];
    selectedAccount?: SyncCenterAccount;
  };
  accounts: SyncCenterAccount[];
  navigation?: MailNavigationSummary;
  labels: LabelDto[];
  rules: HermesRule[];
  pendingRuleCandidates: HermesRuleCandidate[];
  skills: HermesSkill[];
  mailEngine?: HermesWorkspaceMailEngineContext;
  operationBoundaries: HermesWorkspaceOperationBoundary[];
  unavailableModules: string[];
}

export interface HermesWorkspaceContextService {
  getContext(input: {
    accountId?: string;
    ruleLimit?: number;
    labelLimit?: number;
  }): Promise<HermesWorkspaceContext>;
}

export class InvalidHermesWorkspaceContextRequestError extends Error {
  readonly code = "invalid_hermes_workspace_context_request";

  constructor() {
    super("invalid_hermes_workspace_context_request");
  }
}

export function createHermesWorkspaceContextService(options: {
  syncCenterStore?: Pick<SyncCenterStore, "listAccounts">;
  mailNavigationService?: Pick<MailNavigationSummaryService, "getSummary">;
  labelService?: Pick<LabelService, "listLabels">;
  hermesRuleService?: Pick<
    HermesRuleService,
    "listRules" | "listRuleCandidates"
  >;
  getMailEngineContext?: () => Promise<HermesWorkspaceMailEngineContext>;
  getSkills: () => HermesSkill[];
  now: () => string;
}): HermesWorkspaceContextService {
  return {
    async getContext(input) {
      const requestedAccountId = normalizeOptionalId(input.accountId);
      const ruleLimit = clampLimit(input.ruleLimit ?? 25, 1, 100);
      const labelLimit = clampLimit(input.labelLimit ?? 50, 1, 200);
      const unavailableModules = new Set<string>();

      const accountsResult = options.syncCenterStore
        ? await safeModule(
            "sync_center",
            unavailableModules,
            { items: [] },
            () => options.syncCenterStore!.listAccounts(),
          )
        : unavailable("sync_center", { items: [] }, unavailableModules);
      const accounts = accountsResult.items;
      const selectedAccount =
        (requestedAccountId
          ? accounts.find((account) => account.accountId === requestedAccountId)
          : accounts[0]) ?? undefined;
      const accountId = requestedAccountId ?? selectedAccount?.accountId;

      const [navigation, labels, rules, pendingRuleCandidates, mailEngine] =
        await Promise.all([
          options.mailNavigationService
            ? safeModule(
                "mail_navigation",
                unavailableModules,
                undefined,
                () => options.mailNavigationService!.getSummary(),
              )
            : unavailable("mail_navigation", undefined, unavailableModules),
          accountId && options.labelService
            ? safeModule("labels", unavailableModules, [], () =>
                options.labelService!
                  .listLabels({ accountId })
                  .then((result) => result.items.slice(0, labelLimit)),
              )
            : unavailable(
                accountId ? "labels" : "labels_account_scope",
                [],
                unavailableModules,
              ),
          accountId && options.hermesRuleService
            ? safeModule("hermes_rules", unavailableModules, [], () =>
                options.hermesRuleService!
                  .listRules({ accountId, enabled: true, limit: ruleLimit })
                  .then((result) => result.items),
              )
            : unavailable(
                accountId ? "hermes_rules" : "rules_account_scope",
                [],
                unavailableModules,
              ),
          accountId && options.hermesRuleService
            ? safeModule("hermes_rule_candidates", unavailableModules, [], () =>
                options.hermesRuleService!
                  .listRuleCandidates({
                    accountId,
                    status: "shadow",
                    limit: ruleLimit,
                  })
                  .then((result) => result.items),
              )
            : unavailable(
                accountId ? "hermes_rule_candidates" : "rule_candidates_account_scope",
                [],
                unavailableModules,
              ),
          options.getMailEngineContext
            ? safeModule(
                "mail_engine_readiness",
                unavailableModules,
                undefined,
                options.getMailEngineContext,
              )
            : unavailable("mail_engine_readiness", undefined, unavailableModules),
        ]);

      return {
        generatedAt: options.now(),
        accountScope: {
          ...(requestedAccountId ? { requestedAccountId } : {}),
          availableAccountIds: accounts.map((account) => account.accountId),
          ...(selectedAccount ? { selectedAccount } : {}),
        },
        accounts,
        ...(navigation ? { navigation } : {}),
        labels,
        rules,
        pendingRuleCandidates,
        skills: options.getSkills(),
        ...(mailEngine ? { mailEngine } : {}),
        operationBoundaries: buildOperationBoundaries({
          mailEngine,
          hasRuleService: Boolean(options.hermesRuleService),
        }),
        unavailableModules: [...unavailableModules].sort(),
      };
    },
  };
}

function buildOperationBoundaries(input: {
  mailEngine?: HermesWorkspaceMailEngineContext;
  hasRuleService: boolean;
}): HermesWorkspaceOperationBoundary[] {
  return [
    {
      id: "mail_read_context",
      title: "读取邮箱上下文",
      mode: "read_only",
      description: "Hermes 可以读取账号、分组、标签、规则和搜索结果上下文。",
    },
    {
      id: "draft_reply",
      title: "写回复草稿",
      mode: "draft_only",
      description: "Hermes 只能生成可编辑草稿，发信仍由用户确认。",
    },
    {
      id: "translate_and_summarize",
      title: "翻译与总结",
      mode: "read_only",
      description: "Hermes 可以翻译和总结当前邮件或线程，不修改邮箱状态。",
    },
    {
      id: "create_mailbox_rule",
      title: "创建邮箱规则和左侧分组",
      mode: "confirmation_required",
      description: input.hasRuleService
        ? "Hermes 可以生成规则草案、先做 shadow simulation，再由用户确认启用。"
        : "Hermes 规则服务未启用，暂时不能创建或启用邮箱规则。",
    },
    {
      id: "provider_writeback",
      title: "写回邮件服务商",
      mode: "confirmation_required",
      description:
        input.mailEngine?.capabilities.send || input.mailEngine?.ok
          ? "跨服务商写回必须经过显式确认和审计。"
          : "EmailEngine 尚未完全就绪，涉及服务商写回的操作会被降级或阻断。",
    },
  ];
}

function unavailable<T>(
  module: string,
  fallback: T,
  unavailableModules: Set<string>,
): T {
  unavailableModules.add(module);
  return fallback;
}

async function safeModule<T>(
  module: string,
  unavailableModules: Set<string>,
  fallback: T,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch {
    unavailableModules.add(module);
    return fallback;
  }
}

function normalizeOptionalId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
