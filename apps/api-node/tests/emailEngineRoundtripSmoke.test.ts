import { describe, expect, it, vi } from "vitest";

import {
  runEmailEngineAttachmentDownloadSmoke,
  runEmailEngineMailActionSmoke,
  runEmailEngineSendSmoke,
} from "../src/mail-engine/real-roundtrip-smoke";

const payload = {
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

const recipientPayload = {
  ...payload,
  email: "recipient@example.com",
  imap: {
    ...payload.imap,
    username: "recipient@example.com",
  },
  smtp: {
    ...payload.smtp,
    username: "recipient@example.com",
  },
};

describe("EmailEngine send and attachment smoke", () => {
  it("creates a draft, queues worker send, and waits for the delivered message in the read model", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      calls.push(`${init?.method ?? "GET"} ${requestUrl}`);

      if (
        init?.method === "POST" &&
        requestUrl === "http://127.0.0.1:8080/api/accounts/acc_1/compose/drafts"
      ) {
        expect(JSON.parse(String(init.body))).toMatchObject({
          to: [{ address: "recipient@example.com" }],
          subject: "[EmailHub Send Smoke] unique_1",
          source: "manual",
        });
        return jsonResponse({ id: "draft_1", accountId: "acc_1" }, 201);
      }

      if (
        init?.method === "POST" &&
        requestUrl ===
          "http://127.0.0.1:8080/api/accounts/acc_1/compose/drafts/draft_1/send"
      ) {
        return jsonResponse({
          accountId: "acc_1",
          draftId: "draft_1",
          action: "draft_send_queued",
        }, 202);
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_recipient/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_1",
              accountId: "acc_recipient",
              subject: "[EmailHub Send Smoke] unique_1",
              receivedAt: "2026-06-17T10:00:05.000Z",
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_recipient/messages/message_1"
      ) {
        return jsonResponse({
          id: "message_1",
          accountId: "acc_recipient",
          subject: "[EmailHub Send Smoke] unique_1",
          bodyText: "Email Hub EmailEngine send smoke.\nuniqueId=unique_1",
          attachments: [],
        });
      }

      throw new Error(`unexpected URL ${requestUrl}`);
    });
    const runOnboarding = vi.fn(async (input) => ({
      email: input.payload.email,
      provider: input.payload.provider,
      accountId:
        input.payload.email === "recipient@example.com"
          ? "acc_recipient"
          : "acc_1",
      syncJobId: "job_initial",
      syncJobStatus: "done",
    }));

    const result = await runEmailEngineSendSmoke({
      apiBaseUrl: "http://127.0.0.1:8080/",
      payload,
      recipientPayload,
      fetchImpl: fetchImpl as typeof fetch,
      runOnboarding,
      createUniqueId: () => "unique_1",
      delayMs: async () => {},
      pollAttempts: 1,
      pollMs: 1,
      reuseExistingReadyAccount: false,
    });

    expect(result).toEqual({
      ok: true,
      smoke: "emailengine_send",
      apiBaseUrl: "http://127.0.0.1:8080",
      email: "support@example.com",
      provider: "custom_domain",
      accountId: "acc_1",
      senderEmail: "support@example.com",
      senderAccountId: "acc_1",
      recipientEmail: "recipient@example.com",
      recipientAccountId: "acc_recipient",
      draftId: "draft_1",
      sendAction: "draft_send_queued",
      readModelMessageId: "message_1",
      readModelSubject: "[EmailHub Send Smoke] unique_1",
      readModelReceivedAt: "2026-06-17T10:00:05.000Z",
    });
    expect(calls).toEqual([
      "POST http://127.0.0.1:8080/api/accounts/acc_1/compose/drafts",
      "POST http://127.0.0.1:8080/api/accounts/acc_1/compose/drafts/draft_1/send",
      "GET http://127.0.0.1:8080/api/accounts/acc_recipient/messages?limit=10&q=unique_1&qScope=subject",
      "GET http://127.0.0.1:8080/api/accounts/acc_recipient/messages/message_1",
    ]);
  });

  it("delivers an attachment message and downloads it through the public attachment route", async () => {
    const attachmentText = "Email Hub attachment smoke uniqueId=unique_1\n";
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_1",
              accountId: "acc_1",
              subject: "[EmailHub Attachment Smoke] unique_1",
              receivedAt: "2026-06-17T10:00:05.000Z",
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages/message_1"
      ) {
        return jsonResponse({
          id: "message_1",
          accountId: "acc_1",
          subject: "[EmailHub Attachment Smoke] unique_1",
          bodyText:
            "Email Hub EmailEngine attachment smoke.\nuniqueId=unique_1",
          attachments: [
            {
              id: "attachment_1",
              filename: "emailhub-smoke-unique_1.txt",
              contentType: "text/plain",
              byteSize: attachmentText.length,
              inline: false,
              embedded: false,
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/attachments/attachment_1/download"
      ) {
        return new Response(attachmentText, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }

      throw new Error(`unexpected URL ${requestUrl}`);
    });
    const runOnboarding = vi.fn(async (input) => ({
      email: input.payload.email,
      provider: input.payload.provider,
      accountId:
        input.payload.email === "recipient@example.com"
          ? "acc_recipient"
          : "acc_1",
      syncJobId: "job_initial",
      syncJobStatus: "done",
    }));
    const sendMessage = vi.fn(async (input) => {
      expect(input.attachments).toEqual([
        {
          filename: "emailhub-smoke-unique_1.txt",
          contentType: "text/plain",
          content: attachmentText,
        },
      ]);
      return {
        host: input.host,
        port: input.port,
        to: input.to,
        messageId: `<${input.messageId}>`,
      };
    });

    const result = await runEmailEngineAttachmentDownloadSmoke({
      apiBaseUrl: "http://127.0.0.1:8080/",
      payload,
      deliverySmtp: {
        host: "127.0.0.1",
        port: 3025,
      },
      fetchImpl: fetchImpl as typeof fetch,
      runOnboarding,
      sendMessage,
      createUniqueId: () => "unique_1",
      delayMs: async () => {},
      pollAttempts: 1,
      pollMs: 1,
      reuseExistingReadyAccount: false,
    });

    expect(result).toEqual({
      ok: true,
      smoke: "emailengine_attachment_download",
      apiBaseUrl: "http://127.0.0.1:8080",
      email: "support@example.com",
      provider: "custom_domain",
      accountId: "acc_1",
      deliveredMessageId: "<emailhub-attachment-unique_1@emailhub-smoke.local>",
      readModelMessageId: "message_1",
      readModelSubject: "[EmailHub Attachment Smoke] unique_1",
      attachmentId: "attachment_1",
      attachmentFilename: "emailhub-smoke-unique_1.txt",
      attachmentContentType: "text/plain",
      downloadedBytes: attachmentText.length,
    });
  });

  it("marks a delivered message read and waits for the worker to process the engine command", async () => {
    const calls: string[] = [];
    let detailReads = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      calls.push(`${init?.method ?? "GET"} ${requestUrl}`);

      if (
        init?.method === "POST" &&
        requestUrl ===
          "http://127.0.0.1:8080/api/sync-center/accounts/acc_1/resync"
      ) {
        return jsonResponse({
          accountId: "acc_1",
          action: "manual_sync_queued",
          job: {
            id: "job_manual",
            jobType: "sync_account",
            accountId: "acc_1",
            idempotencyKey: "job:manual-sync:acc_1:manual_1",
            status: "queued",
            createdAt: "2026-06-17T10:00:04.000Z",
          },
        }, 202);
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject"
      ) {
        return jsonResponse({
          items: [
            {
              id: "message_1",
              accountId: "acc_1",
              subject: "[EmailHub Action Smoke] unique_1",
              receivedAt: "2026-06-17T10:00:05.000Z",
            },
          ],
        });
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/accounts/acc_1/messages/message_1"
      ) {
        detailReads += 1;
        return jsonResponse({
          id: "message_1",
          accountId: "acc_1",
          subject: "[EmailHub Action Smoke] unique_1",
          bodyText:
            "Email Hub EmailEngine mail action smoke.\nuniqueId=unique_1",
          unread: detailReads === 1,
          attachments: [],
        });
      }

      if (
        init?.method === "POST" &&
        requestUrl ===
          "http://127.0.0.1:8080/api/accounts/acc_1/messages/message_1/actions"
      ) {
        expect(JSON.parse(String(init.body))).toEqual({ action: "mark_read" });
        expect(requestUrl).not.toContain("emailengine");
        return jsonResponse({
          accountId: "acc_1",
          messageId: "message_1",
          action: "mark_read",
          state: {
            unread: false,
            starred: false,
            archived: false,
            deleted: false,
            mailboxIds: ["inbox"],
            labelIds: [],
          },
          command: {
            id: "cmd_mark_read",
            commandType: "mark_read",
            accountId: "acc_1",
            messageId: "message_1",
            idempotencyKey: "acc_1:message_1:mark_read",
            status: "queued",
          },
        }, 202);
      }

      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-worker&event=worker_result&accountId=acc_1&lane=engine_commands&jobId=cmd_mark_read&limit=10"
      ) {
        return jsonResponse({
          items: [
            {
              id: "event_1",
              occurredAt: "2026-06-17T10:00:06.000Z",
              service: "email-hub-worker",
              level: "info",
              event: "worker_result",
              accountId: "acc_1",
              lane: "engine_commands",
              jobId: "cmd_mark_read",
              context: {
                result: {
                  status: "processed",
                  commandId: "cmd_mark_read",
                  laneName: "engine_commands",
                },
              },
            },
          ],
        });
      }

      throw new Error(`unexpected ${init?.method ?? "GET"} ${requestUrl}`);
    });
    const runOnboarding = vi.fn(async (input) => ({
      email: input.payload.email,
      provider: input.payload.provider,
      accountId: "acc_1",
      syncJobId: "job_initial",
      syncJobStatus: "done",
    }));
    const sendMessage = vi.fn(async (input) => {
      expect(input.to).toBe("support@example.com");
      expect(input.subject).toBe("[EmailHub Action Smoke] unique_1");
      return {
        host: input.host,
        port: input.port,
        to: input.to,
        messageId: `<${input.messageId}>`,
      };
    });

    const result = await runEmailEngineMailActionSmoke({
      apiBaseUrl: "http://127.0.0.1:8080/",
      payload,
      deliverySmtp: {
        host: "127.0.0.1",
        port: 3025,
      },
      fetchImpl: fetchImpl as typeof fetch,
      runOnboarding,
      sendMessage,
      createUniqueId: () => "unique_1",
      delayMs: async () => {},
      pollAttempts: 1,
      pollMs: 1,
      workerDiagnosticAttempts: 1,
      workerDiagnosticPollMs: 1,
      reuseExistingReadyAccount: false,
    });

    expect(result).toEqual({
      ok: true,
      smoke: "emailengine_mail_action",
      apiBaseUrl: "http://127.0.0.1:8080",
      email: "support@example.com",
      provider: "custom_domain",
      accountId: "acc_1",
      deliveredMessageId: "<emailhub-action-unique_1@emailhub-smoke.local>",
      postDeliverySyncJobId: "job_manual",
      readModelMessageId: "message_1",
      readModelSubject: "[EmailHub Action Smoke] unique_1",
      action: "mark_read",
      commandId: "cmd_mark_read",
      commandType: "mark_read",
      actionResponseStatus: 202,
      actionStateUnread: false,
      workerDiagnosticEventId: "event_1",
      workerDiagnosticStatus: "processed",
      workerDiagnosticLane: "engine_commands",
    });
    expect(calls).toEqual([
      "POST http://127.0.0.1:8080/api/sync-center/accounts/acc_1/resync",
      "GET http://127.0.0.1:8080/api/accounts/acc_1/messages?limit=10&q=unique_1&qScope=subject",
      "GET http://127.0.0.1:8080/api/accounts/acc_1/messages/message_1",
      "POST http://127.0.0.1:8080/api/accounts/acc_1/messages/message_1/actions",
      "GET http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-worker&event=worker_result&accountId=acc_1&lane=engine_commands&jobId=cmd_mark_read&limit=10",
      "GET http://127.0.0.1:8080/api/accounts/acc_1/messages/message_1",
    ]);
  });

  it("fails the mail action smoke when the worker dead-letters the engine command", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      if (init?.method === "POST" && requestUrl.endsWith("/resync")) {
        return jsonResponse({
          action: "manual_sync_queued",
          job: {
            id: "job_manual",
            status: "queued",
          },
        }, 202);
      }
      if (requestUrl.includes("/messages?")) {
        return jsonResponse({
          items: [
            {
              id: "message_1",
              accountId: "acc_1",
              subject: "[EmailHub Action Smoke] unique_1",
              receivedAt: "2026-06-17T10:00:05.000Z",
            },
          ],
        });
      }
      if (requestUrl.endsWith("/messages/message_1")) {
        return jsonResponse({
          id: "message_1",
          accountId: "acc_1",
          subject: "[EmailHub Action Smoke] unique_1",
          bodyText:
            "Email Hub EmailEngine mail action smoke.\nuniqueId=unique_1",
          unread: true,
          attachments: [],
        });
      }
      if (init?.method === "POST" && requestUrl.endsWith("/actions")) {
        return jsonResponse({
          action: "mark_read",
          state: { unread: false },
          command: {
            id: "cmd_mark_read",
            commandType: "mark_read",
            status: "queued",
          },
        }, 202);
      }
      if (requestUrl.includes("/api/diagnostics/events?")) {
        return jsonResponse({
          items: [
            {
              id: "event_dead",
              service: "email-hub-worker",
              event: "worker_result",
              accountId: "acc_1",
              lane: "engine_commands",
              jobId: "cmd_mark_read",
              context: {
                result: {
                  status: "failed",
                  commandId: "cmd_mark_read",
                  finalJobStatus: "dead_letter",
                  errorMessage: "EmailEngine rejected flags update",
                },
              },
            },
          ],
        });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${requestUrl}`);
    });
    const runOnboarding = vi.fn(async (input) => ({
      email: input.payload.email,
      provider: input.payload.provider,
      accountId: "acc_1",
      syncJobId: "job_initial",
      syncJobStatus: "done",
    }));

    await expect(
      runEmailEngineMailActionSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload,
        deliverySmtp: {
          host: "127.0.0.1",
          port: 3025,
        },
        fetchImpl: fetchImpl as typeof fetch,
        runOnboarding,
        sendMessage: vi.fn(async (input) => ({
          host: input.host,
          port: input.port,
          to: input.to,
          messageId: `<${input.messageId}>`,
        })),
        createUniqueId: () => "unique_1",
        delayMs: async () => {},
        pollAttempts: 1,
        pollMs: 1,
        workerDiagnosticAttempts: 1,
        workerDiagnosticPollMs: 1,
        reuseExistingReadyAccount: false,
      }),
    ).rejects.toThrow(
      "EmailEngine mail action smoke command cmd_mark_read reached dead_letter: EmailEngine rejected flags update",
    );
  });

  it("fails the mail action smoke when post-delivery manual sync fails", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      if (init?.method === "POST" && requestUrl.endsWith("/resync")) {
        return jsonResponse({
          action: "manual_sync_queued",
          job: {
            id: "job_manual",
            status: "queued",
          },
        }, 202);
      }
      if (requestUrl.includes("/messages?")) {
        return jsonResponse({ items: [] });
      }
      if (requestUrl.includes("/api/diagnostics/events?")) {
        return jsonResponse({
          items: [
            {
              id: "event_sync_failed",
              service: "email-hub-worker",
              event: "sync_job_retry_scheduled",
              accountId: "acc_1",
              lane: "sync",
              jobId: "job_manual",
              context: {
                result: {
                  status: "failed",
                  jobId: "job_manual",
                  finalJobStatus: "queued",
                  errorMessage: "EmailEngine request failed: 500",
                },
              },
            },
          ],
        });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${requestUrl}`);
    });
    const runOnboarding = vi.fn(async (input) => ({
      email: input.payload.email,
      provider: input.payload.provider,
      accountId: "acc_1",
      syncJobId: "job_initial",
      syncJobStatus: "done",
    }));

    await expect(
      runEmailEngineMailActionSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload,
        deliverySmtp: {
          host: "127.0.0.1",
          port: 3025,
        },
        fetchImpl: fetchImpl as typeof fetch,
        runOnboarding,
        sendMessage: vi.fn(async (input) => ({
          host: input.host,
          port: input.port,
          to: input.to,
          messageId: `<${input.messageId}>`,
        })),
        createUniqueId: () => "unique_1",
        delayMs: async () => {},
        pollAttempts: 1,
        pollMs: 1,
        reuseExistingReadyAccount: false,
      }),
    ).rejects.toThrow(
      "EmailEngine mail action smoke post-delivery sync job job_manual failed: EmailEngine request failed: 500; final status queued",
    );
  });

  it("fails loudly when a queued send never appears in the read model", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/compose/drafts")) {
        return jsonResponse({ id: "draft_1" }, 201);
      }
      if (requestUrl.endsWith("/compose/drafts/draft_1/send")) {
        return jsonResponse({ action: "draft_send_queued" }, 202);
      }
      if (requestUrl.includes("/messages?")) {
        return jsonResponse({ items: [] });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${requestUrl}`);
    });
    const runOnboarding = vi.fn(async (input) => ({
      email: input.payload.email,
      provider: input.payload.provider,
      accountId:
        input.payload.email === "recipient@example.com"
          ? "acc_recipient"
          : "acc_1",
      syncJobId: "job_initial",
      syncJobStatus: "done",
    }));

    await expect(
      runEmailEngineSendSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload,
        recipientPayload,
        fetchImpl: fetchImpl as typeof fetch,
        runOnboarding,
        createUniqueId: () => "unique_1",
        delayMs: async () => {},
        pollAttempts: 1,
        pollMs: 1,
        reuseExistingReadyAccount: false,
      }),
    ).rejects.toThrow(
      "EmailEngine send smoke did not observe [EmailHub Send Smoke] unique_1 in the mail read model for acc_recipient after 1 polls",
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
