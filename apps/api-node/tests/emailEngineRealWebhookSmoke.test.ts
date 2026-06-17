import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendSmtpSmokeMessage } from "../src/mail-engine/greenmail-smtp-smoke";
import { runEmailEngineRealWebhookSmoke } from "../src/mail-engine/real-webhook-smoke";

let smtpServer: Server | undefined;

afterEach(async () => {
  if (!smtpServer) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    smtpServer!.close((error) => (error ? reject(error) : resolve()));
  });
  smtpServer = undefined;
});

describe("GreenMail SMTP smoke delivery", () => {
  it("delivers a uniquely identifiable message through a real SMTP socket", async () => {
    const receivedCommands: string[] = [];
    let receivedData = "";

    const port = await startSmtpServer({
      onCommand(command) {
        receivedCommands.push(command);
      },
      onData(data) {
        receivedData = data;
      },
    });

    const result = await sendSmtpSmokeMessage({
      host: "127.0.0.1",
      port,
      from: "emailhub-smoke@example.com",
      to: "support@example.com",
      messageId: "emailhub-real-webhook-unique_1@emailhub-smoke.local",
      subject: "[EmailHub Smoke] unique_1",
      text: "real webhook smoke unique_1",
      timeoutMs: 2000,
    });

    expect(result).toEqual({
      host: "127.0.0.1",
      port,
      to: "support@example.com",
      messageId: "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
    });
    expect(receivedCommands).toEqual([
      "EHLO emailhub-smoke.local",
      "MAIL FROM:<emailhub-smoke@example.com>",
      "RCPT TO:<support@example.com>",
      "DATA",
      "QUIT",
    ]);
    expect(receivedData).toContain(
      "Message-ID: <emailhub-real-webhook-unique_1@emailhub-smoke.local>",
    );
    expect(receivedData).toContain("Subject: [EmailHub Smoke] unique_1");
    expect(receivedData).toContain("real webhook smoke unique_1");
  });

  it("can deliver a smoke attachment as multipart MIME", async () => {
    let receivedData = "";
    const port = await startSmtpServer({
      onCommand() {},
      onData(data) {
        receivedData = data;
      },
    });

    await sendSmtpSmokeMessage({
      host: "127.0.0.1",
      port,
      from: "emailhub-smoke@example.com",
      to: "support@example.com",
      messageId: "emailhub-attachment-unique_1@emailhub-smoke.local",
      subject: "[EmailHub Attachment Smoke] unique_1",
      text: "attachment smoke unique_1",
      attachments: [
        {
          filename: "brief.txt",
          contentType: "text/plain",
          content: "attachment bytes unique_1",
        },
      ],
      timeoutMs: 2000,
    });

    expect(receivedData).toContain("Content-Type: multipart/mixed;");
    expect(receivedData).toContain(
      'Content-Disposition: attachment; filename="brief.txt"',
    );
    expect(receivedData).toContain("Content-Transfer-Encoding: base64");
    expect(receivedData).toContain(
      Buffer.from("attachment bytes unique_1").toString("base64"),
    );
  });
});

