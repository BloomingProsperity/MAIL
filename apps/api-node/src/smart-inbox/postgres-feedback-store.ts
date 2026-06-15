import { withTransaction, type PoolLike, type Queryable } from "../db/transaction.js";
import type {
  SmartInboxClassificationDto,
  SmartInboxFeedbackAction,
  SmartInboxFeedbackInput,
  SmartInboxFeedbackResult,
  SmartInboxFeedbackStore,
} from "./feedback-store.js";

interface CreatePostgresSmartInboxFeedbackStoreOptions {
  createId: () => string;
}

interface VisibleMessageRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  from_email: string;
  bucket?: string | null;
  priority_score?: string | number | null;
  reasons?: unknown;
}

export function createPostgresSmartInboxFeedbackStore(
  client: PoolLike,
  options: CreatePostgresSmartInboxFeedbackStoreOptions,
): SmartInboxFeedbackStore {
  return {
    async recordFeedback(input: SmartInboxFeedbackInput) {
      return withTransaction(client, async (tx) => {
        const message = await loadVisibleMessage(tx, input);
        if (!message) {
          return undefined;
        }

        const feedbackEventId = options.createId();
        await tx.query(
          `
            INSERT INTO feedback_events (
              id,
              message_id,
              event_type,
              value
            )
            VALUES ($1, $2, $3, $4)
          `,
          [
            feedbackEventId,
            input.messageId,
            `smart_inbox.${input.action}`,
            {
              action: input.action,
              senderEmail: message.from_email,
            },
          ],
        );

        await upsertSenderRuleIfNeeded(tx, {
          accountId: input.accountId,
          senderEmail: message.from_email,
          action: input.action,
          feedbackEventId,
        });

        const classification = applyFeedbackToClassification(input.action, {
          bucket: message.bucket ?? "P4 FYI / Updates",
          priorityScore:
            message.priority_score === null || message.priority_score === undefined
              ? 0
              : toNumber(message.priority_score),
          reasons: toStringArray(message.reasons),
        });
        await upsertClassification(tx, input.messageId, classification);
        await recordHermesFeedbackMemory(tx, {
          createId: options.createId,
          feedbackEventId,
          accountId: input.accountId,
          messageId: input.messageId,
          senderEmail: message.from_email,
          action: input.action,
          classification,
        });

        return {
          feedbackEventId,
          accountId: input.accountId,
          messageId: input.messageId,
          classification,
        };
      });
    },
  };
}

async function recordHermesFeedbackMemory(
  client: Queryable,
  input: {
    createId: () => string;
    feedbackEventId: string;
    accountId: string;
    messageId: string;
    senderEmail: string;
    action: SmartInboxFeedbackAction;
    classification: SmartInboxClassificationDto;
  },
): Promise<void> {
  const memory = smartInboxFeedbackToMemory(input);
  const memoryKey = `${memory.layer}:${memory.scope}:${input.action}`;
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [memoryKey],
  );

  const existing = await loadExistingSmartInboxFeedbackMemory(client, {
    layer: memory.layer,
    scope: memory.scope,
    action: input.action,
  });

  if (existing) {
    await client.query(
      `
        UPDATE hermes_memories
        SET
          content = $2,
          confidence = $3,
          updated_at = now()
        WHERE id = $1
      `,
      [
        existing.id,
        mergeSmartInboxFeedbackMemoryContent(existing.content, memory.content),
        strengthenMemoryConfidence(existing.confidence, memory.confidence),
      ],
    );
    return;
  }

  await client.query(
    `
      INSERT INTO hermes_memories (
        id,
        layer,
        scope,
        content,
        confidence
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      input.createId(),
      memory.layer,
      memory.scope,
      memory.content,
      memory.confidence,
    ],
  );
}

interface ExistingSmartInboxFeedbackMemoryRow extends Record<string, unknown> {
  id: string;
  content: unknown;
  confidence: string | number;
}

async function loadExistingSmartInboxFeedbackMemory(
  client: Queryable,
  input: {
    layer: "contact_memory";
    scope: string;
    action: SmartInboxFeedbackAction;
  },
): Promise<
  | {
      id: string;
      content: Record<string, unknown>;
      confidence: number;
    }
  | undefined
> {
  const result = await client.query<ExistingSmartInboxFeedbackMemoryRow>(
    `
      SELECT
        id,
        content,
        confidence
      FROM hermes_memories
      WHERE layer = $1
        AND scope = $2
        AND content->>'source' = 'smart_inbox_feedback'
        AND content->>'action' = $3
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [input.layer, input.scope, input.action],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    content: asRecord(row.content),
    confidence: toNumber(row.confidence),
  };
}

