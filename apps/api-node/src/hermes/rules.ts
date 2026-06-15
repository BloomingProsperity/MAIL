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

export interface SuggestHermesRulesInput {
  accountId: string;
  behaviorWindowDays?: number;
  minEvidenceCount?: number;
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
  }): Promise<HermesRule | undefined>;
  listRules(input: ListHermesRulesInput): Promise<{ items: HermesRule[] }>;
}

export interface HermesRuleService {
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
  listRules(input: ListHermesRulesInput): Promise<{ items: HermesRule[] }>;
}

export interface CreateHermesRuleServiceOptions {
  store: HermesRuleStore;
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
      return options.store.approveRuleCandidate({
        accountId: requireString(input.accountId),
        candidateId: requireString(input.candidateId),
        ruleId: options.createId(),
        approvedAt: options.now(),
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
}

export function createInMemoryHermesRuleStore(
  seed: InMemoryHermesRuleStoreSeed = {},
): HermesRuleStore & { listRuns(): HermesRuleSimulation[] } {
  const behaviors = [...(seed.observedBehaviors ?? [])];
  const candidates = [...(seed.candidates ?? [])];
  const rules = [...(seed.rules ?? [])];
  const messages = [...(seed.messages ?? [])];
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

      candidate.status = "approved";
      candidate.approvedAt = input.approvedAt;
      const rule: HermesRule = {
        id: input.ruleId,
        accountId: input.accountId,
        candidateId: candidate.id,
        title: candidate.title,
        ruleType: candidate.ruleType,
        condition: { ...candidate.condition },
        action: { ...candidate.action },
        confidence: candidate.confidence,
        enabled: true,
        createdAt: input.approvedAt,
        approvedAt: input.approvedAt,
      };
      rules.push(rule);
      return { ...rule };
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

    listRuns() {
      return runs.map((run) => ({ ...run }));
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
