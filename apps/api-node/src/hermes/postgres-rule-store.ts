import { type PoolLike, type Queryable, withTransaction } from "../db/transaction.js";
import type { SavedViewDefinition } from "../mail-navigation/saved-views.js";
import type {
  HermesRule,
  HermesRuleCandidate,
  HermesRuleCandidateStatus,
  HermesRuleFeedbackAction,
  HermesRuleMessageMatch,
  HermesRuleSimulation,
  HermesRuleStore,
  ListHermesRuleCandidatesInput,
  ListHermesRulesInput,
} from "./rules.js";

interface ObservedBehaviorRow extends Record<string, unknown> {
  account_id: string;
  message_id: string;
  sender_email: string;
  action: string;
  occurred_at: string;
}

interface RuleCandidateRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  title: string;
  rule_type: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  confidence: string | number;
  status: string;
  evidence_message_ids?: string[] | null;
  created_at: string;
  approved_at?: string | null;
}

interface RuleRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  candidate_id?: string | null;
  title: string;
  rule_type: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  confidence: string | number;
  enabled: boolean;
  created_at: string;
  approved_at?: string | null;
}

interface MessageMatchRow extends Record<string, unknown> {
  message_id: string;
  sender_email: string;
  subject?: string | null;
  received_at?: string | null;
  current_bucket?: string | null;
  current_score?: string | number | null;
}

