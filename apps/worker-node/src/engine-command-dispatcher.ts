import type {
  AccountProviderSettingsStore,
  AccountSyncPlan,
} from "./account-provider-settings-store.js";
import type { EngineCommandRecord } from "./engine-command-queue.js";
import type {
  EngineCommandTargetResolver,
  ResolveLabelTargetsInput,
} from "./engine-command-resolver.js";
import { EmailEngineRequestError } from "./mail-engine/email-engine-client.js";
import type { EmailEngineClient } from "./mail-engine/email-engine-client.js";
import type { NativeProvider } from "./mail-provider/contract.js";
import { NonRetryableQueueError } from "./queue-errors.js";

export interface NativeEngineCommandProcessor {
  executeCommand(input: {
    command: EngineCommandRecord;
    provider: NativeProvider;
  }): Promise<void>;
}

export interface EngineCommandDispatcherOptions {
  accountSettingsStore: AccountProviderSettingsStore;
  targetResolver: EngineCommandTargetResolver;
  emailEngine: Pick<
    EmailEngineClient,
    "updateMessage" | "moveMessage" | "deleteMessage"
  >;
  nativeCommandProcessor: NativeEngineCommandProcessor;
}

export function createEngineCommandDispatcher(
  options: EngineCommandDispatcherOptions,
) {
  return async (command: EngineCommandRecord): Promise<void> => {
    const plan = await options.accountSettingsStore.getAccountSyncPlan(
      command.accountId,
    );
    if (!plan) {
      throw new NonRetryableQueueError(
        `connected account not found for engine command: ${command.accountId}`,
      );
    }
    if (plan.syncState === "paused") {
      throw new Error(
        `account ${command.accountId} is paused; engine command ${command.id} will retry`,
      );
    }
    if (plan.syncState === "reauth_required") {
      throw new Error(
        `account ${command.accountId} requires reauthorization; engine command ${command.id} will retry`,
      );
    }

    if (plan.engineProvider === "native") {
      await dispatchNative(options, plan, command);
      return;
    }

    await dispatchEmailEngine(options, plan, command);
  };
}

async function dispatchNative(
  options: EngineCommandDispatcherOptions,
  plan: AccountSyncPlan,
  command: EngineCommandRecord,
): Promise<void> {
  if (!plan.nativeProvider) {
    throw new NonRetryableQueueError(
      `native account ${command.accountId} is missing nativeProvider`,
    );
  }

  await options.nativeCommandProcessor.executeCommand({
    command,
    provider: plan.nativeProvider,
  });
}

async function dispatchEmailEngine(
  options: EngineCommandDispatcherOptions,
  plan: AccountSyncPlan,
  command: EngineCommandRecord,
): Promise<void> {
  const messageId = requiredString(command.target.messageId, "target.messageId");
  const messageTarget = await options.targetResolver.resolveMessageTarget?.({
    accountId: command.accountId,
    messageId,
    provider: "emailengine",
  });
  if (!messageTarget?.providerMessageId) {
    throw new NonRetryableQueueError(
      `provider message ref not found for engine command ${command.id}`,
    );
  }

  switch (command.commandType) {
    case "mark_read":
      await runIdempotentEmailEngineMutation(() =>
        options.emailEngine.updateMessage({
          accountId: command.accountId,
          messageId: messageTarget.providerMessageId,
          flags: { add: ["\\Seen"] },
        }),
      );
      return;
    case "mark_unread":
      await runIdempotentEmailEngineMutation(() =>
        options.emailEngine.updateMessage({
          accountId: command.accountId,
          messageId: messageTarget.providerMessageId,
          flags: { delete: ["\\Seen"] },
        }),
      );
      return;
    case "star":
      await runIdempotentEmailEngineMutation(() =>
        options.emailEngine.updateMessage({
          accountId: command.accountId,
          messageId: messageTarget.providerMessageId,
          flags: { add: ["\\Flagged"] },
        }),
      );
      return;
    case "unstar":
      await runIdempotentEmailEngineMutation(() =>
        options.emailEngine.updateMessage({
          accountId: command.accountId,
          messageId: messageTarget.providerMessageId,
          flags: { delete: ["\\Flagged"] },
        }),
      );
      return;
    case "move":
      await moveEmailEngineMessage(options, command, messageTarget.providerMessageId);
      return;
    case "archive":
      await archiveEmailEngineMessage(
        options,
        plan,
        command,
        messageTarget.providerMessageId,
      );
      return;
    case "trash":
      await runIdempotentEmailEngineMutation(() =>
        options.emailEngine.deleteMessage({
          accountId: command.accountId,
          messageId: messageTarget.providerMessageId,
          force: false,
        }),
      );
      return;
    case "apply_labels":
      await applyEmailEngineLabels(
        options,
        command,
        messageTarget.providerMessageId,
      );
      return;
  }
}

