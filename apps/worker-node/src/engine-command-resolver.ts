import type { Queryable } from "./postgres-sync-job-queue.js";

export interface ResolveMessageTargetInput {
  accountId: string;
  messageId: string;
  provider: string;
}

export interface ResolveMailboxTargetInput {
  accountId: string;
  mailboxId: string;
  provider: string;
}

export interface ResolveSpecialMailboxTargetInput {
  accountId: string;
  role: "archive" | "trash";
  provider: string;
}

export interface ResolveMessageMailboxTargetsInput {
  accountId: string;
  messageId: string;
  provider: string;
}

export interface ResolveLabelTargetsInput {
  accountId: string;
  provider: string;
  labelIds: string[];
}

export interface EngineCommandMessageTarget {
  providerMessageId: string;
  providerMailboxId?: string;
  providerUidvalidity?: string;
  providerModseq?: string;
}

export interface EngineCommandMailboxTarget {
  providerMailboxId: string;
  role?: string;
}

export interface EngineCommandTargetResolver {
  resolveMessageTarget?(
    input: ResolveMessageTargetInput,
  ): Promise<EngineCommandMessageTarget | undefined>;
  resolveMailboxTarget?(
    input: ResolveMailboxTargetInput,
  ): Promise<EngineCommandMailboxTarget | undefined>;
  resolveSpecialMailboxTarget?(
    input: ResolveSpecialMailboxTargetInput,
  ): Promise<EngineCommandMailboxTarget | undefined>;
  resolveMessageMailboxTargets?(
    input: ResolveMessageMailboxTargetsInput,
  ): Promise<EngineCommandMailboxTarget[]>;
  resolveLabelTargets?(input: ResolveLabelTargetsInput): Promise<string[]>;
}

interface MessageRefRow extends Record<string, unknown> {
  provider_message_id?: string | null;
  emailengine_email_id?: string | null;
  gmail_message_id?: string | null;
  graph_message_id?: string | null;
  imap_mailbox_id?: string | null;
  imap_uidvalidity?: string | null;
  imap_modseq?: string | null;
}

interface MailboxRefRow extends Record<string, unknown> {
  provider_mailbox_id: string;
  role?: string | null;
}

interface LabelRow extends Record<string, unknown> {
  id: string;
  target: string | null;
}

