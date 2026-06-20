import type { EmailHubSessionApi } from "./emailHubSessionTypes";
import { createApiFetch } from "./apiFetch";
import { createDomainAliasApiClient } from "./domainAliasApiClient";
import type {
  AttachmentDownload,
  EmailHubApi,
  ImapSmtpConnectionDiagnostic,
  MailAction,
} from "./emailHubApiTypes";

export interface CreateEmailHubApiOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  apiToken?: string;
}

export interface ApiErrorPayload {
  error?: string;
  skillId?: string;
  requiredPermission?: HermesSkillRequiredPermission;
  provider?: string;
  detail?: string;
  requestId?: string;
  diagnostics?: ImapSmtpConnectionDiagnostic[];
}

export type HermesSkillRequiredPermission = "body_read" | "memory_write";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly skillId?: string;
  readonly requiredPermission?: HermesSkillRequiredPermission;
  readonly provider?: string;
  readonly detail?: string;
  readonly requestId?: string;
  readonly diagnostics?: ImapSmtpConnectionDiagnostic[];
  readonly payload?: ApiErrorPayload;

  constructor(status: number, code: string, payload?: ApiErrorPayload) {
    super(code);
    this.status = status;
    this.code = code;
    this.skillId = payload?.skillId;
    this.requiredPermission = payload?.requiredPermission;
    this.provider = payload?.provider;
    this.detail = payload?.detail;
    this.requestId = payload?.requestId;
    this.diagnostics = payload?.diagnostics;
    this.payload = payload;
  }
}

