import type { LabelService } from "../labels/labels.js";
import type { MailReadStore } from "../mail-read/mail-read-store.js";
import type {
  HermesActionItemExtractResult,
  HermesActionItemExtractService,
} from "./action-items.js";
import type {
  HermesLabelSuggestResult,
  HermesLabelSuggestService,
} from "./label-suggest.js";
import { messageReadableText } from "./message-content.js";
import type {
  HermesNewsletterCleanupResult,
  HermesNewsletterCleanupService,
} from "./newsletter-cleanup.js";
import type {
  HermesPriorityTriageResult,
  HermesPriorityTriageService,
} from "./priority-triage.js";

export interface HermesMessageOrganizationInput {
  accountId: string;
  messageId: string;
  language?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  maxContextChars?: number;
  memoryLimit?: number;
  customInstructionsBySkillId?: Record<string, string>;
}

export interface HermesMessageOrganizationResult {
  accountId: string;
  messageId: string;
  priority: HermesPriorityTriageResult;
  labels: HermesLabelSuggestResult;
  newsletter: HermesNewsletterCleanupResult;
  actionItems: HermesActionItemExtractResult;
}

export interface HermesMessageOrganizationService {
  organizeMessage(
    input: HermesMessageOrganizationInput,
  ): Promise<HermesMessageOrganizationResult | undefined>;
}

export interface HermesMessageOrganizationServiceOptions {
  mailReadStore: Pick<MailReadStore, "getMessage">;
  priorityService: Pick<HermesPriorityTriageService, "triagePriority">;
  labelSuggestService: Pick<HermesLabelSuggestService, "suggestLabels">;
  newsletterCleanupService: Pick<
    HermesNewsletterCleanupService,
    "cleanupNewsletter"
  >;
  actionItemExtractService: Pick<
    HermesActionItemExtractService,
    "extractActionItems"
  >;
  labelService?: Pick<LabelService, "listLabels">;
  now: () => string;
}

export class InvalidHermesMessageOrganizationRequestError extends Error {
  readonly code = "invalid_hermes_message_organization_request";

  constructor(message = "invalid_hermes_message_organization_request") {
    super(message);
  }
}

const DEFAULT_ORGANIZATION_LANGUAGE = "match the thread";
const MAX_SHORT_FIELD_LENGTH = 120;

export function createHermesMessageOrganizationService(
  options: HermesMessageOrganizationServiceOptions,
): HermesMessageOrganizationService {
  return {
    async organizeMessage(input) {
      const normalized = normalizeInput(input);
      const message = await options.mailReadStore.getMessage({
        accountId: normalized.accountId,
        messageId: normalized.messageId,
      });
      if (!message) {
        return undefined;
      }

      const threadText = messageReadableText(message, {
        maxChars: normalized.maxContextChars,
      });
      if (!threadText) {
        throw new InvalidHermesMessageOrganizationRequestError(
          "message has no organizable text",
        );
      }

      const senderEmail = message.from.email;
      const memoryScope =
        normalized.memoryScope ?? (senderEmail ? `sender:${senderEmail}` : "global");
      const availableLabels = await listAvailableLabels(
        options.labelService,
        normalized.accountId,
      );
      const sharedInput = {
        subject: message.subject,
        threadText,
        language: normalized.language,
        readMessageIds: [normalized.messageId],
        memoryIds: normalized.memoryIds,
        memoryScope,
        memoryLayers: normalized.memoryLayers,
        memoryLimit: normalized.memoryLimit,
      };

      const [priority, labels, newsletter, actionItems] = await Promise.all([
        options.priorityService.triagePriority({
          ...sharedInput,
          senderEmail,
          currentBucket: message.classification.bucket,
          currentScore: message.classification.priorityScore,
          currentReasons: message.classification.reasons,
          customInstructions:
            normalized.customInstructionsBySkillId?.priority_triage,
        }),
        options.labelSuggestService.suggestLabels({
          ...sharedInput,
          senderEmail,
          currentLabels: [],
          availableLabels,
          customInstructions:
            normalized.customInstructionsBySkillId?.label_suggest,
        }),
        options.newsletterCleanupService.cleanupNewsletter({
          ...sharedInput,
          senderEmail,
          currentBucket: message.classification.bucket,
          customInstructions:
            normalized.customInstructionsBySkillId?.newsletter_cleanup,
        }),
        options.actionItemExtractService.extractActionItems({
          ...sharedInput,
          now: options.now(),
          customInstructions:
            normalized.customInstructionsBySkillId?.action_item_extract,
        }),
      ]);

      return {
        accountId: normalized.accountId,
        messageId: normalized.messageId,
        priority,
        labels,
        newsletter,
        actionItems,
      };
    },
  };
}

async function listAvailableLabels(
  labelService: Pick<LabelService, "listLabels"> | undefined,
  accountId: string,
): Promise<string[]> {
  if (!labelService) {
    return [];
  }

  const page = await labelService.listLabels({ accountId });
  return page.items.map((label) => label.name);
}

function normalizeInput(
  input: HermesMessageOrganizationInput,
): Required<Pick<HermesMessageOrganizationInput, "accountId" | "messageId" | "language">> &
  Pick<
    HermesMessageOrganizationInput,
    | "memoryIds"
    | "memoryScope"
    | "memoryLayers"
    | "maxContextChars"
    | "memoryLimit"
    | "customInstructionsBySkillId"
  > {
  return {
    accountId: normalizeRequiredText(input.accountId),
    messageId: normalizeRequiredText(input.messageId),
    language: input.language
      ? normalizeRequiredText(input.language)
      : DEFAULT_ORGANIZATION_LANGUAGE,
    ...(input.memoryIds ? { memoryIds: input.memoryIds } : {}),
    ...(input.memoryScope
      ? { memoryScope: normalizeRequiredText(input.memoryScope) }
      : {}),
    ...(input.memoryLayers ? { memoryLayers: input.memoryLayers } : {}),
    ...(input.maxContextChars !== undefined
      ? { maxContextChars: input.maxContextChars }
      : {}),
    ...(input.memoryLimit !== undefined ? { memoryLimit: input.memoryLimit } : {}),
    ...(input.customInstructionsBySkillId
      ? { customInstructionsBySkillId: input.customInstructionsBySkillId }
      : {}),
  };
}

function normalizeRequiredText(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_SHORT_FIELD_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    throw new InvalidHermesMessageOrganizationRequestError();
  }

  return trimmed;
}