describe("real EmailEngine webhook smoke", () => {
  it("redacts failed sync center response details before onboarding reuse", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: "failed http://user:secret@10.0.0.20:8080/path?token=abc github_pat_abc password=hunter2",
          authorization: "Bearer raw-token",
          secret: "smoke-secret",
        },
        503,
      ),
    );

    await expectSanitizedSmokeFailure(
      runEmailEngineRealWebhookSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: smokePayload(),
        deliverySmtp: {
          host: "127.0.0.1",
          port: 3025,
        },
        fetchImpl: fetchImpl as typeof fetch,
        reuseExistingReadyAccount: true,
      }),
      "EmailEngine real webhook smoke sync center returned 503",
    );
  });

  it("onboards a GreenMail account, delivers a message, and waits for message_upserted diagnostics", async () => {
    let diagnosticsCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=acc_1&lane=sync&limit=50"
      ) {
        diagnosticsCalls += 1;
        return jsonResponse({
          items:
            diagnosticsCalls === 1
              ? [
                  {
                    id: "evt_sync_requested",
                    occurredAt: "2026-06-15T10:00:00.000Z",
                    service: "email-hub-api",
                    level: "info",
                    accountId: "acc_1",
                    lane: "sync",
                    event: "emailengine_webhook_ingested",
                    jobId: "job_initial",
                    context: {
                      duplicate: false,
                      mailEngineEventKind: "sync_requested",
                      syncJobId: "job_initial",
                      syncJobType: "sync_account",
                    },
                  },
                ]
              : [
                  {
                    id: "evt_duplicate",
                    occurredAt: "2026-06-15T10:00:02.000Z",
                    service: "email-hub-api",
                    level: "debug",
                    accountId: "acc_1",
                    lane: "sync",
                    event: "emailengine_webhook_ingested",
                    context: {
                      duplicate: true,
                      mailEngineEventKind: "message_upserted",
                    },
                  },
                  {
                    id: "evt_other_message",
                    occurredAt: "2026-06-15T10:00:02.500Z",
                    service: "email-hub-api",
                    level: "info",
                    accountId: "acc_1",
                    lane: "sync",
                    event: "emailengine_webhook_ingested",
                    jobId: "job_other",
                    context: {
                      duplicate: false,
                      mailEngineEventId: "mail_event_other",
                      mailEngineEventKind: "message_upserted",
                      mailEngineIdempotencyKey: "emailengine:acc_1:messageNew:other",
                      rfcMessageId:
                        "<emailhub-real-webhook-other@emailhub-smoke.local>",
                      syncJobId: "job_other",
                      syncJobType: "sync_account",
                    },
                  },
                  {
                    id: "evt_message",
                    occurredAt: "2026-06-15T10:00:03.000Z",
                    service: "email-hub-api",
                    level: "info",
                    accountId: "acc_1",
                    lane: "sync",
                    event: "emailengine_webhook_ingested",
                    jobId: "job_webhook",
                    context: {
                      duplicate: false,
                      mailEngineEventId: "mail_event_1",
                      mailEngineEventKind: "message_upserted",
                      mailEngineIdempotencyKey: "emailengine:acc_1:messageNew:abc",
                      rfcMessageId:
                        "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
                      syncJobId: "job_webhook",
                      syncJobType: "sync_account",
                    },
                  },
                ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_read_1",
              accountId: "acc_1",
              subject: "[EmailHub Real Webhook Smoke] unique_1",
              from: { email: "emailhub-smoke@example.com" },
              receivedAt: "2026-06-15T10:00:04.000Z",
              unread: true,
              starred: false,
              mailboxIds: ["inbox"],
              attachmentCount: 0,
              classification: {
                bucket: "P4 FYI / Updates",
                priorityScore: 0,
                reasons: [],
              },
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages/message_read_1"
      ) {
        return jsonResponse({
          id: "message_read_1",
          accountId: "acc_1",
          subject: "[EmailHub Real Webhook Smoke] unique_1",
          from: { email: "emailhub-smoke@example.com" },
          to: ["support@example.com"],
          cc: [],
          receivedAt: "2026-06-15T10:00:04.000Z",
          snippet: "Email Hub real webhook smoke. uniqueId=unique_1",
          bodyText: "Email Hub real webhook smoke.\nuniqueId=unique_1",
          unread: true,
          starred: false,
          mailboxIds: ["inbox"],
          attachmentCount: 0,
          attachments: [],
          classification: {
            bucket: "P4 FYI / Updates",
            priorityScore: 0,
            reasons: [],
          },
        });
      }

      throw new Error(`unexpected smoke URL ${requestUrl}`);
    });
    const runOnboarding = vi.fn(async () => ({
      email: "support@example.com",
      provider: "custom_domain",
      accountId: "acc_1",
      syncJobId: "job_initial",
      syncJobStatus: "queued",
    }));
    const sendMessage = vi.fn(async (input) => ({
      host: input.host,
      port: input.port,
      to: input.to,
      messageId: `<${input.messageId}>`,
    }));

    const result = await runEmailEngineRealWebhookSmoke({
      apiBaseUrl: "http://127.0.0.1:8080/",
      payload: {
        email: "support@example.com",
        provider: "custom_domain",
        displayName: "Smoke Mailbox",
        imap: {
          host: "greenmail-test",
          port: 3143,
          secure: false,
          username: "support@example.com",
          secret: "smoke-secret",
        },
        smtp: {
          host: "greenmail-test",
          port: 3025,
          secure: false,
          username: "support@example.com",
          secret: "smoke-secret",
        },
      },
      deliverySmtp: {
        host: "127.0.0.1",
        port: 3025,
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runOnboarding,
      sendMessage,
      createUniqueId: () => "unique_1",
      now: () => new Date("2026-06-15T10:00:01.000Z"),
      delayMs: async () => {},
      pollAttempts: 2,
      pollMs: 1,
    });

    expect(runOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: expect.objectContaining({ email: "support@example.com" }),
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 3025,
        to: "support@example.com",
        messageId: "emailhub-real-webhook-unique_1@emailhub-smoke.local",
        subject: "[EmailHub Real Webhook Smoke] unique_1",
      }),
    );
    expect(result).toEqual({
      ok: true,
      smoke: "emailengine_real_webhook",
      apiBaseUrl: "http://127.0.0.1:8080",
      email: "support@example.com",
      provider: "custom_domain",
      accountId: "acc_1",
      initialSyncJobId: "job_initial",
      deliveredMessageId: "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
      deliveryObservation: "message_upserted_webhook",
      diagnosticEventId: "evt_message",
      diagnosticEventKind: "message_upserted",
      readModelMessageId: "message_read_1",
      readModelSubject: "[EmailHub Real Webhook Smoke] unique_1",
      readModelReceivedAt: "2026-06-15T10:00:04.000Z",
      webhookSyncJobId: "job_webhook",
    });
  });

  it("accepts a bootstrap sync read model delivery when EmailEngine does not emit message_upserted", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=acc_1&lane=sync&limit=50"
      ) {
        return jsonResponse({
          items: [
            {
              id: "evt_sync_requested",
              occurredAt: "2026-06-15T10:00:02.000Z",
              service: "email-hub-api",
              level: "info",
              accountId: "acc_1",
              lane: "sync",
              event: "emailengine_webhook_ingested",
              jobId: "job_sync",
              context: {
                duplicate: false,
                mailEngineEventId: "mail_event_sync",
                mailEngineEventKind: "sync_requested",
                mailEngineIdempotencyKey: "emailengine:acc_1:event-id:sync",
                syncJobId: "job_sync",
                syncJobType: "sync_account",
              },
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_read_1",
              accountId: "acc_1",
              subject: "[EmailHub Real Webhook Smoke] unique_1",
              receivedAt: "2026-06-15T10:00:04.000Z",
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages/message_read_1"
      ) {
        return jsonResponse({
          id: "message_read_1",
          accountId: "acc_1",
          subject: "[EmailHub Real Webhook Smoke] unique_1",
          bodyText: "Email Hub real webhook smoke.\nuniqueId=unique_1",
        });
      }

      throw new Error(`unexpected smoke URL ${requestUrl}`);
    });

    const result = await runEmailEngineRealWebhookSmoke({
      apiBaseUrl: "http://127.0.0.1:8080",
      payload: {
        email: "support@example.com",
        provider: "custom_domain",
        imap: {
          host: "greenmail-test",
          port: 3143,
          secure: false,
          username: "support@example.com",
          secret: "smoke-secret",
        },
        smtp: {
          host: "greenmail-test",
          port: 3025,
          secure: false,
          username: "support@example.com",
          secret: "smoke-secret",
        },
      },
      deliverySmtp: {
        host: "127.0.0.1",
        port: 3025,
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runOnboarding: async () => ({
        email: "support@example.com",
        provider: "custom_domain",
        accountId: "acc_1",
        syncJobId: "job_initial",
        syncJobStatus: "queued",
      }),
      sendMessage: async (input) => ({
        host: input.host,
        port: input.port,
        to: input.to,
        messageId: `<${input.messageId}>`,
      }),
      createUniqueId: () => "unique_1",
      now: () => new Date("2026-06-15T10:00:01.000Z"),
      delayMs: async () => {},
      pollAttempts: 1,
      pollMs: 1,
    });

    expect(result).toEqual(
      expect.objectContaining({
        deliveryObservation: "read_model_sync",
        diagnosticEventId: "evt_sync_requested",
        diagnosticEventKind: "sync_requested",
        readModelMessageId: "message_read_1",
        webhookSyncJobId: "job_sync",
      }),
    );
  });

  it("rejects read model fallback when the only account webhook predates the smoke delivery", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=acc_1&lane=sync&limit=50"
      ) {
        return jsonResponse({
          items: [
            {
              id: "evt_sync_before_delivery",
              occurredAt: "2026-06-15T10:00:02.000Z",
              service: "email-hub-api",
              level: "info",
              accountId: "acc_1",
              lane: "sync",
              event: "emailengine_webhook_ingested",
              jobId: "job_sync_before_delivery",
              context: {
                duplicate: false,
                mailEngineEventId: "mail_event_sync_before_delivery",
                mailEngineEventKind: "sync_requested",
                mailEngineIdempotencyKey:
                  "emailengine:acc_1:event-id:sync-before-delivery",
                syncJobId: "job_sync_before_delivery",
                syncJobType: "sync_account",
              },
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_read_1",
              accountId: "acc_1",
              subject: "[EmailHub Real Webhook Smoke] unique_1",
              receivedAt: "2026-06-15T10:00:04.000Z",
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages/message_read_1"
      ) {
        return jsonResponse({
          id: "message_read_1",
          accountId: "acc_1",
          subject: "[EmailHub Real Webhook Smoke] unique_1",
          bodyText: "Email Hub real webhook smoke.\nuniqueId=unique_1",
        });
      }

      throw new Error(`unexpected smoke URL ${requestUrl}`);
    });

    await expect(
      runEmailEngineRealWebhookSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: {
          email: "support@example.com",
          provider: "custom_domain",
          imap: {
            host: "greenmail-test",
            port: 3143,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
          smtp: {
            host: "greenmail-test",
            port: 3025,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
        },
        deliverySmtp: {
          host: "127.0.0.1",
          port: 3025,
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runOnboarding: async () => ({
          email: "support@example.com",
          provider: "custom_domain",
          accountId: "acc_1",
          syncJobId: "job_initial",
          syncJobStatus: "queued",
        }),
        sendMessage: async (input) => ({
          host: input.host,
          port: input.port,
          to: input.to,
          messageId: `<${input.messageId}>`,
        }),
        createUniqueId: () => "unique_1",
        now: () => new Date("2026-06-15T10:00:03.000Z"),
        delayMs: async () => {},
        pollAttempts: 1,
        pollMs: 1,
      }),
    ).rejects.toThrow(
      "EmailEngine real webhook smoke did not observe a current EmailEngine webhook diagnostic for acc_1 after 1 diagnostics polls",
    );
  });

  it("waits for the initial sync job to finish before delivering the smoke message", async () => {
    let syncCenterCalls = 0;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (requestUrl === "http://127.0.0.1:8080/api/sync-center/accounts") {
        syncCenterCalls += 1;
        calls.push(`sync-center:${syncCenterCalls}`);
        return jsonResponse({
          items: [
            {
              accountId: "acc_1",
              latestSyncJob: {
                id: "job_initial",
                status: syncCenterCalls === 1 ? "queued" : "done",
              },
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=acc_1&lane=sync&limit=50"
      ) {
        return jsonResponse({
          items: [
            {
              id: "evt_message",
              occurredAt: "2026-06-15T10:00:03.000Z",
              service: "email-hub-api",
              level: "info",
              accountId: "acc_1",
              lane: "sync",
              event: "emailengine_webhook_ingested",
              jobId: "job_webhook",
              context: {
                duplicate: false,
                mailEngineEventId: "mail_event_1",
                mailEngineEventKind: "message_upserted",
                mailEngineIdempotencyKey: "emailengine:acc_1:messageNew:abc",
                rfcMessageId:
                  "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
                syncJobId: "job_webhook",
                syncJobType: "sync_account",
              },
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_read_1",
              accountId: "acc_1",
              subject: "[EmailHub Real Webhook Smoke] unique_1",
              receivedAt: "2026-06-15T10:00:04.000Z",
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages/message_read_1"
      ) {
        return jsonResponse({
          id: "message_read_1",
          accountId: "acc_1",
          subject: "[EmailHub Real Webhook Smoke] unique_1",
          bodyText: "Email Hub real webhook smoke.\nuniqueId=unique_1",
        });
      }

      throw new Error(`unexpected smoke URL ${requestUrl}`);
    });
    const sendMessage = vi.fn(async (input) => {
      calls.push("send");
      return {
        host: input.host,
        port: input.port,
        to: input.to,
        messageId: `<${input.messageId}>`,
      };
    });

    const result = await runEmailEngineRealWebhookSmoke({
      apiBaseUrl: "http://127.0.0.1:8080",
      payload: {
        email: "support@example.com",
        provider: "custom_domain",
        imap: {
          host: "greenmail-test",
          port: 3143,
          secure: false,
          username: "support@example.com",
          secret: "smoke-secret",
        },
        smtp: {
          host: "greenmail-test",
          port: 3025,
          secure: false,
          username: "support@example.com",
          secret: "smoke-secret",
        },
      },
      deliverySmtp: {
        host: "127.0.0.1",
        port: 3025,
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runOnboarding: async () => ({
        email: "support@example.com",
        provider: "custom_domain",
        accountId: "acc_1",
        syncJobId: "job_initial",
        syncJobStatus: "queued",
      }),
      sendMessage,
      createUniqueId: () => "unique_1",
      now: () => new Date("2026-06-15T10:00:01.000Z"),
      delayMs: async () => {},
      initialSyncReadyAttempts: 3,
      initialSyncReadyPollMs: 1,
      pollAttempts: 1,
      pollMs: 1,
    });

    expect(result.deliveryObservation).toBe("message_upserted_webhook");
    expect(calls).toEqual(["sync-center:1", "sync-center:2", "send"]);
  });

  it("reuses an existing ready EmailEngine account without re-registering the smoke mailbox", async () => {
    let syncCenterCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (requestUrl === "http://127.0.0.1:8080/api/sync-center/accounts") {
        syncCenterCalls += 1;
        return jsonResponse({
          items: [
            {
              accountId: "acc_existing",
              email: "support@example.com",
              provider: "custom_domain",
              engineProvider: "emailengine",
              reauthRequired: false,
              latestSyncJob: {
                id: "job_existing_done",
                status: "done",
              },
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=acc_existing&lane=sync&limit=50"
      ) {
        return jsonResponse({
          items: [
            {
              id: "evt_message",
              occurredAt: "2026-06-15T10:00:03.000Z",
              service: "email-hub-api",
              level: "info",
              accountId: "acc_existing",
              lane: "sync",
              event: "emailengine_webhook_ingested",
              jobId: "job_webhook",
              context: {
                duplicate: false,
                mailEngineEventId: "mail_event_1",
                mailEngineEventKind: "message_upserted",
                mailEngineIdempotencyKey:
                  "emailengine:acc_existing:messageNew:abc",
                rfcMessageId:
                  "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
                syncJobId: "job_webhook",
                syncJobType: "sync_account",
              },
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_existing/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_read_1",
              accountId: "acc_existing",
              subject: "[EmailHub Real Webhook Smoke] unique_1",
              receivedAt: "2026-06-15T10:00:04.000Z",
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_existing/messages/message_read_1"
      ) {
        return jsonResponse({
          id: "message_read_1",
          accountId: "acc_existing",
          subject: "[EmailHub Real Webhook Smoke] unique_1",
          bodyText: "Email Hub real webhook smoke.\nuniqueId=unique_1",
        });
      }

      throw new Error(`unexpected smoke URL ${requestUrl}`);
    });
    const runOnboarding = vi.fn();
    const sendMessage = vi.fn(async (input) => ({
      host: input.host,
      port: input.port,
      to: input.to,
      messageId: `<${input.messageId}>`,
    }));

    const result = await runEmailEngineRealWebhookSmoke({
      apiBaseUrl: "http://127.0.0.1:8080",
      payload: {
        email: "support@example.com",
        provider: "custom_domain",
        imap: {
          host: "greenmail-test",
          port: 3143,
          secure: false,
          username: "support@example.com",
          secret: "smoke-secret",
        },
        smtp: {
          host: "greenmail-test",
          port: 3025,
          secure: false,
          username: "support@example.com",
          secret: "smoke-secret",
        },
      },
      deliverySmtp: {
        host: "127.0.0.1",
        port: 3025,
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runOnboarding,
      sendMessage,
      createUniqueId: () => "unique_1",
      now: () => new Date("2026-06-15T10:00:01.000Z"),
      delayMs: async () => {},
      initialSyncReadyAttempts: 2,
      initialSyncReadyPollMs: 1,
      pollAttempts: 1,
      pollMs: 1,
      reuseExistingReadyAccount: true,
    });

    expect(runOnboarding).not.toHaveBeenCalled();
    expect(syncCenterCalls).toBe(2);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "support@example.com",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        accountId: "acc_existing",
        initialSyncJobId: "job_existing_done",
        deliveryObservation: "message_upserted_webhook",
      }),
    );
  });

  it("fails loudly when the initial sync job never becomes ready", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (requestUrl === "http://127.0.0.1:8080/api/sync-center/accounts") {
        return jsonResponse({
          items: [
            {
              accountId: "acc_1",
              latestSyncJob: {
                id: "job_initial",
                status: "queued",
              },
            },
          ],
        });
      }

      throw new Error(`unexpected smoke URL ${requestUrl}`);
    });
    const sendMessage = vi.fn();

    await expect(
      runEmailEngineRealWebhookSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: {
          email: "support@example.com",
          provider: "custom_domain",
          imap: {
            host: "greenmail-test",
            port: 3143,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
          smtp: {
            host: "greenmail-test",
            port: 3025,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
        },
        deliverySmtp: {
          host: "127.0.0.1",
          port: 3025,
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runOnboarding: async () => ({
          email: "support@example.com",
          provider: "custom_domain",
          accountId: "acc_1",
          syncJobId: "job_initial",
          syncJobStatus: "queued",
        }),
        sendMessage,
        createUniqueId: () => "unique_1",
        now: () => new Date("2026-06-15T10:00:01.000Z"),
        delayMs: async () => {},
        initialSyncReadyAttempts: 2,
        initialSyncReadyPollMs: 1,
        pollAttempts: 1,
        pollMs: 1,
      }),
    ).rejects.toThrow(
      "EmailEngine real webhook smoke initial sync job job_initial for acc_1 did not reach done after 2 polls; latest status queued",
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("fails loudly when the read model has no current EmailEngine webhook diagnostic", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=acc_1&lane=sync&limit=50"
      ) {
        return jsonResponse({ items: [] });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_read_1",
              accountId: "acc_1",
              subject: "[EmailHub Real Webhook Smoke] unique_1",
              receivedAt: "2026-06-15T10:00:04.000Z",
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages/message_read_1"
      ) {
        return jsonResponse({
          id: "message_read_1",
          accountId: "acc_1",
          subject: "[EmailHub Real Webhook Smoke] unique_1",
          bodyText: "Email Hub real webhook smoke.\nuniqueId=unique_1",
        });
      }

      throw new Error(`unexpected smoke URL ${requestUrl}`);
    });

    await expect(
      runEmailEngineRealWebhookSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: {
          email: "support@example.com",
          provider: "custom_domain",
          imap: {
            host: "greenmail-test",
            port: 3143,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
          smtp: {
            host: "greenmail-test",
            port: 3025,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
        },
        deliverySmtp: {
          host: "127.0.0.1",
          port: 3025,
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runOnboarding: async () => ({
          email: "support@example.com",
          provider: "custom_domain",
          accountId: "acc_1",
          syncJobId: "job_initial",
          syncJobStatus: "queued",
        }),
        sendMessage: async (input) => ({
          host: input.host,
          port: input.port,
          to: input.to,
          messageId: `<${input.messageId}>`,
        }),
        createUniqueId: () => "unique_1",
        now: () => new Date("2026-06-15T10:00:01.000Z"),
        delayMs: async () => {},
        pollAttempts: 2,
        pollMs: 1,
      }),
    ).rejects.toThrow(
      "EmailEngine real webhook smoke did not observe a current EmailEngine webhook diagnostic for acc_1 after 2 diagnostics polls",
    );
  });

  it("fails loudly when the delivered message never reaches the mail read model", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=acc_1&lane=sync&limit=50"
      ) {
        return jsonResponse({
          items: [
            {
              id: "evt_message",
              occurredAt: "2026-06-15T10:00:03.000Z",
              service: "email-hub-api",
              level: "info",
              accountId: "acc_1",
              lane: "sync",
              event: "emailengine_webhook_ingested",
              jobId: "job_webhook",
              context: {
                duplicate: false,
                mailEngineEventId: "mail_event_1",
                mailEngineEventKind: "message_upserted",
                mailEngineIdempotencyKey: "emailengine:acc_1:messageNew:abc",
                rfcMessageId:
                  "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
                syncJobId: "job_webhook",
                syncJobType: "sync_account",
              },
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({ items: [] });
      }

      throw new Error(`unexpected smoke URL ${requestUrl}`);
    });

    await expect(
      runEmailEngineRealWebhookSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: {
          email: "support@example.com",
          provider: "custom_domain",
          imap: {
            host: "greenmail-test",
            port: 3143,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
          smtp: {
            host: "greenmail-test",
            port: 3025,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
        },
        deliverySmtp: {
          host: "127.0.0.1",
          port: 3025,
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runOnboarding: async () => ({
          email: "support@example.com",
          provider: "custom_domain",
          accountId: "acc_1",
          syncJobId: "job_initial",
          syncJobStatus: "queued",
        }),
        sendMessage: async (input) => ({
          host: input.host,
          port: input.port,
          to: input.to,
          messageId: `<${input.messageId}>`,
        }),
        createUniqueId: () => "unique_1",
        now: () => new Date("2026-06-15T10:00:01.000Z"),
        delayMs: async () => {},
        pollAttempts: 2,
        pollMs: 1,
      }),
    ).rejects.toThrow(
      "EmailEngine real webhook smoke did not observe [EmailHub Real Webhook Smoke] unique_1 in the mail read model for acc_1 after 2 polls",
    );
  });

  it("rejects read model details that do not match the delivered smoke message", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=acc_1&lane=sync&limit=50"
      ) {
        return jsonResponse({
          items: [
            {
              id: "evt_message",
              occurredAt: "2026-06-15T10:00:03.000Z",
              service: "email-hub-api",
              level: "info",
              accountId: "acc_1",
              lane: "sync",
              event: "emailengine_webhook_ingested",
              jobId: "job_webhook",
              context: {
                duplicate: false,
                mailEngineEventId: "mail_event_1",
                mailEngineEventKind: "message_upserted",
                mailEngineIdempotencyKey: "emailengine:acc_1:messageNew:abc",
                rfcMessageId:
                  "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
                syncJobId: "job_webhook",
                syncJobType: "sync_account",
              },
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_read_1",
              accountId: "acc_1",
              subject: "[EmailHub Real Webhook Smoke] unique_1",
              receivedAt: "2026-06-15T10:00:04.000Z",
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages/message_read_1"
      ) {
        return jsonResponse({
          id: "message_read_1",
          accountId: "acc_1",
          subject: "[EmailHub Real Webhook Smoke] unique_1",
          bodyText: "different delivered message",
        });
      }

      throw new Error(`unexpected smoke URL ${requestUrl}`);
    });

    await expect(
      runEmailEngineRealWebhookSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: {
          email: "support@example.com",
          provider: "custom_domain",
          imap: {
            host: "greenmail-test",
            port: 3143,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
          smtp: {
            host: "greenmail-test",
            port: 3025,
            secure: false,
            username: "support@example.com",
            secret: "smoke-secret",
          },
        },
        deliverySmtp: {
          host: "127.0.0.1",
          port: 3025,
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runOnboarding: async () => ({
          email: "support@example.com",
          provider: "custom_domain",
          accountId: "acc_1",
          syncJobId: "job_initial",
          syncJobStatus: "queued",
        }),
        sendMessage: async (input) => ({
          host: input.host,
          port: input.port,
          to: input.to,
          messageId: `<${input.messageId}>`,
        }),
        createUniqueId: () => "unique_1",
        now: () => new Date("2026-06-15T10:00:01.000Z"),
        delayMs: async () => {},
        pollAttempts: 1,
        pollMs: 1,
      }),
    ).rejects.toThrow(
      "EmailEngine real webhook smoke did not observe [EmailHub Real Webhook Smoke] unique_1 in the mail read model for acc_1 after 1 polls",
    );
  });
});

async function expectSanitizedSmokeFailure(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("expected smoke failure");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain(expectedMessage);
    expect(message).not.toContain("smoke-secret");
    expect(message).not.toContain("Bearer raw-token");
    expect(message).not.toContain("user:secret");
    expect(message).not.toContain("10.0.0.20");
    expect(message).not.toContain("github_pat_abc");
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("token=abc");
  }
}

function smokePayload() {
  return {
    email: "support@example.com",
    provider: "custom_domain",
    imap: {
      host: "greenmail-test",
      port: 3143,
      secure: false,
      username: "support@example.com",
      secret: "smoke-secret",
    },
    smtp: {
      host: "greenmail-test",
      port: 3025,
      secure: false,
      username: "support@example.com",
      secret: "smoke-secret",
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function startSmtpServer(input: {
  onCommand(command: string): void;
  onData(data: string): void;
}): Promise<number> {
  smtpServer = createServer((socket) => handleSmtpSocket(socket, input));
  await new Promise<void>((resolve) => {
    smtpServer!.listen(0, "127.0.0.1", resolve);
  });
  const address = smtpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("SMTP server did not bind to a TCP port");
  }

  return address.port;
}

function handleSmtpSocket(
  socket: Socket,
  input: {
    onCommand(command: string): void;
    onData(data: string): void;
  },
): void {
  socket.setEncoding("utf8");
  socket.write("220 greenmail.test ESMTP\r\n");
  let buffer = "";
  let dataMode = false;
  let messageData = "";

  socket.on("data", (chunk) => {
    buffer += chunk;
    let nextLineIndex = buffer.indexOf("\r\n");
    while (nextLineIndex >= 0) {
      const line = buffer.slice(0, nextLineIndex);
      buffer = buffer.slice(nextLineIndex + 2);

      if (dataMode) {
        if (line === ".") {
          dataMode = false;
          input.onData(messageData);
          socket.write("250 queued\r\n");
        } else {
          messageData += `${line}\r\n`;
        }
      } else {
        input.onCommand(line);
        if (line.startsWith("EHLO ")) {
          socket.write("250-greenmail.test\r\n250 OK\r\n");
        } else if (line.startsWith("MAIL FROM:")) {
          socket.write("250 sender ok\r\n");
        } else if (line.startsWith("RCPT TO:")) {
          socket.write("250 recipient ok\r\n");
        } else if (line === "DATA") {
          socket.write("354 end with dot\r\n");
          dataMode = true;
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 ok\r\n");
        }
      }

      nextLineIndex = buffer.indexOf("\r\n");
    }
  });
}
