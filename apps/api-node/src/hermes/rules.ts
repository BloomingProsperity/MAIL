import {
  findBuiltInSavedView,
  type SavedViewDefinition,
} from "../mail-navigation/saved-views.js";
import type { LabelColor, LabelService } from "../labels/labels.js";

export type HermesRuleCandidateStatus = "shadow" | "approved" | "dismissed";
export type HermesRuleRunMode = "shadow" | "active";
export type HermesRuleFeedbackAction =
  | "always_important_sender"
  | "mark_not_important"
  | "move_to_feed"
  | "mute_sender";

export interface HermesRuleCandidate {
  id: string;
  accountId: string;
  title: string;
  ruleType: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  confidence: number;
  status: HermesRuleCandidateStatus;
  evidenceMessageIds: string[];
  createdAt: string;
  approvedAt?: string;
}

export interface HermesRule {
  id: string;
  accountId: string;
  candidateId?: string;
  title: string;
  ruleType: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  confidence: number;
  enabled: boolean;
  createdAt: string;
  approvedAt?: string;
}

export interface HermesRuleObservedBehavior {
  accountId: string;
  messageId: string;
  senderEmail: string;
  action: HermesRuleFeedbackAction;
  occurredAt: string;
}

export interface HermesRuleMessageMatch {
  messageId: string;
  senderEmail: string;
  subject?: string;
  receivedAt?: string;
  currentBucket?: string;
  currentScore?: number;
}

export interface HermesRuleSimulation {
  id: string;
  accountId: string;
  candidateId: string;
  mode: HermesRuleRunMode;
  matchedCount: number;
  sampleMessageIds: string[];
  actionPreview: Record<string, unknown>;
  createdAt: string;
}

export interface HermesRuleHistoryBackfill {
  accountId: string;
  ruleId: string;
  matchedCount: number;
  appliedCount: number;
  sampleMessageIds: string[];
}

export interface SuggestHermesRulesInput {
  accountId: string;
  behaviorWindowDays?: number;
  minEvidenceCount?: number;
}

export interface DraftHermesRuleInput {
  accountId: string;
  command: string;
}

export interface ListHermesRuleCandidatesInput {
  accountId: string;
  status?: HermesRuleCandidateStatus;
  limit: number;
}

export interface SimulateHermesRuleInput {
  accountId: string;
  candidateId: string;
  sampleLimit?: number;
}

export interface ApproveHermesRuleInput {
  accountId: string;
  candidateId: string;
}

export interface BackfillHermesRuleHistoryInput {
  accountId: string;
  ruleId: string;
  limit?: number;
}

export interface ListHermesRulesInput {
  accountId: string;
  enabled?: boolean;
  limit: number;
}

export interface HermesRuleStore {
  listObservedBehaviors(input: {
    accountId: string;
    since: string;
    limit: number;
  }): Promise<HermesRuleObservedBehavior[]>;
  createRuleCandidate(
    input: HermesRuleCandidate,
  ): Promise<HermesRuleCandidate>;
  listRuleCandidates(
    input: ListHermesRuleCandidatesInput,
  ): Promise<{ items: HermesRuleCandidate[] }>;
  getRuleCandidate(input: {
    accountId: string;
    candidateId: string;
  }): Promise<HermesRuleCandidate | undefined>;
  listCandidateMatches(input: {
    accountId: string;
    candidate: HermesRuleCandidate;
    limit: number;
  }): Promise<HermesRuleMessageMatch[]>;
  recordRuleSimulation(
    input: HermesRuleSimulation,
  ): Promise<HermesRuleSimulation>;
  approveRuleCandidate(input: {
    accountId: string;
    candidateId: string;
    ruleId: string;
    approvedAt: string;
    actionOverride?: Record<string, unknown>;
  }): Promise<HermesRule | undefined>;
  getRule(input: {
    accountId: string;
    ruleId: string;
  }): Promise<HermesRule | undefined>;
  backfillContentLabelRule(input: {
    accountId: string;
    rule: HermesRule;
    limit: number;
  }): Promise<HermesRuleHistoryBackfill>;
  listRules(input: ListHermesRulesInput): Promise<{ items: HermesRule[] }>;
  upsertSavedView(input: SavedViewDefinition): Promise<void>;
}

