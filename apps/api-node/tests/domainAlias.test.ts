import { describe, expect, it } from "vitest";

import {
  createDomainAliasService,
  createInMemoryDomainAliasStore,
  InvalidDomainAliasRequestError,
} from "../src/domains/domain-alias";

describe("domain alias service", () => {
  it("creates a domain with DNS guidance and pending verification", async () => {
    const store = createInMemoryDomainAliasStore();
    const service = createDomainAliasService({
      store,
      createId: sequenceIds(["domain_1"]),
      now: () => "2026-06-13T08:00:00.000Z",
    });

    const result = await service.createDomain({ domain: "Example.COM" });

    expect(result).toEqual({
      id: "domain_1",
      domain: "example.com",
      verificationStatus: "pending",
      dnsRecords: {
        ownershipTxt: {
          type: "TXT",
          name: "_emailhub.example.com",
          value: "emailhub-domain-verification=domain_1",
        },
        mx: {
          type: "MX",
          name: "example.com",
          value: "10 mx.emailhub.local",
        },
        spf: {
          type: "TXT",
          name: "example.com",
          value: "v=spf1 include:emailhub.local ~all",
        },
        dmarc: {
          type: "TXT",
          name: "_dmarc.example.com",
          value: "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com",
        },
      },
      createdAt: "2026-06-13T08:00:00.000Z",
    });
    expect(await service.listDomains()).toEqual({ items: [result] });
  });

  it("creates verified destinations and alias routes using local ids", async () => {
    const store = createInMemoryDomainAliasStore();
    const service = createDomainAliasService({
      store,
      createId: sequenceIds(["domain_1", "dest_1", "alias_1"]),
      now: () => "2026-06-13T08:00:00.000Z",
    });

    await service.createDomain({ domain: "example.com" });
    const destination = await service.createDestination({
      domainId: "domain_1",
      email: "Owner@Example.net",
    });
    const alias = await service.createAlias({
      domainId: "domain_1",
      localPart: "Sales",
      destinationIds: ["dest_1"],
    });

    expect(destination).toEqual({
      id: "dest_1",
      domainId: "domain_1",
      email: "owner@example.net",
      verified: false,
      createdAt: "2026-06-13T08:00:00.000Z",
    });
    expect(alias).toEqual({
      id: "alias_1",
      domainId: "domain_1",
      address: "sales@example.com",
      localPart: "sales",
      enabled: true,
      destinationIds: ["dest_1"],
      createdAt: "2026-06-13T08:00:00.000Z",
    });
    expect(await service.listAliases({ domainId: "domain_1" })).toEqual({
      items: [alias],
    });
    expect(await service.listDestinations({ domainId: "domain_1" })).toEqual({
      items: [destination],
    });
  });

  it("verifies domain ownership and MX records through DNS", async () => {
    const store = createInMemoryDomainAliasStore();
    const service = createDomainAliasService({
      store,
      createId: sequenceIds(["domain_1"]),
      now: () => "2026-06-13T08:00:00.000Z",
      dnsResolver: {
        async resolveTxt(name) {
          expect(name).toBe("_emailhub.example.com");
          return [["emailhub-domain-verification=domain_1"]];
        },
        async resolveMx(name) {
          expect(name).toBe("example.com");
          return [{ exchange: "mx.emailhub.local.", priority: 10 }];
        },
      },
    });

    await service.createDomain({ domain: "example.com" });

    await expect(service.verifyDomain({ domainId: "domain_1" })).resolves.toMatchObject({
      id: "domain_1",
      verificationStatus: "verified",
    });
    await expect(service.listDomains()).resolves.toMatchObject({
      items: [{ id: "domain_1", verificationStatus: "verified" }],
    });
  });

  it("marks domain verification failed when required DNS records are missing", async () => {
    const store = createInMemoryDomainAliasStore();
    const service = createDomainAliasService({
      store,
      createId: sequenceIds(["domain_1"]),
      dnsResolver: {
        async resolveTxt() {
          return [["wrong-token"]];
        },
        async resolveMx() {
          return [];
        },
      },
    });

    await service.createDomain({ domain: "example.com" });

    await expect(service.verifyDomain({ domainId: "domain_1" })).resolves.toMatchObject({
      verificationStatus: "failed",
    });
  });

  it("applies Cloudflare DNS setup with the domain guidance records", async () => {
    const store = createInMemoryDomainAliasStore();
    const cloudflareCalls: unknown[] = [];
    const service = createDomainAliasService({
      store,
      createId: sequenceIds(["domain_1"]),
      cloudflareDnsClient: {
        async setupDomainDns(input) {
          cloudflareCalls.push(input);
          return {
            zoneId: input.zoneId ?? "zone_1",
            zoneName: input.domain,
            records: [
              {
                type: "TXT",
                name: input.dnsRecords.ownershipTxt.name,
                value: input.dnsRecords.ownershipTxt.value,
                status: "created",
              },
            ],
          };
        },
      },
    });

    await service.createDomain({ domain: "example.com" });
    const result = await service.configureDomainCloudflare({
      domainId: "domain_1",
      apiToken: " cf-token ",
      zoneId: " zone_1 ",
    });

    expect(result).toMatchObject({
      zoneId: "zone_1",
      zoneName: "example.com",
      records: [{ status: "created" }],
    });
    expect(cloudflareCalls).toMatchObject([
      {
        apiToken: "cf-token",
        domain: "example.com",
        zoneId: "zone_1",
        dnsRecords: {
          ownershipTxt: {
            name: "_emailhub.example.com",
            value: "emailhub-domain-verification=domain_1",
          },
          mx: {
            name: "example.com",
            value: "10 mx.emailhub.local",
          },
        },
      },
    ]);
    await expect(service.listDomains()).resolves.toMatchObject({
      items: [{ id: "domain_1", verificationStatus: "pending" }],
    });
  });

  it("updates catch-all routing without creating a full mail server", async () => {
    const store = createInMemoryDomainAliasStore();
    const service = createDomainAliasService({
      store,
      createId: sequenceIds(["domain_1", "dest_1", "rule_1"]),
      now: () => "2026-06-13T08:00:00.000Z",
    });

    await service.createDomain({ domain: "example.com" });
    await service.createDestination({
      domainId: "domain_1",
      email: "owner@example.net",
    });

    const rule = await service.setCatchAll({
      domainId: "domain_1",
      mode: "forward",
      destinationIds: ["dest_1"],
    });

    expect(rule).toEqual({
      id: "rule_1",
      domainId: "domain_1",
      ruleType: "catch_all",
      enabled: true,
      config: {
        mode: "forward",
        destinationIds: ["dest_1"],
      },
      createdAt: "2026-06-13T08:00:00.000Z",
    });
    expect(await service.getCatchAll({ domainId: "domain_1" })).toEqual({
      item: rule,
    });
  });

  it("does not allow an alias to route to a destination from another domain", async () => {
    const store = createInMemoryDomainAliasStore();
    const service = createDomainAliasService({
      store,
      createId: sequenceIds(["domain_1", "domain_2", "dest_1"]),
      now: () => "2026-06-13T08:00:00.000Z",
    });

    await service.createDomain({ domain: "example.com" });
    await service.createDomain({ domain: "other.com" });
    await service.createDestination({
      domainId: "domain_2",
      email: "owner@example.net",
    });

    await expect(
      service.createAlias({
        domainId: "domain_1",
        localPart: "sales",
        destinationIds: ["dest_1"],
      }),
    ).rejects.toBeInstanceOf(InvalidDomainAliasRequestError);
  });

  it("lists delivery logs in newest-first order", async () => {
    const store = createInMemoryDomainAliasStore();
    const service = createDomainAliasService({
      store,
      createId: sequenceIds(["domain_1", "log_1", "log_2"]),
      now: () => "2026-06-13T08:00:00.000Z",
    });
    await service.createDomain({ domain: "example.com" });
    await store.recordDeliveryLog({
      id: "log_1",
      domainId: "domain_1",
      recipient: "a@example.com",
      status: "accepted",
      detail: "matched alias",
      createdAt: "2026-06-13T08:00:00.000Z",
    });
    await store.recordDeliveryLog({
      id: "log_2",
      domainId: "domain_1",
      recipient: "b@example.com",
      status: "bounced",
      detail: "destination rejected",
      createdAt: "2026-06-13T08:01:00.000Z",
    });

    expect(await service.listDeliveryLogs({ domainId: "domain_1" })).toEqual({
      items: [
        {
          id: "log_2",
          domainId: "domain_1",
          recipient: "b@example.com",
          status: "bounced",
          detail: "destination rejected",
          createdAt: "2026-06-13T08:01:00.000Z",
        },
        {
          id: "log_1",
          domainId: "domain_1",
          recipient: "a@example.com",
          status: "accepted",
          detail: "matched alias",
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    });
  });

  it("rejects invalid domains, local parts, destinations, and catch-all modes", async () => {
    const store = createInMemoryDomainAliasStore();
    const service = createDomainAliasService({
      store,
      createId: sequenceIds(["domain_1"]),
      now: () => "2026-06-13T08:00:00.000Z",
    });

    await expect(service.createDomain({ domain: "bad domain" })).rejects.toBeInstanceOf(
      InvalidDomainAliasRequestError,
    );
    await expect(
      service.createAlias({
        domainId: "missing",
        localPart: "../root",
        destinationIds: [],
      }),
    ).rejects.toBeInstanceOf(InvalidDomainAliasRequestError);
    await expect(
      service.setCatchAll({ domainId: "missing", mode: "forward", destinationIds: [] }),
    ).rejects.toBeInstanceOf(InvalidDomainAliasRequestError);
  });
});

function sequenceIds(ids: string[]): () => string {
  return () => ids.shift() ?? "extra_id";
}
