import type { ImapMutationClient } from "../mail-provider/native-command-processor.js";
import { NonRetryableQueueError } from "../queue-errors.js";
import type { SecretStore } from "../secrets/secret-store.js";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface ImapAccountSettings {
  accountId: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  secretRef: string;
}

export interface ImapAccountSettingsStore {
  getSettings(accountId: string): Promise<ImapAccountSettings | undefined>;
}

export interface ImapConnectionOptions {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  logger: false;
  disableAutoIdle: true;
}

export interface ImapMailboxLock {
  release(): void;
}

export interface ImapMutationSession {
  connect(): Promise<void>;
  getMailboxLock(path: string): Promise<ImapMailboxLock>;
  messageFlagsAdd(
    range: string,
    flags: string[],
    options: { uid: true },
  ): Promise<unknown>;
  messageFlagsRemove(
    range: string,
    flags: string[],
    options: { uid: true },
  ): Promise<unknown>;
  messageMove(
    range: string,
    destination: string,
    options: { uid: true },
  ): Promise<unknown>;
  logout(): Promise<void>;
  closeAfter?(): void;
}

export interface ImapFlowMutationClientOptions {
  settingsStore: ImapAccountSettingsStore;
  secretStore: SecretStore;
  connect?: (options: ImapConnectionOptions) => Promise<ImapMutationSession>;
}

interface ImapAccountSettingsRow extends Record<string, unknown> {
  settings?: unknown;
  secret_ref?: string | null;
}

export function createImapFlowMutationClient(
  options: ImapFlowMutationClientOptions,
): ImapMutationClient {
  const connect = options.connect ?? defaultConnect;

  return {
    async updateFlags(input) {
      await withMailboxSession(options, connect, input.accountId, input.mailboxPath, async (session) => {
        if (input.addFlags && input.addFlags.length > 0) {
          await session.messageFlagsAdd(input.uid, input.addFlags, { uid: true });
        }
        if (input.removeFlags && input.removeFlags.length > 0) {
          await session.messageFlagsRemove(input.uid, input.removeFlags, {
            uid: true,
          });
        }
      });
    },
    async moveMessage(input) {
      await withMailboxSession(
        options,
        connect,
        input.accountId,
        input.sourceMailboxPath,
        async (session) => {
          await session.messageMove(input.uid, input.destinationMailboxPath, {
            uid: true,
          });
        },
      );
    },
    async applyLabels(input) {
      await withMailboxSession(options, connect, input.accountId, input.mailboxPath, async (session) => {
        if (input.labels.length > 0) {
          await session.messageFlagsAdd(input.uid, input.labels, { uid: true });
        }
      });
    },
  };
}

export function createPostgresImapAccountSettingsStore(
  client: Queryable,
): ImapAccountSettingsStore {
  return {
    async getSettings(accountId) {
      const result = await client.query<ImapAccountSettingsRow>(
        `
          SELECT
            account_provider_settings.settings,
            account_credentials.secret_ref
          FROM account_provider_settings
          JOIN account_credentials
            ON account_credentials.account_id = account_provider_settings.account_id
           AND account_credentials.credential_kind = $2
          WHERE account_provider_settings.account_id = $1
            AND account_provider_settings.native_provider = 'imap'
          LIMIT 1
        `,
        [accountId, "imap_password"],
      );

      const row = result.rows[0];
      if (!row) {
        return undefined;
      }

      const imap = recordValue(row.settings).imap;
      const settings = recordValue(imap);
      const host = readString(settings.host);
      const port = readNumber(settings.port);
      const secure = readBoolean(settings.secure);
      const username = readString(settings.username);
      const secretRef = readString(row.secret_ref);
      if (!host || !port || secure === undefined || !username || !secretRef) {
        return undefined;
      }

      return {
        accountId,
        host,
        port,
        secure,
        username,
        secretRef,
      };
    },
  };
}

async function withMailboxSession(
  options: ImapFlowMutationClientOptions,
  connect: (connection: ImapConnectionOptions) => Promise<ImapMutationSession>,
  accountId: string,
  mailboxPath: string,
  run: (session: ImapMutationSession) => Promise<void>,
): Promise<void> {
  const { session, secret } = await openSession(options, connect, accountId);
  let lock: ImapMailboxLock | undefined;
  try {
    await session.connect();
    lock = await session.getMailboxLock(mailboxPath);
    await run(session);
  } catch (error) {
    session.closeAfter?.();
    throw sanitizeSecretError(error, secret);
  } finally {
    try {
      lock?.release();
    } finally {
      await logoutQuietly(session);
    }
  }
}

async function openSession(
  options: ImapFlowMutationClientOptions,
  connect: (connection: ImapConnectionOptions) => Promise<ImapMutationSession>,
  accountId: string,
): Promise<{ session: ImapMutationSession; secret: string }> {
  const settings = await options.settingsStore.getSettings(accountId);
  if (!settings) {
    throw new NonRetryableQueueError(
      `native IMAP settings not found for account ${accountId}`,
    );
  }

  const secret = await options.secretStore.getSecret(settings.secretRef);
  const session = await connect({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: {
      user: settings.username,
      pass: secret,
    },
    logger: false,
    disableAutoIdle: true,
  });

  return { session, secret };
}

async function defaultConnect(
  options: ImapConnectionOptions,
): Promise<ImapMutationSession> {
  const { ImapFlow } = await import("imapflow");
  return new ImapFlow(options) as ImapMutationSession;
}

async function logoutQuietly(session: ImapMutationSession): Promise<void> {
  try {
    await session.logout();
  } catch {
    session.closeAfter?.();
  }
}

function sanitizeSecretError(error: unknown, secret: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(message.split(secret).join("[redacted]"));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return undefined;
}