export interface HermesRuleService {
  draftRule(
    input: DraftHermesRuleInput,
  ): Promise<{ candidates: HermesRuleCandidate[] }>;
  suggestRules(
    input: SuggestHermesRulesInput,
  ): Promise<{ candidates: HermesRuleCandidate[] }>;
  listRuleCandidates(
    input: ListHermesRuleCandidatesInput,
  ): Promise<{ items: HermesRuleCandidate[] }>;
  simulateRule(
    input: SimulateHermesRuleInput,
  ): Promise<HermesRuleSimulation | undefined>;
  approveRule(input: ApproveHermesRuleInput): Promise<HermesRule | undefined>;
  backfillRuleHistory(
    input: BackfillHermesRuleHistoryInput,
  ): Promise<HermesRuleHistoryBackfill | undefined>;
  listRules(input: ListHermesRulesInput): Promise<{ items: HermesRule[] }>;
}

export interface CreateHermesRuleServiceOptions {
  store: HermesRuleStore;
  labelService?: Pick<LabelService, "upsertLabel">;
  createId: () => string;
  now: () => string;
}

export class InvalidHermesRuleRequestError extends Error {
  readonly code = "invalid_hermes_rule_request";

  constructor() {
    super("invalid_hermes_rule_request");
  }
}

export function createHermesRuleService(
  options: CreateHermesRuleServiceOptions,
): HermesRuleService {
  return {
    async suggestRules(input) {
      const accountId = requireString(input.accountId);
      const behaviorWindowDays = positiveInteger(
        input.behaviorWindowDays ?? 30,
        1,
        365,
      );
      const minEvidenceCount = positiveInteger(
        input.minEvidenceCount ?? 2,
        2,
        20,
      );
      const since = subtractDays(options.now(), behaviorWindowDays);
      const behaviors = await options.store.listObservedBehaviors({
        accountId,
        since,
        limit: 1000,
      });
      const candidates: HermesRuleCandidate[] = [];

      for (const group of groupBehaviors(behaviors)) {
        if (group.behaviors.length < minEvidenceCount) {
          continue;
        }

        const draft = candidateDraftFor(group.action, group.senderEmail);
        if (!draft) {
          continue;
        }

        const candidate: HermesRuleCandidate = {
          id: options.createId(),
          accountId,
          title: draft.title,
          ruleType: draft.ruleType,
          condition: { senderEmail: group.senderEmail },
          action: draft.action,
          confidence: confidenceFromEvidence(group.behaviors.length),
          status: "shadow",
          evidenceMessageIds: group.behaviors.map((behavior) => behavior.messageId),
          createdAt: options.now(),
        };
        candidates.push(await options.store.createRuleCandidate(candidate));
      }

      return { candidates };
    },

    async draftRule(input) {
      const accountId = requireString(input.accountId);
      const command = requireLongText(input.command);
      const draft = labelRuleDraftForCommand(command);
      const candidate: HermesRuleCandidate = {
        id: options.createId(),
        accountId,
        title: draft.title,
        ruleType: "content_label",
        condition: {
          anyKeywords: draft.keywords,
        },
        action: {
          type: "apply_label",
          labelName: draft.labelName,
          labelColor: draft.labelColor,
          savedView: draft.savedView,
          applyToHistory: draft.applyToHistory,
          providerWriteback: false,
          requiresConfirmation: true,
        },
        confidence: draft.confidence,
        status: "shadow",
        evidenceMessageIds: [],
        createdAt: options.now(),
      };

      return {
        candidates: [await options.store.createRuleCandidate(candidate)],
      };
    },

    async listRuleCandidates(input) {
      return options.store.listRuleCandidates({
        accountId: requireString(input.accountId),
        ...(input.status ? { status: input.status } : {}),
        limit: positiveInteger(input.limit, 1, 100),
      });
    },

    async simulateRule(input) {
      const accountId = requireString(input.accountId);
      const candidateId = requireString(input.candidateId);
      const limit = positiveInteger(input.sampleLimit ?? 25, 1, 100);
      const candidate = await options.store.getRuleCandidate({
        accountId,
        candidateId,
      });
      if (!candidate) {
        return undefined;
      }

      const matches = await options.store.listCandidateMatches({
        accountId,
        candidate,
        limit,
      });
      return options.store.recordRuleSimulation({
        id: options.createId(),
        accountId,
        candidateId,
        mode: "shadow",
        matchedCount: matches.length,
        sampleMessageIds: matches.map((match) => match.messageId),
        actionPreview: candidate.action,
        createdAt: options.now(),
      });
    },

    async approveRule(input) {
      const accountId = requireString(input.accountId);
      const candidateId = requireString(input.candidateId);
      const candidate = await options.store.getRuleCandidate({
        accountId,
        candidateId,
      });
      if (!candidate || candidate.status !== "shadow") {
        return undefined;
      }
      const actionOverride =
        candidate.ruleType === "content_label"
          ? await approvedLabelActionForCandidate({
              candidate,
              accountId,
              labelService: options.labelService,
            })
          : undefined;
      const rule = await options.store.approveRuleCandidate({
        accountId,
        candidateId,
        ruleId: options.createId(),
        approvedAt: options.now(),
        ...(actionOverride ? { actionOverride } : {}),
      });
      const savedView = rule
        ? savedViewFromRuleAction(rule.action, rule.condition)
        : undefined;
      if (savedView && !findBuiltInSavedView(savedView.id)) {
        await options.store.upsertSavedView(savedView);
      }

      return rule;
    },

    async backfillRuleHistory(input) {
      const accountId = requireString(input.accountId);
      const ruleId = requireString(input.ruleId);
      const limit = positiveInteger(input.limit ?? 5000, 1, 10000);
      const rule = await options.store.getRule({ accountId, ruleId });
      if (!rule) {
        return undefined;
      }
      if (!isHistoryBackfillableRule(rule)) {
        return {
          accountId,
          ruleId,
          matchedCount: 0,
          appliedCount: 0,
          sampleMessageIds: [],
        };
      }

      return options.store.backfillContentLabelRule({
        accountId,
        rule,
        limit,
      });
    },

    async listRules(input) {
      return options.store.listRules({
        accountId: requireString(input.accountId),
        ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
        limit: positiveInteger(input.limit, 1, 100),
      });
    },
  };
}

