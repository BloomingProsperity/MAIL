import { withTransaction, type PoolLike, type Queryable } from "../db/transaction.js";
import {
  InvalidSenderScreeningRequestError,
  type GatekeeperSenderDto,
  type SenderScreeningBulkAction,
  type SenderScreeningDecisionResult,
  type SenderScreeningStatus,
  type SenderScreeningStore,
} from "./sender-screening.js";

interface CreatePostgresSenderScreeningStoreOptions {
  createId: () => string;
}

interface SenderScreeningRuleRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  sender_email?: string | null;
  domain: string;
  scope: "email" | "domain";
  status: SenderScreeningStatus;
}

interface SenderScreeningListRow extends Record<string, unknown> {
  id: string;
  sender_email: string;
  domain: string;
  status: SenderScreeningStatus;
  message_count: string | number;
  latest_message_id?: string | null;
  latest_received_at?: string | Date | null;
}

export function createPostgresSenderScreeningStore(
  client: PoolLike,
  options: CreatePostgresSenderScreeningStoreOptions,
): SenderScreeningStore {
  return {
    async listSenders(input) {
      return withTransaction(client, async (tx) => {
        await materializeUnknownScreenedSenders(tx, input.accountId);
        const result = await tx.query<SenderScreeningListRow>(
          `
            SELECT screening.id,
              screening.sender_email,
              screening.domain,
              screening.status,
              COUNT(messages.id) AS message_count,
              (ARRAY_AGG(messages.id ORDER BY messages.received_at DESC))[1] AS latest_message_id,
              MAX(messages.received_at) AS latest_received_at
            FROM sender_screening_rules screening
            LEFT JOIN messages
              ON messages.account_id = screening.account_id
              AND lower(messages.from_email) = lower(screening.sender_email)
            LEFT JOIN message_state
              ON message_state.message_id = messages.id
              AND message_state.deleted_at IS NULL
            WHERE screening.account_id = $1
              AND screening.scope = 'email'
              AND ($2::text IS NULL OR screening.status = $2)
            GROUP BY
              screening.id,
              screening.sender_email,
              screening.domain,
              screening.status,
              screening.updated_at
            ORDER BY
              CASE screening.status
                WHEN 'unknown' THEN 0
                WHEN 'accepted' THEN 1
                ELSE 2
              END,
              latest_received_at DESC NULLS LAST,
              screening.updated_at DESC,
              screening.id DESC
          `,
          [input.accountId, input.status ?? null],
        );

        return { items: result.rows.map(rowToSenderDto) };
      });
    },

    async acceptSender(input) {
      return decideSender(client, options, {
        accountId: input.accountId,
        senderId: input.senderId,
        config: decisionConfigForAction("accept"),
      });
    },

    async blockSender(input) {
      return decideSender(client, options, {
        accountId: input.accountId,
        senderId: input.senderId,
        config: decisionConfigForAction("block"),
      });
    },

    async bulkDecideSenders(input) {
      const senderIds = normalizeSenderIds(input.senderIds);
      const config = decisionConfigForAction(input.action);
      return withTransaction(client, async (tx) => {
        const result = await tx.query<SenderScreeningRuleRow>(
          `
            SELECT id, account_id, sender_email, domain, scope, status
            FROM sender_screening_rules
            WHERE account_id = $1
              AND id = ANY($2::uuid[])
              AND scope = 'email'
            ORDER BY array_position($2::uuid[], id)
          `,
          [input.accountId, senderIds],
        );
        const rowsById = new Map(result.rows.map((row) => [row.id, row]));
        const items: SenderScreeningDecisionResult[] = [];

        for (const senderId of senderIds) {
          const rule = rowsById.get(senderId);
          if (!rule) {
            continue;
          }
          items.push(await applySenderDecision(tx, options, rule, config));
        }

        return {
          items,
          missingSenderIds: senderIds.filter((senderId) => !rowsById.has(senderId)),
        };
      });
    },

    async blockDomain(input) {
      const domain = normalizeDomain(input.domain);
      return withTransaction(client, async (tx) => {
        const ruleId = options.createId();
        const rule = await tx.query<SenderScreeningRuleRow>(
          `
            INSERT INTO sender_screening_rules (
              id,
              account_id,
              scope,
              sender_email,
              domain,
              status
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (account_id, lower(domain)) WHERE scope = 'domain'
            DO UPDATE SET
              status = EXCLUDED.status,
              updated_at = now()
            RETURNING id, account_id, sender_email, domain, scope, status
          `,
          [ruleId, input.accountId, "domain", null, domain, "blocked"],
        );
        const row = rule.rows[0];
        if (!row) {
          throw new Error("domain screening rule upsert returned no row");
        }

        const eventId = options.createId();
        await recordDecisionEvent(tx, {
          eventId,
          ruleId: row.id,
          accountId: row.account_id,
          action: "block_domain",
          value: { domain: row.domain, scope: "domain" },
        });
        await upsertDomainClassification(tx, {
          accountId: row.account_id,
          domain: row.domain,
          bucket: "P7 Screen",
          priorityScore: 0,
          reasons: ["Domain blocked"],
          classifiedBy: "gatekeeper",
        });
        await recordDecisionMemory(tx, {
          id: options.createId(),
          eventId,
          action: "block_domain",
          scope: `domain:${row.domain}`,
          domain: row.domain,
          preference: "Keep future mail from this domain in Gatekeeper Screen.",
        });

        return {
          senderId: row.id,
          domain: row.domain,
          status: "blocked",
          action: "block_domain",
          eventId,
        };
      });
    },
  };
}