export function createEmailHubApi(
  options: CreateEmailHubApiOptions = {},
): EmailHubApi & EmailHubSessionApi {
  const fetchImpl = createApiFetch(options.fetchImpl ?? fetch, options.apiToken);
  const baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
  const domainAliasApi = createDomainAliasApiClient({
    request: (path, init) => request(fetchImpl, baseUrl, path, init),
  });

  return {
    getSession() {
      return request(fetchImpl, baseUrl, "/api/session");
    },

    createAdmin(input) {
      return request(fetchImpl, baseUrl, "/api/session/setup", {
        method: "POST",
        body: JSON.stringify({ email: input.email, password: input.password }),
      });
    },

    login(input) {
      return request(fetchImpl, baseUrl, "/api/session/login", {
        method: "POST",
        body: JSON.stringify({ email: input.email, password: input.password }),
      });
    },

    logout() {
      return request(fetchImpl, baseUrl, "/api/session/logout", {
        method: "POST",
      });
    },

    listMailboxes(input) {
      return request(fetchImpl, baseUrl, `/api/accounts/${encodePath(input.accountId)}/mailboxes`);
    },

    listMessages(input) {
      const params = new URLSearchParams();
      params.set("limit", String(input.limit ?? 50));
      appendParam(params, "mailboxId", input.mailboxId);
      appendParam(params, "mailboxRole", input.mailboxRole);
      appendParam(params, "cursor", input.cursor);
      appendParam(params, "q", input.q?.trim() || undefined);
      appendParam(params, "sort", input.sort);
      appendParam(params, "savedView", input.savedView);
      appendParams(params, "quickFilter", input.quickFilters);
      appendParams(params, "qScope", input.qScopes);
      appendParams(params, "labelId", input.labelIds);
      appendParam(params, "tagMode", input.tagMode);
      appendParam(params, "sender", input.senderQuery?.trim() || undefined);
      appendParam(params, "recipient", input.recipientQuery?.trim() || undefined);
      appendParam(params, "receivedAfter", input.receivedAfter);
      appendParam(params, "receivedBefore", input.receivedBefore);
      if (typeof input.hasAttachment === "boolean") {
        appendParam(params, "hasAttachment", String(input.hasAttachment));
      }
      const path = input.accountId
        ? `/api/accounts/${encodePath(input.accountId)}/messages`
        : "/api/messages";
      return request(
        fetchImpl,
        baseUrl,
        `${path}?${params.toString()}`,
      );
    },

    listLabels(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/labels`,
      );
    },

    upsertLabel(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/labels`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              name: input.name,
              color: input.color,
            }),
          ),
        },
      );
    },

    getMessage(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}`,
      );
    },

    downloadAttachment(input) {
      return downloadBlob(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/attachments/${encodePath(input.attachmentId)}/download`,
      );
    },

    applyMailAction(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/actions`,
        {
          method: "POST",
          body: actionBody(input),
        },
      );
    },

    applySmartInboxCardBulkAction(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/smart-inbox/cards/${encodePath(input.bucket)}/actions`,
        {
          method: "POST",
          body: JSON.stringify({
            action: input.action,
            messageIds: input.messageIds,
          }),
        },
      );
    },

    recordSmartInboxFeedback(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/smart-inbox/feedback`,
        {
          method: "POST",
          body: JSON.stringify({ action: input.action }),
        },
      );
    },

    getGatekeeperSettings(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/gatekeeper/settings`,
      );
    },

    updateGatekeeperSettings(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/gatekeeper/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({ mode: input.mode }),
        },
      );
    },

    listGatekeeperSenders(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      appendParam(params, "status", input.status);
      return request(fetchImpl, baseUrl, `/api/screening/senders?${params.toString()}`);
    },

    acceptGatekeeperSender(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/screening/senders/${encodePath(input.senderId)}/accept`,
        {
          method: "POST",
          body: JSON.stringify({ accountId: input.accountId }),
        },
      );
    },

    blockGatekeeperSender(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/screening/senders/${encodePath(input.senderId)}/block`,
        {
          method: "POST",
          body: JSON.stringify({ accountId: input.accountId }),
        },
      );
    },

    bulkDecideGatekeeperSenders(input) {
      return request(fetchImpl, baseUrl, "/api/screening/senders/bulk", {
        method: "POST",
        body: JSON.stringify({
          accountId: input.accountId,
          senderIds: input.senderIds,
          action: input.action,
        }),
      });
    },

    blockGatekeeperDomain(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/screening/domains/${encodePath(input.domain)}/block`,
        {
          method: "POST",
          body: JSON.stringify({ accountId: input.accountId }),
        },
      );
    },

    getHermesRuntimeSettings() {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime");
    },

    getHermesProviders() {
      return request(fetchImpl, baseUrl, "/api/hermes/providers");
    },

    updateHermesRuntimeSettings(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime", {
        method: "PUT",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    clearHermesRuntimeApiKey(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime", {
        method: "PUT",
        body: JSON.stringify(cleanObject({ ...input, clearApiKey: true })),
      });
    },

    probeHermesProvider(input) {
      const { providerKey, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/providers/${encodePath(providerKey)}/probe`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    testHermesRuntimeConnection() {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime/test", {
        method: "POST",
      });
    },

    getHermesRuntimeVersion() {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime/version");
    },

    checkHermesRuntimeUpdate() {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime/update/check", {
        method: "POST",
      });
    },

    listHermesSkills() {
      return request(fetchImpl, baseUrl, "/api/hermes/skills");
    },

    getHermesResourceProfile() {
      return request(fetchImpl, baseUrl, "/api/hermes/resource-profile");
    },

    updateHermesSkillSettings(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/skills/${encodePath(input.skillId)}/settings`,
        {
          method: "PATCH",
          body: JSON.stringify(cleanObject(input.patch)),
        },
      );
    },

    listHermesMemories(input) {
      const params = new URLSearchParams();
      appendParam(params, "accountId", input.accountId.trim());
      appendParam(params, "layer", input.layer?.trim() || undefined);
      appendParam(params, "scope", input.scope?.trim() || undefined);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/memories${query ? `?${query}` : ""}`,
      );
    },

    updateHermesMemory(input) {
      const params = new URLSearchParams({
        accountId: input.accountId.trim(),
      });
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/memories/${encodePath(input.id)}?${params}`,
        {
          method: "PATCH",
          body: JSON.stringify(
            cleanObject({
              content: input.content,
              confidence: input.confidence,
            }),
          ),
        },
      );
    },

    deleteHermesMemory(input) {
      const params = new URLSearchParams({
        accountId: input.accountId.trim(),
      });
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/memories/${encodePath(input.id)}?${params}`,
        { method: "DELETE" },
      );
    },

    listHermesAuditLog(input = {}) {
      const params = new URLSearchParams();
      appendParam(params, "accountId", input.accountId?.trim() || undefined);
      appendParam(params, "skillId", input.skillId?.trim() || undefined);
      appendParam(params, "messageId", input.messageId?.trim() || undefined);
      appendParam(params, "memoryId", input.memoryId?.trim() || undefined);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/audit-log${query ? `?${query}` : ""}`,
      );
    },

    searchMailWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/email_search_qa/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    getHermesWorkspaceContext(input = {}) {
      const params = new URLSearchParams();
      if (input.accountId) {
        params.set("accountId", input.accountId);
      }
      if (input.ruleLimit !== undefined) {
        params.set("ruleLimit", String(input.ruleLimit));
      }
      if (input.labelLimit !== undefined) {
        params.set("labelLimit", String(input.labelLimit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/workspace/context${query ? `?${query}` : ""}`,
      );
    },

    createHermesActionPlan(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/action-plans", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    confirmHermesActionPlan(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/action-plans/${encodePath(input.planId)}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            accountId: input.accountId,
            candidateId: input.candidateId,
          }),
        },
      );
    },

    listHermesRules(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      if (typeof input.enabled === "boolean") {
        params.set("enabled", String(input.enabled));
      }
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rules?${params.toString()}`,
      );
    },

    listHermesRuleCandidates(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      if (input.status) {
        params.set("status", input.status);
      }
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rule-candidates?${params.toString()}`,
      );
    },

    updateHermesRuleCandidate(input) {
      const { candidateId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rule-candidates/${encodePath(candidateId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    dismissHermesRuleCandidate(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rule-candidates/${encodePath(input.candidateId)}/dismiss`,
        {
          method: "POST",
          body: JSON.stringify({ accountId: input.accountId }),
        },
      );
    },

    updateHermesRule(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rules/${encodePath(input.ruleId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(cleanObject({
            accountId: input.accountId,
            enabled: input.enabled,
            sortOrder: input.sortOrder,
          })),
        },
      );
    },

    runHermesRule(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rules/${encodePath(input.ruleId)}/run`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              accountId: input.accountId,
              limit: input.limit,
            }),
          ),
        },
      );
    },

    listHermesRuleExecutions(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      if (input.ruleId) {
        params.set("ruleId", input.ruleId);
      }
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rule-runs?${params.toString()}`,
      );
    },

    draftHermesRule(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/rules/draft", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    suggestHermesRules(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/rules/suggest", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    simulateHermesRule(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rules/${encodePath(input.candidateId)}/simulate`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              accountId: input.accountId,
              sampleLimit: input.sampleLimit,
            }),
          ),
        },
      );
    },

    triagePriorityWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/priority_triage/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    suggestLabelsWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/label_suggest/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    cleanupNewsletterWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/newsletter_cleanup/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    extractActionItemsWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/action_item_extract/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    organizeMessage(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/organize`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
            }),
          ),
        },
      );
    },

    previewAccountCsv(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/import/csv/preview", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    createAccountCsvImport(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/import/csv", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    exportAccountTransfer(input = {}) {
      return request(fetchImpl, baseUrl, "/api/accounts/transfer/export", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    importAccountTransfer(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/transfer/import", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    startOAuthAccount(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/oauth/${encodePath(input.provider)}/start`,
        {
          method: "POST",
          body: JSON.stringify({
            redirectUri: input.redirectUri,
            ...(input.loginHint ? { loginHint: input.loginHint } : {}),
          }),
        },
      );
    },

    completeOAuthCallback(input) {
      const params = new URLSearchParams();
      params.set("state", input.state);
      params.set("code", input.code);
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/oauth/${encodePath(input.provider)}/callback?${params.toString()}`,
      );
    },

    onboardImapSmtpAccount(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/imap-smtp", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    testImapSmtpConnection(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/imap-smtp/test", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    listOperationalEvents(input = {}) {
      const params = new URLSearchParams();
      appendParam(params, "service", input.service);
      appendParam(params, "level", input.level);
      appendParam(params, "event", input.event);
      appendParam(params, "requestId", input.requestId);
      appendParam(params, "accountId", input.accountId);
      appendParam(params, "lane", input.lane);
      appendParam(params, "jobId", input.jobId);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/diagnostics/events${query ? `?${query}` : ""}`,
      );
    },

    listSyncCenterAccounts() {
      return request(fetchImpl, baseUrl, "/api/sync-center/accounts");
    },

    listSyncCenterReauthorizations() {
      return request(fetchImpl, baseUrl, "/api/sync-center/reauthorizations");
    },

    startSyncCenterOAuthReauthorization(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/reauthorizations/${encodePath(input.taskId)}/oauth/start`,
        {
          method: "POST",
          body: JSON.stringify({ redirectUri: input.redirectUri }),
        },
      );
    },

    completeSyncCenterOAuthReauthorizationCallback(input) {
      return request(
        fetchImpl,
        baseUrl,
        "/api/sync-center/reauthorizations/oauth/callback",
        {
          method: "POST",
          body: JSON.stringify({
            state: input.state,
            code: input.code,
          }),
        },
      );
    },

    completeSyncCenterImapSmtpReauthorization(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/reauthorizations/${encodePath(input.taskId)}/imap-smtp`,
        {
          method: "POST",
          body: JSON.stringify({
            ...(input.username ? { username: input.username } : {}),
            secret: input.secret,
            ...(input.imap && input.smtp
              ? { imap: input.imap, smtp: input.smtp }
              : {}),
          }),
        },
      );
    },

    listSyncCenterAccountDiagnostics(input) {
      const params = new URLSearchParams();
      appendParam(params, "level", input.level);
      appendParam(params, "jobId", input.jobId);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/diagnostics${query ? `?${query}` : ""}`,
      );
    },

    requestSyncCenterResync(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/resync`,
        { method: "POST" },
      );
    },

    pauseSyncCenterAccount(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/pause`,
        { method: "POST" },
      );
    },

    resumeSyncCenterAccount(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/resume`,
        { method: "POST" },
      );
    },

    retryFailedSyncCenterJobs(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/retry-failed`,
        { method: "POST" },
      );
    },

    getMailNavigationSummary() {
      return request(fetchImpl, baseUrl, "/api/mail-navigation/summary");
    },

    getApiHealth() {
      return request(fetchImpl, baseUrl, "/health");
    },

    getMailEngineHealth() {
      return request(fetchImpl, baseUrl, "/api/mail-engine/health");
    },

    getMailProviderCapabilities() {
      return request(fetchImpl, baseUrl, "/api/mail-providers/capabilities");
    },

    getComposeAttachmentMaintenanceStatus() {
      return request(fetchImpl, baseUrl, "/api/maintenance/compose-attachments");
    },

    cleanupComposeAttachments(input = {}) {
      return request(
        fetchImpl,
        baseUrl,
        "/api/maintenance/compose-attachments/cleanup",
        {
          method: "POST",
          body: JSON.stringify(cleanObject(input)),
        },
      );
    },

    getHermesRetentionMaintenanceStatus() {
      return request(fetchImpl, baseUrl, "/api/maintenance/hermes-retention");
    },

    cleanupHermesRetention(input = {}) {
      return request(
        fetchImpl,
        baseUrl,
        "/api/maintenance/hermes-retention/cleanup",
        {
          method: "POST",
          body: JSON.stringify(cleanObject(input)),
        },
      );
    },

    ...domainAliasApi,

    listFollowUps(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      appendParam(params, "status", input.status);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      return request(fetchImpl, baseUrl, `/api/follow-ups?${params.toString()}`);
    },

    trackFollowup(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/followup_tracker/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    trackMessageFollowup(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/followup-track`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
            }),
          ),
        },
      );
    },

    translateText(input) {
      const accountId = input.accountId.trim();
      const params = new URLSearchParams();
      appendParam(params, "accountId", accountId);
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/skills/translate_text/run${query ? `?${query}` : ""}`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject({ ...input, accountId })),
        },
      );
    },

    translateMessage(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/translate`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              targetLanguage: input.targetLanguage,
              sourceLanguage: input.sourceLanguage,
              tone: input.tone,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
              forceRefresh: input.forceRefresh,
            }),
          ),
        },
      );
    },

    confirmTranslationPreference(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/translation-preferences", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    summarizeThread(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/thread_summarize/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    summarizeMessage(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/summary`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              mode: input.mode,
              focus: input.focus,
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
              forceRefresh: input.forceRefresh,
            }),
          ),
        },
      );
    },

    draftMessageReply(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/reply-draft`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              instruction: input.instruction,
              tone: input.tone,
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
            }),
          ),
        },
      );
    },

    quickMessageReply(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/quick-reply`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              scenario: input.scenario,
              instruction: input.instruction,
              tone: input.tone,
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
            }),
          ),
        },
      );
    },

    draftReply(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/reply_draft/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    quickReply(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/quick_reply/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    rewritePolishDraft(input) {
      const accountId = input.accountId.trim();
      const params = new URLSearchParams();
      appendParam(params, "accountId", accountId);
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/skills/rewrite_polish/run${query ? `?${query}` : ""}`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject({ ...input, accountId })),
        },
      );
    },

    confirmHermesFollowUp(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/follow-ups/confirm", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    createFollowUp(input) {
      const { accountId, messageId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/messages/${encodePath(messageId)}/follow-ups`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
    },

    updateFollowUp(input) {
      const { id, ...body } = input;
      return request(fetchImpl, baseUrl, `/api/follow-ups/${encodePath(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },

    cancelFollowUp(input) {
      return request(fetchImpl, baseUrl, `/api/follow-ups/${encodePath(input.id)}`, {
        method: "DELETE",
      });
    },

    createMailDraft(input) {
      const { accountId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/compose/drafts`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    listMailDrafts(input) {
      const query = new URLSearchParams();
      if (typeof input.limit === "number") {
        query.set("limit", String(input.limit));
      }
      const queryString = query.toString();
      const suffix = queryString ? `?${queryString}` : "";
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/compose/drafts${suffix}`,
      );
    },

    uploadComposeAttachment(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/compose/attachments`,
        {
          method: "POST",
          headers: {
            "content-type": input.file.type || "application/octet-stream",
            "x-emailhub-filename": encodeURIComponent(
              input.file.name || "attachment",
            ),
          },
          body: input.file,
        },
      );
    },

    updateMailDraft(input) {
      const { accountId, draftId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/compose/drafts/${encodePath(draftId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    createComposeSeed(input) {
      const { accountId, messageId, mode, ...body } = input;
      const pathMode = mode === "reply_all" ? "reply-all" : mode;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/messages/${encodePath(messageId)}/compose/${pathMode}`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    previewMailDraft(input) {
      const { accountId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/compose/preview`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    listSendIdentities(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities`,
      );
    },

    addProviderSendIdentityCandidate(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities/provider-candidates`,
        {
          method: "POST",
          body: JSON.stringify({
            provider: input.provider,
            address: input.address,
            ...(input.name ? { name: input.name } : {}),
            identityType: input.identityType,
          }),
        },
      );
    },

    verifyProviderSendIdentityCandidate(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities/provider-candidates/${encodePath(input.candidateId)}/verify`,
        { method: "POST" },
      );
    },

    verifyProviderSendIdentityUserTarget(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities/provider-candidates/${encodePath(input.candidateId)}/verify-user-target`,
        {
          method: "POST",
          body: JSON.stringify({
            targetMailbox: input.targetMailbox,
          }),
        },
      );
    },

    diagnoseProviderSendIdentityCandidate(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities/provider-candidates/${encodePath(input.candidateId)}/diagnostics`,
      );
    },

    sendMailDraft(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/compose/drafts/${encodePath(input.draftId)}/send`,
        { method: "POST" },
      );
    },

    scheduleMailDraft(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/compose/drafts/${encodePath(input.draftId)}/schedule`,
        {
          method: "POST",
          body: JSON.stringify({ scheduledAt: input.scheduledAt }),
        },
      );
    },

    listOutbox(input) {
      const query = new URLSearchParams();
      if (typeof input.limit === "number") {
        query.set("limit", String(input.limit));
      }
      const queryString = query.toString();
      const suffix = queryString ? `?${queryString}` : "";
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox${suffix}`,
      );
    },

    getScheduledDraft(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox/${encodePath(input.scheduledId)}/draft`,
      );
    },

    updateScheduledDraft(input) {
      const { accountId, scheduledId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/outbox/${encodePath(scheduledId)}/draft`,
        {
          method: "PATCH",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    sendScheduledNow(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox/${encodePath(input.scheduledId)}/send-now`,
        { method: "POST" },
      );
    },

    rescheduleScheduledSend(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox/${encodePath(input.scheduledId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ scheduledAt: input.scheduledAt }),
        },
      );
    },

    cancelScheduledSend(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox/${encodePath(input.scheduledId)}`,
        { method: "DELETE" },
      );
    },
  };
}

async function request<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "GET",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await readJson(response);
  const errorPayload = normalizeApiErrorPayload(payload);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      errorPayload?.error ?? "request_failed",
      errorPayload,
    );
  }

  return payload as T;
}