interface InMemoryHermesRuleStoreSeed {
  observedBehaviors?: HermesRuleObservedBehavior[];
  candidates?: HermesRuleCandidate[];
  rules?: HermesRule[];
  messages?: Array<HermesRuleMessageMatch & { accountId?: string }>;
  savedViews?: SavedViewDefinition[];
}

export function createInMemoryHermesRuleStore(
  seed: InMemoryHermesRuleStoreSeed = {},
): HermesRuleStore & {
  listRuns(): HermesRuleSimulation[];
  listSavedViews(): SavedViewDefinition[];
} {
  const behaviors = [...(seed.observedBehaviors ?? [])];
  const candidates = [...(seed.candidates ?? [])];
  const rules = [...(seed.rules ?? [])];
  const messages = [...(seed.messages ?? [])];
  const savedViews = [...(seed.savedViews ?? [])];
  const labelAssignments = new Set<string>();
  const runs: HermesRuleSimulation[] = [];

  return {
    async listObservedBehaviors(input) {
      return behaviors.filter(
        (behavior) =>
          behavior.accountId === input.accountId &&
          behavior.occurredAt >= input.since,
      );
    },

    async createRuleCandidate(input) {
      candidates.push({ ...input });
      return { ...input };
    },

    async listRuleCandidates(input) {
      return {
        items: candidates
          .filter(
            (candidate) =>
              candidate.accountId === input.accountId &&
              (!input.status || candidate.status === input.status),
          )
          .slice(0, input.limit)
          .map((candidate) => ({ ...candidate })),
      };
    },

    async getRuleCandidate(input) {
      const candidate = candidates.find(
        (item) =>
          item.accountId === input.accountId &&
          item.id === input.candidateId,
      );
      return candidate ? { ...candidate } : undefined;
    },

    async listCandidateMatches(input) {
      const keywords = candidateKeywords(input.candidate);
      if (keywords.length > 0) {
        return messages
          .filter(
            (message) =>
              (message.accountId ?? input.accountId) === input.accountId &&
              keywords.some((keyword) =>
                [
                  message.senderEmail,
                  message.subject ?? "",
                  message.currentBucket ?? "",
                ]
                  .join(" ")
                  .toLowerCase()
                  .includes(keyword.toLowerCase()),
              ),
          )
          .slice(0, input.limit)
          .map(({ accountId: _accountId, ...message }) => ({ ...message }));
      }

      const senderEmail =
        typeof input.candidate.condition.senderEmail === "string"
          ? input.candidate.condition.senderEmail.toLowerCase()
          : "";
      return messages
        .filter(
          (message) =>
            (message.accountId ?? input.accountId) === input.accountId &&
            message.senderEmail.toLowerCase() === senderEmail,
        )
        .slice(0, input.limit)
        .map(({ accountId: _accountId, ...message }) => ({ ...message }));
    },

    async recordRuleSimulation(input) {
      runs.push({ ...input });
      return { ...input };
    },

    async approveRuleCandidate(input) {
      const candidate = candidates.find(
        (item) =>
          item.accountId === input.accountId &&
          item.id === input.candidateId,
      );
      if (!candidate) {
        return undefined;
      }
      if (candidate.status !== "shadow") {
        return undefined;
      }

      candidate.status = "approved";
      candidate.approvedAt = input.approvedAt;
      const rule: HermesRule = {
        id: input.ruleId,
        accountId: input.accountId,
        candidateId: candidate.id,
        title: candidate.title,
        ruleType: candidate.ruleType,
        condition: { ...candidate.condition },
        action: { ...(input.actionOverride ?? candidate.action) },
        confidence: candidate.confidence,
        enabled: true,
        createdAt: input.approvedAt,
        approvedAt: input.approvedAt,
      };
      rules.push(rule);
      return { ...rule };
    },

    async getRule(input) {
      const rule = rules.find(
        (item) => item.accountId === input.accountId && item.id === input.ruleId,
      );
      return rule ? { ...rule } : undefined;
    },

    async backfillContentLabelRule(input) {
      const labelId =
        typeof input.rule.action.labelId === "string"
          ? input.rule.action.labelId
          : undefined;
      if (!labelId) {
        return {
          accountId: input.accountId,
          ruleId: input.rule.id,
          matchedCount: 0,
          appliedCount: 0,
          sampleMessageIds: [],
        };
      }

      const keywords = ruleKeywords(input.rule);
      const matches = messages
        .filter(
          (message) =>
            (message.accountId ?? input.accountId) === input.accountId &&
            keywords.some((keyword) =>
              [
                message.senderEmail,
                message.subject ?? "",
                message.currentBucket ?? "",
              ]
                .join(" ")
                .toLowerCase()
                .includes(keyword.toLowerCase()),
            ),
        )
        .slice(0, input.limit);
      let appliedCount = 0;
      for (const match of matches) {
        const assignmentKey = `${match.messageId}:${labelId}`;
        if (labelAssignments.has(assignmentKey)) {
          continue;
        }
        labelAssignments.add(assignmentKey);
        appliedCount += 1;
      }

      return {
        accountId: input.accountId,
        ruleId: input.rule.id,
        matchedCount: matches.length,
        appliedCount,
        sampleMessageIds: matches.slice(0, 25).map((message) => message.messageId),
      };
    },

    async listRules(input) {
      return {
        items: rules
          .filter(
            (rule) =>
              rule.accountId === input.accountId &&
              (typeof input.enabled !== "boolean" ||
                rule.enabled === input.enabled),
          )
          .slice(0, input.limit)
          .map((rule) => ({ ...rule })),
      };
    },

    async upsertSavedView(input) {
      const index = savedViews.findIndex((view) => view.id === input.id);
      if (index >= 0) {
        savedViews[index] = { ...input, keywords: [...input.keywords] };
        return;
      }
      savedViews.push({ ...input, keywords: [...input.keywords] });
    },

    listRuns() {
      return runs.map((run) => ({ ...run }));
    },

    listSavedViews() {
      return savedViews.map((view) => ({
        ...view,
        keywords: [...view.keywords],
      }));
    },
  };
}