export function createPostgresHermesRuleStore(
  client: PoolLike,
): HermesRuleStore {
  return {
    async listObservedBehaviors(input) {
      const result = await client.query<ObservedBehaviorRow>(
        `
          SELECT
            messages.account_id,
            messages.id AS message_id,
            messages.from_email AS sender_email,
            feedback_events.value->>'action' AS action,
            feedback_events.created_at AS occurred_at
          FROM feedback_events
          JOIN messages
            ON messages.id = feedback_events.message_id
          WHERE messages.account_id = $1
            AND feedback_events.created_at >= $2
            AND feedback_events.event_type LIKE 'smart_inbox.%'
            AND feedback_events.value->>'action' IN (
              'always_important_sender',
              'mark_not_important',
              'move_to_feed',
              'mute_sender'
            )
          ORDER BY feedback_events.created_at DESC, feedback_events.id DESC
          LIMIT $3
        `,
        [input.accountId, input.since, input.limit],
      );

      return result.rows.map((row) => ({
        accountId: row.account_id,
        messageId: row.message_id,
        senderEmail: row.sender_email,
        action: row.action as HermesRuleFeedbackAction,
        occurredAt: row.occurred_at,
      }));
    },

    async createRuleCandidate(input) {
      const result = await client.query<RuleCandidateRow>(
        `
          INSERT INTO hermes_rule_candidates (
            id,
            account_id,
            title,
            rule_type,
            condition,
            action,
            confidence,
            status,
            evidence_message_ids
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING
            id,
            account_id,
            title,
            rule_type,
            condition,
            action,
            confidence,
            status,
            evidence_message_ids,
            created_at,
            approved_at
        `,
        [
          input.id,
          input.accountId,
          input.title,
          input.ruleType,
          input.condition,
          input.action,
          input.confidence,
          input.status,
          input.evidenceMessageIds,
        ],
      );

      return candidateFromRow(result.rows[0]);
    },

    async listRuleCandidates(input) {
      const result = await client.query<RuleCandidateRow>(
        `
          SELECT
            id,
            account_id,
            title,
            rule_type,
            condition,
            action,
            confidence,
            status,
            evidence_message_ids,
            created_at,
            approved_at
          FROM hermes_rule_candidates
          WHERE account_id = $1
            AND ($2::text IS NULL OR status = $2)
          ORDER BY created_at DESC, id DESC
          LIMIT $3
        `,
        [input.accountId, input.status ?? null, input.limit],
      );

      return { items: result.rows.map(candidateFromRow) };
    },

    async getRuleCandidate(input) {
      return loadCandidate(client, input.accountId, input.candidateId);
    },

    async listCandidateMatches(input) {
      const keywords = candidateKeywords(input.candidate);
      if (keywords.length > 0) {
        const result = await client.query<MessageMatchRow>(
          `
            SELECT
              messages.id AS message_id,
              messages.from_email AS sender_email,
              messages.subject,
              messages.received_at,
              message_classification.bucket AS current_bucket,
              message_classification.priority_score AS current_score
            FROM messages
            JOIN message_state
              ON message_state.message_id = messages.id
            LEFT JOIN message_classification
              ON message_classification.message_id = messages.id
            LEFT JOIN search_documents
              ON search_documents.message_id = messages.id
            WHERE messages.account_id = $1
              AND message_state.deleted_at IS NULL
              AND EXISTS (
                SELECT 1
                FROM unnest($2::text[]) AS keyword
                WHERE messages.subject ILIKE '%' || keyword || '%'
                   OR messages.from_email ILIKE '%' || keyword || '%'
                   OR COALESCE(messages.from_name, '') ILIKE '%' || keyword || '%'
                   OR COALESCE(messages.snippet, '') ILIKE '%' || keyword || '%'
                   OR COALESCE(search_documents.raw_text, '') ILIKE '%' || keyword || '%'
                   OR COALESCE(message_classification.reasons::text, '') ILIKE '%' || keyword || '%'
              )
            ORDER BY messages.received_at DESC, messages.id DESC
            LIMIT $3
          `,
          [input.accountId, keywords, input.limit],
        );

        return result.rows.map(messageMatchFromRow);
      }

      const senderEmail =
        typeof input.candidate.condition.senderEmail === "string"
          ? input.candidate.condition.senderEmail
          : "";
      const result = await client.query<MessageMatchRow>(
        `
          SELECT
            messages.id AS message_id,
            messages.from_email AS sender_email,
            messages.subject,
            messages.received_at,
            message_classification.bucket AS current_bucket,
            message_classification.priority_score AS current_score
          FROM messages
          JOIN message_state
            ON message_state.message_id = messages.id
          LEFT JOIN message_classification
            ON message_classification.message_id = messages.id
          WHERE messages.account_id = $1
            AND lower(messages.from_email) = lower($2)
            AND message_state.deleted_at IS NULL
          ORDER BY messages.received_at DESC, messages.id DESC
          LIMIT $3
        `,
        [input.accountId, senderEmail, input.limit],
      );

      return result.rows.map(messageMatchFromRow);
    },

    async recordRuleSimulation(input) {
      await client.query(
        `
          INSERT INTO hermes_rule_runs (
            id,
            candidate_id,
            mode,
            result
          )
          VALUES ($1, $2, $3, $4)
        `,
        [
          input.id,
          input.candidateId,
          input.mode,
          {
            accountId: input.accountId,
            matchedCount: input.matchedCount,
            sampleMessageIds: input.sampleMessageIds,
            actionPreview: input.actionPreview,
            createdAt: input.createdAt,
          },
        ],
      );

      return input;
    },

    async approveRuleCandidate(input) {
      return withTransaction(client, async (tx) => {
        const candidate = await loadCandidateForUpdate(
          tx,
          input.accountId,
          input.candidateId,
        );
        if (!candidate) {
          return undefined;
        }

        await tx.query(
          `
            UPDATE hermes_rule_candidates
            SET status = $1,
                approved_at = $2
            WHERE id = $3
          `,
          ["approved", input.approvedAt, input.candidateId],
        );

        const result = await tx.query<RuleRow>(
          `
            INSERT INTO hermes_rules (
              id,
              account_id,
              candidate_id,
              title,
              rule_type,
              condition,
              action,
              confidence,
              enabled,
              approved_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)
            RETURNING
              id,
              account_id,
              candidate_id,
              title,
              rule_type,
              condition,
              action,
              confidence,
              enabled,
              created_at,
              approved_at
          `,
          [
            input.ruleId,
            input.accountId,
            input.candidateId,
            candidate.title,
            candidate.ruleType,
            candidate.condition,
            input.actionOverride ?? candidate.action,
            candidate.confidence,
            input.approvedAt,
          ],
        );

        return ruleFromRow(result.rows[0]);
      });
    },

    async listRules(input) {
      const result = await client.query<RuleRow>(
        `
          SELECT
            id,
            account_id,
            candidate_id,
            title,
            rule_type,
            condition,
            action,
            confidence,
            enabled,
            created_at,
            approved_at
          FROM hermes_rules
          WHERE account_id = $1
            AND ($2::boolean IS NULL OR enabled = $2)
          ORDER BY created_at DESC, id DESC
          LIMIT $3
        `,
        [input.accountId, input.enabled ?? null, input.limit],
      );

      return { items: result.rows.map(ruleFromRow) };
    },

    async upsertSavedView(input) {
      await client.query(
        `
          INSERT INTO saved_views (
            id,
            label,
            tone,
            kind,
            enabled,
            keywords,
            match_config,
            sort_order,
            source
          )
          VALUES ($1, $2, $3, $4, TRUE, $5, $6, 100, 'hermes')
          ON CONFLICT (id) DO UPDATE
          SET label = EXCLUDED.label,
              tone = EXCLUDED.tone,
              kind = EXCLUDED.kind,
              enabled = TRUE,
              keywords = EXCLUDED.keywords,
              match_config = EXCLUDED.match_config,
              source = 'hermes',
              updated_at = now()
        `,
        [
          input.id,
          input.label,
          input.tone,
          input.kind,
          input.keywords,
          savedViewMatchConfig(input),
        ],
      );
    },
  };
}

