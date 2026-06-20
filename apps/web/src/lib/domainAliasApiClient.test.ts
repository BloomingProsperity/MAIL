import { describe, expect, it, vi } from "vitest";

import { createEmailHubApi } from "./emailHubApi";

describe("domain alias API client", () => {
  it("verifies domains and applies Cloudflare DNS records", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/domains/domain_1/verify") {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          id: "domain_1",
          domain: "demo.site",
          verificationStatus: "verified",
          dnsRecords: {},
          createdAt: "2026-06-13T08:00:00.000Z",
        });
      }

      expect(url).toBe("/api/domains/domain_1/cloudflare/dns-records");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        apiToken: "cf-token",
        zoneId: "zone_1",
      });
      return jsonResponse({
        zoneId: "zone_1",
        zoneName: "demo.site",
        records: [
          {
            type: "TXT",
            name: "_emailhub.demo.site",
            value: "emailhub-domain-verification=domain_1",
            status: "created",
          },
        ],
      });
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const verified = await api.verifyDomain({ domainId: "domain_1" });
    const cloudflare = await api.configureDomainCloudflare({
      domainId: "domain_1",
      apiToken: "cf-token",
      zoneId: "zone_1",
    });

    expect(verified.verificationStatus).toBe("verified");
    expect(cloudflare.records[0].status).toBe("created");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