function mergeSmartInboxFeedbackMemoryContent(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const existingFeedbackEventId =
    typeof existing.feedbackEventId === "string"
      ? existing.feedbackEventId
      : undefined;
  const nextFeedbackEventId =
    typeof next.feedbackEventId === "string" ? next.feedbackEventId : undefined;
  const existingCount =
    typeof existing.evidenceCount === "number" ? existing.evidenceCount : 1;

  return {
    ...next,
    firstFeedbackEventId:
      typeof existing.firstFeedbackEventId === "string"
        ? existing.firstFeedbackEventId
        : existingFeedbackEventId ?? nextFeedbackEventId,
    lastFeedbackEventId: nextFeedbackEventId,
    evidenceCount: existingCount + 1,
  };
}

function strengthenMemoryConfidence(current: number, next: number): number {
  return roundToThreeDecimals(Math.min(0.99, Math.max(current, next) + 0.03));
}

function roundToThreeDecimals(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function smartInboxFeedbackToMemory(input: {
  feedbackEventId: string;
  accountId: string;
  messageId: string;
  senderEmail: string;
  action: SmartInboxFeedbackAction;
  classification: SmartInboxClassificationDto;
}): {
  layer: "contact_memory";
  scope: string;
  content: Record<string, unknown>;
  confidence: number;
} {
  return {
    layer: "contact_memory",
    scope: `sender:${input.senderEmail.toLowerCase()}`,
    content: {
      source: "smart_inbox_feedback",
      feedbackEventId: input.feedbackEventId,
      accountId: input.accountId,
      messageId: input.messageId,
      senderEmail: input.senderEmail,
      action: input.action,
      preference: feedbackActionToMemoryPreference(input.action),
      classification: {
        bucket: input.classification.bucket,
        priorityScore: input.classification.priorityScore,
      },
    },
    confidence: feedbackActionToMemoryConfidence(input.action),
  };
}

function feedbackActionToMemoryPreference(
  action: SmartInboxFeedbackAction,
): string {
  if (action === "always_important_sender") {
    return "Prioritize future mail from this sender.";
  }
  if (action === "mute_sender") {
    return "Screen or mute future mail from this sender.";
  }
  if (action === "move_to_personal") {
    return "Route similar future mail from this sender to Personal.";
  }
  if (action === "move_to_notifications") {
    return "Route similar future mail from this sender to Notifications.";
  }
  if (action === "move_to_newsletters") {
    return "Route similar future mail from this sender to Newsletters.";
  }
  if (action === "move_to_feed") {
    return "Route similar future mail from this sender to Feed.";
  }
  if (action === "mark_not_important") {
    return "Deprioritize similar future mail from this sender.";
  }
  return "Treat similar future mail from this sender as important.";
}

function feedbackActionToMemoryConfidence(
  action: SmartInboxFeedbackAction,
): number {
  if (action === "always_important_sender" || action === "mute_sender") {
    return 0.95;
  }
  if (
    action === "move_to_personal" ||
    action === "move_to_notifications" ||
    action === "move_to_newsletters"
  ) {
    return 0.75;
  }
  if (action === "move_to_feed") {
    return 0.7;
  }
  return 0.65;
}

async function loadVisibleMessage(
  client: Queryable,
  input: SmartInboxFeedbackInput,
): Promise<VisibleMessageRow | undefined> {
  const result = await client.query<VisibleMessageRow>(
    `
      SELECT
        messages.id,
        messages.account_id,
        messages.from_email,
        message_classification.bucket,
        message_classification.priority_score,
        message_classification.reasons
      FROM messages
      JOIN message_state
        ON message_state.message_id = messages.id
      LEFT JOIN message_classification
        ON message_classification.message_id = messages.id
      WHERE messages.account_id = $1
        AND messages.id = $2
        AND message_state.deleted_at IS NULL
      LIMIT 1
    `,
    [input.accountId, input.messageId],
  );

  return result.rows[0];
}

function applyFeedbackToClassification(
  action: SmartInboxFeedbackAction,
  current: SmartInboxClassificationDto,
): SmartInboxClassificationDto {
  if (action === "mark_important") {
    return {
      bucket: "P2 Important",
      priorityScore: Math.max(current.priorityScore, 85),
      reasons: appendReason(current.reasons, "用户标记重要"),
    };
  }

  if (action === "always_important_sender") {
    return {
      bucket: "P2 Important",
      priorityScore: Math.max(current.priorityScore, 90),
      reasons: appendReason(current.reasons, "发件人总是重要"),
    };
  }

  if (action === "mark_not_important") {
    return {
      bucket: "P4 FYI / Updates",
      priorityScore: Math.min(current.priorityScore, 30),
      reasons: appendReason(current.reasons, "用户标记不重要"),
    };
  }

  if (action === "move_to_personal") {
    return {
      bucket: "P2 Important",
      priorityScore: Math.max(current.priorityScore, 80),
      reasons: appendReason(current.reasons, "User moved sender to Personal"),
    };
  }

  if (action === "move_to_notifications") {
    return {
      bucket: "P4 FYI / Updates",
      priorityScore: Math.min(current.priorityScore, 35),
      reasons: appendReason(current.reasons, "User moved sender to Notifications"),
    };
  }

  if (action === "move_to_newsletters") {
    return {
      bucket: "P6 Feed",
      priorityScore: Math.min(current.priorityScore, 15),
      reasons: appendReason(current.reasons, "User moved sender to Newsletters"),
    };
  }

  if (action === "move_to_feed") {
    return {
      bucket: "P6 Feed",
      priorityScore: Math.min(current.priorityScore, 15),
      reasons: appendReason(current.reasons, "用户移动到 Feed"),
    };
  }

  return {
    bucket: "P7 Screen",
    priorityScore: 0,
    reasons: appendReason(current.reasons, "发件人已静音"),
  };
}

async function upsertSenderRuleIfNeeded(
  client: Queryable,
  input: {
    accountId: string;
    senderEmail: string;
    action: SmartInboxFeedbackAction;
    feedbackEventId: string;
  },
): Promise<void> {
  const ruleType = feedbackActionToSenderRule(input.action);
  if (!ruleType) {
    return;
  }

  const oppositeRuleType = ruleType === "mute" ? "always_important" : "mute";
  await client.query(
    `
      DELETE FROM smart_inbox_sender_rules
      WHERE account_id = $1
        AND sender_email = $2
        AND rule_type = $3
    `,
    [input.accountId, input.senderEmail, oppositeRuleType],
  );

  await client.query(
    `
      DELETE FROM smart_inbox_sender_rules
      WHERE account_id = $1
        AND sender_email = $2
        AND rule_type = ANY($3)
    `,
    [
      input.accountId,
      input.senderEmail,
      categoryRuleTypes(ruleType),
    ],
  );

  await client.query(
    `
      INSERT INTO smart_inbox_sender_rules (
        id,
        account_id,
        sender_email,
        rule_type,
        created_from_feedback_event_id
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (account_id, sender_email, rule_type) DO UPDATE
      SET
        created_from_feedback_event_id = EXCLUDED.created_from_feedback_event_id,
        updated_at = now()
    `,
    [
      input.feedbackEventId,
      input.accountId,
      input.senderEmail,
      ruleType,
      input.feedbackEventId,
    ],
  );
}

function feedbackActionToSenderRule(
  action: SmartInboxFeedbackAction,
):
  | "always_important"
  | "mute"
  | "personal"
  | "notifications"
  | "newsletters"
  | "feed"
  | undefined {
  if (action === "always_important_sender") {
    return "always_important";
  }
  if (action === "mute_sender") {
    return "mute";
  }
  if (action === "move_to_personal") {
    return "personal";
  }
  if (action === "move_to_notifications") {
    return "notifications";
  }
  if (action === "move_to_newsletters") {
    return "newsletters";
  }
  if (action === "move_to_feed") {
    return "feed";
  }
  return undefined;
}

function categoryRuleTypes(ruleType: string): string[] {
  const categoryRules = ["personal", "notifications", "newsletters", "feed"];
  return categoryRules.includes(ruleType)
    ? categoryRules.filter((item) => item !== ruleType)
    : [];
}

async function upsertClassification(
  client: Queryable,
  messageId: string,
  classification: SmartInboxClassificationDto,
): Promise<void> {
  await client.query(
    `
      INSERT INTO message_classification (
        message_id,
        bucket,
        priority_score,
        reasons,
        classified_by
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (message_id) DO UPDATE
      SET
        bucket = EXCLUDED.bucket,
        priority_score = EXCLUDED.priority_score,
        reasons = EXCLUDED.reasons,
        classified_by = EXCLUDED.classified_by,
        updated_at = now()
    `,
    [
      messageId,
      classification.bucket,
      classification.priorityScore,
      classification.reasons,
      "user_feedback",
    ],
  );
}

function appendReason(reasons: string[], reason: string): string[] {
  return reasons.includes(reason) ? reasons : [...reasons, reason];
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