function groupBehaviors(behaviors: HermesRuleObservedBehavior[]): Array<{
  senderEmail: string;
  action: HermesRuleFeedbackAction;
  behaviors: HermesRuleObservedBehavior[];
}> {
  const groups = new Map<string, {
    senderEmail: string;
    action: HermesRuleFeedbackAction;
    behaviors: HermesRuleObservedBehavior[];
  }>();

  for (const behavior of behaviors) {
    const senderEmail = behavior.senderEmail.trim().toLowerCase();
    if (!senderEmail) {
      continue;
    }

    const key = `${behavior.action}:${senderEmail}`;
    const group =
      groups.get(key) ??
      {
        senderEmail,
        action: behavior.action,
        behaviors: [],
      };
    group.behaviors.push(behavior);
    groups.set(key, group);
  }

  return Array.from(groups.values());
}

function savedViewDraftForCommand(command: string): {
  title: string;
  savedView: SavedViewDefinition;
  confidence: number;
} {
  const normalized = command.toLowerCase();
  const builtInCodes = findBuiltInSavedView("codes");
  if (
    builtInCodes &&
    /验证码|驗證碼|动态码|安全码|otp|verification|security code|one-time code/i.test(
      command,
    )
  ) {
    return {
      title: "启用验证码智能分组",
      savedView: builtInCodes,
      confidence: 0.9,
    };
  }

  const label = extractRequestedGroupLabel(command);
  if (!label) {
    throw new InvalidHermesRuleRequestError();
  }

  const keywords = uniqueStrings([
    label,
    ...extractQuotedTerms(command),
    ...extractContainsTerms(command),
  ]).slice(0, 12);
  return {
    title: `创建${label}智能分组`,
    savedView: {
      id: `hermes_${stableTextId(label)}`,
      label,
      tone: "blue",
      kind: "keyword",
      keywords,
    },
    confidence: normalized.includes("规则") ? 0.78 : 0.7,
  };
}

