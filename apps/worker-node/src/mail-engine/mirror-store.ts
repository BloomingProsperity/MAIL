import type {
  MailProvider,
  ProviderMailboxIdentity,
  ProviderMessageIdentity,
} from "../mail-provider/contract.js";

export type MirrorProvider = MailProvider;

export interface UpsertMailboxesInput {
  engineAccountId: string;
  provider: MirrorProvider;
  mailboxes: unknown[];
}

export interface UpsertMessageInput {
  engineAccountId: string;
  provider: MirrorProvider;
  message: unknown;
  providerIdentity?: ProviderMessageIdentity;
  mailboxPath?: string;
  mailboxIdentity?: ProviderMailboxIdentity;
}

export interface RecordMessageDeletedInput {
  engineAccountId: string;
  provider: MirrorProvider;
  providerMessageId: string;
  providerIdentity?: ProviderMessageIdentity;
  mailboxPath?: string;
  mailboxIdentity?: ProviderMailboxIdentity;
  deletedAt: string;
  idempotencyKey: string;
}

export interface MirrorStore {
  upsertMailboxes(input: UpsertMailboxesInput): Promise<void>;
  upsertMessage(input: UpsertMessageInput): Promise<void>;
  recordMessageDeleted(input: RecordMessageDeletedInput): Promise<void>;
}