async function downloadBlob(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
): Promise<AttachmentDownload> {
  const response = await fetchImpl(`${baseUrl}${path}`, { method: "GET" });
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    const errorPayload = normalizeApiErrorPayload(payload);
    throw new ApiRequestError(
      response.status,
      errorPayload?.error ?? "request_failed",
      errorPayload,
    );
  }

  const blob = await response.blob();
  return {
    blob,
    filename:
      parseContentDispositionFilename(response.headers.get("content-disposition")) ??
      "attachment",
    contentType:
      response.headers.get("content-type") ??
      blob.type ??
      "application/octet-stream",
  };
}

async function readJson(response: Response): Promise<Record<string, unknown> | undefined> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  return JSON.parse(text) as Record<string, unknown>;
}

async function readErrorPayload(
  response: Response,
): Promise<Record<string, unknown> | undefined> {
  try {
    return await readJson(response);
  } catch {
    return undefined;
  }
}

function normalizeApiErrorPayload(
  payload: Record<string, unknown> | undefined,
): ApiErrorPayload | undefined {
  if (!payload) {
    return undefined;
  }

  const normalized: ApiErrorPayload = {};
  if (typeof payload.error === "string") {
    normalized.error = payload.error;
  }
  if (typeof payload.skillId === "string") {
    normalized.skillId = payload.skillId;
  }
  if (isHermesSkillRequiredPermission(payload.requiredPermission)) {
    normalized.requiredPermission = payload.requiredPermission;
  }
  if (typeof payload.provider === "string") {
    normalized.provider = payload.provider;
  }
  if (typeof payload.detail === "string") {
    normalized.detail = payload.detail;
  }
  if (typeof payload.requestId === "string") {
    normalized.requestId = payload.requestId;
  }

  const diagnostics = normalizeApiConnectionDiagnostics(payload.diagnostics);
  if (diagnostics.length > 0) {
    normalized.diagnostics = diagnostics;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isHermesSkillRequiredPermission(
  value: unknown,
): value is HermesSkillRequiredPermission {
  return value === "body_read" || value === "memory_write";
}

function normalizeApiConnectionDiagnostics(
  value: unknown,
): ImapSmtpConnectionDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isApiConnectionDiagnostic)
    .map((diagnostic) => ({
      code: diagnostic.code,
      provider: diagnostic.provider,
      severity: diagnostic.severity,
      affected: diagnostic.affected,
      message: diagnostic.message,
      recoveryAction: diagnostic.recoveryAction,
    }));
}

