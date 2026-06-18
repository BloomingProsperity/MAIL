import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler } from "../src/http/router";
import { createInMemoryMailEngineIngestStore } from "../src/mail-engine/ingest-store";

let server: Server | undefined;

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe("EmailEngine accountDeleted route", () => {
  it("records accountDeleted webhooks as account-state recovery work", async () => {
    const store = createInMemoryMailEngineIngestStore();
    const operationalEvents: unknown[] = [];
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent(input: unknown) {
        operationalEvents.push(input);
        return {
          id: "op_webhook_deleted_1",
          occurredAt: "2026-06-14T08:02:00.000Z",
          ...(input as Record<string, unknown>),
        };
      },
    };

    server = createServer(
      createApiHandler({
        apiName: "email-hub-api",
        emailEngineUrl: "http://emailengine:3000",
        emailEngineWebhookSecret: "webhook-secret",
        mailEngineIngestStore: store,
        operationalEventLogService,
      } as any),
    );

    const baseUrl = await listen(server);
    const body = webhookBody({
      event: "accountDeleted",
      eventId: "evt_account_deleted",
      account: "acc_deleted",
    });
    const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ee-wh-signature": sign(body),
        "x-request-id": "req_webhook_deleted_1",
      },
      body,
    });

    expect(response.status).toBe(202);
    expect(store.listEvents()[0]).toMatchObject({
      kind: "account_deleted",
      accountId: "acc_deleted",
      idempotencyKey: "emailengine:acc_deleted:event-id:evt_account_deleted",
    });
    expect(store.listSyncJobs()[0]).toMatchObject({
      jobType: "account_state",
      accountId: "acc_deleted",
    });
    expect(operationalEvents).toEqual([
      {
        service: "email-hub-api",
        level: "info",
        event: "emailengine_webhook_ingested",
        requestId: "req_webhook_deleted_1",
        accountId: "acc_deleted",
        lane: "sync",
        jobId: expect.any(String),
        message: "EmailEngine webhook account_deleted ingested for acc_deleted",
        context: {
          duplicate: false,
          mailEngineEventId: expect.any(String),
          mailEngineEventKind: "account_deleted",
          mailEngineIdempotencyKey:
            "emailengine:acc_deleted:event-id:evt_account_deleted",
          syncJobId: expect.any(String),
          syncJobType: "account_state",
        },
      },
    ]);
  });
});

async function listen(boundServer: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    boundServer.listen(0, "127.0.0.1", resolve);
  });

  const address = boundServer.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function sign(body: string): string {
  return createHmac("sha256", "webhook-secret").update(body).digest("base64url");
}

function webhookBody(payload: Record<string, unknown>): string {
  return JSON.stringify({
    date: new Date().toISOString(),
    ...payload,
  });
}
