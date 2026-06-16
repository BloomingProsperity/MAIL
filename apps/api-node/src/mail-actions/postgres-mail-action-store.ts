import {
  InvalidMailActionRequestError,
  type MailActionCommand,
  type MailActionInput,
  type MailProviderCommandType,
  type MailActionResult,
  type MailActionState,
  type MailActionStore,
} from "./mail-actions.js";
import { type PoolLike, type Queryable, withTransaction } from "../db/transaction.js";

interface StateRow extends Record<string, unknown> {
  id: string;
  unread: boolean;
  starred: boolean;
  archived: boolean;
  deleted: boolean;
  done_at?: string | Date | null;
  last_action_token?: string | null;
  undo_expires_at?: string | Date | null;
}

interface CommandRow extends Record<string, unknown> {
  id: string;
  command_type: MailProviderCommandType;
  account_id: string;
  idempotency_key: string;
  status: "queued" | "running" | "done" | "failed" | "dead_letter";
}

interface SnapshotRow extends Record<string, unknown> {
  mailbox_ids: unknown;
  label_ids: unknown;
}

interface PendingEngineCommand {
  commandType: MailProviderCommandType;
  target: Record<string, unknown>;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

interface AppliedMailAction {
  state: StateRow;
  command: PendingEngineCommand;
}

export function createPostgresMailActionStore(
  client: PoolLike,
  options: { createId: () => string },
): MailActionStore {
  return {
    applyAction(input) {
      return withTransaction(client, async (tx) => {
        const applied = await applyLocalState(tx, input, options.createId);
        if (!applied) {
          throw new Error("message was not found");
        }

        const command = await enqueueCommand(
          tx,
          input,
          applied.command,
          options.createId(),
        );
        const snapshot = await loadSnapshot(tx, input.messageId);

        return {
          accountId: input.accountId,
          messageId: input.messageId,
          action: input.action,
          state: stateDto(applied.state, snapshot),
          command,
        };
      });
    },
  };
}

function stateDto(
  state: StateRow,
  snapshot: { mailboxIds: string[]; labelIds: string[] },
): MailActionState {
  return {
    unread: state.unread,
    starred: state.starred,
    archived: state.archived,
    deleted: state.deleted,
    mailboxIds: snapshot.mailboxIds,
    labelIds: snapshot.labelIds,
    doneAt: nullableIsoString(state.done_at),
    undoToken: state.last_action_token ?? null,
    undoExpiresAt: nullableIsoString(state.undo_expires_at),
  };
}

async function applyLocalState(
  client: Queryable,
  input: MailActionInput,
  createId: () => string,
): Promise<AppliedMailAction | undefined> {
  const applyProviderAction = async (
    statePromise: Promise<StateRow | undefined>,
  ): Promise<AppliedMailAction | undefined> => {
    const state = await statePromise;
    return state ? { state, command: providerCommandFor(input) } : undefined;
  };

  switch (input.action) {
    case "mark_read":
      return applyProviderAction(
        updateMessageState(client, input, "unread = FALSE"),
      );
    case "mark_unread":
      return applyProviderAction(
        updateMessageState(client, input, "unread = TRUE"),
      );
    case "star":
      return applyProviderAction(
        updateMessageState(client, input, "starred = TRUE"),
      );
    case "unstar":
      return applyProviderAction(
        updateMessageState(client, input, "starred = FALSE"),
      );
    case "archive": {
      const state = await updateMessageState(client, input, "archived = TRUE");
      if (!state) {
        return undefined;
      }
      await deleteInboxLocation(client, input);
      return { state, command: providerCommandFor(input) };
    }
    case "trash":
      return applyProviderAction(
        updateMessageState(client, input, "deleted_at = now()"),
      );
    case "move":
      return applyProviderAction(moveMessage(client, input));
    case "apply_labels":
      return applyProviderAction(applyLabels(client, input));
    case "done":
      return markDone(client, input, createId());
    case "undo_done":
      return undoDone(client, input);
    case "undone":
      return undone(client, input);
  }
}

async function updateMessageState(
  client: Queryable,
  input: MailActionInput,
  assignment: string,
  values: unknown[] = [],
): Promise<StateRow | undefined> {
  const result = await client.query<StateRow>(
    `
      UPDATE message_state
      SET ${assignment},
          updated_at = now()
      FROM messages
      WHERE message_state.message_id = messages.id
        AND messages.account_id = $1
        AND messages.id = $2
        AND message_state.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM message_locations
          WHERE message_locations.message_id = messages.id
        )
      RETURNING
        messages.id,
        message_state.unread,
        message_state.starred,
        message_state.archived,
        message_state.done_at,
        message_state.last_action_token,
        message_state.undo_expires_at,
        (message_state.deleted_at IS NOT NULL) AS deleted
    `,
    [input.accountId, input.messageId, ...values],
  );

  return result.rows[0];
}

async function markDone(
  client: Queryable,
  input: MailActionInput,
  undoToken: string,
): Promise<AppliedMailAction | undefined> {
  const state = await updateMessageState(
    client,
    input,
    "archived = TRUE, done_at = now(), last_action_token = $3, undo_expires_at = now() + interval '5 seconds'",
    [undoToken],
  );
  if (!state) {
    return undefined;
  }

  await deleteInboxLocation(client, input);

  return {
    state,
    command: {
      commandType: "archive",
      target: { messageId: input.messageId },
      payload: { action: "done", undoToken },
      idempotencyKey: `mail-action:${input.accountId}:${input.messageId}:done`,
    },
  };
}

async function undoDone(
  client: Queryable,
  input: MailActionInput,
): Promise<AppliedMailAction | undefined> {
  const undoToken = input.undoToken;
  if (!undoToken) {
    return undefined;
  }

  const state = await clearDoneState(
    client,
    input,
    "AND message_state.last_action_token = $3 AND message_state.undo_expires_at > now()",
    [undoToken],
  );
  if (!state) {
    return undefined;
  }

  const inboxMailboxId = await restoreInboxLocation(client, input);
  return {
    state,
    command: {
      commandType: "move",
      target: { messageId: input.messageId, mailboxId: inboxMailboxId },
      payload: {
        action: "undo_done",
        undoToken,
        mailboxId: inboxMailboxId,
      },
      idempotencyKey: `mail-action:${input.accountId}:${input.messageId}:undo_done:${undoToken}`,
    },
  };
}

async function undone(
  client: Queryable,
  input: MailActionInput,
): Promise<AppliedMailAction | undefined> {
  const state = await clearDoneState(client, input);
  if (!state) {
    return undefined;
  }

  const inboxMailboxId = await restoreInboxLocation(client, input);
  return {
    state,
    command: {
      commandType: "move",
      target: { messageId: input.messageId, mailboxId: inboxMailboxId },
      payload: { action: "undone", mailboxId: inboxMailboxId },
      idempotencyKey: `mail-action:${input.accountId}:${input.messageId}:undone`,
    },
  };
}

async function clearDoneState(
  client: Queryable,
  input: MailActionInput,
  extraPredicate = "",
  values: unknown[] = [],
): Promise<StateRow | undefined> {
  const result = await client.query<StateRow>(
    `
      UPDATE message_state
      SET archived = FALSE,
          done_at = NULL,
          last_action_token = NULL,
          undo_expires_at = NULL,
          updated_at = now()
      FROM messages
      WHERE message_state.message_id = messages.id
        AND messages.account_id = $1
        AND messages.id = $2
        AND message_state.deleted_at IS NULL
        ${extraPredicate}
      RETURNING
        messages.id,
        message_state.unread,
        message_state.starred,
        message_state.archived,
        message_state.done_at,
        message_state.last_action_token,
        message_state.undo_expires_at,
        (message_state.deleted_at IS NOT NULL) AS deleted
    `,
    [input.accountId, input.messageId, ...values],
  );

  return result.rows[0];
}

async function deleteInboxLocation(
  client: Queryable,
  input: MailActionInput,
): Promise<void> {
  await client.query(
    `
      DELETE FROM message_locations
      USING mailboxes
      WHERE message_locations.mailbox_id = mailboxes.id
        AND mailboxes.account_id = $1
        AND message_locations.message_id = $2
        AND mailboxes.role = 'inbox'
    `,
    [input.accountId, input.messageId],
  );
}

async function restoreInboxLocation(
  client: Queryable,
  input: MailActionInput,
): Promise<string> {
  const inboxMailboxId = await loadInboxMailboxId(client, input.accountId);
  if (!inboxMailboxId) {
    throw new Error("inbox mailbox was not found");
  }

  await client.query(
    `
      INSERT INTO message_locations (message_id, mailbox_id)
      SELECT $1, $2
      FROM mailboxes
      WHERE mailboxes.id = $2
        AND mailboxes.account_id = $3
      ON CONFLICT DO NOTHING
    `,
    [input.messageId, inboxMailboxId, input.accountId],
  );

  return inboxMailboxId;
}

async function loadInboxMailboxId(
  client: Queryable,
  accountId: string,
): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM mailboxes
      WHERE account_id = $1
        AND role = 'inbox'
      ORDER BY id
      LIMIT 1
    `,
    [accountId],
  );

  return result.rows[0]?.id;
}

async function moveMessage(
  client: Queryable,
  input: MailActionInput,
): Promise<StateRow | undefined> {
  const state = await loadVisibleState(client, input);
  if (!state) {
    return undefined;
  }

  await client.query(
    `
      DELETE FROM message_locations
      USING mailboxes
      WHERE message_locations.mailbox_id = mailboxes.id
        AND mailboxes.account_id = $1
        AND message_locations.message_id = $2
    `,
    [input.accountId, input.messageId],
  );
  await client.query(
    `
      INSERT INTO message_locations (message_id, mailbox_id)
      SELECT $1, $2
      FROM mailboxes
      WHERE mailboxes.id = $2
        AND mailboxes.account_id = $3
      ON CONFLICT DO NOTHING
    `,
    [input.messageId, input.mailboxId, input.accountId],
  );

  return state;
}

async function applyLabels(
  client: Queryable,
  input: MailActionInput,
): Promise<StateRow | undefined> {
  const state = await loadVisibleState(client, input);
  if (!state) {
    return undefined;
  }

  const labelIds = input.labelIds ?? [];
  const ownedLabelIds = await loadOwnedLabelIds(client, input.accountId, labelIds);
  if (ownedLabelIds.size !== labelIds.length) {
    throw new InvalidMailActionRequestError("labelIds are invalid");
  }

  for (const labelId of labelIds) {
    await client.query(
      `
        INSERT INTO label_assignments (message_id, label_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [input.messageId, labelId],
    );
  }

  return state;
}