function labelRuleDraftForCommand(command: string): {
  title: string;
  labelName: string;
  labelColor: LabelColor;
  savedView: SavedViewDefinition;
  keywords: string[];
  confidence: number;
  applyToHistory: boolean;
} {
  const savedViewDraft = savedViewDraftForCommand(command);
  return {
    title: savedViewDraft.title,
    labelName: savedViewDraft.savedView.label,
    labelColor: savedViewDraft.savedView.tone,
    savedView: savedViewDraft.savedView,
    keywords: savedViewDraft.savedView.keywords,
    confidence: savedViewDraft.confidence,
    applyToHistory: shouldApplyRuleToHistory(command),
  };
}

async function approvedLabelActionForCandidate(input: {
  candidate: HermesRuleCandidate;
  accountId: string;
  labelService: Pick<LabelService, "upsertLabel"> | undefined;
}): Promise<Record<string, unknown>> {
  if (!input.labelService) {
    throw new InvalidHermesRuleRequestError();
  }

  const draftAction = labelDraftActionFromCandidate(input.candidate);
  const label = await input.labelService.upsertLabel({
    accountId: input.accountId,
    name: draftAction.labelName,
    color: draftAction.labelColor,
  });

  return {
    type: "apply_label",
    labelId: label.id,
    labelName: label.name,
    labelColor: label.color,
    savedView: draftAction.savedView,
    applyToHistory: draftAction.applyToHistory,
    providerWriteback: false,
    requiresConfirmation: false,
  };
}

