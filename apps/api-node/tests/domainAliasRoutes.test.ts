import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler } from "../src/http/router";
import { InvalidDomainAliasRequestError } from "../src/domains/domain-alias";

let server: Server | undefined;

async function withApi(
  test: (baseUrl: string) => Promise<void>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  server = createServer(
    createApiHandler({
      apiName: "email-hub-api",
      emailEngineUrl: "http://emailengine:3000",
      emailEngineWebhookSecret: "webhook-secret",
      ...overrides,
    } as any),
  );

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }

  await test(`http://127.0.0.1:${address.port}`);
}

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe("domain alias routes", () => {
  it("creates and lists domains through the control-plane service", async () => {
    const calls: unknown[] = [];
    const domainAliasService = {
      async createDomain(input: unknown) {
        calls.push(["createDomain", input]);
        return {
          id: "domain_1",
          domain: "example.com",
          verificationStatus: "pending",
          dnsRecords: {
            ownershipTxt: {
              type: "TXT",
              name: "_emailhub.example.com",
              value: "emailhub-domain-verification=domain_1",
            },
          },
          createdAt: "2026-06-13T08:00:00.000Z",
        };
      },
      async listDomains() {
        calls.push(["listDomains"]);
        return { items: [{ id: "domain_1", domain: "example.com" }] };
      },
      async verifyDomain(input: unknown) {
        calls.push(["verifyDomain", input]);
        return {
          id: "domain_1",
          domain: "example.com",
          verificationStatus: "verified",
          dnsRecords: {},
          createdAt: "2026-06-13T08:00:00.000Z",
        };
      },
      async configureDomainCloudflare(input: unknown) {
        calls.push(["configureDomainCloudflare", input]);
        return {
          zoneId: "zone_1",
          zoneName: "example.com",
          records: [
            {
              type: "TXT",
              name: "_emailhub.example.com",
              value: "emailhub-domain-verification=domain_1",
              status: "created",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/domains`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ domain: "Example.COM" }),
        });
        const verified = await fetch(`${baseUrl}/api/domains/domain_1/verify`, {
          method: "POST",
        });
        const cloudflare = await fetch(
          `${baseUrl}/api/domains/domain_1/cloudflare/dns-records`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              apiToken: "cf-token",
              zoneId: "zone_1",
            }),
          },
        );
        const listed = await fetch(`${baseUrl}/api/domains`);

        expect(created.status).toBe(201);
        expect(verified.status).toBe(200);
        expect(cloudflare.status).toBe(200);
        expect(await created.json()).toMatchObject({
          id: "domain_1",
          domain: "example.com",
          verificationStatus: "pending",
        });
        expect(await verified.json()).toMatchObject({
          id: "domain_1",
          verificationStatus: "verified",
        });
        expect(await cloudflare.json()).toMatchObject({
          zoneId: "zone_1",
          records: [{ status: "created" }],
        });
        expect(listed.status).toBe(200);
        expect(await listed.json()).toEqual({
          items: [{ id: "domain_1", domain: "example.com" }],
        });
        expect(calls).toEqual([
          ["createDomain", { domain: "Example.COM" }],
          ["verifyDomain", { domainId: "domain_1" }],
          [
            "configureDomainCloudflare",
            { domainId: "domain_1", apiToken: "cf-token", zoneId: "zone_1" },
          ],
          ["listDomains"],
        ]);
      },
      { domainAliasService },
    );
  });

  it("creates destinations, aliases, catch-all rules, and reads delivery logs", async () => {
    const calls: unknown[] = [];
    const domainAliasService = {
      async createDestination(input: unknown) {
        calls.push(["createDestination", input]);
        return {
          id: "dest_1",
          domainId: "domain_1",
          email: "owner@example.net",
          verified: false,
          createdAt: "2026-06-13T08:00:00.000Z",
        };
      },
      async listDestinations(input: unknown) {
        calls.push(["listDestinations", input]);
        return {
          items: [
            {
              id: "dest_1",
              domainId: "domain_1",
              email: "owner@example.net",
              verified: false,
              createdAt: "2026-06-13T08:00:00.000Z",
            },
          ],
        };
      },
      async createAlias(input: unknown) {
        calls.push(["createAlias", input]);
        return {
          id: "alias_1",
          domainId: "domain_1",
          address: "sales@example.com",
          localPart: "sales",
          enabled: true,
          destinationIds: ["dest_1"],
          createdAt: "2026-06-13T08:00:00.000Z",
        };
      },
      async listAliases(input: unknown) {
        calls.push(["listAliases", input]);
        return {
          items: [{ id: "alias_1", address: "sales@example.com" }],
        };
      },
      async setCatchAll(input: unknown) {
        calls.push(["setCatchAll", input]);
        return {
          id: "rule_1",
          domainId: "domain_1",
          ruleType: "catch_all",
          enabled: true,
          config: { mode: "forward", destinationIds: ["dest_1"] },
          createdAt: "2026-06-13T08:00:00.000Z",
        };
      },
      async getCatchAll(input: unknown) {
        calls.push(["getCatchAll", input]);
        return {
          item: {
            id: "rule_1",
            domainId: "domain_1",
            ruleType: "catch_all",
            enabled: true,
            config: { mode: "forward", destinationIds: ["dest_1"] },
            createdAt: "2026-06-13T08:00:00.000Z",
          },
        };
      },
      async listDeliveryLogs(input: unknown) {
        calls.push(["listDeliveryLogs", input]);
        return {
          items: [
            {
              id: "log_1",
              domainId: "domain_1",
              recipient: "sales@example.com",
              status: "delivered",
              createdAt: "2026-06-13T08:00:00.000Z",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const destination = await fetch(
          `${baseUrl}/api/domains/domain_1/destinations`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "Owner@Example.net" }),
          },
        );
        const destinations = await fetch(
          `${baseUrl}/api/domains/domain_1/destinations`,
        );
        const alias = await fetch(`${baseUrl}/api/domains/domain_1/aliases`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            localPart: "Sales",
            destinationIds: ["dest_1"],
          }),
        });
        const aliases = await fetch(`${baseUrl}/api/domains/domain_1/aliases`);
        const catchAll = await fetch(
          `${baseUrl}/api/domains/domain_1/catch-all`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "forward",
              destinationIds: ["dest_1"],
            }),
          },
        );
        const currentCatchAll = await fetch(
          `${baseUrl}/api/domains/domain_1/catch-all`,
        );
        const logs = await fetch(
          `${baseUrl}/api/domains/domain_1/delivery-logs?limit=25`,
        );

        expect(destination.status).toBe(201);
        expect(destinations.status).toBe(200);
        expect(alias.status).toBe(201);
        expect(aliases.status).toBe(200);
        expect(catchAll.status).toBe(200);
        expect(currentCatchAll.status).toBe(200);
        expect(logs.status).toBe(200);
        expect(await destination.json()).toMatchObject({
          id: "dest_1",
          email: "owner@example.net",
        });
        expect(await destinations.json()).toMatchObject({
          items: [{ id: "dest_1", email: "owner@example.net" }],
        });
        expect(await alias.json()).toMatchObject({
          id: "alias_1",
          address: "sales@example.com",
        });
        expect(await aliases.json()).toEqual({
          items: [{ id: "alias_1", address: "sales@example.com" }],
        });
        expect(await catchAll.json()).toMatchObject({
          id: "rule_1",
          config: { mode: "forward", destinationIds: ["dest_1"] },
        });
        expect(await currentCatchAll.json()).toMatchObject({
          item: {
            id: "rule_1",
            config: { mode: "forward", destinationIds: ["dest_1"] },
          },
        });
        expect(await logs.json()).toMatchObject({
          items: [{ id: "log_1", status: "delivered" }],
        });
        expect(calls).toEqual([
          [
            "createDestination",
            { domainId: "domain_1", email: "Owner@Example.net" },
          ],
          ["listDestinations", { domainId: "domain_1" }],
          [
            "createAlias",
            {
              domainId: "domain_1",
              localPart: "Sales",
              destinationIds: ["dest_1"],
            },
          ],
          ["listAliases", { domainId: "domain_1" }],
          [
            "setCatchAll",
            {
              domainId: "domain_1",
              mode: "forward",
              destinationIds: ["dest_1"],
            },
          ],
          ["getCatchAll", { domainId: "domain_1" }],
          ["listDeliveryLogs", { domainId: "domain_1", limit: 25 }],
        ]);
      },
      { domainAliasService },
    );
  });

  it("rejects invalid domain alias requests before provider internals leak in", async () => {
    const domainAliasService = {
      async createDomain() {
        throw new InvalidDomainAliasRequestError("domain is invalid");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/domains`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ domain: "bad domain" }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_domain_alias_request",
        });
      },
      { domainAliasService },
    );
  });

  it("returns 503 when domain aliases are unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/domains`);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "domain_alias_unavailable",
      });
    });
  });
});