async function moveEmailEngineMessage(
  options: EngineCommandDispatcherOptions,
  command: EngineCommandRecord,
  providerMessageId: string,
): Promise<void> {
  const mailboxId = requiredString(command.target.mailboxId, "target.mailboxId");
  const mailboxTarget = await options.targetResolver.resolveMailboxTarget?.({
    accountId: command.accountId,
    mailboxId,
    provider: "emailengine",
  });
  if (!mailboxTarget?.providerMailboxId) {
    throw new NonRetryableQueueError(
      `provider mailbox ref not found for engine command ${command.id}`,
    );
  }

  await runIdempotentEmailEngineMutation(() =>
    options.emailEngine.moveMessage({
      accountId: command.accountId,
      messageId: providerMessageId,
      path: mailboxTarget.providerMailboxId,
    }),
  );
}

async function archiveEmailEngineMessage(
  options: EngineCommandDispatcherOptions,
  plan: AccountSyncPlan,
  command: EngineCommandRecord,
  providerMessageId: string,
): Promise<void> {
  const configuredPath =
    typeof plan.settings.archivePath === "string"
      ? plan.settings.archivePath
      : undefined;
  const archiveTarget = configuredPath
    ? { providerMailboxId: configuredPath }
    : await options.targetResolver.resolveSpecialMailboxTarget?.({
        accountId: command.accountId,
        role: "archive",
        provider: "emailengine",
      });
  if (!archiveTarget?.providerMailboxId) {
    throw new NonRetryableQueueError(
      `archive mailbox path is not configured for engine command ${command.id}`,
    );
  }

  await runIdempotentEmailEngineMutation(() =>
    options.emailEngine.moveMessage({
      accountId: command.accountId,
      messageId: providerMessageId,
      path: archiveTarget.providerMailboxId,
    }),
  );
}

async function applyEmailEngineLabels(
  options: EngineCommandDispatcherOptions,
  command: EngineCommandRecord,
  providerMessageId: string,
): Promise<void> {
  const labelIds = requiredStringArray(command.target.labelIds, "target.labelIds");
  const labelTargets = await options.targetResolver.resolveLabelTargets?.(
    labelResolverInput(labelIds),
  );
  if (!labelTargets || labelTargets.length !== labelIds.length) {
    throw new NonRetryableQueueError(
      `provider labels could not be resolved for engine command ${command.id}`,
    );
  }

  await runIdempotentEmailEngineMutation(() =>
    options.emailEngine.updateMessage({
      accountId: command.accountId,
      messageId: providerMessageId,
      labels: { add: labelTargets },
    }),
  );
}

function labelResolverInput(labelIds: string[]): ResolveLabelTargetsInput {
  return { labelIds };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NonRetryableQueueError(`${name} is required`);
  }

  return value.trim();
}

function requiredStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new NonRetryableQueueError(`${name} is required`);
  }

  const values = value.map((item) => requiredString(item, name));
  if (values.length === 0) {
    throw new NonRetryableQueueError(`${name} is required`);
  }

  return values;
}

async function runIdempotentEmailEngineMutation(
  mutate: () => Promise<unknown>,
): Promise<void> {
  try {
    await mutate();
  } catch (error) {
    if (isEmailEngineMessageNotFound(error)) {
      return;
    }
    throw error;
  }
}

function isEmailEngineMessageNotFound(error: unknown): boolean {
  if (error instanceof EmailEngineRequestError) {
    return error.code === "MessageNotFound";
  }

  return error instanceof Error && error.message.includes("MessageNotFound");
}
