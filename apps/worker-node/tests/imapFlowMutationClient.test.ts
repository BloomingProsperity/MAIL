import { describe, expect, it, vi } from "vitest";

import {
  createImapFlowMutationClient,
  createPostgresImapAccountSettingsStore,
} from "../src/imap/imapflow-mutation-client";
import { NonRetryableQueueError } from "../src/queue-errors";

describe("ImapFlow mutation client", () => {
  it("updates IMAP flags inside a mailbox lock and logs out", async () => {
    const calls: string[] = [];
    const session = {
      async connect() {
        calls.push("connect");
      },
      async getMailboxLock(path: string) {
        calls.push(`lock:${path}`);
        return {
          release() {
            calls.push("release");
          },
        };
      },
      async messageFlagsAdd(range: string, flags: string[], options: unknown) {
        calls.push(`add:${range}:${flags.join(",")}:${JSON.stringify(options)}`);
      },
      async messageFlagsRemove(range: string, flags: string[], options: unknown) {
        calls.push(
          `remove:${range}:${flags.join(",")}:${JSON.stringify(options)}`,
        );
      },
      async messageMove() {
        throw new Error("should not move while updating flags");
      },
      async logout() {
        calls.push("logout");
      },
      closeAfter: vi.fn(),
    };
    const client = createImapFlowMutationClient({
      settingsStore: fixedSettingsStore(),
      secretStore: fixedSecretStore("app-password"),
      connect: async (options) => {
        expect(options).toMatchObject({
          host: "imap.qq.com",
          port: 993,
          secure: true,
          auth: {
            user: "support@qq.com",
            pass: "app-password",
          },
          logger: false,
          disableAutoIdle: true,
        });
        return session;
      },
    });

    await client.updateFlags({
      accountId: "account_1",
      mailboxPath: "INBOX",
      uid: "42",
      addFlags: ["\\Seen"],
      removeFlags: ["\\Flagged"],
    });

    expect(calls).toEqual([
      "connect",
      "lock:INBOX",
      'add:42:\\Seen:{"uid":true}',
      'remove:42:\\Flagged:{"uid":true}',
      "release",
      "logout",
    ]);
  });

  it("moves IMAP messages by UID and releases the mailbox lock", async () => {
    const calls: string[] = [];
    const session = {
      async connect() {
        calls.push("connect");
      },
      async getMailboxLock(path: string) {
        calls.push(`lock:${path}`);
        return {
          release() {
            calls.push("release");
          },
        };
      },
      async messageFlagsAdd() {
        throw new Error("should not update flags while moving");
      },
      async messageFlagsRemove() {
        throw new Error("should not update flags while moving");
      },
      async messageMove(range: string, destination: string, options: unknown) {
        calls.push(`move:${range}:${destination}:${JSON.stringify(options)}`);
      },
      async logout() {
        calls.push("logout");
      },
      closeAfter: vi.fn(),
    };
    const client = createImapFlowMutationClient({
      settingsStore: fixedSettingsStore(),
      secretStore: fixedSecretStore("app-password"),
      connect: async () => session,
    });

    await client.moveMessage({
      accountId: "account_1",
      sourceMailboxPath: "INBOX",
      uid: "42",
      destinationMailboxPath: "Archive",
    });

    expect(calls).toEqual([
      "connect",
      "lock:INBOX",
      'move:42:Archive:{"uid":true}',
      "release",
      "logout",
    ]);
  });

  it("adds IMAP labels as keyword flags", async () => {
    const calls: string[] = [];
    const session = {
      async connect() {
        calls.push("connect");
      },
      async getMailboxLock(path: string) {
        calls.push(`lock:${path}`);
        return {
          release() {
            calls.push("release");
          },
        };
      },
      async messageFlagsAdd(range: string, flags: string[], options: unknown) {
        calls.push(`add:${range}:${flags.join(",")}:${JSON.stringify(options)}`);
      },
      async messageFlagsRemove() {
        throw new Error("should not remove flags while applying labels");
      },
      async messageMove() {
        throw new Error("should not move while applying labels");
      },
      async logout() {
        calls.push("logout");
      },
      closeAfter: vi.fn(),
    };
    const client = createImapFlowMutationClient({
      settingsStore: fixedSettingsStore(),
      secretStore: fixedSecretStore("app-password"),
      connect: async () => session,
    });

    await client.applyLabels({
      accountId: "account_1",
      mailboxPath: "INBOX",
      uid: "42",
      labels: ["Project/Acme"],
    });

    expect(calls).toEqual([
      "connect",
      "lock:INBOX",
      'add:42:Project/Acme:{"uid":true}',
      "release",
      "logout",
    ]);
  });

  it("rejects unsafe IMAP label keywords before connecting", async () => {
    const connect = vi.fn(async () => {
      throw new Error("should not connect for unsafe labels");
    });
    const client = createImapFlowMutationClient({
      settingsStore: fixedSettingsStore(),
      secretStore: fixedSecretStore("app-password"),
      connect,
    });

    await expect(
      client.applyLabels({
        accountId: "account_1",
        mailboxPath: "INBOX",
        uid: "42",
        labels: ["验证码", "Project Alpha", "\\Seen"],
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
    expect(connect).not.toHaveBeenCalled();
  });

  it("closes the connection after failed commands without leaking passwords", async () => {
    const closeAfter = vi.fn();
    const client = createImapFlowMutationClient({
      settingsStore: fixedSettingsStore(),
      secretStore: fixedSecretStore("super-secret-password"),
      connect: async () => ({
        async connect() {},
        async getMailboxLock() {
          return {
            release() {},
          };
        },
        async messageFlagsAdd() {
          throw new Error("server rejected super-secret-password");
        },
        async messageFlagsRemove() {},
        async messageMove() {},
        async logout() {},
        closeAfter,
      }),
    });

    await expect(
      client.updateFlags({
        accountId: "account_1",
        mailboxPath: "INBOX",
        uid: "42",
        addFlags: ["\\Seen"],
      }),
    ).rejects.toThrow("server rejected [redacted]");
    await expect(
      client.updateFlags({
        accountId: "account_1",
        mailboxPath: "INBOX",
        uid: "42",
        addFlags: ["\\Seen"],
      }),
    ).rejects.not.toThrow("super-secret-password");
    expect(closeAfter).toHaveBeenCalled();
  });
});

describe("postgres IMAP account settings store", () => {
  it("loads IMAP settings and secret refs without selecting secret values", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresImapAccountSettingsStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              settings: {
                imap: {
                  host: "imap.mail.me.com",
                  port: 993,
                  secure: true,
                  username: "me@icloud.com",
                },
              },
              secret_ref: "db:imap_secret_1",
            },
          ],
        };
      },
    });

    const settings = await store.getSettings("account_1");

    expect(queries[0].text).toMatch(/account_provider_settings/i);
    expect(queries[0].text).toMatch(/account_credentials/i);
    expect(queries[0].text).not.toMatch(/secret_value/i);
    expect(queries[0].values).toEqual(["account_1", "imap_password"]);
    expect(settings).toEqual({
      accountId: "account_1",
      host: "imap.mail.me.com",
      port: 993,
      secure: true,
      username: "me@icloud.com",
      secretRef: "db:imap_secret_1",
    });
  });
});

function fixedSettingsStore() {
  return {
    async getSettings() {
      return {
        accountId: "account_1",
        host: "imap.qq.com",
        port: 993,
        secure: true,
        username: "support@qq.com",
        secretRef: "db:imap_secret_1",
      };
    },
  };
}

function fixedSecretStore(secret: string) {
  return {
    async getSecret() {
      return secret;
    },
  };
}
