import { describe, expect, it, vi } from "vitest";

import { createCloudflareDnsClient } from "../src/domains/domain-cloudflare";

describe("Cloudflare domain DNS client", () => {
  it("creates missing Email Hub DNS records and skips matching records", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      requests.push({ url: requestUrl, init });

      if (requestUrl.endsWith("/zones?name=example.com&status=active")) {
        return jsonResponse({ result: [{ id: "zone_1", name: "example.com" }] });
      }
      if (requestUrl.includes("type=TXT&name=_emailhub.example.com")) {
        return jsonResponse({
          result: [
            {
              id: "txt_existing",
              type: "TXT",
              name: "_emailhub.example.com",
              content: "emailhub-domain-verification=domain_1",
            },
          ],
        });
      }
      if (requestUrl.includes("/dns_records?")) {
        return jsonResponse({ result: [] });
      }
      const body = JSON.parse(String(init?.body));
      return jsonResponse({
        result: {
          id: "created",
          type: body.type,
          name: body.name,
          content: body.content,
        },
      });
    });
    const client = createCloudflareDnsClient({
      apiBaseUrl: "https://api.cloudflare.test/client/v4",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.setupDomainDns({
      apiToken: "cf-token",
      domain: "example.com",
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
    });

    expect(result).toMatchObject({
      zoneId: "zone_1",
      zoneName: "example.com",
      records: [
        { type: "TXT", status: "existing" },
        { type: "MX", name: "example.com", value: "10 mx.emailhub.local" },
        { type: "TXT", name: "example.com" },
        { type: "TXT", name: "_dmarc.example.com" },
      ],
    });
    expect(requests[0].init?.headers).toMatchObject({
      authorization: "Bearer cf-token",
    });
    const mxCreate = requests.find((request) => {
      if (request.init?.method !== "POST" || !request.init.body) {
        return false;
      }
      return JSON.parse(String(request.init.body)).type === "MX";
    });
    expect(JSON.parse(String(mxCreate?.init?.body))).toMatchObject({
      type: "MX",
      name: "example.com",
      content: "mx.emailhub.local",
      priority: 10,
      ttl: 1,
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      success: status >= 200 && status < 300,
      ...body,
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}
