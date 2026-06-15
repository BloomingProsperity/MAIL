import type {
  NativeMailAdapter,
  NativeProvider,
  ProviderMailbox,
  ProviderMailboxIdentity,
  ProviderMessageIdentity,
  ProviderSyncContinuation,
} from "./contract.js";
import { providerMessageKey } from "./contract.js";
import { GmailHistoryResetError } from "./gmail-readonly-adapter.js";
import type { MirrorStore } from "../mail-engine/mirror-store.js";
import type { ProviderRefStore } from "../provider-ref-store.js";
import type { SyncCursorStore } from "../sync-cursor-store.js";
import type {
  NativeSendIdentityDiscovery,
  NativeSendIdentityDiscoveryResult,
} from "./send-identity-discovery.js";

export interface NativeSyncProcessorOptions {
  adapters: Partial<Record<NativeProvider, NativeMailAdapter>>;
  cursorStore: SyncCursorStore;
  providerRefStore: Pick<
    ProviderRefStore,
    "upsertMailboxRef" | "upsertMessageRef" | "recordTombstone"
  >;
  mirrorStore?: Pick<
    MirrorStore,
    "upsertMailboxes" | "upsertMessage" | "recordMessageDeleted"
  >;
  sendIdentityDiscovery?: NativeSendIdentityDiscovery;
}

export interface NativeSyncAccountInput {
  accountId: string;
  provider: NativeProvider;
  mailbox?: ProviderMailboxIdentity;
  continuation?: ProviderSyncContinuation;
  limit?: number;
}

export interface NativeSyncAccountResult {
  provider: NativeProvider;
  accountId: string;
  changeCount: number;
  cursorAdvanced: boolean;
  hasMore: boolean;
  continuation?: ProviderSyncContinuation;
  resetRequired?: boolean;
  resetReason?: string;
}

export interface NativeMailboxDiscoveryInput {
  accountId: string;
  provider: NativeProvider;
}

export interface NativeMailboxDiscoveryResult {
  provider: NativeProvider;
  accountId: string;
  mailboxCount: number;
  mailboxes: ProviderMailbox[];
  sendIdentityDiscovery?: NativeSendIdentityDiscoveryResult;
}

export interface NativeSyncProcessor {
  syncAccount(input: NativeSyncAccountInput): Promise<NativeSyncAccountResult>;
  discoverMailboxes(
    input: NativeMailboxDiscoveryInput,
  ): Promise<NativeMailboxDiscoveryResult>;
}

export function createNativeSyncProcessor(
  options: NativeSyncProcessorOptions,
): NativeSyncProcessor {
  return {
    async discoverMailboxes(input) {
      const adapter = options.adapters[input.provider];
      if (!adapter) {
        throw new Error(`native provider adapter not configured: ${input.provider}`);
      }
      if (!adapter.listMailboxes) {
        throw new Error(
          `native provider adapter cannot discover mailboxes: ${input.provider}`,
        );
      }

      const result = await adapter.listMailboxes({
        accountId: input.accountId,
      });

      for (const mailbox of result.mailboxes) {
        await options.providerRefStore.upsertMailboxRef({
          accountId: input.accountId,
          identity: mailbox.identity,
          displayName: mailbox.displayName,
          role: mailbox.role,
          rawRef: mailbox.raw,
        });
      }
      if (options.mirrorStore) {
        await options.mirrorStore.upsertMailboxes({
          engineAccountId: input.accountId,
          provider: input.provider,
          mailboxes: result.mailboxes,
        });
      }
      const sendIdentityDiscovery =
        await options.sendIdentityDiscovery?.discoverProviderSendIdentities({
          accountId: input.accountId,
          provider: input.provider,
        });

      return {
        provider: input.provider,
        accountId: input.accountId,
        mailboxCount: result.mailboxes.length,
        mailboxes: result.mailboxes,
        ...(sendIdentityDiscovery ? { sendIdentityDiscovery } : {}),
      };
    },

    async syncAccount(input) {
      const adapter = options.adapters[input.provider];
      if (!adapter) {
        throw new Error(`native provider adapter not configured: ${input.provider}`);
      }

      const cursor = await options.cursorStore.getCursor({
        accountId: input.accountId,
        provider: input.provider,
        ...(input.mailbox ? { mailbox: input.mailbox } : {}),
      });

      try {
        const result = await adapter.sync({
          accountId: input.accountId,
          cursor,
          ...(input.mailbox ? { mailbox: input.mailbox } : {}),
          ...(input.continuation ? { continuation: input.continuation } : {}),
          limit: input.limit,
        });

        for (const change of result.changes) {
          if (change.kind === "mailbox_changed") {
            await options.providerRefStore.upsertMailboxRef({
              accountId: input.accountId,
              identity: change.mailbox,
              rawRef: change.raw,
            });
            await options.mirrorStore?.upsertMailboxes({
              engineAccountId: input.accountId,
              provider: input.provider,
              mailboxes: [
                {
                  identity: change.mailbox,
                  raw: change.raw,
                },
              ],
            });
          }

          if (change.kind === "message_upserted") {
            await options.providerRefStore.upsertMessageRef({
              accountId: input.accountId,
              identity: change.identity,
              rawRef: change.raw,
            });
            await options.mirrorStore?.upsertMessage({
              engineAccountId: input.accountId,
              provider: input.provider,
              message: change.raw ?? change.identity,
              providerIdentity: change.identity,
              ...(input.mailbox ? { mailboxIdentity: input.mailbox } : {}),
            });
          }

          if (change.kind === "message_deleted") {
            await options.providerRefStore.recordTombstone({
              accountId: input.accountId,
              identity: change.identity,
              deletedAt: change.deletedAt,
              reason: "provider_deleted",
              rawEvent: change.raw,
            });
            await options.mirrorStore?.recordMessageDeleted({
              engineAccountId: input.accountId,
              provider: input.provider,
              providerMessageId: providerMessageIdFor(change.identity),
              providerIdentity: change.identity,
              ...(input.mailbox ? { mailboxIdentity: input.mailbox } : {}),
              deletedAt: change.deletedAt,
              idempotencyKey: `delete:${input.accountId}:${providerMessageKey(
                change.identity,
              )}`,
            });
          }
        }

        if (result.cursor) {
          await options.cursorStore.upsertCursor({
            accountId: input.accountId,
            cursor: result.cursor,
          });
        }

        return {
          provider: input.provider,
          accountId: input.accountId,
          changeCount: result.changes.length,
          cursorAdvanced: Boolean(result.cursor),
          hasMore: result.hasMore,
          ...(result.continuation
            ? { continuation: result.continuation }
            : {}),
        };
      } catch (error) {
        if (input.provider === "gmail" && error instanceof GmailHistoryResetError) {
          await options.cursorStore.markCursorReset({
            accountId: input.accountId,
            provider: input.provider,
            reason: error.code,
          });

          return {
            provider: input.provider,
            accountId: input.accountId,
            changeCount: 0,
            cursorAdvanced: false,
            hasMore: false,
            resetRequired: true,
            resetReason: error.code,
          };
        }

        throw error;
      }
    },
  };
}

function providerMessageIdFor(identity: ProviderMessageIdentity): string {
  switch (identity.provider) {
    case "emailengine":
      return identity.messageId;
    case "gmail":
      return identity.messageId;
    case "graph":
      return identity.id;
    case "imap":
      return identity.uid;
  }
}