async function materializeUnknownScreenedSenders(
  client: Queryable,
  accountId: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO sender_screening_rules (
        id,
        account_id,
        scope,
        sender_email,
        domain,
        status,
        created_from_message_id
      )
      SELECT
        gen_random_uuid(),
        candidates.account_id,
        'email',
        candidates.sender_email,
        candidates.domain,
        'unknown',
        candidates.latest_message_id
      FROM (
        SELECT
          messages.account_id,
          lower(messages.from_email) AS sender_email,
          lower(split_part(messages.from_email, '@', 2)) AS domain,
          (ARRAY_AGG(messages.id ORDER BY messages.received_at DESC))[1] AS latest_message_id
        FROM messages
        JOIN message_state
          ON message_state.message_id = messages.id
          AND message_state.deleted_at IS NULL
        JOIN message_classification
          ON message_classification.message_id = messages.id
        WHERE messages.account_id = $1
          AND messages.from_email LIKE '%@%'
          AND lower(split_part(messages.from_email, '@', 2)) <> ''
          AND message_classification.bucket = 'P7 Screen'
          AND NOT EXISTS (
            SELECT 1
            FROM sender_screening_rules existing
            WHERE existing.account_id = messages.account_id
              AND (
                (
                  existing.scope = 'email'
                  AND lower(existing.sender_email) = lower(messages.from_email)
                )
                OR (
                  existing.scope = 'domain'
                  AND lower(existing.domain) = lower(split_part(messages.from_email, '@', 2))
                )
              )
          )
        GROUP BY
          messages.account_id,
          lower(messages.from_email),
          lower(split_part(messages.from_email, '@', 2))
      ) candidates
      ON CONFLICT (account_id, lower(sender_email)) WHERE scope = 'email'
      DO NOTHING
    `,
    [accountId],
  );
}

async function decideSender(
  client: PoolLike,
  options: CreatePostgresSenderScreeningStoreOptions,
  input: {
    accountId: string;
    senderId: string;
    config: SenderDecisionConfig;
  },
): Promise<SenderScreeningDecisionResult | undefined> {
  return withTransaction(client, async (tx) => {
    const rule = await loadRuleById(tx, {
      accountId: input.accountId,
      senderId: input.senderId,
    });
    if (!rule) {
      return undefined;
    }
    if (rule.scope !== "email" || !rule.sender_email) {
      throw new InvalidSenderScreeningRequestError();
    }

    return applySenderDecision(tx, options, rule, input.config);
  });
}

interface SenderDecisionConfig {
  status: "accepted" | "blocked";
  action: "accept" | "block_sender";
  bucket: string;
  priorityScore: number;
  reasons: string[];
  memoryPreference: string;
}

async function applySenderDecision(
  client: Queryable,
  options: CreatePostgresSenderScreeningStoreOptions,
  rule: SenderScreeningRuleRow,
  config: SenderDecisionConfig,
): Promise<SenderScreeningDecisionResult> {
  if (rule.scope !== "email" || !rule.sender_email) {
    throw new InvalidSenderScreeningRequestError();
  }

  await client.query(
    `
      UPDATE sender_screening_rules
      SET status = $2, updated_at = now()
      WHERE id = $1
    `,
    [rule.id, config.status],
  );

  const eventId = options.createId();
  await recordDecisionEvent(client, {
    eventId,
    ruleId: rule.id,
    accountId: rule.account_id,
    action: config.action,
    value: {
      senderEmail: rule.sender_email,
      domain: rule.domain,
      scope: "email",
    },
  });
  await upsertSenderClassification(client, {
    accountId: rule.account_id,
    senderEmail: rule.sender_email,
    bucket: config.bucket,
    priorityScore: config.priorityScore,
    reasons: config.reasons,
    classifiedBy: "gatekeeper",
  });
  await recordDecisionMemory(client, {
    id: options.createId(),
    eventId,
    action: config.action,
    scope: `sender:${rule.sender_email}`,
    senderEmail: rule.sender_email,
    domain: rule.domain,
    preference: config.memoryPreference,
  });

  return {
    senderId: rule.id,
    email: rule.sender_email,
    domain: rule.domain,
    status: config.status,
    action: config.action,
    eventId,
  };
}

function decisionConfigForAction(
  action: SenderScreeningBulkAction,
): SenderDecisionConfig {
  if (action === "accept") {
    return {
      status: "accepted",
      action: "accept",
      bucket: "P2 Important",
      priorityScore: 70,
      reasons: ["Sender accepted"],
      memoryPreference: "Allow future mail from this sender into the inbox.",
    };
  }

  return {
    status: "blocked",
    action: "block_sender",
    bucket: "P7 Screen",
    priorityScore: 0,
    reasons: ["Sender blocked"],
    memoryPreference: "Keep future mail from this sender in Gatekeeper Screen.",
  };
}

async function loadRuleById(
  client: Queryable,
  input: {
    accountId: string;
    senderId: string;
  },
): Promise<SenderScreeningRuleRow | undefined> {
  const result = await client.query<SenderScreeningRuleRow>(
    `
      SELECT id, account_id, sender_email, domain, scope, status
      FROM sender_screening_rules
      WHERE id = $1
        AND account_id = $2
      LIMIT 1
    `,
    [input.senderId, input.accountId],
  );

  return result.rows[0];
}

async function recordDecisionEvent(
  client: Queryable,
  input: {
    eventId: string;
    ruleId: string;
    accountId: string;
    action: "accept" | "block_sender" | "block_domain";
    value: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO sender_screening_events (
        id,
        rule_id,
        account_id,
        action,
        value
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [input.eventId, input.ruleId, input.accountId, input.action, input.value],
  );
}

async function upsertSenderClassification(
  client: Queryable,
  input: {
    accountId: string;
    senderEmail: string;
    bucket: string;
    priorityScore: number;
    reasons: string[];
    classifiedBy: string;
  },
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
      SELECT messages.id, $3, $4, $5, $6
      FROM messages
      JOIN message_state
        ON message_state.message_id = messages.id
        AND message_state.deleted_at IS NULL
      WHERE messages.account_id = $1
        AND lower(messages.from_email) = lower($2)
      ON CONFLICT (message_id) DO UPDATE
      SET
        bucket = EXCLUDED.bucket,
        priority_score = EXCLUDED.priority_score,
        reasons = EXCLUDED.reasons,
        classified_by = EXCLUDED.classified_by,
        updated_at = now()
    `,
    [
      input.accountId,
      input.senderEmail,
      input.bucket,
      input.priorityScore,
      input.reasons,
      input.classifiedBy,
    ],
  );
}

