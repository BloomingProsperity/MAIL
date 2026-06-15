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
});

describe("real EmailEngine webhook smoke", () => {
  it("onboards a GreenMail account, delivers a message, and waits for message_upserted diagnostics", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      if (
        requestUrl ===
        "http://127.0.0.1:8080/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=acc_1&lane=sync&limit=50"
      ) {
        const attempts = fetchImpl.mock.calls.length;
        return jsonResponse({
          items:
            attempts === 1
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

      throw new Error(`unexpected diagnostics URL ${requestUrl}`);
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
      diagnosticEventId: "evt_message",
      webhookSyncJobId: "job_webhook",
    });
  });

  it("fails loudly when EmailEngine never emits message_upserted diagnostics", async () => {
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
        fetchImpl: async () => jsonResponse({ items: [] }),
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
        delayMs: async () => {},
        pollAttempts: 2,
        pollMs: 1,
      }),
    ).rejects.toThrow(
      "EmailEngine real webhook smoke did not observe message_upserted for acc_1 after 2 diagnostics polls",
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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
