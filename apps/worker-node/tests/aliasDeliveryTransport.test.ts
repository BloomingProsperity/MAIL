import { describe, expect, it } from "vitest";

import {
  createHttpAliasDeliveryTransport,
  PermanentAliasDeliveryError,
  TemporaryAliasDeliveryError,
} from "../src/alias-routing/alias-delivery-transport";

describe("alias delivery transport", () => {
  it("posts sanitized delivery jobs to the configured forwarding webhook", async () => {
    const calls: unknown[] = [];
    const transport = createHttpAliasDeliveryTransport({
      endpointUrl: "https://forwarder.example.test/deliver",
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init?.method,
          headers: init?.headers,
          body: JSON.parse(String(init?.body)),
        });
        return response(202, { providerMessageId: "queued-1" });
      },
    });

    await expect(
      transport.deliver({
        recipient: "sales@example.com",
        destinationEmail: "owner@example.net",
        sender: "lead@client.test",
        rawMessageRef: "raw://message-1",
        messageFingerprint: "sha256:message-1",
      }),
    ).resolves.toEqual({ providerMessageId: "queued-1" });
    expect(calls).toEqual([
      {
        url: "https://forwarder.example.test/deliver",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {
          recipient: "sales@example.com",
          destinationEmail: "owner@example.net",
          sender: "lead@client.test",
          rawMessageRef: "raw://message-1",
          messageFingerprint: "sha256:message-1",
        },
      },
    ]);
  });

  it("maps temporary forwarding failures to deferred delivery", async () => {
    const transport = createHttpAliasDeliveryTransport({
      endpointUrl: "https://forwarder.example.test/deliver",
      fetchImpl: async () => response(503, { error: "forwarder busy" }),
    });

    await expect(
      transport.deliver({
        recipient: "sales@example.com",
        destinationEmail: "owner@example.net",
        messageFingerprint: "sha256:message-1",
      }),
    ).rejects.toBeInstanceOf(TemporaryAliasDeliveryError);
  });

  it("maps permanent forwarding failures to bounced delivery", async () => {
    const transport = createHttpAliasDeliveryTransport({
      endpointUrl: "https://forwarder.example.test/deliver",
      fetchImpl: async () => response(550, { error: "recipient rejected" }),
    });

    await expect(
      transport.deliver({
        recipient: "sales@example.com",
        destinationEmail: "owner@example.net",
        messageFingerprint: "sha256:message-1",
      }),
    ).rejects.toBeInstanceOf(PermanentAliasDeliveryError);
  });
});

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