export function createPostgresEngineCommandTargetResolver(
  client: Queryable,
): EngineCommandTargetResolver {
  return {
    async resolveMessageTarget(input) {
      const result = await client.query<MessageRefRow>(
        `
          SELECT
            provider_message_id,
            emailengine_email_id,
            gmail_message_id,
            graph_message_id,
            imap_mailbox_id,
            imap_uidvalidity,
            imap_modseq
          FROM provider_message_refs
          WHERE account_id = $1
            AND message_id = $2
            AND provider = $3
          ORDER BY last_seen_at DESC, first_seen_at DESC
          LIMIT 1
        `,
        [input.accountId, input.messageId, input.provider],
      );

      const row = result.rows[0];
      const providerMessageId = row ? messageIdFor(row, input.provider) : undefined;
      return providerMessageId
        ? {
            providerMessageId,
            ...(row.imap_mailbox_id
              ? { providerMailboxId: row.imap_mailbox_id }
              : {}),
            ...(row.imap_uidvalidity
              ? { providerUidvalidity: row.imap_uidvalidity }
              : {}),
            ...(row.imap_modseq ? { providerModseq: row.imap_modseq } : {}),
          }
        : undefined;
    },

    async resolveMailboxTarget(input) {
      const result = await client.query<MailboxRefRow>(
        `
          SELECT provider_mailbox_id
          FROM provider_mailbox_refs
          WHERE account_id = $1
            AND mailbox_id = $2
            AND provider = $3
          ORDER BY last_seen_at DESC, first_seen_at DESC
          LIMIT 1
        `,
        [input.accountId, input.mailboxId, input.provider],
      );

      return result.rows[0]
        ? { providerMailboxId: result.rows[0].provider_mailbox_id }
        : undefined;
    },

    async resolveSpecialMailboxTarget(input) {
      const result = await client.query<MailboxRefRow>(
        `
          SELECT provider_mailbox_id
          FROM provider_mailbox_refs
          WHERE account_id = $1
            AND provider = $2
            AND role = $3
          ORDER BY last_seen_at DESC, first_seen_at DESC
          LIMIT 1
        `,
        [input.accountId, input.provider, input.role],
      );

      return result.rows[0]
        ? { providerMailboxId: result.rows[0].provider_mailbox_id }
        : undefined;
    },

    async resolveMessageMailboxTargets(input) {
      const result = await client.query<MailboxRefRow>(
        `
          SELECT DISTINCT
            provider_mailbox_refs.provider_mailbox_id,
            provider_mailbox_refs.role
          FROM message_locations
          JOIN messages
            ON messages.id = message_locations.message_id
          JOIN mailboxes
            ON mailboxes.id = message_locations.mailbox_id
          JOIN provider_mailbox_refs
            ON provider_mailbox_refs.account_id = mailboxes.account_id
           AND provider_mailbox_refs.mailbox_id = mailboxes.id
           AND provider_mailbox_refs.provider = $3
          WHERE mailboxes.account_id = $1
            AND messages.account_id = $1
            AND message_locations.message_id = $2
          ORDER BY provider_mailbox_refs.provider_mailbox_id
        `,
        [input.accountId, input.messageId, input.provider],
      );

      return result.rows.map((row) => ({
        providerMailboxId: row.provider_mailbox_id,
        ...(row.role ? { role: row.role } : {}),
      }));
    },

    async resolveLabelTargets(input) {
      if (input.labelIds.length === 0) {
        return [];
      }

      if (input.provider === "gmail") {
        const result = await client.query<LabelRow>(
          `
            SELECT
              labels.id,
              CASE
                WHEN COUNT(DISTINCT COALESCE(
                  provider_mailbox_refs.gmail_label_id,
                  provider_mailbox_refs.provider_mailbox_id
                )) = 1
                  THEN MIN(COALESCE(
                    provider_mailbox_refs.gmail_label_id,
                    provider_mailbox_refs.provider_mailbox_id
                  ))
                ELSE NULL
              END AS target
            FROM labels
            LEFT JOIN provider_mailbox_refs
              ON provider_mailbox_refs.account_id = labels.account_id
             AND provider_mailbox_refs.provider = 'gmail'
             AND provider_mailbox_refs.role = 'label'
             AND lower(provider_mailbox_refs.display_name) = lower(labels.name)
            WHERE labels.account_id = $1
              AND labels.id = ANY($2::uuid[])
            GROUP BY labels.id
          `,
          [input.accountId, input.labelIds],
        );
        const targetsById = new Map(result.rows.map((row) => [row.id, row.target]));

        return input.labelIds
          .map((labelId) => targetsById.get(labelId))
          .filter((target): target is string => !!target);
      }

      const result = await client.query<LabelRow>(
        `
          SELECT id, name AS target
          FROM labels
          WHERE account_id = $1
            AND id = ANY($2::uuid[])
        `,
        [input.accountId, input.labelIds],
      );
      const targetsById = new Map(result.rows.map((row) => [row.id, row.target]));

      return input.labelIds
        .map((labelId) => targetsById.get(labelId))
        .filter((target): target is string => !!target);
    },
  };
}

function messageIdFor(
  row: MessageRefRow,
  provider: string,
): string | undefined {
  if (provider === "gmail") {
    return row.gmail_message_id ?? row.provider_message_id ?? undefined;
  }
  if (provider === "graph") {
    return row.graph_message_id ?? row.provider_message_id ?? undefined;
  }

  return row.provider_message_id ?? row.emailengine_email_id ?? undefined;
}
