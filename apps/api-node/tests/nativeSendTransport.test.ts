import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

import {
  createConfiguredNativeSendTransport,
  createNativeSendTransport,
  createPostgresNativeAccountSettingsStore,
} from "../src/native-send/native-send-transport";
import { createImapSentAppender } from "../src/native-send/imap-sent-appender";
import { NativeProviderSubmitError } from "../src/native-send/provider-submit-clients";
import { createPostgresNativeSendReauthorizationMarker } from "../src/native-send/reauthorization-marker";
import {
  createPostgresSmtpAccountSendSettingsStore,
  createPostgresSmtpSendReauthorizationMarker,
  createSmtpNativeSendTransport,
} from "../src/native-send/smtp-send-transport";

describe("API native send transport", () => {
  it("routes Gmail native sends through Gmail messages.send with RFC 2822 MIME", async () => {
    const sendMessage = vi.fn(async () => ({ id: "gmail_msg_1" }));
    const sendMail = vi.fn(async () => ({}));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "gmail";
        },
      },
      gmail: { sendMessage },
      graph: { sendMail },
      smtp: noopSmtpTransport(),
      createBoundary: () => "boundary_1",
    });

    const result = await transport.submitMessage({
      accountId: "acc_gmail",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      from: { address: "support@demo.site", name: "Support" },
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [{ address: "team@example.com" }],
      bcc: [],
      subject: "Launch plan",
      bodyText: "Plain body",
      bodyHtml: "<p>HTML body</p>",
    });

    const raw = sendMessage.mock.calls[0][0].raw;
    const decoded = decodeBase64Url(raw);
    expect(result).toEqual({ messageId: "gmail_msg_1" });
    expect(decoded).toContain('From: "Support" <support@demo.site>');
    expect(decoded).toContain('To: "Lina" <lina@example.com>');
    expect(decoded).toContain("Cc: team@example.com");
    expect(decoded).toContain("Subject: Launch plan");
    expect(decoded).toContain('Content-Type: multipart/alternative; boundary="boundary_1"');
    expect(decoded).toContain("Plain body");
    expect(decoded).toContain("<p>HTML body</p>");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("includes content-backed attachments in Gmail native MIME", async () => {
    const sendMessage = vi.fn(async () => ({ id: "gmail_msg_1" }));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "gmail";
        },
      },
      gmail: { sendMessage },
      graph: { sendMail: vi.fn(async () => ({})) },
      smtp: noopSmtpTransport(),
      createBoundary: () => "boundary_1",
    });

    await transport.submitMessage({
      accountId: "acc_gmail",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Launch plan",
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

    const decoded = decodeBase64Url(sendMessage.mock.calls[0][0].raw);
    expect(decoded).toContain('Content-Type: multipart/mixed; boundary="boundary_1"');
    expect(decoded).toContain(
      'Content-Disposition: attachment; filename="proposal.pdf"',
    );
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    expect(decoded).toContain(
      Buffer.from("hello attachment").toString("base64"),
    );
  });

  it("rejects native attachment references without content bytes", async () => {
    const sendMessage = vi.fn(async () => ({ id: "gmail_msg_1" }));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "gmail";
        },
      },
      gmail: { sendMessage },
      graph: { sendMail: vi.fn(async () => ({})) },
      smtp: noopSmtpTransport(),
      createBoundary: () => "boundary_1",
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_gmail",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
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
    ).rejects.toThrow("native send attachment content is unavailable");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("adds Gmail reply headers and threadId for threaded replies", async () => {
    const sendMessage = vi.fn(async () => ({ id: "gmail_msg_1" }));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "gmail";
        },
      },
      gmail: { sendMessage },
      graph: { sendMail: vi.fn(async () => ({})) },
      smtp: noopSmtpTransport(),
      createBoundary: () => "boundary_1",
    });

    await transport.submitMessage({
      accountId: "acc_gmail",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Re: Launch plan",
      bodyText: "Thanks.",
      threading: {
        action: "reply",
        inReplyTo: "<source@example.com>",
        references: ["<root@example.com>", "<source@example.com>"],
        gmailThreadId: "gmail_thread_1",
      },
    });

    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      accountId: "acc_gmail",
      threadId: "gmail_thread_1",
    });
    const decoded = decodeBase64Url(sendMessage.mock.calls[0][0].raw);
    expect(decoded).toContain("In-Reply-To: <source@example.com>");
    expect(decoded).toContain(
      "References: <root@example.com> <source@example.com>",
    );
  });

  it("routes Graph native sends through Microsoft Graph sendMail", async () => {
    const sendMessage = vi.fn(async () => ({ id: "gmail_msg_1" }));
    const sendMail = vi.fn(async () => ({}));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "graph";
        },
      },
      gmail: { sendMessage },
      graph: { sendMail },
      smtp: noopSmtpTransport(),
    });

    await transport.submitMessage({
      accountId: "acc_graph",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      from: { address: "support@demo.site", name: "Support" },
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [],
      bcc: [{ address: "audit@example.com" }],
      subject: "Launch plan",
      bodyText: "Plain body",
    });

    expect(sendMail).toHaveBeenCalledWith({
      accountId: "acc_graph",
      message: {
        subject: "Launch plan",
        from: {
          emailAddress: { address: "support@demo.site", name: "Support" },
        },
        body: {
          contentType: "Text",
          content: "Plain body",
        },
        toRecipients: [
          { emailAddress: { address: "lina@example.com", name: "Lina" } },
        ],
        ccRecipients: [],
        bccRecipients: [
          { emailAddress: { address: "audit@example.com" } },
        ],
      },
      saveToSentItems: true,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends Graph threaded replies as base64 MIME with reply headers", async () => {
    const sendMail = vi.fn(async () => ({}));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "graph";
        },
      },
      gmail: { sendMessage: vi.fn(async () => ({})) },
      graph: { sendMail },
      smtp: noopSmtpTransport(),
      createBoundary: () => "boundary_1",
    });

    await transport.submitMessage({
      accountId: "acc_graph",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      from: { address: "support@demo.site", name: "Support" },
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Re: Launch plan",
      bodyText: "Thanks.",
      threading: {
        action: "reply",
        inReplyTo: "<source@example.com>",
        references: ["<root@example.com>", "<source@example.com>"],
        graphMessageId: "graph_msg_1",
      },
    });

    expect(sendMail).toHaveBeenCalledWith({
      accountId: "acc_graph",
      mime: expect.any(String),
    });
    const decoded = decodeBase64(sendMail.mock.calls[0][0].mime);
    expect(decoded).toContain('From: "Support" <support@demo.site>');
    expect(decoded).toContain("In-Reply-To: <source@example.com>");
    expect(decoded).toContain(
      "References: <root@example.com> <source@example.com>",
    );
    expect(decoded).toContain("Thanks.");
  });

  it("sends Graph content-backed attachments as MIME", async () => {
    const sendMail = vi.fn(async () => ({}));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "graph";
        },
      },
      gmail: { sendMessage: vi.fn(async () => ({})) },
      graph: { sendMail },
      smtp: noopSmtpTransport(),
      createBoundary: () => "boundary_1",
    });

    await transport.submitMessage({
      accountId: "acc_graph",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Launch plan",
      bodyText: "Plain body",
      attachments: [
        {
          filename: "brief.txt",
          contentType: "text/plain",
          byteSize: 5,
          inline: false,
          providerAttachmentId: "ee_attachment_1",
          contentBase64: "aGVsbG8=",
        },
      ],
    });

    expect(sendMail).toHaveBeenCalledWith({
      accountId: "acc_graph",
      mime: expect.any(String),
    });
    const decoded = decodeBase64(sendMail.mock.calls[0][0].mime);
    expect(decoded).toContain('Content-Type: multipart/mixed; boundary="boundary_1"');
    expect(decoded).toContain('Content-Disposition: attachment; filename="brief.txt"');
    expect(decoded).toContain("aGVsbG8=");
  });

  it("routes IMAP native sends through SMTP transport", async () => {
    const submitMessage = vi.fn(async () => ({ messageId: "smtp_msg_1" }));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "imap";
        },
      },
      gmail: { sendMessage: vi.fn(async () => ({})) },
      graph: { sendMail: vi.fn(async () => ({})) },
      smtp: { submitMessage },
    });

    const message = {
      accountId: "acc_imap",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Launch plan",
      bodyText: "Plain body",
    };

    await expect(transport.submitMessage(message)).resolves.toEqual({
      messageId: "smtp_msg_1",
    });
    expect(submitMessage).toHaveBeenCalledWith(message);
  });

  it("marks native accounts for reauthorization on provider permission failures", async () => {
    const markRequired = vi.fn(async () => ({ taskId: "task_reauth_1" }));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "graph";
        },
      },
      gmail: { sendMessage: vi.fn(async () => ({})) },
      graph: {
        sendMail: vi.fn(async () => {
          throw new NativeProviderSubmitError(
            "Microsoft Graph",
            403,
            "ErrorAccessDenied",
          );
        }),
      },
      smtp: noopSmtpTransport(),
      reauthorizationMarker: { markRequired },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_graph",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("Microsoft Graph send failed: 403 ErrorAccessDenied");
    expect(markRequired).toHaveBeenCalledWith({
      accountId: "acc_graph",
      provider: "outlook",
      reason: "Microsoft Graph 403 ErrorAccessDenied",
    });
  });

  it("does not mark accounts for reauthorization on transient provider failures", async () => {
    const markRequired = vi.fn(async () => ({ taskId: "task_reauth_1" }));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "gmail";
        },
      },
      gmail: {
        sendMessage: vi.fn(async () => {
          throw new NativeProviderSubmitError("Gmail", 500, "backendError");
        }),
      },
      graph: { sendMail: vi.fn(async () => ({})) },
      smtp: noopSmtpTransport(),
      reauthorizationMarker: { markRequired },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_gmail",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("Gmail send failed: 500 backendError");
    expect(markRequired).not.toHaveBeenCalled();
  });

  it("loads native provider settings from Postgres", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresNativeAccountSettingsStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [{ native_provider: "gmail" }] };
      },
    });

    await expect(store.getNativeProvider("acc_1")).resolves.toBe("gmail");
    expect(queries[0].text).toMatch(/FROM account_provider_settings/i);
    expect(queries[0].values).toEqual(["acc_1"]);
  });

  it("loads native SMTP settings with SMTP credential preference", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresSmtpAccountSendSettingsStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              account_id: "acc_imap",
              email: "support@qq.com",
              display_name: "Support",
              provider: "qq",
              settings: {
                imap: {
                  host: "imap.qq.com",
                  port: 993,
                  secure: true,
                  username: "support@qq.com",
                  sentMailboxPath: "Sent Messages",
                },
                smtp: {
                  host: "smtp.qq.com",
                  port: 465,
                  secure: true,
                  username: "support@qq.com",
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

    await expect(store.getSettings("acc_imap")).resolves.toEqual({
      accountId: "acc_imap",
      provider: "qq",
      fromAddress: "support@qq.com",
      fromName: "Support",
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      username: "support@qq.com",
      secretRef: "db:smtp_secret",
      smtpSecretRef: "db:smtp_secret",
      imapSecretRef: "db:imap_secret",
      sentMailboxPath: "Sent",
      imap: {
        host: "imap.qq.com",
        port: 993,
        secure: true,
        username: "support@qq.com",
      },
      smtp: {
        host: "smtp.qq.com",
        port: 465,
        secure: true,
        username: "support@qq.com",
      },
    });
    expect(queries[0].text).toMatch(/smtp_credential\.credential_kind = \$2/i);
    expect(queries[0].text).toMatch(/imap_credential\.credential_kind = \$3/i);
    expect(queries[0].values).toEqual([
      "acc_imap",
      "smtp_password",
      "imap_password",
    ]);
  });

  it("sends native IMAP accounts through SMTP with safe envelope and deterministic Message-ID", async () => {
    const sent: unknown[] = [];
    const appended: Array<{ secret: string; raw: Buffer; sentAt: Date }> = [];
    const operations: string[] = [];
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "qq",
            fromAddress: "support@qq.com",
            fromName: "Support",
            host: "smtp.qq.com",
            port: 465,
            secure: true,
            username: "support@qq.com",
            secretRef: "db:smtp_secret",
            smtpSecretRef: "db:smtp_secret",
            imapSecretRef: "db:imap_secret",
            sentMailboxPath: "Sent",
            imap: {
              host: "imap.qq.com",
              port: 993,
              secure: true,
              username: "support@qq.com",
            },
            smtp: {
              host: "smtp.qq.com",
              port: 465,
              secure: true,
              username: "support@qq.com",
            },
          };
        },
      },
      secretStore: {
        async getSecret(secretRef) {
          if (secretRef === "db:smtp_secret") {
            return "smtp-auth-code";
          }
          if (secretRef === "db:imap_secret") {
            return "imap-auth-code";
          }
          throw new Error(`unexpected secret ref: ${secretRef}`);
        },
      },
      async sendMail(input) {
        operations.push("send");
        sent.push(input);
        return { messageId: "smtp_provider_msg_1" };
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

    await expect(
      transport.submitMessage({
        accountId: "acc_imap",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        from: { address: "sales@qq.com", name: "Sales" },
        to: [{ address: "client@example.com", name: "Client" }],
        cc: [{ address: "team@example.com" }],
        bcc: [{ address: "audit@example.com" }],
        subject: "上线计划",
        bodyText: "Plain body",
        bodyHtml: "<p>HTML body</p>",
        threading: {
          action: "reply",
          inReplyTo: "<source@example.com>\r\nBcc: leak@example.com",
          references: [
            "<root@example.com>",
            "<source@example.com>",
            "<source@example.com>",
          ],
        },
      }),
    ).resolves.toEqual({ messageId: "smtp_provider_msg_1" });

    expect(operations).toEqual(["send", "append"]);
    expect(sent).toEqual([
      expect.objectContaining({
        secret: "smtp-auth-code",
        settings: expect.objectContaining({
          host: "smtp.qq.com",
          port: 465,
          secure: true,
        }),
        mail: expect.objectContaining({
          from: '"Sales" <sales@qq.com>',
          to: '"Client" <client@example.com>',
          cc: "team@example.com",
          bcc: "audit@example.com",
          subject: "上线计划",
          text: "Plain body",
          html: "<p>HTML body</p>",
          messageId: expect.stringMatching(/^<[a-f0-9]{32}@emailhub\.local>$/),
          envelope: {
            from: "support@qq.com",
            to: ["client@example.com", "team@example.com", "audit@example.com"],
          },
          headers: {
            "X-EmailHub-Idempotency-Key": "compose:draft_1:send",
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
        secret: "imap-auth-code",
        raw: expect.any(Buffer),
        sentAt: new Date("2026-06-15T12:00:00.000Z"),
      },
    ]);
    const sentMessageId = (sent[0] as { mail: { messageId: string } }).mail
      .messageId;
    const appendedRaw = appended[0].raw.toString("utf8");
    expect(appendedRaw).toContain(`Message-ID: ${sentMessageId}`);
    expect(appendedRaw).toContain("From: Sales <sales@qq.com>");
    expect(appendedRaw).toContain("To: Client <client@example.com>");
    expect(appendedRaw).toContain("Cc: team@example.com");
    expect(appendedRaw).toContain("Bcc: audit@example.com");
    expect(appendedRaw).toContain("Subject:");
    expect(appendedRaw).toContain("Plain body");
    expect(appendedRaw).toContain("<p>HTML body</p>");
    expect(appendedRaw).toContain(
      "In-Reply-To: <source@example.com> Bcc: leak@example.com",
    );
    expect(appendedRaw).toContain(
      "References: <root@example.com> <source@example.com>",
    );
  });

  it("keeps SMTP send successful when IMAP Sent append fails", async () => {
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
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).resolves.toEqual({ messageId: "smtp_msg_1" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(appendSentMessage).toHaveBeenCalledTimes(1);
  });

  it("does not append to Sent when SMTP delivery fails", async () => {
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
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("SMTP rejected message");
    expect(appendSentMessage).not.toHaveBeenCalled();
  });

  it("appends sent messages to the configured IMAP Sent mailbox", async () => {
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

  it("redacts IMAP secrets and closes the session when Sent append fails", async () => {
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

  it("passes content-backed attachments to native SMTP", async () => {
    const sent: unknown[] = [];
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "custom",
            fromAddress: "support@example.com",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "support@example.com",
            secretRef: "db:smtp_secret",
            smtp: {
              host: "smtp.example.com",
              port: 587,
              secure: false,
              username: "support@example.com",
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
        return { messageId: "smtp_msg_1" };
      },
    });

    await transport.submitMessage({
      accountId: "acc_imap",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "client@example.com" }],
      cc: [],
      bcc: [],
      subject: "Launch plan",
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

  it("rejects native SMTP attachment references without content bytes", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "smtp_msg_1" }));
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "custom",
            fromAddress: "support@example.com",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "support@example.com",
            secretRef: "db:smtp_secret",
            smtp: {
              host: "smtp.example.com",
              port: 587,
              secure: false,
              username: "support@example.com",
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
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
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
            fromAddress: "support@example.com",
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "support@example.com",
            secretRef: "db:smtp_secret",
            smtp: {
              host: "smtp.example.com",
              port: 587,
              secure: false,
              username: "support@example.com",
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
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "client@example.com\r\nBcc: leak@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("SMTP address is invalid");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("marks password SMTP auth failures for reauthorization without leaking secrets", async () => {
    const markRequired = vi.fn(async () => ({ taskId: "task_reauth_1" }));
    const transport = createSmtpNativeSendTransport({
      settingsStore: {
        async getSettings() {
          return {
            accountId: "acc_imap",
            provider: "qq",
            fromAddress: "support@qq.com",
            host: "smtp.qq.com",
            port: 465,
            secure: true,
            username: "support@qq.com",
            secretRef: "db:smtp_secret",
            smtp: {
              host: "smtp.qq.com",
              port: 465,
              secure: true,
              username: "support@qq.com",
            },
          };
        },
      },
      secretStore: {
        async getSecret() {
          return "smtp-auth-code";
        },
      },
      async sendMail() {
        throw Object.assign(
          new Error("535 invalid smtp-auth-code for support@qq.com"),
          { code: "EAUTH" },
        );
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
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("535 invalid [redacted] for support@qq.com");
    expect(markRequired).toHaveBeenCalledWith({
      accountId: "acc_imap",
      reason: "535 invalid [redacted] for support@qq.com",
    });
  });

  it("marks password SMTP accounts as reauthorization required in Postgres", async () => {
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
        reason: "535 auth failed",
      }),
    ).resolves.toEqual({ taskId: "task_reauth_1" });
    expect(queries[0].text).toMatch(/auth_method = 'password'/i);
    expect(queries[0].text).toMatch(/sync_state = 'reauth_required'/i);
    expect(queries[0].text).toMatch(/'source', 'native_smtp_send'/i);
    expect(queries[0].text).toMatch(/settings -> 'smtp'/i);
    expect(queries[0].values).toEqual([
      "acc_imap",
      "task_reauth_1",
      "535 auth failed",
    ]);
  });

  it("marks OAuth native send accounts as reauthorization required in Postgres", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const marker = createPostgresNativeSendReauthorizationMarker({
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
        accountId: "acc_gmail",
        provider: "gmail",
        reason: "Gmail 403 PERMISSION_DENIED",
      }),
    ).resolves.toEqual({ taskId: "task_reauth_1" });
    expect(queries[0].text).toMatch(/UPDATE connected_accounts/i);
    expect(queries[0].text).toMatch(/sync_state = 'reauth_required'/i);
    expect(queries[0].text).toMatch(/INSERT INTO onboarding_tasks/i);
    expect(queries[0].text).toMatch(/'source', 'native_send'/i);
    expect(queries[0].values).toEqual([
      "acc_gmail",
      "task_reauth_1",
      "Gmail 403 PERMISSION_DENIED",
    ]);
  });

  it("refreshes a Gmail access token from stored credentials before provider submit", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth.example/token") {
        expect(String(init?.body)).toContain("refresh_token=refresh-token-1");
        return jsonResponse({
          access_token: "access-token-1",
          expires_in: 3600,
        });
      }

      expect(url).toBe("https://gmail.example/users/me/messages/send");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer access-token-1",
        "content-type": "application/json",
      });
      return jsonResponse({ id: "gmail_msg_1" });
    });
    const transport = createConfiguredNativeSendTransport({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes("account_provider_settings")) {
            return { rows: [{ native_provider: "gmail" }] };
          }
          if (text.includes("account_credentials")) {
            return { rows: [{ secret_ref: "db:refresh_1" }] };
          }
          if (text.includes("stored_secrets")) {
            return { rows: [{ secret_value: "refresh-token-1" }] };
          }
          throw new Error(`unexpected query: ${text}`);
        },
      },
      createId: () => "task_reauth_1",
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
        GOOGLE_OAUTH_TOKEN_URL: "https://oauth.example/token",
        GMAIL_API_BASE_URL: "https://gmail.example",
      },
      fetchImpl: fetchMock as any,
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_gmail",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).resolves.toEqual({ messageId: "gmail_msg_1" });
    expect(queries.map((query) => query.values)).toEqual([
      ["acc_gmail"],
      ["acc_gmail", "google_oauth_refresh_token"],
      ["db:refresh_1"],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates a reauthorization task when OAuth refresh is rejected during native send", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://oauth.example/token");
      return jsonResponse({ error: "invalid_grant" }, 400);
    });
    const transport = createConfiguredNativeSendTransport({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes("account_provider_settings")) {
            return { rows: [{ native_provider: "gmail" }] };
          }
          if (text.includes("account_credentials")) {
            return { rows: [{ secret_ref: "db:refresh_1" }] };
          }
          if (text.includes("stored_secrets")) {
            return { rows: [{ secret_value: "refresh-token-1" }] };
          }
          if (text.includes("UPDATE connected_accounts")) {
            return { rows: [{ task_id: "task_reauth_1" }] };
          }
          throw new Error(`unexpected query: ${text}`);
        },
      },
      createId: () => "task_reauth_1",
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
        GOOGLE_OAUTH_TOKEN_URL: "https://oauth.example/token",
        GMAIL_API_BASE_URL: "https://gmail.example",
      },
      fetchImpl: fetchMock as any,
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_gmail",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("native access token unavailable");
    expect(queries.at(-1)?.text).toMatch(/sync_state = 'reauth_required'/i);
    expect(queries.at(-1)?.values).toEqual([
      "acc_gmail",
      "task_reauth_1",
      "native access token unavailable for account acc_gmail: OAuth refresh failed: 400 invalid_grant",
    ]);
  });

  it("creates a reauthorization task when native send is missing a refresh credential", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const transport = createConfiguredNativeSendTransport({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes("account_provider_settings")) {
            return { rows: [{ native_provider: "gmail" }] };
          }
          if (text.includes("account_credentials")) {
            return { rows: [] };
          }
          if (text.includes("UPDATE connected_accounts")) {
            return { rows: [{ task_id: "task_reauth_1" }] };
          }
          throw new Error(`unexpected query: ${text}`);
        },
      },
      createId: () => "task_reauth_1",
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
        GOOGLE_OAUTH_TOKEN_URL: "https://oauth.example/token",
        GMAIL_API_BASE_URL: "https://gmail.example",
      },
      fetchImpl: async () => {
        throw new Error("should not call Gmail without a refresh credential");
      },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_gmail",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow(
      "missing google_oauth_refresh_token credential for account acc_gmail",
    );
    expect(queries.at(-1)?.text).toMatch(/sync_state = 'reauth_required'/i);
    expect(queries.at(-1)?.values).toEqual([
      "acc_gmail",
      "task_reauth_1",
      "missing google_oauth_refresh_token credential for account acc_gmail",
    ]);
  });

  it("configured transport sends native IMAP accounts through SMTP settings and secrets", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const sent: unknown[] = [];
    const appended: unknown[] = [];
    const transport = createConfiguredNativeSendTransport({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes("SELECT native_provider")) {
            return { rows: [{ native_provider: "imap" }] };
          }
          if (text.includes("COALESCE(smtp_credential.secret_ref")) {
            return {
              rows: [
                {
                  account_id: "acc_imap",
                  email: "support@qq.com",
                  display_name: "Support",
                  provider: "qq",
                  settings: {
                    imap: {
                      host: "imap.qq.com",
                      port: 993,
                      secure: true,
                      username: "support@qq.com",
                    },
                    smtp: {
                      host: "smtp.qq.com",
                      port: 465,
                      secure: true,
                      username: "support@qq.com",
                    },
                  },
                  secret_ref: "db:smtp_secret",
                  smtp_secret_ref: "db:smtp_secret",
                  imap_secret_ref: "db:imap_secret",
                  sent_mailbox_path: "Sent",
                },
              ],
            };
          }
          if (text.includes("stored_secrets")) {
            return {
              rows: [
                {
                  secret_value:
                    values?.[0] === "db:imap_secret"
                      ? "imap-auth-code"
                      : "smtp-auth-code",
                },
              ],
            };
          }
          throw new Error(`unexpected query: ${text}`);
        },
      },
      createId: () => "task_reauth_1",
      async smtpSendMail(input) {
        sent.push(input);
        return { messageId: "smtp_msg_1" };
      },
      smtpSentAppender: {
        async appendSentMessage(input) {
          appended.push(input);
        },
      },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_imap",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).resolves.toEqual({ messageId: "smtp_msg_1" });
    expect(queries.some((query) => query.text.includes("stored_secrets"))).toBe(
      true,
    );
    expect(sent).toEqual([
      expect.objectContaining({
        secret: "smtp-auth-code",
        mail: expect.objectContaining({
          from: '"Support" <support@qq.com>',
          to: "client@example.com",
        }),
      }),
    ]);
    expect(appended).toEqual([
      expect.objectContaining({
        secret: "imap-auth-code",
        raw: expect.any(Buffer),
        settings: expect.objectContaining({
          sentMailboxPath: "Sent",
        }),
      }),
    ]);
    const settingsQuery = queries.find((query) =>
      query.text.includes("connected_accounts.email"),
    );
    expect(settingsQuery?.text).not.toMatch(/secret_value/i);
  });
});

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noopSmtpTransport() {
  return {
    async submitMessage() {
      return {};
    },
  };
}