function labelDraftActionFromCandidate(candidate: HermesRuleCandidate): {
  labelName: string;
  labelColor: LabelColor;
  savedView: SavedViewDefinition;
  applyToHistory: boolean;
} {
  const action = candidate.action;
  if (action.type !== "apply_label") {
    throw new InvalidHermesRuleRequestError();
  }
  const labelName = action.labelName;
  const labelColor = action.labelColor ?? "blue";
  if (typeof labelName !== "string" || !isLabelColor(labelColor)) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    labelName,
    labelColor,
    applyToHistory: action.applyToHistory === true,
    savedView:
      savedViewDefinitionFromValue(action.savedView) ??
      savedViewDefinitionFromLabelAction(action, candidate.condition),
  };
}

function savedViewFromRuleAction(
  action: Record<string, unknown>,
  condition: Record<string, unknown> = {},
): SavedViewDefinition | undefined {
  if (action.type === "apply_label") {
    return (
      savedViewDefinitionFromValue(action.savedView) ??
      savedViewDefinitionFromLabelAction(action, condition)
    );
  }

  if (action.type !== "ensure_saved_view") {
    return undefined;
  }

  return savedViewDefinitionFromValue(action.savedView);
}

function savedViewDefinitionFromValue(
  value: unknown,
): SavedViewDefinition | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.label !== "string" ||
    !isTone(record.tone) ||
    (record.kind !== "keyword" && record.kind !== "message_fact")
  ) {
    return undefined;
  }

  return {
    id: record.id,
    label: record.label,
    tone: record.tone,
    kind: record.kind,
    keywords: Array.isArray(record.keywords)
      ? record.keywords.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function savedViewDefinitionFromLabelAction(
  action: Record<string, unknown>,
  condition: Record<string, unknown>,
): SavedViewDefinition {
  const labelName = action.labelName;
  const labelColor = action.labelColor ?? "blue";
  if (typeof labelName !== "string" || !isTone(labelColor)) {
    throw new InvalidHermesRuleRequestError();
  }

  const keywords = conditionKeywords(condition);
  if (keywords.length === 0) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    id: `hermes_${stableTextId(labelName)}`,
    label: labelName,
    tone: labelColor,
    kind: "keyword",
    keywords,
  };
}

function candidateKeywords(candidate: HermesRuleCandidate): string[] {
  const fromCondition = conditionKeywords(candidate.condition);
  if (fromCondition.length > 0) {
    return fromCondition;
  }

  const savedView = savedViewFromRuleAction(candidate.action, candidate.condition);
  return savedView ? savedView.keywords : [];
}

function ruleKeywords(rule: HermesRule): string[] {
  const fromCondition = conditionKeywords(rule.condition);
  if (fromCondition.length > 0) {
    return fromCondition;
  }

  const savedView = savedViewFromRuleAction(rule.action, rule.condition);
  return savedView ? savedView.keywords : [];
}

function conditionKeywords(condition: Record<string, unknown>): string[] {
  const fromCondition = condition.anyKeywords;
  if (!Array.isArray(fromCondition)) {
    return [];
  }

  return uniqueStrings(
    fromCondition.filter((item): item is string => typeof item === "string"),
  );
}

function extractRequestedGroupLabel(command: string): string | undefined {
  const match = /([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9 _/-]{0,24})(?:分组|分类|标签)/u.exec(
    command,
  );
  const raw = match?.[1] ?? "";
  const cleaned = raw
    .replace(/^(帮我|帮忙|创建|新增|添加|新建|左侧|右侧|加|一个|一条|规则|邮件|所有|账号|里的|里面|的)+/u, "")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 24) {
    return undefined;
  }
  return cleaned;
}

