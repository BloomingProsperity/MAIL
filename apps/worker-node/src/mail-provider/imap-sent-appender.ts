import type { SmtpAccountSendSettings } from "./smtp-send-transport.js";

export interface ImapSentAppendSession {
  connect(): Promise<void>;
  append(
    path: string,
    content: Buffer,
    flags?: string[],
    idate?: Date | string,
  ): Promise<unknown>;
  logout(): Promise<void>;
  closeAfter?(): void;
}

export interface ImapSentAppendConnectionOptions {
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

export type ImapSentAppendConnect = (
  options: ImapSentAppendConnectionOptions,
) => Promise<ImapSentAppendSession>;

export interface SmtpSentAppender {
  appendSentMessage(input: {
    settings: SmtpAccountSendSettings;
    secret: string;
    raw: Buffer;
    sentAt: Date;
  }): Promise<void>;
}

export function createImapSentAppender(options: {
  connect?: ImapSentAppendConnect;
} = {}): SmtpSentAppender {
  const connect = options.connect ?? defaultConnect;
  return {
    async appendSentMessage(input) {
      if (!input.settings.imap) {
        return;
      }

      const session = await connect({
        host: input.settings.imap.host,
        port: input.settings.imap.port,
        secure: input.settings.imap.secure,
        auth: {
          user: input.settings.imap.username,
          pass: input.secret,
        },
        logger: false,
        disableAutoIdle: true,
      });

      try {
        await session.connect();
        await session.append(
          sentMailboxPath(input.settings),
          input.raw,
          ["\\Seen"],
          input.sentAt,
        );
      } catch (error) {
        session.closeAfter?.();
        throw sanitizeSecretError(error, input.secret);
      } finally {
        await logoutQuietly(session);
      }
    },
  };
}

function sentMailboxPath(settings: SmtpAccountSendSettings): string {
  const path = settings.sentMailboxPath?.trim();
  return path && !/[\u0000-\u001f]/.test(path) ? path : "Sent";
}

async function defaultConnect(
  options: ImapSentAppendConnectionOptions,
): Promise<ImapSentAppendSession> {
  const { ImapFlow } = await import("imapflow");
  return new ImapFlow(options) as ImapSentAppendSession;
}

async function logoutQuietly(session: ImapSentAppendSession): Promise<void> {
  try {
    await session.logout();
  } catch {
    session.closeAfter?.();
  }
}

function sanitizeSecretError(error: unknown, secret: string): Error {
  const base = error instanceof Error ? error : new Error(String(error));
  const sanitized = new Error(base.message.split(secret).join("[redacted]"));
  const code = (base as { code?: unknown }).code;
  if (code !== undefined) {
    (sanitized as { code?: unknown }).code = code;
  }
  return sanitized;
}
