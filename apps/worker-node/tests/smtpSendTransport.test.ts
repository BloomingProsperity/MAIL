import { describe, expect, it, vi } from "vitest";

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
                },
                smtp: {
                  host: "smtp.custom.example",
                  port: 587,
                  secure: false,
                  username: "smtp-user",
                },
              },
              secret_ref: "db:smtp_secret",
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
          expect(secretRef).toBe("db:bridge_secret");
          return "bridge-password";
        },
      },
      async sendMail(input) {
        sent.push(input);
        return {};
      },
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
    });

    expect(result.messageId).toMatch(/^<[a-f0-9]{32}@emailhub\.local>$/);
    expect(sent).toEqual([
      expect.objectContaining({
        secret: "bridge-password",
        mail: expect.objectContaining({
          from: '"Alias" <alias@proton.me>',
          to: '"Client" <client@example.com>',
          cc: "team@example.com",
          bcc: "audit@example.com",
          envelope: {
            from: "me@proton.me",
            to: ["client@example.com", "team@example.com", "audit@example.com"],
          },
          disableFileAccess: true,
          disableUrlAccess: true,
        }),
      }),
    ]);
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