function extractQuotedTerms(command: string): string[] {
  return Array.from(command.matchAll(/[“"']([^“"']{2,40})[”"']/g)).map(
    (match) => match[1].trim(),
  );
}

function extractContainsTerms(command: string): string[] {
  const match = /(?:包含|含有|关键词|关键字|是)([\p{Script=Han}A-Za-z0-9 _/-]{2,40})(?:的|邮件|时|就|，|。|$)/u.exec(
    command,
  );
  return match?.[1] ? [match[1].trim()] : [];
}

function shouldApplyRuleToHistory(command: string): boolean {
  return /所有|全部|已有|现有|历史|以前|过去|已经同步|账号里|账号里的|all|existing|history|historical|past/i.test(
    command,
  );
}

function isHistoryBackfillableRule(rule: HermesRule): boolean {
  return (
    rule.enabled === true &&
    rule.ruleType === "content_label" &&
    rule.action.type === "apply_label" &&
    typeof rule.action.labelId === "string" &&
    rule.action.applyToHistory === true &&
    rule.action.providerWriteback !== true
  );
}

function stableTextId(value: string): string {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (ascii) {
    return ascii.slice(0, 40);
  }
  return Array.from(value)
    .map((char) => char.codePointAt(0)?.toString(16) ?? "")
    .filter(Boolean)
    .slice(0, 8)
    .join("_");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function candidateDraftFor(
  action: HermesRuleFeedbackAction,
  senderEmail: string,
):
  | { title: string; ruleType: string; action: Record<string, unknown> }
  | undefined {
  if (action === "always_important_sender") {
    return {
      title: `Prioritize ${senderEmail}`,
      ruleType: "sender_priority",
      action: {
        type: "classify_sender",
        bucket: "P2 Important",
        priorityScore: 90,
        reason: "Hermes learned you often mark this sender important.",
      },
    };
  }

  if (action === "move_to_feed") {
    return {
      title: `Move ${senderEmail} to Feed`,
      ruleType: "sender_feed",
      action: {
        type: "classify_sender",
        bucket: "P6 Feed",
        priorityScore: 15,
        reason: "Hermes learned you move this sender to Feed.",
      },
    };
  }

  if (action === "mute_sender") {
    return {
      title: `Screen ${senderEmail}`,
      ruleType: "sender_screen",
      action: {
        type: "classify_sender",
        bucket: "P7 Screen",
        priorityScore: 0,
        reason: "Hermes learned you mute this sender.",
      },
    };
  }

  if (action === "mark_not_important") {
    return {
      title: `Deprioritize ${senderEmail}`,
      ruleType: "sender_deprioritize",
      action: {
        type: "classify_sender",
        bucket: "P4 FYI / Updates",
        priorityScore: 30,
        reason: "Hermes learned you mark this sender less important.",
      },
    };
  }

  return undefined;
}

function confidenceFromEvidence(count: number): number {
  return Number(Math.min(0.95, 0.65 + count * 0.1).toFixed(2));
}

function subtractDays(now: string, days: number): string {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidHermesRuleRequestError();
  }

  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidHermesRuleRequestError();
  }

  return value;
}

function requireLongText(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidHermesRuleRequestError();
  }
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 500) {
    throw new InvalidHermesRuleRequestError();
  }
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidHermesRuleRequestError();
  }
  return trimmed;
}

function isTone(value: unknown): value is SavedViewDefinition["tone"] {
  return (
    value === "coral" ||
    value === "blue" ||
    value === "green" ||
    value === "yellow" ||
    value === "purple"
  );
}

function isLabelColor(value: unknown): value is LabelColor {
  return (
    value === "coral" ||
    value === "blue" ||
    value === "green" ||
    value === "yellow" ||
    value === "purple" ||
    value === "mint"
  );
}

function positiveInteger(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new InvalidHermesRuleRequestError();
  }

  return value;
}
