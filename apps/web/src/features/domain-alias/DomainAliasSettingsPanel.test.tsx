import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EmailHubApi } from "../../lib/emailHubApi";
import { DomainAliasSettingsPanel } from "./DomainAliasSettingsPanel";

function createDomainAliasApiFixture() {
  return {
    createDomain: vi.fn(async (input: { domain: string }) => ({
      id: "domain_1",
      domain: input.domain,
      verificationStatus: "pending",
      dnsRecords: {
        ownershipTxt: {
          type: "TXT",
          name: `_emailhub.${input.domain}`,
          value: "emailhub-domain-verification=domain_1",
        },
      },
      createdAt: "2026-06-13T08:00:00.000Z",
    })),
    listDomains: vi.fn(async () => ({
      items: [
        {
          id: "domain_1",
          domain: "demo.site",
          verificationStatus: "pending",
          dnsRecords: {
            ownershipTxt: {
              type: "TXT",
              name: "_emailhub.demo.site",
              value: "emailhub-domain-verification=domain_1",
            },
            mx: {
              type: "MX",
              name: "demo.site",
              value: "10 mx.emailhub.local",
            },
          },
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    })),
    createDomainDestination: vi.fn(
      async (input: { domainId: string; email: string }) => ({
        id: "dest_1",
        domainId: input.domainId,
        email: input.email,
        verified: false,
        createdAt: "2026-06-13T08:00:00.000Z",
      }),
    ),
    listDomainDestinations: vi.fn(async () => ({
      items: [
        {
          id: "dest_1",
          domainId: "domain_1",
          email: "owner@example.net",
          verified: false,
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    })),
    createDomainAlias: vi.fn(
      async (input: {
        domainId: string;
        localPart: string;
        destinationIds: string[];
      }) => ({
        id: "alias_2",
        domainId: input.domainId,
        address: `${input.localPart}@demo.site`,
        localPart: input.localPart,
        enabled: true,
        destinationIds: input.destinationIds,
        createdAt: "2026-06-13T08:00:00.000Z",
      }),
    ),
    listDomainAliases: vi.fn(async () => ({
      items: [
        {
          id: "alias_1",
          domainId: "domain_1",
          address: "support@demo.site",
          localPart: "support",
          enabled: true,
          destinationIds: ["dest_1"],
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    })),
    setDomainCatchAll: vi.fn(
      async (input: {
        domainId: string;
        mode: "reject" | "forward" | "auto_create" | "discard";
        destinationIds?: string[];
      }) => ({
        id: "rule_1",
        domainId: input.domainId,
        ruleType: "catch_all" as const,
        enabled: true,
        config: {
          mode: input.mode,
          ...(input.destinationIds
            ? { destinationIds: input.destinationIds }
            : {}),
        },
        createdAt: "2026-06-13T08:00:00.000Z",
      }),
    ),
    getDomainCatchAll: vi.fn(async () => ({
      item: {
        id: "rule_1",
        domainId: "domain_1",
        ruleType: "catch_all" as const,
        enabled: true,
        config: { mode: "reject" as const },
        createdAt: "2026-06-13T08:00:00.000Z",
      },
    })),
    listDomainDeliveryLogs: vi.fn(async () => ({
      items: [
        {
          id: "log_1",
          domainId: "domain_1",
          recipient: "support@demo.site",
          status: "delivered",
          createdAt: "2026-06-13T09:00:00.000Z",
        },
      ],
    })),
  };
}

describe("DomainAliasSettingsPanel", () => {
  it("loads domain alias settings from the backend", async () => {
    const api = createDomainAliasApiFixture();

    render(
      <DomainAliasSettingsPanel api={api as unknown as EmailHubApi} mode="domains" />,
    );

    expect((await screen.findAllByText(/demo\.site/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("owner@example.net")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("support@demo.site")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/已送达/)).toBeTruthy();
    expect(api.listDomains).toHaveBeenCalled();
    expect(api.listDomainDestinations).toHaveBeenCalledWith({
      domainId: "domain_1",
    });
    expect(api.listDomainAliases).toHaveBeenCalledWith({
      domainId: "domain_1",
    });
    expect(api.getDomainCatchAll).toHaveBeenCalledWith({
      domainId: "domain_1",
    });
    expect(api.listDomainDeliveryLogs).toHaveBeenCalledWith({
      domainId: "domain_1",
      limit: 20,
    });
  });

  it("configures domains, forwarding targets, aliases, and catch-all", async () => {
    const api = createDomainAliasApiFixture();

    render(
      <DomainAliasSettingsPanel api={api as unknown as EmailHubApi} mode="domains" />,
    );

    await screen.findByText("emailhub-domain-verification=domain_1");

    fireEvent.change(screen.getByLabelText("Domain name"), {
      target: { value: "demo.site" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加域名" }));

    await waitFor(() => {
      expect(api.createDomain).toHaveBeenCalledWith({ domain: "demo.site" });
    });

    fireEvent.change(screen.getByLabelText("Domain destination email"), {
      target: { value: "ops@example.net" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加目标邮箱" }));

    await waitFor(() => {
      expect(api.createDomainDestination).toHaveBeenCalledWith({
        domainId: "domain_1",
        email: "ops@example.net",
      });
    });

    fireEvent.change(screen.getByLabelText("Domain alias local part"), {
      target: { value: "ops" },
    });
    fireEvent.change(screen.getByLabelText("Domain alias destination"), {
      target: { value: "dest_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建别名" }));

    await waitFor(() => {
      expect(api.createDomainAlias).toHaveBeenCalledWith({
        domainId: "domain_1",
        localPart: "ops",
        destinationIds: ["dest_1"],
      });
    });

    fireEvent.change(screen.getByLabelText("Domain catch-all mode"), {
      target: { value: "forward" },
    });
    fireEvent.change(screen.getByLabelText("Domain catch-all destination"), {
      target: { value: "dest_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 Catch-all" }));

    await waitFor(() => {
      expect(api.setDomainCatchAll).toHaveBeenCalledWith({
        domainId: "domain_1",
        mode: "forward",
        destinationIds: ["dest_1"],
      });
    });
    expect(await screen.findByText(/Catch-all 已设置为转发/)).toBeTruthy();
  });
});