function candidateKeywords(candidate: HermesRuleCandidate): string[] {
  const value = candidate.condition.anyKeywords;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function savedViewMatchConfig(input: SavedViewDefinition): Record<string, unknown> {
  return input.minAttachmentCount === undefined
    ? {}
    : { minAttachmentCount: input.minAttachmentCount };
}

async function loadCandidate(
  client: Queryable,
  accountId: string,
  candidateId: string,
): Promise<HermesRuleCandidate | undefined> {
  const result = await client.query<RuleCandidateRow>(
    `
      SELECT
        id,
        account_id,
        title,
        rule_type,
        condition,
        action,
        confidence,
        status,
        evidence_message_ids,
        created_at,
        approved_at
      FROM hermes_rule_candidates
      WHERE account_id = $1
        AND id = $2
      LIMIT 1
    `,
    [accountId, candidateId],
  );

  return result.rows[0] ? candidateFromRow(result.rows[0]) : undefined;
}

async function loadCandidateForUpdate(
  client: Queryable,
  accountId: string,
  candidateId: string,
): Promise<HermesRuleCandidate | undefined> {
  const result = await client.query<RuleCandidateRow>(
    `
      SELECT
        id,
        account_id,
        title,
        rule_type,
        condition,
        action,
        confidence,
        status,
        evidence_message_ids,
        created_at,
        approved_at
      FROM hermes_rule_candidates
      WHERE account_id = $1
        AND id = $2
      FOR UPDATE
    `,
    [accountId, candidateId],
  );

  return result.rows[0] ? candidateFromRow(result.rows[0]) : undefined;
}

function candidateFromRow(row: RuleCandidateRow): HermesRuleCandidate {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    ruleType: row.rule_type,
    condition: row.condition,
    action: row.action,
    confidence: Number(row.confidence),
    status: row.status as HermesRuleCandidateStatus,
    evidenceMessageIds: row.evidence_message_ids ?? [],
    createdAt: row.created_at,
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
  };
}

function ruleFromRow(row: RuleRow): HermesRule {
  return {
    id: row.id,
    accountId: row.account_id,
    ...(row.candidate_id ? { candidateId: row.candidate_id } : {}),
    title: row.title,
    ruleType: row.rule_type,
    condition: row.condition,
    action: row.action,
    confidence: Number(row.confidence),
    enabled: row.enabled,
    createdAt: row.created_at,
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
  };
}

function messageMatchFromRow(row: MessageMatchRow): HermesRuleMessageMatch {
  return {
    messageId: row.message_id,
    senderEmail: row.sender_email,
    ...(row.subject ? { subject: row.subject } : {}),
    ...(row.received_at ? { receivedAt: row.received_at } : {}),
    ...(row.current_bucket ? { currentBucket: row.current_bucket } : {}),
    ...(row.current_score !== null && row.current_score !== undefined
      ? { currentScore: Number(row.current_score) }
      : {}),
  };
}
