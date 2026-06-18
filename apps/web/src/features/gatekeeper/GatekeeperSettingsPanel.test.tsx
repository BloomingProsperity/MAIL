import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  EmailHubApi,
  GatekeeperMode,
  GatekeeperSenderDto,
} from "../../lib/emailHubApi";
import { GatekeeperSettingsPanel } from "./GatekeeperSettingsPanel";

function gatekeeperSenderFixture(
  overrides: Partial<GatekeeperSenderDto> = {},
): GatekeeperSenderDto {
  return {
    senderId: "sender_1",
    email: "new-client@example.com",
    domain: "example.com",
    status: "unknown",
    messageCount: 2,
    latestMessageId: "message_1",
    latestReceivedAt: "2026-06-14T08:00:00.000Z",
    bulkAvailable: true,
    ...overrides,
  };
}

function createGatekeeperApiFixture(
  senders: GatekeeperSenderDto[] = [gatekeeperSenderFixture()],
) {
  return {
    getGatekeeperSettings: vi.fn(async () => ({
      accountId: "account_1",
      mode: "off_accept_all" as const,
      updatedAt: "2026-06-14T08:00:00.000Z",
    })),
    updateGatekeeperSettings: vi.fn(
      async (input: { accountId: string; mode: GatekeeperMode }) => ({
        accountId: input.accountId,
        mode: input.mode,
        updatedAt: "2026-06-14T08:05:00.000Z",
      }),
    ),
    listGatekeeperSenders: vi.fn(async () => ({
      items: senders,
    })),
    acceptGatekeeperSender: vi.fn(
      async (input: { accountId: string; senderId: string }) => ({
        senderId: input.senderId,
        email: "new-client@example.com",
        domain: "example.com",
        status: "accepted" as const,
        action: "accept" as const,
        eventId: "screen_event_1",
      }),
    ),
    blockGatekeeperSender: vi.fn(
      async (input: { accountId: string; senderId: string }) => ({
        senderId: input.senderId,
        email: "new-client@example.com",
        domain: "example.com",
        status: "blocked" as const,
        action: "block_sender" as const,
        eventId: "screen_event_2",
      }),
    ),
    bulkDecideGatekeeperSenders: vi.fn(
      async (input: {
        accountId: string;
        senderIds: string[];
        action: "accept" | "block_sender";
      }) => ({
        items: input.senderIds.map((senderId) => ({
          senderId,
          email: "new-client@example.com",
          domain: "example.com",
          status: input.action === "accept" ? "accepted" as const : "blocked" as const,
          action:
            input.action === "accept"
              ? "accept" as const
              : "block_sender" as const,
          eventId: `screen_event_${senderId}`,
        })),
        missingSenderIds: [],
      }),
    ),
    blockGatekeeperDomain: vi.fn(
      async (input: { accountId: string; domain: string }) => ({
        senderId: "domain_rule_1",
        domain: input.domain,
        status: "blocked" as const,
        action: "block_domain" as const,
        eventId: "screen_event_3",
      }),
    ),
  };
}

describe("GatekeeperSettingsPanel", () => {
  it("loads and saves new-sender handling", async () => {
    const api = createGatekeeperApiFixture();

    render(
      <GatekeeperSettingsPanel
        api={api as unknown as EmailHubApi}
        accountId="account_1"
      />,
    );

    await waitFor(() => {
      expect(api.getGatekeeperSettings).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });
    expect(screen.getByRole("heading", { name: "新发件人处理" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "先进入新发件人" }));

    await waitFor(() => {
      expect(api.updateGatekeeperSettings).toHaveBeenCalledWith({
        accountId: "account_1",
        mode: "before_inbox",
      });
    });
    expect(await screen.findByText("当前：先进入新发件人")).toBeTruthy();
  });

  it("decides sender screening rows", async () => {
    const api = createGatekeeperApiFixture();

    render(
      <GatekeeperSettingsPanel
        api={api as unknown as EmailHubApi}
        accountId="account_1"
      />,
    );

    expect(await screen.findByText("new-client@example.com")).toBeTruthy();
    expect(api.listGatekeeperSenders).toHaveBeenCalledWith({
      accountId: "account_1",
      status: "unknown",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Accept sender new-client@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.acceptGatekeeperSender).toHaveBeenCalledWith({
        accountId: "account_1",
        senderId: "sender_1",
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Block domain example.com" }),
    );

    await waitFor(() => {
      expect(api.blockGatekeeperDomain).toHaveBeenCalledWith({
        accountId: "account_1",
        domain: "example.com",
      });
    });
  });

  it("bulk accepts only senders marked bulk available", async () => {
    const api = createGatekeeperApiFixture([
      gatekeeperSenderFixture({ senderId: "sender_1", bulkAvailable: true }),
      gatekeeperSenderFixture({
        senderId: "sender_2",
        email: "manual@example.com",
        bulkAvailable: false,
      }),
    ]);

    render(
      <GatekeeperSettingsPanel
        api={api as unknown as EmailHubApi}
        accountId="account_1"
      />,
    );

    expect(await screen.findByText("manual@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "批量放行" }));

    await waitFor(() => {
      expect(api.bulkDecideGatekeeperSenders).toHaveBeenCalledWith({
        accountId: "account_1",
        senderIds: ["sender_1"],
        action: "accept",
      });
    });
    expect(await screen.findByText(/已放行 1 个发件人。/)).toBeTruthy();
  });
});