function isApiConnectionDiagnostic(
  value: unknown,
): value is ImapSmtpConnectionDiagnostic {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const diagnostic = value as Record<string, unknown>;
  return (
    typeof diagnostic.code === "string" &&
    typeof diagnostic.provider === "string" &&
    diagnostic.severity === "action_required" &&
    (diagnostic.affected === "account" ||
      diagnostic.affected === "imap" ||
      diagnostic.affected === "smtp") &&
    typeof diagnostic.message === "string" &&
    typeof diagnostic.recoveryAction === "string"
  );
}

function parseContentDispositionFilename(header: string | null): string | undefined {
  if (!header) {
    return undefined;
  }

  const parts = header.split(";").map((part) => part.trim());
  const extended = parts.find((part) =>
    part.toLowerCase().startsWith("filename*="),
  );
  if (extended) {
    const value = unquoteHeaderValue(extended.slice(extended.indexOf("=") + 1));
    const encoded = value.includes("''") ? value.slice(value.indexOf("''") + 2) : value;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  const plain = parts.find((part) => part.toLowerCase().startsWith("filename="));
  if (!plain) {
    return undefined;
  }

  return unquoteHeaderValue(plain.slice(plain.indexOf("=") + 1));
}

function unquoteHeaderValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"");
  }

  return trimmed;
}

function actionBody(input: {
  action: MailAction;
  mailboxId?: string;
  labelIds?: string[];
  undoToken?: string;
}): string {
  return JSON.stringify({
    action: input.action,
    ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
    ...(input.labelIds ? { labelIds: input.labelIds } : {}),
    ...(input.undoToken ? { undoToken: input.undoToken } : {}),
  });
}

function appendParam(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
): void {
  if (value) {
    params.set(key, value);
  }
}

function appendParams(
  params: URLSearchParams,
  key: string,
  values: string[] | undefined,
): void {
  for (const value of values ?? []) {
    if (value) {
      params.append(key, value);
    }
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function cleanObject<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
