import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { createImapSentAppender } from "../src/mail-provider/imap-sent-appender";
import {
  createPostgresSmtpAccountSendSettingsStore,
  createPostgresSmtpSendReauthorizationMarker,
  createSmtpNativeSendTransport,
} from "../src/mail-provider/smtp-send-transport";

describe("worker native SMTP send transport", () => {
  it("loads SMTP settings and prefers smtp_password over imap_password", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresSmtpAccountSendSettingsStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              account_id: "acc_imap",
              email: "me@custom.example",
              display_name: "Custom Mail",
              provider: "custom",
              settings: {
                imap: {
                  host: "imap.custom.example",
                  port: 993,
                  secure: true,
                  username: "me@custom.example",
                  sentMailboxPath: "Sent Messages",
                },
                smtp: {
                  host: "smtp.custom.example",
                  port: 587,
                  secure: false,
                  username: "smtp-user",
                },
              },
              secret_ref: "db:smtp_secret",
              smtp_secret_ref: "db:smtp_secret",
              imap_secret_ref: "db:imap_secret",
              sent_mailbox_path: "Sent",
            },
          ],
        };
      },
    });

    await expect(store.getSettings("acc_imap")).resolves.toMatchObject({
      accountId: "acc_imap",
      provider: "custom",
      fromAddress: "me@custom.example",
      fromName: "Custom Mail",
      host: "smtp.custom.example",
      port: 587,
      secure: false,
      username: "smtp-user",
      secretRef: "db:smtp_secret",
      smtpSecretRef: "db:smtp_secret",
      imapSecretRef: "db:imap_secret",
      sentMailboxPath: "Sent",
      imap: { host: "imap.custom.example" },
      smtp: { host: "smtp.custom.example" },
    });
    expect(queries[0].values).toEqual([
      "acc_imap",
      "smtp_password",
      "imap_password",
    ]);
  });

  it("builds SMTP mail options with Bcc recipients preserved for delivery", async () => {
    const sent: unknown[] = [];
    const appended: Array<{ secret: string; raw: Buffer; sentAt: Date }> = [];
    const operations: string[] = [];
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "proton_bridge",
            fromAddress: "me@proton.me",
            host: "127.0.0.1",
            port: 1025,
            secure: false,
            username: "bridge-user",
            secretRef: "db:bridge_secret",
            smtpSecretRef: "db:smtp_secret",
            imapSecretRef: "db:imap_secret",
            sentMailboxPath: "Sent",
            imap: {
              host: "imap.proton.local",
              port: 1143,
              secure: false,
              username: "bridge-user",
            },
            smtp: {
              host: "127.0.0.1",
              port: 1025,
              secure: false,
              username: "bridge-user",
            },
          };
        },
      },
      secretStore: {
        async getSecret(secretRef) {
          if (secretRef === "db:smtp_secret") {
            return "smtp-password";
          }
          if (secretRef === "db:imap_secret") {
            return "imap-password";
          }
          throw new Error(`unexpected secret ref: ${secretRef}`);
        },
      },
      async sendMail(input) {
        operations.push("send");
        sent.push(input);
        return { messageId: "smtp_msg_1" };
      },
      sentAppender: {
        async appendSentMessage(input) {
          operations.push("append");
          appended.push({
            secret: input.secret,
            raw: input.raw,
            sentAt: input.sentAt,
          });
        },
      },
      now: () => new Date("2026-06-15T12:00:00.000Z"),
    });

    const result = await transport.submitMessage({
      accountId: "acc_imap",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
      from: { address: "alias@proton.me", name: "Alias" },
      to: [{ address: "client@example.com", name: "Client" }],
      cc: [{ address: "team@example.com" }],
      bcc: [{ address: "audit@example.com" }],
      subject: "Bridge update",
      bodyText: "Plain body",
      threading: {
        action: "reply",
        inReplyTo: "<source@example.com>\r\nBcc: leak@example.com",
        references: [
          "<root@example.com>",
          "<source@example.com>",
          "<source@example.com>",
        ],
      },
    });

    expect(result.messageId).toBe("smtp_msg_1");
    expect(operations).toEqual(["send", "append"]);
    expect(sent).toEqual([
      expect.objectContaining({
        secret: "smtp-password",
        mail: expect.objectContaining({
          from: '"Alias" <alias@proton.me>',
          to: '"Client" <client@example.com>',
          cc: "team@example.com",
          bcc: "audit@example.com",
          envelope: {
            from: "me@proton.me",
            to: ["client@example.com", "team@example.com", "audit@example.com"],
          },
          headers: {
            "X-EmailHub-Idempotency-Key":
              "compose:draft_1:schedule:schedule_1:send",
            "In-Reply-To": "<source@example.com> Bcc: leak@example.com",
            References: "<root@example.com> <source@example.com>",
          },
          disableFileAccess: true,
          disableUrlAccess: true,
        }),
      }),
    ]);
    expect(appended).toEqual([
      {
        secret: "imap-password",
        raw: expect.any(Buffer),
        sentAt: new Date("2026-06-15T12:00:00.000Z"),
      },
    ]);
    const sentMessageId = (sent[0] as { mail: { messageId: string } }).mail
      .messageId;
    const appendedRaw = appended[0].raw.toString("utf8");
    expect(appendedRaw).toContain(`Message-ID: ${sentMessageId}`);
    expect(appendedRaw).toContain("From: Alias <alias@proton.me>");
    expect(appendedRaw).toContain("To: Client <client@example.com>");
    expect(appendedRaw).toContain("Cc: team@example.com");
    expect(appendedRaw).toContain("Bcc: audit@example.com");
    expect(appendedRaw).toContain("Subject: Bridge update");
    expect(appendedRaw).toContain("Plain body");
    expect(appendedRaw).toContain(
      "In-Reply-To: <source@example.com> Bcc: leak@example.com",
    );
    expect(appendedRaw).toContain(
      "References: <root@example.com> <source@example.com>",
    );
  });

  it("keeps scheduled SMTP send successful when IMAP Sent append fails", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "smtp_msg_1" }));
    const appendSentMessage = vi.fn(async () => {
      throw new Error("append failed with imap-secret");
    });
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "custom",
            fromAddress: "me@example.com",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "smtp-user",
            smtpSecretRef: "db:smtp_secret",
            imapSecretRef: "db:imap_secret",
            sentMailboxPath: "Sent",
            imap: {
              host: "imap.example.com",
              port: 993,
              secure: true,
              username: "imap-user",
            },
            smtp: {
              host: "smtp.example.com",
              port: 587,
              secure: false,
              username: "smtp-user",
            },
          };
        },
      },
      secretStore: {
        async getSecret(secretRef) {
          return secretRef === "db:imap_secret" ? "imap-secret" : "smtp-secret";
        },
      },
      sendMail,
      sentAppender: { appendSentMessage },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_imap",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Bridge update",
        bodyText: "Plain body",
      }),
    ).resolves.toEqual({ messageId: "smtp_msg_1" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(appendSentMessage).toHaveBeenCalledTimes(1);
  });

  it("does not append to Sent when scheduled SMTP delivery fails", async () => {
    const sendMail = vi.fn(async () => {
      throw new Error("SMTP rejected message");
    });
    const appendSentMessage = vi.fn(async () => undefined);
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "custom",
            fromAddress: "me@example.com",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "smtp-user",
            smtpSecretRef: "db:smtp_secret",
            imapSecretRef: "db:imap_secret",
            imap: {
              host: "imap.example.com",
              port: 993,
              secure: true,
              username: "imap-user",
            },
            smtp: {
              host: "smtp.example.com",
              port: 587,
              secure: false,
              username: "smtp-user",
            },
          };
        },
      },
      secretStore: {
        async getSecret() {
          return "smtp-secret";
        },
      },
      sendMail,
      sentAppender: { appendSentMessage },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_imap",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Bridge update",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("SMTP rejected message");
    expect(appendSentMessage).not.toHaveBeenCalled();
  });

  it("appends scheduled sent messages to the configured IMAP Sent mailbox", async () => {
    const calls: unknown[] = [];
    const sentAt = new Date("2026-06-15T12:00:00.000Z");
    const appender = createImapSentAppender({
      async connect(options) {
        calls.push(["connect_options", options]);
        return {
          async connect() {
            calls.push("connect");
          },
          async append(path, raw, flags, idate) {
            calls.push(["append", path, raw.toString("utf8"), flags, idate]);
          },
          async logout() {
            calls.push("logout");
          },
        };
      },
    });

    await appender.appendSentMessage({
      settings: {
        accountId: "acc_imap",
        provider: "custom",
        fromAddress: "me@example.com",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "smtp-user",
        sentMailboxPath: "Sent Items",
        imap: {
          host: "imap.example.com",
          port: 993,
          secure: true,
          username: "imap-user",
        },
        smtp: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          username: "smtp-user",
        },
      },
      secret: "imap-secret",
      raw: Buffer.from("Subject: hi\r\n\r\nbody"),
      sentAt,
    });

    expect(calls).toEqual([
      [
        "connect_options",
        {
          host: "imap.example.com",
          port: 993,
          secure: true,
          auth: { user: "imap-user", pass: "imap-secret" },
          logger: false,
          disableAutoIdle: true,
        },
      ],
      "connect",
      ["append", "Sent Items", "Subject: hi\r\n\r\nbody", ["\\Seen"], sentAt],
      "logout",
    ]);
  });

  it("redacts IMAP secrets and closes the session when scheduled Sent append fails", async () => {
    const calls: string[] = [];
    const appender = createImapSentAppender({
      async connect() {
        return {
          async connect() {
            calls.push("connect");
          },
          async append() {
            throw new Error("invalid login for imap-secret");
          },
          async logout() {
            calls.push("logout");
          },
          closeAfter() {
            calls.push("closeAfter");
          },
        };
      },
    });

    await expect(
      appender.appendSentMessage({
        settings: {
          accountId: "acc_imap",
          provider: "custom",
          fromAddress: "me@example.com",
          host: "smtp.example.com",
          port: 587,
          secure: false,
          username: "smtp-user",
          imap: {
            host: "imap.example.com",
            port: 993,
            secure: true,
            username: "imap-user",
          },
          smtp: {
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "smtp-user",
          },
        },
        secret: "imap-secret",
        raw: Buffer.from("Subject: hi\r\n\r\nbody"),
        sentAt: new Date("2026-06-15T12:00:00.000Z"),
      }),
    ).rejects.toThrow("invalid login for [redacted]");
    expect(calls).toEqual(["connect", "closeAfter", "logout"]);
  });

  it("passes content-backed attachments to SMTP delivery", async () => {
    const sent: unknown[] = [];
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "custom",
            fromAddress: "me@example.com",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "me@example.com",
            secretRef: "db:smtp_secret",
            smtp: {
              host: "smtp.example.com",
              port: 587,
              secure: false,
              username: "me@example.com",
            },
          };
        },
      },
      secretStore: {
        async getSecret() {
          return "smtp-secret";
        },
      },
      async sendMail(input) {
        sent.push(input);
        return {};
      },
    });

    await transport.submitMessage({
      accountId: "acc_imap",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
      to: [{ address: "client@example.com" }],
      cc: [],
      bcc: [],
      subject: "Bridge update",
      bodyText: "Plain body",
      attachments: [
        {
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 16,
          inline: false,
          providerAttachmentId: "ee_attachment_1",
          contentBase64: Buffer.from("hello attachment").toString("base64"),
        },
      ],
    });

    expect(sent).toEqual([
      expect.objectContaining({
        mail: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              filename: "proposal.pdf",
              contentType: "application/pdf",
              content: Buffer.from("hello attachment"),
              contentDisposition: "attachment",
            }),
          ],
        }),
      }),
    ]);
  });

  it("rejects SMTP attachment references without content bytes", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "smtp_msg_1" }));
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "custom",
            fromAddress: "me@example.com",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "me@example.com",
            secretRef: "db:smtp_secret",
            smtp: {
              host: "smtp.example.com",
              port: 587,
              secure: false,
              username: "me@example.com",
            },
          };
        },
      },
      secretStore: {
        async getSecret() {
          return "smtp-secret";
        },
      },
      sendMail,
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_imap",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Bridge update",
        bodyText: "Plain body",
        attachments: [
          {
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
            inline: false,
            providerAttachmentId: "ee_attachment_1",
          },
        ],
      }),
    ).rejects.toThrow("SMTP attachment content is unavailable");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects SMTP addresses with header injection characters", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "smtp_msg_1" }));
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "custom",
            fromAddress: "me@example.com",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "me@example.com",
            secretRef: "db:smtp_secret",
            smtp: {
              host: "smtp.example.com",
              port: 587,
              secure: false,
              username: "me@example.com",
            },
          };
        },
      },
      secretStore: {
        async getSecret() {
          return "smtp-secret";
        },
      },
      sendMail,
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_imap",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
        to: [{ address: "client@example.com\r\nBcc: leak@example.com" }],
        cc: [],
        bcc: [],
        subject: "Bridge update",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("SMTP address is invalid");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("marks auth failures for password reauthorization with redacted errors", async () => {
    const markRequired = vi.fn(async () => ({ taskId: "task_reauth_1" }));
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "163",
            fromAddress: "me@163.com",
            host: "smtp.163.com",
            port: 465,
            secure: true,
            username: "me@163.com",
            secretRef: "db:smtp_secret",
            smtp: {
              host: "smtp.163.com",
              port: 465,
              secure: true,
              username: "me@163.com",
            },
          };
        },
      },
      secretStore: {
        async getSecret() {
          return "netease-auth-code";
        },
      },
      async sendMail() {
        throw Object.assign(new Error("EAUTH netease-auth-code rejected"), {
          code: "EAUTH",
        });
      },
      reauthorizationMarker: { markRequired },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_imap",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Status",
        bodyText: "Ready",
      }),
    ).rejects.toThrow("EAUTH [redacted] rejected");
    expect(markRequired).toHaveBeenCalledWith({
      accountId: "acc_imap",
      reason: "EAUTH [redacted] rejected",
    });
  });

  it("creates password reauthorization tasks with endpoint payloads", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const marker = createPostgresSmtpSendReauthorizationMarker({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          return { rows: [{ task_id: "task_reauth_1" }] };
        },
      },
      createId: () => "task_reauth_1",
    });

    await expect(
      marker.markRequired({
        accountId: "acc_imap",
        reason: "EAUTH rejected",
      }),
    ).resolves.toEqual({ taskId: "task_reauth_1" });

    expect(queries[0].text).toMatch(/auth_method = 'password'/i);
    expect(queries[0].text).toMatch(/'source', 'native_smtp_send'/i);
    expect(queries[0].text).toMatch(/settings -> 'imap'/i);
    expect(queries[0].text).toMatch(/settings -> 'smtp'/i);
    expect(queries[0].values).toEqual([
      "acc_imap",
      "task_reauth_1",
      "EAUTH rejected",
    ]);
  });
});
