export class InvalidMailActionRequestError extends Error {
  readonly code = "invalid_mail_action_request";

  constructor(message = "invalid mail action request") {
    super(message);
  }
}

export type MailAction =
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar"
  | "archive"
  | "trash"
  | "move"
  | "apply_labels"
  | "done"
  | "undo_done"
  | "undone";

export type MailProviderCommandType =
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar"
  | "archive"
  | "trash"
  | "move"
  | "apply_labels";

export interface MailActionInput {
  accountId: string;
  messageId: string;
  action: MailAction;
  mailboxId?: string;
  labelIds?: string[];
  undoToken?: string;
}

export type MailBulkAction = "done";

export interface MailBulkActionInput {
  accountId: string;
  bucket: string;
  action: MailBulkAction;
  messageIds: string[];
}

export interface MailActionState {
  unread: boolean;
  starred: boolean;
  archived: boolean;
  deleted: boolean;
  mailboxIds: string[];
  labelIds: string[];
  doneAt?: string | null;
  undoToken?: string | null;
  undoExpiresAt?: string | null;
}

export interface MailActionCommand {
  id: string;
  commandType: MailProviderCommandType;
  accountId: string;
  messageId: string;
  idempotencyKey: string;
  status: "queued" | "running" | "done" | "failed" | "dead_letter";
}

export interface MailActionResult {
  accountId: string;
  messageId: string;
  action: MailAction;
  state: MailActionState;
  command: MailActionCommand;
}

export interface MailBulkActionSuccess {
  messageId: string;
  undoToken?: string | null;
  undoExpiresAt?: string | null;
  commandId: string;
}

export interface MailBulkActionFailure {
  messageId: string;
  error: "message_not_visible" | "action_failed";
  message?: string;
}

export interface MailBulkActionResult {
  accountId: string;
  bucket: string;
  action: MailBulkAction;
  requestedCount: number;
  attemptedCount: number;
  succeededCount: number;
  failedCount: number;
  succeeded: MailBulkActionSuccess[];
  failed: MailBulkActionFailure[];
}

export interface MailActionStore {
  applyAction(input: MailActionInput): Promise<MailActionResult>;
}

export interface MailActionService {
  applyAction(input: MailActionInput): Promise<MailActionResult>;
  applyBulkAction(input: MailBulkActionInput): Promise<MailBulkActionResult>;
}

const MAX_BULK_ACTION_MESSAGE_IDS = 50;

export function createMailActionService(options: {
  store: MailActionStore;
}): MailActionService {
  return {
    async applyAction(input) {
      const normalized = normalizeActionInput(input);
      return options.store.applyAction(normalized);
    },
    async applyBulkAction(input) {
      const normalized = normalizeBulkActionInput(input);
      const succeeded: MailBulkActionSuccess[] = [];
      const failed: MailBulkActionFailure[] = [];

      for (const messageId of normalized.messageIds) {
        try {
          const result = await options.store.applyAction({
            accountId: normalized.accountId,
            messageId,
            action: normalized.action,
          });
          succeeded.push({
            messageId,
            undoToken: result.state.undoToken,
            undoExpiresAt: result.state.undoExpiresAt,
            commandId: result.command.id,
          });
        } catch (error) {
          failed.push({
            messageId,
            error: isNotVisibleError(error)
              ? "message_not_visible"
              : "action_failed",
            ...(error instanceof Error ? { message: error.message } : {}),
          });
        }
      }

      return {
        accountId: normalized.accountId,
        bucket: normalized.bucket,
        action: normalized.action,
        requestedCount: input.messageIds.length,
        attemptedCount: normalized.messageIds.length,
        succeededCount: succeeded.length,
        failedCount: failed.length,
        succeeded,
        failed,
      };
    },
  };
}

function normalizeBulkActionInput(input: MailBulkActionInput): MailBulkActionInput {
  const accountId = requiredString(input.accountId);
  const bucket = requiredString(input.bucket);
  if (input.action !== "done") {
    throw new InvalidMailActionRequestError("bulk action is invalid");
  }
  if (!Array.isArray(input.messageIds) || input.messageIds.length === 0) {
    throw new InvalidMailActionRequestError("messageIds are required");
  }
  if (input.messageIds.length > MAX_BULK_ACTION_MESSAGE_IDS) {
    throw new InvalidMailActionRequestError("too many messageIds");
  }

  const messageIds = uniqueStrings(input.messageIds);
  if (messageIds.length === 0) {
    throw new InvalidMailActionRequestError("messageIds are required");
  }

  return {
    accountId,
    bucket,
    action: "done",
    messageIds,
  };
}

function normalizeActionInput(input: MailActionInput): MailActionInput {
  const accountId = requiredString(input.accountId);
  const messageId = requiredString(input.messageId);
  const action = normalizeAction(input.action);

  if (action === "move") {
    return {
      accountId,
      messageId,
      action,
      mailboxId: requiredString(input.mailboxId),
    };
  }

  if (action === "apply_labels") {
    const labelIds = [...new Set((input.labelIds ?? []).map(requiredString))];
    if (labelIds.length === 0) {
      throw new InvalidMailActionRequestError("labelIds are required");
    }
    return { accountId, messageId, action, labelIds };
  }

  if (action === "undo_done") {
    return {
      accountId,
      messageId,
      action,
      undoToken: requiredString(input.undoToken),
    };
  }

  return { accountId, messageId, action };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const item = requiredString(value);
    if (!seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  }
  return normalized;
}

function isNotVisibleError(error: unknown): boolean {
  return error instanceof Error && /not found|not visible/i.test(error.message);
}

function normalizeAction(value: string): MailAction {
  if (
    value === "mark_read" ||
    value === "mark_unread" ||
    value === "star" ||
    value === "unstar" ||
    value === "archive" ||
    value === "trash" ||
    value === "move" ||
    value === "apply_labels" ||
    value === "done" ||
    value === "undo_done" ||
    value === "undone"
  ) {
    return value;
  }

  throw new InvalidMailActionRequestError("action is invalid");
}

function requiredString(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new InvalidMailActionRequestError();
  }
  return trimmed;
}
