import { describe, expect, it } from "vitest";

import {
  createAliasRouter,
  createInMemoryAliasRoutingStore,
  InvalidAliasRoutingInputError,
} from "../src/alias-routing/alias-router";

describe("alias router", () => {
  it("queues one delivery job per exact alias destination and records logs", async () => {
    const store = createInMemoryAliasRoutingStore({
      routes: [
        {
          routeType: "alias",
          domainId: "domain_1",
          domain: "example.com",
          aliasId: "alias_1",
          localPart: "sales",
          destinationIds: ["dest_1", "dest_2"],
          destinationEmails: ["owner@example.net", "backup@example.net"],
        },
      ],
    });
    const router = createAliasRouter({
      store,
      createId: sequenceIds(["log_1", "job_1", "log_2", "job_2", "log_3"]),
      now: () => "2026-06-13T09:00:00.000Z",
    });

    const result = await router.routeInbound({
      recipient: " Sales@Example.COM ",
      sender: "lead@client.test",
      messageFingerprint: "sha256:message-1",
      rawMessageRef: "raw://message-1",
    });

    expect(result).toEqual({
      status: "queued",
      routeType: "alias",
      domainId: "domain_1",
      aliasId: "alias_1",
      recipient: "sales@example.com",
      jobs: [
        {
          id: "job_1",
          domainId: "domain_1",
          aliasId: "alias_1",
          recipient: "sales@example.com",
          destinationId: "dest_1",
          destinationEmail: "owner@example.net",
          sender: "lead@client.test",
          messageFingerprint: "sha256:message-1",
          rawMessageRef: "raw://message-1",
          idempotencyKey: "alias-delivery:sha256:message-1:dest_1",
          status: "queued",
          attempts: 0,
          maxAttempts: 8,
          notBefore: "2026-06-13T09:00:00.000Z",
          payload: { routeType: "alias" },
          createdAt: "2026-06-13T09:00:00.000Z",
          updatedAt: "2026-06-13T09:00:00.000Z",
        },
        {
          id: "job_2",
          domainId: "domain_1",
          aliasId: "alias_1",
          recipient: "sales@example.com",
          destinationId: "dest_2",
          destinationEmail: "backup@example.net",
          sender: "lead@client.test",
          messageFingerprint: "sha256:message-1",
          rawMessageRef: "raw://message-1",
          idempotencyKey: "alias-delivery:sha256:message-1:dest_2",
          status: "queued",
          attempts: 0,
          maxAttempts: 8,
          notBefore: "2026-06-13T09:00:00.000Z",
          payload: { routeType: "alias" },
          createdAt: "2026-06-13T09:00:00.000Z",
          updatedAt: "2026-06-13T09:00:00.000Z",
        },
      ],
    });
    expect(store.listDeliveryLogs()).toMatchObject([
      {
        id: "log_1",
        domainId: "domain_1",
        aliasId: "alias_1",
        recipient: "sales@example.com",
        status: "matched",
        detail: "matched exact alias sales@example.com",
      },
      {
        id: "log_2",
        status: "queued",
        detail: "queued alias delivery to owner@example.net",
      },
      {
        id: "log_3",
        status: "queued",
        detail: "queued alias delivery to backup@example.net",
      },
    ]);
  });

  it("falls back to forwarding catch-all rules when no exact alias exists", async () => {
    const store = createInMemoryAliasRoutingStore({
      routes: [
        {
          routeType: "catch_all",
          domainId: "domain_1",
          domain: "example.com",
          localPart: "*",
          catchAllMode: "forward",
          destinationIds: ["dest_1"],
          destinationEmails: ["owner@example.net"],
        },
      ],
    });
    const router = createAliasRouter({
      store,
      createId: sequenceIds(["log_1", "job_1", "log_2"]),
      now: () => "2026-06-13T09:00:00.000Z",
    });

    const result = await router.routeInbound({
      recipient: "anything@example.com",
      messageFingerprint: "sha256:message-2",
    });

    expect(result).toMatchObject({
      status: "queued",
      routeType: "catch_all",
      domainId: "domain_1",
      recipient: "anything@example.com",
      jobs: [
        {
          id: "job_1",
          destinationEmail: "owner@example.net",
          payload: { routeType: "catch_all" },
        },
      ],
    });
  });

  it("drops unroutable or rejecting recipients with an audit log and no jobs", async () => {
    const store = createInMemoryAliasRoutingStore();
    const router = createAliasRouter({
      store,
      createId: sequenceIds(["log_1"]),
      now: () => "2026-06-13T09:00:00.000Z",
    });

    const result = await router.routeInbound({
      recipient: "nobody@example.com",
      messageFingerprint: "sha256:message-3",
    });

    expect(result).toEqual({
      status: "dropped",
      reason: "no_route",
      recipient: "nobody@example.com",
      jobs: [],
    });
    expect(store.listDeliveryLogs()).toEqual([
      {
        id: "log_1",
        recipient: "nobody@example.com",
        status: "dropped",
        detail: "no alias or catch-all route matched",
        createdAt: "2026-06-13T09:00:00.000Z",
      },
    ]);
  });

  it("deduplicates delivery jobs for repeated inbound message fingerprints", async () => {
    const store = createInMemoryAliasRoutingStore({
      routes: [
        {
          routeType: "alias",
          domainId: "domain_1",
          domain: "example.com",
          aliasId: "alias_1",
          localPart: "sales",
          destinationIds: ["dest_1"],
          destinationEmails: ["owner@example.net"],
        },
      ],
    });
    const router = createAliasRouter({
      store,
      createId: sequenceIds(["log_1", "job_1", "log_2", "log_3", "job_2", "log_4"]),
      now: () => "2026-06-13T09:00:00.000Z",
    });

    const first = await router.routeInbound({
      recipient: "sales@example.com",
      messageFingerprint: "sha256:same",
    });
    const second = await router.routeInbound({
      recipient: "sales@example.com",
      messageFingerprint: "sha256:same",
    });

    expect(first.jobs).toHaveLength(1);
    expect(second.jobs).toHaveLength(1);
    expect(second.jobs[0]).toEqual(first.jobs[0]);
    expect(store.listDeliveryJobs()).toHaveLength(1);
  });

  it("rejects malformed recipients and missing fingerprints before writing logs", async () => {
    const store = createInMemoryAliasRoutingStore();
    const router = createAliasRouter({
      store,
      createId: () => "unused",
      now: () => "2026-06-13T09:00:00.000Z",
    });

    await expect(
      router.routeInbound({
        recipient: "not an email",
        messageFingerprint: "sha256:bad",
      }),
    ).rejects.toBeInstanceOf(InvalidAliasRoutingInputError);
    await expect(
      router.routeInbound({
        recipient: "sales@example.com",
        messageFingerprint: "",
      }),
    ).rejects.toBeInstanceOf(InvalidAliasRoutingInputError);
    expect(store.listDeliveryLogs()).toEqual([]);
  });
});

function sequenceIds(ids: string[]): () => string {
  return () => ids.shift() ?? "extra_id";
}