async function loadOwnedLabelIds(
  client: Queryable,
  accountId: string,
  labelIds: string[],
): Promise<Set<string>> {
  if (labelIds.length === 0) {
    return new Set();
  }

  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM labels
      WHERE account_id = $1
        AND id = ANY($2::uuid[])
    `,
    [accountId, labelIds],
  );

  return new Set(result.rows.map((row) => row.id));
}

async function loadVisibleState(
  client: Queryable,
  input: MailActionInput,
): Promise<StateRow | undefined> {
  const result = await client.query<StateRow>(
    `
      SELECT
        messages.id,
        message_state.unread,
        message_state.starred,
        message_state.archived,
        message_state.done_at,
        message_state.last_action_token,
        message_state.undo_expires_at,
        (message_state.deleted_at IS NOT NULL) AS deleted
      FROM messages
      JOIN message_state
        ON message_state.message_id = messages.id
      WHERE messages.account_id = $1
        AND messages.id = $2
        AND message_state.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM message_locations
          WHERE message_locations.message_id = messages.id
        )
      LIMIT 1
    `,
    [input.accountId, input.messageId],
  );

  return result.rows[0];
}

async function enqueueCommand(
  client: Queryable,
  input: MailActionInput,
  command: PendingEngineCommand,
  commandId: string,
): Promise<MailActionCommand> {
  const result = await client.query<CommandRow>(
    `
      INSERT INTO engine_commands (
        id,
        command_type,
        account_id,
        target,
        payload,
        idempotency_key
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (idempotency_key) DO UPDATE
      SET updated_at = engine_commands.updated_at
      RETURNING id, command_type, account_id, idempotency_key, status
    `,
    [
      commandId,
      command.commandType,
      input.accountId,
      command.target,
      command.payload,
      command.idempotencyKey,
    ],
  );

  const row = result.rows[0];
  return {
    id: row.id,
    commandType: row.command_type,
    accountId: row.account_id,
    messageId: input.messageId,
    idempotencyKey: row.idempotency_key,
    status: row.status,
  };
}

async function loadSnapshot(
  client: Queryable,
  messageId: string,
): Promise<{ mailboxIds: string[]; labelIds: string[] }> {
  const result = await client.query<SnapshotRow>(
    `
      SELECT
        COALESCE(
          (
            SELECT ARRAY_AGG(DISTINCT message_locations.mailbox_id)
            FROM message_locations
            WHERE message_locations.message_id = $1
          ),
          '{}'
        ) AS mailbox_ids,
        COALESCE(
          (
            SELECT ARRAY_AGG(DISTINCT label_assignments.label_id)
            FROM label_assignments
            WHERE label_assignments.message_id = $1
          ),
          '{}'
        ) AS label_ids
    `,
    [messageId],
  );

  const row = result.rows[0];
  return {
    mailboxIds: stringArray(row?.mailbox_ids),
    labelIds: stringArray(row?.label_ids),
  };
}

function providerCommandFor(input: MailActionInput): PendingEngineCommand {
  if (input.action === "done" || input.action === "undo_done" || input.action === "undone") {
    throw new Error(`app action ${input.action} requires explicit command mapping`);
  }

  return {
    commandType: input.action,
    target: {
      messageId: input.messageId,
      ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
      ...(input.labelIds ? { labelIds: input.labelIds } : {}),
    },
    payload: {
      action: input.action,
      ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
      ...(input.labelIds ? { labelIds: input.labelIds } : {}),
    },
    idempotencyKey: idempotencyKeyForProviderAction(input),
  };
}

function idempotencyKeyForProviderAction(input: MailActionInput): string {
  const suffix =
    input.action === "move"
      ? `:${input.mailboxId}`
      : input.action === "apply_labels"
        ? `:${(input.labelIds ?? []).slice().sort().join(",")}`
        : "";
  return `mail-action:${input.accountId}:${input.messageId}:${input.action}${suffix}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function nullableIsoString(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}