async function upsertDomainClassification(
  client: Queryable,
  input: {
    accountId: string;
    domain: string;
    bucket: string;
    priorityScore: number;
    reasons: string[];
    classifiedBy: string;
  },
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
      SELECT messages.id, $3, $4, $5, $6
      FROM messages
      JOIN message_state
        ON message_state.message_id = messages.id
        AND message_state.deleted_at IS NULL
      WHERE messages.account_id = $1
        AND lower(split_part(messages.from_email, '@', 2)) = lower($2)
      ON CONFLICT (message_id) DO UPDATE
      SET
        bucket = EXCLUDED.bucket,
        priority_score = EXCLUDED.priority_score,
        reasons = EXCLUDED.reasons,
        classified_by = EXCLUDED.classified_by,
        updated_at = now()
    `,
    [
      input.accountId,
      input.domain,
      input.bucket,
      input.priorityScore,
      input.reasons,
      input.classifiedBy,
    ],
  );
}

async function recordDecisionMemory(
  client: Queryable,
  input: {
    id: string;
    eventId: string;
    action: "accept" | "block_sender" | "block_domain";
    scope: string;
    senderEmail?: string;
    domain: string;
    preference: string;
  },
): Promise<void> {
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
      input.id,
      "contact_memory",
      input.scope,
      {
        source: "sender_screening",
        eventId: input.eventId,
        action: input.action,
        ...(input.senderEmail ? { senderEmail: input.senderEmail } : {}),
        domain: input.domain,
        preference: input.preference,
      },
      0.95,
    ],
  );
}

function rowToSenderDto(row: SenderScreeningListRow): GatekeeperSenderDto {
  const messageCount = toNumber(row.message_count);
  return {
    senderId: row.id,
    email: row.sender_email,
    domain: row.domain,
    status: row.status,
    messageCount,
    ...(row.latest_message_id ? { latestMessageId: row.latest_message_id } : {}),
    ...(row.latest_received_at
      ? { latestReceivedAt: toIsoString(row.latest_received_at) }
      : {}),
    bulkAvailable: messageCount > 1,
  };
}

function normalizeDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.includes("@") ||
    normalized.includes(" ") ||
    !normalized.includes(".")
  ) {
    throw new InvalidSenderScreeningRequestError();
  }

  return normalized;
}

function normalizeSenderIds(senderIds: string[]): string[] {
  const normalized = senderIds
    .map((senderId) => senderId.trim())
    .filter((senderId, index, all) => senderId.length > 0 && all.indexOf(senderId) === index);
  if (normalized.length === 0 || normalized.length > 100) {
    throw new InvalidSenderScreeningRequestError();
  }

  return normalized;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
